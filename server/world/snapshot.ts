/**
 * Read-only access to a live Bedrock world.
 *
 * The LevelDB build shipped with BDS does not take an exclusive lock, so a
 * mapper *can* open the server's live `db/` directory - but it must not.
 * Opening a LevelDB read/write replays the write-ahead log and may compact
 * tables, which rewrites `.ldb` files, `MANIFEST-*` and `CURRENT` underneath
 * the running server. (Verified against BDS 1.26.51.1: a single open() of a
 * live world rewrote three table files and the manifest.)
 *
 * So we never touch the server's directory with LevelDB. We copy `db/` into the
 * cache directory and open the copy. Copies live in a directory named after the
 * state of the source they were taken from, which means:
 *
 *   - an unchanged world reuses its copy, so restarts and refreshes are cheap;
 *   - a changed world gets a *new* directory while the previous copy stays
 *     open and serving, so a failed snapshot can never replace a good one.
 *
 * The copy runs against a database that BDS is writing to. That is safe as long
 * as nothing is assumed about consistency: table files are copied before the
 * manifest and the log, files that vanish mid-copy (compaction) are tolerated,
 * files that appear mid-copy are picked up by a second sweep, and a torn tail on
 * the write-ahead log is recovered by LevelDB - on the copy, never on the
 * source. Anything the copy still cannot make sense of surfaces as a failed
 * open, which the caller treats as "keep the previous snapshot and retry".
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** LevelDB bookkeeping files that must not be copied into the snapshot. */
const EXCLUDED_FILES = new Set(['LOCK', 'LOG', 'LOG.old']);

/** Immutable once written, so they are the safest thing to copy first. */
const TABLE_FILE = /\.(ldb|sst)$/;

/** Marker written after a copy is complete; its absence means "do not reuse". */
const MARKER_FILE = 'source-fingerprint.json';

export interface SnapshotResult {
  /** Directory holding the copied LevelDB, safe to open read/write. */
  dbPath: string;
  /** Directory holding `db/` and the snapshot marker. */
  root: string;
  /** True when files were copied, false when an up-to-date copy was reused. */
  copied: boolean;
  fileCount: number;
  byteCount: number;
  /**
   * Identifies the source world's contents. Changes whenever the BDS world
   * changes, so derived caches (map tiles) can tell when they are stale.
   */
  sourceId: string;
  /** Milliseconds spent copying (0 when an existing copy was reused). */
  copyMs: number;
  /** Source files that disappeared while being copied, e.g. by compaction. */
  vanishedFiles: string[];
  /** True when the source changed while the copy was running. */
  sourceChangedDuringCopy: boolean;
}

export interface SourceFingerprint {
  files: Record<string, { size: number; mtimeMs: number }>;
}

export interface SourceState {
  fingerprint: SourceFingerprint;
  /** Changes whenever any file of the source database changes. */
  sourceId: string;
  fileCount: number;
  byteCount: number;
}

function sourceDbPath(worldPath: string): string {
  return path.join(worldPath, 'db');
}

async function fingerprintSource(sourceDb: string): Promise<SourceFingerprint> {
  const entries = await fs.readdir(sourceDb, { withFileTypes: true });
  const files: SourceFingerprint['files'] = {};
  for (const entry of entries) {
    if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue;
    const stat = await fs.stat(path.join(sourceDb, entry.name)).catch(() => null);
    // A file BDS deleted between readdir() and stat() simply is not part of
    // this fingerprint.
    if (stat) files[entry.name] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  // Sorted so the serialisation - and with it the id - is stable.
  const sorted: SourceFingerprint['files'] = {};
  for (const name of Object.keys(files).sort()) sorted[name] = files[name]!;
  return { files: sorted };
}

function stateOf(fingerprint: SourceFingerprint): SourceState {
  const names = Object.keys(fingerprint.files);
  return {
    fingerprint,
    sourceId: createHash('sha1').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 16),
    fileCount: names.length,
    byteCount: names.reduce((sum, name) => sum + fingerprint.files[name]!.size, 0),
  };
}

/**
 * Cheap check of what the live world looks like right now: one readdir plus a
 * stat per file (a handful of files, even for a large world). This is what the
 * refresh loop runs on its interval to decide whether there is anything to do.
 */
export async function readSourceState(worldPath: string): Promise<SourceState> {
  const sourceDb = sourceDbPath(worldPath);
  const stat = await fs.stat(sourceDb).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`No LevelDB found at ${sourceDb} - is WORLD_PATH a Bedrock world directory?`);
  }
  return stateOf(await fingerprintSource(sourceDb));
}

/** Root of every snapshot taken of one world. */
export function snapshotRootFor(worldPath: string, cacheDir: string): string {
  const worldId = createHash('sha1').update(path.resolve(worldPath)).digest('hex').slice(0, 12);
  return path.join(cacheDir, 'world-snapshot', worldId);
}

async function copyFileIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await fs.copyFile(from, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Copies the database files, tolerating a source that is being written to.
 *
 * Tables first (immutable), then the log and the manifest, then repeated sweeps
 * for files that appeared in the meantime - the manifest we copied may name a
 * table that BDS created after our first pass.
 */
async function copyDatabase(
  sourceDb: string,
  targetDb: string,
  fingerprint: SourceFingerprint,
): Promise<{ vanished: string[] }> {
  const names = Object.keys(fingerprint.files);
  const tables = names.filter((name) => TABLE_FILE.test(name));
  const logs = names.filter((name) => name.endsWith('.log'));
  const manifests = names.filter((name) => name.startsWith('MANIFEST'));
  const ordered = [
    ...tables,
    ...logs,
    ...manifests,
    // CURRENT names the manifest to use, so it is copied last.
    ...names.filter(
      (name) => !tables.includes(name) && !logs.includes(name) && !manifests.includes(name),
    ),
  ];

  const copied = new Set<string>();
  const vanished: string[] = [];
  for (const name of ordered) {
    if (await copyFileIfPresent(path.join(sourceDb, name), path.join(targetDb, name))) {
      copied.add(name);
    } else {
      vanished.push(name);
    }
  }

  for (let sweep = 0; sweep < 2; sweep++) {
    const current = await fs.readdir(sourceDb).catch(() => [] as string[]);
    const extra = current.filter((name) => !EXCLUDED_FILES.has(name) && !copied.has(name));
    if (!extra.length) break;
    for (const name of extra) {
      if (await copyFileIfPresent(path.join(sourceDb, name), path.join(targetDb, name))) {
        copied.add(name);
      }
    }
  }

  return { vanished };
}

/**
 * Checks the copy is at least self-consistent before anyone opens it: CURRENT
 * must name a manifest that we actually have.
 */
async function verifyCopy(sourceDb: string, targetDb: string): Promise<void> {
  const current = await fs.readFile(path.join(targetDb, 'CURRENT'), 'utf8').catch(() => null);
  if (!current) throw new Error('snapshot is missing CURRENT');
  const manifest = current.trim();
  if (!manifest) throw new Error('snapshot has an empty CURRENT');

  const exists = await fs
    .stat(path.join(targetDb, manifest))
    .then(() => true)
    .catch(() => false);
  if (exists) return;

  // The manifest was rotated while we copied; fetch the one CURRENT points at.
  if (!(await copyFileIfPresent(path.join(sourceDb, manifest), path.join(targetDb, manifest)))) {
    throw new Error(`snapshot CURRENT points at ${manifest}, which the source no longer has`);
  }
}

export interface SnapshotOptions {
  /** Skip reusing an existing copy, e.g. when one turned out to be unusable. */
  force?: boolean;
  /** Source state already read by the caller, to avoid stat-ing twice. */
  state?: SourceState;
}

/**
 * Copies the world's LevelDB into `cacheDir` unless an up-to-date copy exists.
 *
 * The source world is only ever read, never opened as a database.
 */
export async function snapshotWorld(
  worldPath: string,
  cacheDir: string,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const sourceDb = sourceDbPath(worldPath);
  const state = options.state ?? (await readSourceState(worldPath));
  const root = path.join(snapshotRootFor(worldPath, cacheDir), state.sourceId);
  const dbPath = path.join(root, 'db');
  const markerPath = path.join(root, MARKER_FILE);

  const complete = await fs
    .readFile(markerPath, 'utf8')
    .then(() => true)
    .catch(() => false);
  if (complete && !options.force) {
    return {
      dbPath,
      root,
      copied: false,
      fileCount: state.fileCount,
      byteCount: state.byteCount,
      sourceId: state.sourceId,
      copyMs: 0,
      vanishedFiles: [],
      sourceChangedDuringCopy: false,
    };
  }

  // A half-copied or already-opened directory is never merged into: opening a
  // snapshot mutates it (log replay, compaction), so every copy starts clean.
  const startedAt = performance.now();
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(dbPath, { recursive: true });
  let vanished: string[];
  try {
    vanished = (await copyDatabase(sourceDb, dbPath, state.fingerprint)).vanished;
    await verifyCopy(sourceDb, dbPath);
  } catch (error) {
    // Leave nothing behind that a later refresh could mistake for a good copy.
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const after = await fingerprintSource(sourceDb).catch(() => null);
  const sourceChangedDuringCopy =
    after !== null && JSON.stringify(after) !== JSON.stringify(state.fingerprint);

  // The marker records the source state this copy was taken *from*, so a source
  // that moved on during the copy is picked up by the next refresh instead of
  // being mistaken for a copy of the newer state.
  await fs.writeFile(markerPath, JSON.stringify(state.fingerprint));

  return {
    dbPath,
    root,
    copied: true,
    fileCount: state.fileCount,
    byteCount: state.byteCount,
    sourceId: state.sourceId,
    copyMs: performance.now() - startedAt,
    vanishedFiles: vanished,
    sourceChangedDuringCopy,
  };
}

/** Removes a snapshot copy, e.g. one that could not be opened. */
export async function discardSnapshot(snapshot: Pick<SnapshotResult, 'root'>): Promise<void> {
  await fs.rm(snapshot.root, { recursive: true, force: true });
}

/** Deletes every snapshot of a world except the ones still in use. */
export async function pruneSnapshots(
  worldPath: string,
  cacheDir: string,
  keepSourceIds: readonly string[],
): Promise<string[]> {
  const root = snapshotRootFor(worldPath, cacheDir);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (keepSourceIds.includes(entry.name)) continue;
    await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

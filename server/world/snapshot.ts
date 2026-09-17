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
 * So we never touch the server's directory with LevelDB. We copy `db/` into
 * the cache directory and open the copy. The copy is refreshed only when the
 * source files change, so repeated startups and refreshes are cheap.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** LevelDB bookkeeping files that must not be copied into the snapshot. */
const EXCLUDED_FILES = new Set(['LOCK', 'LOG', 'LOG.old']);

export interface SnapshotResult {
  /** Directory holding the copied LevelDB, safe to open read/write. */
  dbPath: string;
  /** True when files were copied, false when an up-to-date copy was reused. */
  copied: boolean;
  fileCount: number;
  byteCount: number;
  /**
   * Identifies the source world's contents. Changes whenever the BDS world
   * changes, so derived caches (map tiles) can tell when they are stale.
   */
  sourceId: string;
}

interface SourceFingerprint {
  files: Record<string, { size: number; mtimeMs: number }>;
}

async function fingerprintSource(sourceDb: string): Promise<SourceFingerprint> {
  const entries = await fs.readdir(sourceDb, { withFileTypes: true });
  const files: SourceFingerprint['files'] = {};
  for (const entry of entries) {
    if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue;
    const stat = await fs.stat(path.join(sourceDb, entry.name));
    files[entry.name] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  return { files };
}

function fingerprintId(worldPath: string): string {
  return createHash('sha1').update(path.resolve(worldPath)).digest('hex').slice(0, 12);
}

/**
 * Copies the world's LevelDB into `cacheDir` unless an up-to-date copy exists.
 *
 * The source world is only ever read, never opened as a database.
 */
export async function snapshotWorld(worldPath: string, cacheDir: string): Promise<SnapshotResult> {
  const sourceDb = path.join(worldPath, 'db');
  const sourceStat = await fs.stat(sourceDb).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`No LevelDB found at ${sourceDb} - is WORLD_PATH a Bedrock world directory?`);
  }

  const snapshotRoot = path.join(cacheDir, 'world-snapshot', fingerprintId(worldPath));
  const dbPath = path.join(snapshotRoot, 'db');
  const fingerprintPath = path.join(snapshotRoot, 'source-fingerprint.json');

  const fingerprint = await fingerprintSource(sourceDb);
  const previous = await fs
    .readFile(fingerprintPath, 'utf8')
    .then((raw) => JSON.parse(raw) as SourceFingerprint)
    .catch(() => null);

  const fileNames = Object.keys(fingerprint.files);
  const byteCount = fileNames.reduce((sum, name) => sum + fingerprint.files[name]!.size, 0);
  const serialized = JSON.stringify(fingerprint);
  const sourceId = createHash('sha1').update(serialized).digest('hex').slice(0, 16);

  if (previous && JSON.stringify(previous) === serialized) {
    return { dbPath, copied: false, fileCount: fileNames.length, byteCount, sourceId };
  }

  // Opening the snapshot mutates it (log replay, compaction), so a changed
  // source always gets a clean copy rather than a file-by-file merge.
  await fs.rm(snapshotRoot, { recursive: true, force: true });
  await fs.mkdir(dbPath, { recursive: true });
  for (const name of fileNames) {
    await fs.copyFile(path.join(sourceDb, name), path.join(dbPath, name));
  }
  await fs.writeFile(fingerprintPath, serialized);

  return { dbPath, copied: true, fileCount: fileNames.length, byteCount, sourceId };
}

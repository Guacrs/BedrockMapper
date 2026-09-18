/**
 * Cache housekeeping.
 *
 * Everything the server writes lives under MAP_CACHE:
 *
 *   <cache>/world-snapshot/<worldId>/<sourceId>/db/   copies of the world database
 *   <cache>/world-snapshot/<worldId>/<sourceId>/source-fingerprint.json
 *   <cache>/tiles/source.json                         which snapshot the tiles match
 *   <cache>/tiles/<dimension>/<zoom>/<x>/<y>.png      rendered tiles
 *
 * A snapshot directory is only reusable once its fingerprint marker exists, so a
 * copy interrupted by a crash or a kill is dead weight; the same goes for the
 * `.tmp` files a tile write renames from. Neither is ever read again, so both are
 * swept away: at startup, on shutdown, and on a slow timer in between. Rendered
 * tiles are left alone - they are the expensive thing to rebuild, and they are
 * invalidated precisely by the refresh loop instead.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { snapshotRootFor } from './world/snapshot.ts';

/** Temporary files younger than this may belong to an in-flight write. */
const DEFAULT_TEMP_GRACE_MS = 60_000;

export interface CleanupResult {
  /** Source ids of snapshot copies that were deleted. */
  snapshotsRemoved: string[];
  /** Abandoned `*.tmp` tile writes and write probes that were deleted. */
  tempFilesRemoved: number;
  bytesFreed: number;
}

export interface CleanupOptions {
  worldPath: string;
  /** Snapshot source ids that are in use and must survive. */
  keepSourceIds: readonly string[];
  /** Ignore temporary files newer than this. 0 deletes them all. */
  tempGraceMs?: number;
}

const TEMP_FILE = /(\.tmp|^\.write-probe-)/;

async function removeTempFiles(
  directory: string,
  olderThanMs: number,
  result: CleanupResult,
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeTempFiles(target, olderThanMs, result);
      continue;
    }
    if (!TEMP_FILE.test(entry.name)) continue;
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) continue;
    if (olderThanMs > 0 && now - stat.mtimeMs < olderThanMs) continue;
    if (await fs.rm(target, { force: true }).then(() => true).catch(() => false)) {
      result.tempFilesRemoved++;
      result.bytesFreed += stat.size;
    }
  }
}

async function directorySize(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else total += (await fs.stat(target).catch(() => null))?.size ?? 0;
  }
  return total;
}

/**
 * Deletes snapshot copies that are no longer in use plus abandoned temporary
 * files. Never touches a cached tile.
 */
export async function cleanCache(cacheDir: string, options: CleanupOptions): Promise<CleanupResult> {
  const result: CleanupResult = { snapshotsRemoved: [], tempFilesRemoved: 0, bytesFreed: 0 };
  const grace = options.tempGraceMs ?? DEFAULT_TEMP_GRACE_MS;
  const now = Date.now();

  const snapshotRoot = snapshotRootFor(options.worldPath, cacheDir);
  const entries = await fs.readdir(snapshotRoot, { withFileTypes: true }).catch(() => []);
  const keep = new Set(options.keepSourceIds);
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const target = path.join(snapshotRoot, entry.name);
    if (grace > 0) {
      const stat = await fs.stat(target).catch(() => null);
      // A snapshot directory that was just created is likely a copy still in
      // flight; leaving it alone for a minute avoids deleting a refresh's work.
      if (stat && now - stat.mtimeMs < grace) continue;
    }
    result.bytesFreed += await directorySize(target);
    await fs.rm(target, { recursive: true, force: true });
    result.snapshotsRemoved.push(entry.name);
  }

  await removeTempFiles(cacheDir, grace, result);

  return result;
}

/** True when a cleanup found something worth mentioning in the log. */
export function cleanupHappened(result: CleanupResult): boolean {
  return result.snapshotsRemoved.length > 0 || result.tempFilesRemoved > 0;
}

/**
 * On-disk tile cache.
 *
 * Tiles are keyed by dimension/zoom/x/y under the cache directory. The cache
 * records which world snapshot produced it; if the BDS world has changed since,
 * the whole tile directory is dropped rather than serving stale terrain.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DimensionId } from '../world/dimensions.ts';

export interface TileCacheStats {
  hits: number;
  misses: number;
  writes: number;
}

export class TileCache {
  readonly root: string;
  readonly sourceId: string;
  readonly clearedStaleTiles: boolean;
  readonly stats: TileCacheStats = { hits: 0, misses: 0, writes: 0 };

  private constructor(root: string, sourceId: string, clearedStaleTiles: boolean) {
    this.root = root;
    this.sourceId = sourceId;
    this.clearedStaleTiles = clearedStaleTiles;
  }

  static async create(cacheDir: string, sourceId: string): Promise<TileCache> {
    const root = path.join(cacheDir, 'tiles');
    const stampPath = path.join(root, 'source.json');
    const previous = await fs
      .readFile(stampPath, 'utf8')
      .then((raw) => (JSON.parse(raw) as { sourceId?: string }).sourceId)
      .catch(() => undefined);

    const stale = previous !== undefined && previous !== sourceId;
    if (stale) await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    if (previous !== sourceId) await fs.writeFile(stampPath, JSON.stringify({ sourceId }));

    return new TileCache(root, sourceId, stale);
  }

  tilePath(dimension: DimensionId, zoom: number, x: number, y: number): string {
    return path.join(this.root, dimension, String(zoom), String(x), `${y}.png`);
  }

  async read(dimension: DimensionId, zoom: number, x: number, y: number): Promise<Buffer | null> {
    const bytes = await fs.readFile(this.tilePath(dimension, zoom, x, y)).catch(() => null);
    if (bytes) this.stats.hits++;
    else this.stats.misses++;
    return bytes;
  }

  async write(
    dimension: DimensionId,
    zoom: number,
    x: number,
    y: number,
    bytes: Uint8Array,
  ): Promise<void> {
    const file = this.tilePath(dimension, zoom, x, y);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write to a temporary file first so a concurrent request never reads a
    // half-written PNG.
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, file);
    this.stats.writes++;
  }

  /** Drops every cached tile, e.g. for a manual map refresh. */
  async clear(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(path.join(this.root, 'source.json'), JSON.stringify({ sourceId: this.sourceId }));
  }
}

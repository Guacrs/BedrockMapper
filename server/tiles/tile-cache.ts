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
  invalidated: number;
}

export class TileCache {
  readonly root: string;
  readonly clearedStaleTiles: boolean;
  readonly stats: TileCacheStats = { hits: 0, misses: 0, writes: 0, invalidated: 0 };

  #sourceId: string;

  private constructor(root: string, sourceId: string, clearedStaleTiles: boolean) {
    this.root = root;
    this.#sourceId = sourceId;
    this.clearedStaleTiles = clearedStaleTiles;
  }

  get sourceId(): string {
    return this.#sourceId;
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

  /**
   * Drops one cached tile. Returns true when a tile was actually cached, which
   * is what tells a refresh whether the tile is worth drawing again right away.
   */
  async invalidate(dimension: DimensionId, zoom: number, x: number, y: number): Promise<boolean> {
    const removed = await fs
      .rm(this.tilePath(dimension, zoom, x, y))
      .then(() => true)
      .catch(() => false);
    if (removed) this.stats.invalidated++;
    return removed;
  }

  /**
   * Records that the tiles now correspond to a newer world snapshot. Used after
   * an incremental refresh, where only the affected tiles were invalidated and
   * the rest are still correct.
   */
  async setSourceId(sourceId: string): Promise<void> {
    if (sourceId === this.#sourceId) return;
    this.#sourceId = sourceId;
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(path.join(this.root, 'source.json'), JSON.stringify({ sourceId }));
  }

  /** Drops every cached tile, e.g. for a manual map refresh. */
  async clear(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(path.join(this.root, 'source.json'), JSON.stringify({ sourceId: this.#sourceId }));
  }
}

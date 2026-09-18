/**
 * Ties the verified world reader to the tile pipeline.
 *
 * Chunk surfaces are decoded once and kept in memory, and finished tiles are
 * cached on disk, so a browser panning around does not re-decode LevelDB.
 *
 * `refresh()` keeps that state in step with a running server: it takes a fresh
 * read-only snapshot when the live world has changed, works out which chunks
 * gained, lost or changed block data, and throws away only the cached surfaces
 * and tiles that those chunks feed into. The previous snapshot keeps serving
 * until the new one is open and scanned, so a snapshot taken mid-write can never
 * replace a working map.
 */

import { silentLogger, type Logger } from './log.ts';
import { encodePng } from './renderer/chunk-image.ts';
import {
  NATIVE_ZOOM,
  TILE_SIZE,
  boundsCenter,
  boundsOfChunks,
  chunkBoundsToBlockBounds,
  tileRangeForBlockBounds,
  tilesAffectedByChunk,
  type Bounds,
  type TilePos,
} from './tiles/coords.ts';
import { CHUNKS_PER_TILE } from './tiles/coords.ts';
import { TileCache } from './tiles/tile-cache.ts';
import { renderTile } from './tiles/tile-renderer.ts';
import { chunkId, diffChunkDigests, type ChunkDigests } from './world/chunk-diff.ts';
import { OVERWORLD, SUPPORTED_DIMENSIONS, type Dimension, type DimensionId } from './world/dimensions.ts';
import {
  discardSnapshot,
  pruneSnapshots,
  readSourceState,
  snapshotWorld,
  type SourceState,
} from './world/snapshot.ts';
import { readChunkSurface, type ChunkSurface } from './world/surface.ts';
import { BedrockWorld, type WorldScan } from './world/world.ts';

/** Upper bound on cached chunk surfaces (~1 KB each). */
const SURFACE_CACHE_LIMIT = 8192;

/** How many invalidated tiles are redrawn at once during a refresh. */
const REFRESH_RENDER_CONCURRENCY = 4;

export interface MapInfo {
  world: { name: string; version: string | null };
  dimension: DimensionId;
  dimensions: DimensionId[];
  tileSize: number;
  chunksPerTile: number;
  /** Server-rendered zoom level: 1 pixel per block. */
  nativeZoom: number;
  minZoom: number;
  maxZoom: number;
  chunkCount: number;
  chunkBounds: Bounds | null;
  blockBounds: Bounds | null;
  tileBounds: Bounds | null;
  center: { x: number; z: number } | null;
}

/** What the browser polls for: has the terrain changed, and how does it look now. */
export interface MapState {
  /** Incremented whenever terrain changed; part of the tile URL. */
  version: number;
  /** When the terrain last changed, or null if it has not since startup. */
  terrainUpdatedAt: string | null;
  chunkCount: number;
  chunkBounds: Bounds | null;
  blockBounds: Bounds | null;
  tileBounds: Bounds | null;
  center: { x: number; z: number } | null;
}

export interface RefreshStats {
  at: string;
  /** False when the live world's files were untouched since the last check. */
  sourceChanged: boolean;
  /** False when an existing snapshot of the same world state was reused. */
  snapshotCopied: boolean;
  snapshotMs: number;
  scanMs: number;
  chunksScanned: number;
  addedChunks: number;
  changedChunks: number;
  removedChunks: number;
  /** Chunk surfaces decoded as part of the refresh. */
  chunksDecoded: number;
  tilesInvalidated: number;
  tilesRegenerated: number;
  /** Redrawn tiles that really came out different, i.e. what the browser needs. */
  tilesChanged: number;
  totalMs: number;
  version: number;
  /** Set when the refresh failed; the previous snapshot is still being served. */
  error: string | null;
}

export interface TileResult {
  bytes: Uint8Array;
  /** True when the tile came from the disk cache. */
  cached: boolean;
  /** True when no chunk in the tile has block data. */
  empty: boolean;
}

export interface MapServiceOptions {
  worldPath: string;
  cacheDir: string;
  minZoom?: number;
  maxZoom?: number;
  log?: Logger;
}

interface WorldState {
  chunksWithData: Set<string>;
  digests: ChunkDigests;
  info: MapInfo;
}

function stateFromScan(world: BedrockWorld, scan: WorldScan, options: MapServiceOptions): WorldState {
  const withData = scan.chunks.filter((chunk) => chunk.subChunkIndices.length > 0);
  const chunkBounds = boundsOfChunks(withData);
  const blockBounds = chunkBounds ? chunkBoundsToBlockBounds(chunkBounds) : null;

  return {
    chunksWithData: new Set(withData.map((chunk) => chunkId(chunk.x, chunk.z))),
    digests: scan.digests,
    info: {
      world: { name: world.levelInfo.name, version: world.levelInfo.lastOpenedWithVersion },
      dimension: OVERWORLD.id,
      dimensions: SUPPORTED_DIMENSIONS.map((dimension) => dimension.id),
      tileSize: TILE_SIZE,
      chunksPerTile: CHUNKS_PER_TILE,
      nativeZoom: NATIVE_ZOOM,
      minZoom: options.minZoom ?? -4,
      maxZoom: options.maxZoom ?? 4,
      chunkCount: withData.length,
      chunkBounds,
      blockBounds,
      tileBounds: blockBounds ? tileRangeForBlockBounds(blockBounds) : null,
      center: blockBounds ? boundsCenter(blockBounds) : null,
    },
  };
}

export class MapService {
  readonly tileCache: TileCache;

  #options: MapServiceOptions;
  #world: BedrockWorld;
  #state: WorldState;
  #dimension: Dimension = OVERWORLD;
  #surfaces = new Map<string, ChunkSurface | null>();
  #surfacesInFlight = new Map<string, Promise<ChunkSurface | null>>();
  #inFlight = new Map<string, Promise<TileResult>>();
  #emptyTile: Uint8Array;
  #decodedChunks = 0;
  #version = 1;
  #terrainUpdatedAt: string | null = null;
  #refreshing: Promise<RefreshStats> | null = null;
  #lastRefresh: RefreshStats | null = null;
  #refreshCount = 0;
  #failedRefreshCount = 0;
  #consecutiveRefreshFailures = 0;
  #cacheWriteFailures = 0;
  #cacheWriteFailureReported = false;
  #log: Logger;

  private constructor(
    options: MapServiceOptions,
    world: BedrockWorld,
    tileCache: TileCache,
    state: WorldState,
  ) {
    this.#options = options;
    this.#log = options.log ?? silentLogger;
    this.#world = world;
    this.tileCache = tileCache;
    this.#state = state;
    this.#emptyTile = encodePng({
      width: TILE_SIZE,
      height: TILE_SIZE,
      data: new Uint8Array(TILE_SIZE * TILE_SIZE * 4),
    });
  }

  static async create(options: MapServiceOptions): Promise<MapService> {
    const world = await BedrockWorld.open({
      worldPath: options.worldPath,
      cacheDir: options.cacheDir,
    });
    const tileCache = await TileCache.create(options.cacheDir, world.snapshot.sourceId);
    const scan = await world.scan(OVERWORLD);
    await pruneSnapshots(options.worldPath, options.cacheDir, [world.snapshot.sourceId]);
    return new MapService(options, world, tileCache, stateFromScan(world, scan, options));
  }

  get world(): BedrockWorld {
    return this.#world;
  }

  get info(): MapInfo {
    return this.#state.info;
  }

  get version(): number {
    return this.#version;
  }

  get state(): MapState {
    const info = this.#state.info;
    return {
      version: this.#version,
      terrainUpdatedAt: this.#terrainUpdatedAt,
      chunkCount: info.chunkCount,
      chunkBounds: info.chunkBounds,
      blockBounds: info.blockBounds,
      tileBounds: info.tileBounds,
      center: info.center,
    };
  }

  get lastRefresh(): RefreshStats | null {
    return this.#lastRefresh;
  }

  get refreshCount(): number {
    return this.#refreshCount;
  }

  get failedRefreshCount(): number {
    return this.#failedRefreshCount;
  }

  /** Failures since the last successful refresh; 0 means the map is current. */
  get consecutiveRefreshFailures(): number {
    return this.#consecutiveRefreshFailures;
  }

  /** Tiles that were rendered and served but could not be cached. */
  get cacheWriteFailures(): number {
    return this.#cacheWriteFailures;
  }

  get decodedChunks(): number {
    return this.#decodedChunks;
  }

  hasChunkData(chunkX: number, chunkZ: number): boolean {
    return this.#state.chunksWithData.has(chunkId(chunkX, chunkZ));
  }

  /**
   * Decoded surface for a chunk, memoised. Chunks the world does not store are
   * never looked up in the database, and two tiles wanting the same chunk at the
   * same time share one decode.
   */
  async surface(chunkX: number, chunkZ: number): Promise<ChunkSurface | null> {
    const key = chunkId(chunkX, chunkZ);
    if (this.#surfaces.has(key)) return this.#surfaces.get(key)!;
    if (!this.hasChunkData(chunkX, chunkZ)) {
      this.#surfaces.set(key, null);
      return null;
    }

    const pending = this.#surfacesInFlight.get(key);
    if (pending) return pending;

    const work = (async (): Promise<ChunkSurface | null> => {
      const surface = await readChunkSurface(this.#world, this.#dimension, chunkX, chunkZ);
      this.#decodedChunks++;
      if (this.#surfaces.size >= SURFACE_CACHE_LIMIT) {
        // Plain FIFO eviction; panning tends to move on rather than come back.
        const oldest = this.#surfaces.keys().next().value;
        if (oldest !== undefined) this.#surfaces.delete(oldest);
      }
      this.#surfaces.set(key, surface);
      return surface;
    })().finally(() => this.#surfacesInFlight.delete(key));

    this.#surfacesInFlight.set(key, work);
    return work;
  }

  /** PNG for a tile. Empty areas resolve to a fully transparent tile. */
  async tile(dimension: DimensionId, zoom: number, x: number, y: number): Promise<TileResult> {
    if (dimension !== this.#dimension.id) throw new Error(`Dimension not rendered: ${dimension}`);
    if (zoom !== NATIVE_ZOOM) throw new Error(`Only zoom ${NATIVE_ZOOM} is rendered, got ${zoom}`);

    const key = `${dimension}/${zoom}/${x}/${y}`;
    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const work = (async (): Promise<TileResult> => {
      const cached = await this.tileCache.read(dimension, zoom, x, y);
      if (cached) return { bytes: cached, cached: true, empty: false };

      const image = await renderTile(x, y, (chunkX, chunkZ) => this.surface(chunkX, chunkZ));
      if (!image) return { bytes: this.#emptyTile, cached: false, empty: true };

      const bytes = encodePng(image);
      // A cache that cannot be written to (full disk, permissions changed under
      // a running server) costs performance, not correctness: the tile has
      // already been drawn, so it is served either way.
      try {
        await this.tileCache.write(dimension, zoom, x, y, bytes);
        this.#cacheWriteFailureReported = false;
      } catch (error) {
        this.#cacheWriteFailures++;
        if (!this.#cacheWriteFailureReported) {
          this.#cacheWriteFailureReported = true;
          this.#log.warn('cache.write_failed', {
            tile: `${dimension}/${zoom}/${x}/${y}`,
            error: message(error),
            note: 'tiles are still being served, but every request has to redraw them',
          });
        }
      }
      return { bytes, cached: false, empty: false };
    })().finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, work);
    return work;
  }

  /**
   * Brings the map up to date with the live world.
   *
   * Cheap when nothing changed: one readdir plus a stat per database file. When
   * the world did change, a new snapshot is taken and compared against the
   * previous one chunk by chunk, and only the tiles that the changed chunks are
   * drawn into are dropped.
   *
   * Never throws: a failure leaves the previous snapshot in place and is
   * reported in the returned stats.
   */
  async refresh(): Promise<RefreshStats> {
    // Concurrent callers (the timer and a manual refresh) share one run.
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#runRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #runRefresh(): Promise<RefreshStats> {
    const startedAt = performance.now();
    const stats: RefreshStats = {
      at: new Date().toISOString(),
      sourceChanged: false,
      snapshotCopied: false,
      snapshotMs: 0,
      scanMs: 0,
      chunksScanned: 0,
      addedChunks: 0,
      changedChunks: 0,
      removedChunks: 0,
      chunksDecoded: 0,
      tilesInvalidated: 0,
      tilesRegenerated: 0,
      tilesChanged: 0,
      totalMs: 0,
      version: this.#version,
      error: null,
    };
    this.#refreshCount++;

    const finish = (): RefreshStats => {
      stats.totalMs = performance.now() - startedAt;
      stats.version = this.#version;
      this.#lastRefresh = stats;
      return stats;
    };

    let source: SourceState;
    try {
      source = await readSourceState(this.#options.worldPath);
    } catch (error) {
      this.#failedRefreshCount++;
      this.#consecutiveRefreshFailures++;
      stats.error = `could not read the world directory: ${message(error)}`;
      return finish();
    }

    if (source.sourceId === this.#world.snapshot.sourceId) {
      this.#consecutiveRefreshFailures = 0;
      return finish();
    }
    stats.sourceChanged = true;

    // Everything below runs against a *new* snapshot while the previous one
    // keeps serving, so a copy that turns out to be unusable changes nothing.
    let next: BedrockWorld | null = null;
    let scan: WorldScan;
    let snapshotRoot: string | null = null;
    try {
      const snapshot = await snapshotWorld(this.#options.worldPath, this.#options.cacheDir, {
        state: source,
        force: true,
      });
      snapshotRoot = snapshot.root;
      stats.snapshotCopied = snapshot.copied;
      stats.snapshotMs = snapshot.copyMs;
      next = await BedrockWorld.open({
        worldPath: this.#options.worldPath,
        cacheDir: this.#options.cacheDir,
        snapshot,
      });
      scan = await next.scan(this.#dimension);
      this.#log.debug('snapshot.created', {
        sourceId: snapshot.sourceId,
        files: snapshot.fileCount,
        bytes: snapshot.byteCount,
        copyMs: snapshot.copyMs,
        vanished: snapshot.vanishedFiles.length,
      });
    } catch (error) {
      this.#failedRefreshCount++;
      this.#consecutiveRefreshFailures++;
      stats.error = `snapshot failed, keeping the previous one: ${message(error)}`;
      if (next) await next.close().catch(() => {});
      // A copy that could not be opened or scanned must not be reused.
      if (snapshotRoot) await discardSnapshot({ root: snapshotRoot }).catch(() => {});
      return finish();
    }

    this.#consecutiveRefreshFailures = 0;
    stats.scanMs = scan.scanMs;
    stats.chunksScanned = scan.chunks.length;

    const diff = diffChunkDigests(this.#state.digests, scan.digests);
    stats.addedChunks = diff.added.length;
    stats.changedChunks = diff.changed.length;
    stats.removedChunks = diff.removed.length;

    // Let work already reading the old snapshot finish before it is closed.
    await Promise.allSettled([...this.#inFlight.values(), ...this.#surfacesInFlight.values()]);

    const previous = this.#world;
    const previousBounds = this.#state.info.chunkBounds;
    this.#world = next;
    this.#state = stateFromScan(next, scan, this.#options);

    for (const chunk of diff.all) this.#surfaces.delete(chunkId(chunk.x, chunk.z));

    await this.tileCache.setSourceId(next.snapshot.sourceId);
    await previous.close().catch(() => {});
    await pruneSnapshots(this.#options.worldPath, this.#options.cacheDir, [next.snapshot.sourceId]);

    if (diff.all.length) {
      const decodedBefore = this.#decodedChunks;
      const stale = await this.#invalidateTilesFor(diff.all);
      stats.tilesInvalidated = stale.length;
      const redrawn = await this.#renderTiles(stale);
      stats.tilesRegenerated = redrawn.rendered;
      stats.tilesChanged = redrawn.changed;
      stats.chunksDecoded = this.#decodedChunks - decodedBefore;
    }

    // A running server rewrites chunks constantly - block ticks, growth, leaves -
    // and most of that is invisible from above. Moving the version only when a
    // tile really came out different keeps browsers from re-fetching tiles that
    // look the same. Chunks appearing or disappearing always count: they change
    // which tiles exist and how far the map reaches.
    const worthTelling =
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      stats.tilesChanged > 0 ||
      !sameBounds(previousBounds, this.#state.info.chunkBounds);
    if (worthTelling) {
      this.#version++;
      this.#terrainUpdatedAt = stats.at;
    }

    return finish();
  }

  /**
   * Drops the cached tiles the given chunks are drawn into, keeping what each of
   * them looked like, and reports the ones that were actually cached - those are
   * the tiles worth drawing again now.
   */
  async #invalidateTilesFor(
    chunks: readonly { x: number; z: number }[],
  ): Promise<{ tile: TilePos; before: Uint8Array }[]> {
    const tiles = new Map<string, TilePos>();
    for (const chunk of chunks) {
      for (const tile of tilesAffectedByChunk(chunk.x, chunk.z)) {
        tiles.set(`${tile.x},${tile.y}`, tile);
      }
    }

    const wereCached: { tile: TilePos; before: Uint8Array }[] = [];
    for (const tile of tiles.values()) {
      const before = await this.tileCache.read(this.#dimension.id, NATIVE_ZOOM, tile.x, tile.y);
      if (!before) continue;
      if (await this.tileCache.invalidate(this.#dimension.id, NATIVE_ZOOM, tile.x, tile.y)) {
        wereCached.push({ tile, before });
      }
    }
    return wereCached;
  }

  /** Redraws tiles, a few at a time so a refresh does not monopolise the CPU. */
  async #renderTiles(
    stale: readonly { tile: TilePos; before: Uint8Array }[],
  ): Promise<{ rendered: number; changed: number }> {
    let rendered = 0;
    let changed = 0;
    const queue = [...stale];
    const workers = Array.from({ length: Math.min(REFRESH_RENDER_CONCURRENCY, queue.length) }, async () => {
      for (let entry = queue.pop(); entry; entry = queue.pop()) {
        const result = await this.tile(this.#dimension.id, NATIVE_ZOOM, entry.tile.x, entry.tile.y).catch(
          () => null,
        );
        if (!result) continue;
        if (!result.empty) rendered++;
        // An emptied tile stops being served as an image at all, which the
        // browser has to be told about just like a redrawn one.
        if (result.empty || !sameBytes(result.bytes, entry.before)) changed++;
      }
    });
    await Promise.all(workers);
    return { rendered, changed };
  }

  get emptyTile(): Uint8Array {
    return this.#emptyTile;
  }

  async close(): Promise<void> {
    if (this.#refreshing) await this.#refreshing.catch(() => {});
    await Promise.allSettled([...this.#inFlight.values(), ...this.#surfacesInFlight.values()]);
    await this.#world.close();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}

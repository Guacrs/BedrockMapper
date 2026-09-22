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
import { MeshCache } from './renderer/3d/mesh-cache.ts';
import { ChunkBlocks } from './renderer/3d/chunk-blocks.ts';
import { buildVoxelMesh } from './renderer/3d/voxel-mesh-builder.ts';
import { type MeshChunk } from './renderer/3d/mesh-types.ts';
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
import { Semaphore } from './util/pool.ts';
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

/** Decoded block volumes for voxel meshing — larger than a surface. */
const CHUNK_BLOCK_CACHE_LIMIT = 512;

/** Default how many invalidated tiles are redrawn at once during a refresh. */
const DEFAULT_REFRESH_RENDER_CONCURRENCY = 2;

/**
 * Cap on concurrent cold-cache tile *draws* served to HTTP clients.
 * Cache hits skip this. Without it, fitBounds over a large world can start
 * hundreds of renders and OOM Node.
 */
const DEFAULT_HTTP_TILE_RENDER_CONCURRENCY = 2;

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
  /** Incremented whenever 2D terrain tiles changed; part of the tile URL. */
  version: number;
  /**
   * Incremented whenever any chunk digest changed (including underground /
   * structure edits that may not alter top-down tiles). Drives 3D mesh reload.
   */
  meshVersion: number;
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
  /** Tiles that still had a recent redraw, so this refresh left them alone. */
  tilesSkippedCooldown: number;
  tilesRegenerated: number;
  /** Redrawn tiles that really came out different, i.e. what the browser needs. */
  tilesChanged: number;
  totalMs: number;
  version: number;
  meshVersion: number;
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
  /**
   * After a tile is redrawn, skip invalidating it again for this many ms unless
   * a chunk was added or removed inside it. 0 disables.
   */
  tileUpdateCooldownMs?: number;
  /** Parallel tile redraws during refresh. */
  refreshRenderConcurrency?: number;
  /**
   * Parallel cold-cache tile draws for HTTP `/tiles` requests.
   * Defaults to the same value as refresh concurrency.
   */
  httpTileRenderConcurrency?: number;
  log?: Logger;
}

interface WorldState {
  chunksWithData: Set<string>;
  /** SubChunkPrefix indices discovered during scan, keyed by chunk id. */
  subChunkIndices: Map<string, number[]>;
  digests: ChunkDigests;
  info: MapInfo;
}

function stateFromScan(world: BedrockWorld, scan: WorldScan, options: MapServiceOptions): WorldState {
  const withData = scan.chunks.filter((chunk) => chunk.subChunkIndices.length > 0);
  const chunkBounds = boundsOfChunks(withData);
  const blockBounds = chunkBounds ? chunkBoundsToBlockBounds(chunkBounds) : null;
  const subChunkIndices = new Map<string, number[]>();
  for (const chunk of withData) {
    subChunkIndices.set(chunkId(chunk.x, chunk.z), chunk.subChunkIndices);
  }

  return {
    chunksWithData: new Set(withData.map((chunk) => chunkId(chunk.x, chunk.z))),
    subChunkIndices,
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
  #chunkBlocks = new Map<string, ChunkBlocks | null>();
  #chunkBlocksInFlight = new Map<string, Promise<ChunkBlocks | null>>();
  #inFlight = new Map<string, Promise<TileResult>>();
  #emptyTile: Uint8Array;
  #decodedChunks = 0;
  #version = 1;
  #meshVersion = 1;
  #terrainUpdatedAt: string | null = null;
  #refreshing: Promise<RefreshStats> | null = null;
  #lastRefresh: RefreshStats | null = null;
  #refreshCount = 0;
  #failedRefreshCount = 0;
  #consecutiveRefreshFailures = 0;
  #cacheWriteFailures = 0;
  #cacheWriteFailureReported = false;
  /** tile "x,y" -> earliest time another digest-driven invalidate is allowed. */
  #tileCooldownUntil = new Map<string, number>();
  #tileRenderSlots: Semaphore;
  #meshCache = new MeshCache();
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
    this.#tileRenderSlots = new Semaphore(
      Math.max(
        1,
        options.httpTileRenderConcurrency ??
          options.refreshRenderConcurrency ??
          DEFAULT_HTTP_TILE_RENDER_CONCURRENCY,
      ),
    );
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

  get meshVersion(): number {
    return this.#meshVersion;
  }

  get state(): MapState {
    const info = this.#state.info;
    return {
      version: this.#version,
      meshVersion: this.#meshVersion,
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
      const indices = this.#state.subChunkIndices.get(key);
      const surface = await readChunkSurface(
        this.#world,
        this.#dimension,
        chunkX,
        chunkZ,
        indices,
      );
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

      return this.#tileRenderSlots.run(async () => {
        // Re-check after waiting for a render slot: another request may have
        // filled the disk cache while we were queued.
        const raced = await this.tileCache.read(dimension, zoom, x, y);
        if (raced) return { bytes: raced, cached: true, empty: false };

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
      });
    })().finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, work);
    return work;
  }

  /**
   * Decoded block volume for voxel meshing. Same LevelDB path as surfaces;
   * memoised so neighbouring mesh builds share neighbour decodes.
   */
  async chunkBlocks(chunkX: number, chunkZ: number): Promise<ChunkBlocks | null> {
    const key = chunkId(chunkX, chunkZ);
    if (this.#chunkBlocks.has(key)) {
      // Refresh insertion order so recently used volumes survive FIFO eviction.
      const hit = this.#chunkBlocks.get(key)!;
      this.#chunkBlocks.delete(key);
      this.#chunkBlocks.set(key, hit);
      return hit;
    }
    if (!this.hasChunkData(chunkX, chunkZ)) return null;

    const pending = this.#chunkBlocksInFlight.get(key);
    if (pending) return pending;

    const work = (async (): Promise<ChunkBlocks | null> => {
      const indices = this.#state.subChunkIndices.get(key);
      const { subChunks } = await this.#world.readChunkSubChunks(
        this.#dimension,
        chunkX,
        chunkZ,
        indices,
      );
      const volume = ChunkBlocks.fromSubChunks(chunkX, chunkZ, subChunks);
      if (this.#chunkBlocks.has(key)) this.#chunkBlocks.delete(key);
      while (this.#chunkBlocks.size >= CHUNK_BLOCK_CACHE_LIMIT) {
        const oldest = this.#chunkBlocks.keys().next().value;
        if (oldest === undefined) break;
        this.#chunkBlocks.delete(oldest);
      }
      this.#chunkBlocks.set(key, volume);
      return volume;
    })().finally(() => this.#chunkBlocksInFlight.delete(key));

    this.#chunkBlocksInFlight.set(key, work);
    return work;
  }

  /**
   * Terrain mesh for one Minecraft chunk: exposed faces of full cubes, coloured
   * with `blockColor`. Neighbour volumes are loaded for boundary face culling.
   * Returns null when the chunk has no block data in the scanned world.
   *
   * The heightmap builder (`buildTerrainMesh` in mesh-builder.ts) remains in
   * the tree for comparison/debugging but is no longer the `/api/mesh` path.
   */
  async mesh(dimension: DimensionId, chunkX: number, chunkZ: number): Promise<MeshChunk | null> {
    if (dimension !== this.#dimension.id) throw new Error(`Dimension not rendered: ${dimension}`);
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
      throw new Error('chunk coordinates must be integers');
    }
    if (!this.hasChunkData(chunkX, chunkZ)) return null;

    const cached = this.#meshCache.get(dimension, chunkX, chunkZ);
    if (cached) return cached;

    const [self, west, east, north, south] = await Promise.all([
      this.chunkBlocks(chunkX, chunkZ),
      this.chunkBlocks(chunkX - 1, chunkZ),
      this.chunkBlocks(chunkX + 1, chunkZ),
      this.chunkBlocks(chunkX, chunkZ - 1),
      this.chunkBlocks(chunkX, chunkZ + 1),
    ]);

    const mesh = buildVoxelMesh(chunkX, chunkZ, { self, west, east, north, south });
    this.#meshCache.set(dimension, chunkX, chunkZ, mesh);
    return mesh;
  }

  get meshCacheStats(): { size: number; hits: number; misses: number } {
    return this.#meshCache.stats;
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
      tilesSkippedCooldown: 0,
      tilesRegenerated: 0,
      tilesChanged: 0,
      totalMs: 0,
      version: this.#version,
      meshVersion: this.#meshVersion,
      error: null,
    };
    this.#refreshCount++;

    const finish = (): RefreshStats => {
      stats.totalMs = performance.now() - startedAt;
      stats.version = this.#version;
      stats.meshVersion = this.#meshVersion;
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
    await Promise.allSettled([
      ...this.#inFlight.values(),
      ...this.#surfacesInFlight.values(),
      ...this.#chunkBlocksInFlight.values(),
    ]);

    const previous = this.#world;
    const previousBounds = this.#state.info.chunkBounds;
    this.#world = next;
    this.#state = stateFromScan(next, scan, this.#options);

    for (const chunk of diff.all) {
      this.#surfaces.delete(chunkId(chunk.x, chunk.z));
      this.#chunkBlocks.delete(chunkId(chunk.x, chunk.z));
      this.#meshCache.invalidateAround(this.#dimension.id, chunk.x, chunk.z);
    }

    // Voxel meshes can change from underground / structure edits that never
    // alter a top-down tile. Bump meshVersion whenever any chunk digest moved.
    if (diff.all.length > 0) {
      this.#meshVersion++;
    }

    await this.tileCache.setSourceId(next.snapshot.sourceId);
    await previous.close().catch(() => {});
    await pruneSnapshots(this.#options.worldPath, this.#options.cacheDir, [next.snapshot.sourceId]);

    if (diff.all.length) {
      const decodedBefore = this.#decodedChunks;
      const forced = new Set<string>();
      for (const chunk of [...diff.added, ...diff.removed]) {
        for (const tile of tilesAffectedByChunk(chunk.x, chunk.z)) {
          forced.add(`${tile.x},${tile.y}`);
        }
      }
      const stale = await this.#invalidateTilesFor(diff.all, forced);
      stats.tilesInvalidated = stale.invalidated.length;
      stats.tilesSkippedCooldown = stale.skippedCooldown;
      const redrawn = await this.#renderTiles(stale.invalidated);
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
   *
   * Tiles still inside the update cooldown are left on disk unless `forced`
   * names them (chunk added or removed), so busy worlds do not redraw the same
   * area every save tick.
   */
  async #invalidateTilesFor(
    chunks: readonly { x: number; z: number }[],
    forced: ReadonlySet<string> = new Set(),
  ): Promise<{ invalidated: { tile: TilePos; before: Uint8Array }[]; skippedCooldown: number }> {
    const tiles = new Map<string, TilePos>();
    for (const chunk of chunks) {
      for (const tile of tilesAffectedByChunk(chunk.x, chunk.z)) {
        tiles.set(`${tile.x},${tile.y}`, tile);
      }
    }

    const cooldownMs = this.#options.tileUpdateCooldownMs ?? 0;
    const now = Date.now();
    const wereCached: { tile: TilePos; before: Uint8Array }[] = [];
    let skippedCooldown = 0;

    for (const [key, tile] of tiles) {
      if (!forced.has(key) && cooldownMs > 0) {
        const until = this.#tileCooldownUntil.get(key);
        if (until !== undefined && until > now) {
          skippedCooldown++;
          continue;
        }
      }

      const before = await this.tileCache.read(this.#dimension.id, NATIVE_ZOOM, tile.x, tile.y);
      if (!before) continue;
      if (await this.tileCache.invalidate(this.#dimension.id, NATIVE_ZOOM, tile.x, tile.y)) {
        wereCached.push({ tile, before });
      }
    }
    return { invalidated: wereCached, skippedCooldown };
  }

  /** Redraws tiles, a few at a time so a refresh does not monopolise the CPU. */
  async #renderTiles(
    stale: readonly { tile: TilePos; before: Uint8Array }[],
  ): Promise<{ rendered: number; changed: number }> {
    let rendered = 0;
    let changed = 0;
    const queue = [...stale];
    const concurrency = Math.max(
      1,
      this.#options.refreshRenderConcurrency ?? DEFAULT_REFRESH_RENDER_CONCURRENCY,
    );
    const cooldownMs = this.#options.tileUpdateCooldownMs ?? 0;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let entry = queue.pop(); entry; entry = queue.pop()) {
        const result = await this.tile(this.#dimension.id, NATIVE_ZOOM, entry.tile.x, entry.tile.y).catch(
          () => null,
        );
        if (!result) continue;
        if (!result.empty) rendered++;
        // An emptied tile stops being served as an image at all, which the
        // browser has to be told about just like a redrawn one.
        if (result.empty || !sameBytes(result.bytes, entry.before)) changed++;
        if (cooldownMs > 0) {
          this.#tileCooldownUntil.set(`${entry.tile.x},${entry.tile.y}`, Date.now() + cooldownMs);
        }
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
    await Promise.allSettled([
      ...this.#inFlight.values(),
      ...this.#surfacesInFlight.values(),
      ...this.#chunkBlocksInFlight.values(),
    ]);
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

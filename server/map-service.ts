/**
 * Ties the verified world reader to the tile pipeline.
 *
 * Chunk surfaces are decoded once and kept in memory, and finished tiles are
 * cached on disk, so a browser panning around does not re-decode LevelDB.
 */

import { encodePng } from './renderer/chunk-image.ts';
import { NATIVE_ZOOM, TILE_SIZE, boundsCenter, boundsOfChunks, chunkBoundsToBlockBounds, tileRangeForBlockBounds, type Bounds } from './tiles/coords.ts';
import { CHUNKS_PER_TILE } from './tiles/coords.ts';
import { TileCache } from './tiles/tile-cache.ts';
import { renderTile } from './tiles/tile-renderer.ts';
import { OVERWORLD, SUPPORTED_DIMENSIONS, type Dimension, type DimensionId } from './world/dimensions.ts';
import { readChunkSurface, type ChunkSurface } from './world/surface.ts';
import { BedrockWorld } from './world/world.ts';

/** Upper bound on cached chunk surfaces (~1 KB each). */
const SURFACE_CACHE_LIMIT = 8192;

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
}

export class MapService {
  readonly world: BedrockWorld;
  readonly tileCache: TileCache;
  readonly info: MapInfo;

  #dimension: Dimension = OVERWORLD;
  #chunksWithData = new Set<string>();
  #surfaces = new Map<string, ChunkSurface | null>();
  #inFlight = new Map<string, Promise<TileResult>>();
  #emptyTile: Uint8Array;
  #decodedChunks = 0;

  private constructor(world: BedrockWorld, tileCache: TileCache, info: MapInfo, chunksWithData: Set<string>) {
    this.world = world;
    this.tileCache = tileCache;
    this.info = info;
    this.#chunksWithData = chunksWithData;
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

    const chunks = await world.listChunks(OVERWORLD);
    const withData = chunks.filter((chunk) => chunk.subChunkIndices.length > 0);
    const chunkBounds = boundsOfChunks(withData);
    const blockBounds = chunkBounds ? chunkBoundsToBlockBounds(chunkBounds) : null;

    const info: MapInfo = {
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
    };

    return new MapService(
      world,
      tileCache,
      info,
      new Set(withData.map((chunk) => `${chunk.x},${chunk.z}`)),
    );
  }

  get decodedChunks(): number {
    return this.#decodedChunks;
  }

  hasChunkData(chunkX: number, chunkZ: number): boolean {
    return this.#chunksWithData.has(`${chunkX},${chunkZ}`);
  }

  /**
   * Decoded surface for a chunk, memoised. Chunks the world does not store are
   * never looked up in the database.
   */
  async surface(chunkX: number, chunkZ: number): Promise<ChunkSurface | null> {
    const key = `${chunkX},${chunkZ}`;
    if (this.#surfaces.has(key)) return this.#surfaces.get(key)!;
    if (!this.hasChunkData(chunkX, chunkZ)) {
      this.#surfaces.set(key, null);
      return null;
    }

    const surface = await readChunkSurface(this.world, this.#dimension, chunkX, chunkZ);
    this.#decodedChunks++;
    if (this.#surfaces.size >= SURFACE_CACHE_LIMIT) {
      // Plain FIFO eviction; panning tends to move on rather than come back.
      const oldest = this.#surfaces.keys().next().value;
      if (oldest !== undefined) this.#surfaces.delete(oldest);
    }
    this.#surfaces.set(key, surface);
    return surface;
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
      await this.tileCache.write(dimension, zoom, x, y, bytes);
      return { bytes, cached: false, empty: false };
    })().finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, work);
    return work;
  }

  async close(): Promise<void> {
    await this.world.close();
  }
}

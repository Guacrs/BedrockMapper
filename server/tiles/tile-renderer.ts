/**
 * Composes many real chunks into one seamless tile.
 *
 * Every pixel is placed by its world block coordinate, so chunk boundaries line
 * up by construction - there is no per-chunk image stitching step that could
 * introduce a one-block offset. Elevation shading reads heights from the
 * neighbouring chunks as well, so relief continues across chunk borders.
 */

import { applyShade, CHANNELS, shadeFactorForBlock, shadeFromNeighbors, type RenderedImage } from '../renderer/chunk-image.ts';
import { surfaceBlockColor } from '../renderer/colors.ts';
import { mapPool } from '../util/pool.ts';
import { columnIndex } from '../world/keys.ts';
import { NO_SURFACE, NO_BIOME, type ChunkSurface } from '../world/surface.ts';
import { CHUNKS_PER_TILE, TILE_SIZE, floorDiv, tileToBlock, tileToChunk } from './coords.ts';

/** Looks up a chunk surface, returning null when the chunk has no block data. */
export type SurfaceLoader = (chunkX: number, chunkZ: number) => Promise<ChunkSurface | null>;

/**
 * How many chunk surfaces one tile may decode at once. A tile touches up to
 * 17×17 chunks including the shading border; unbounded Promise.all on that set
 * is a common OOM path when many cold tiles render together.
 */
export const TILE_CHUNK_LOAD_CONCURRENCY = 8;

/** Chunks a tile needs, including the one-chunk border used for shading. */
export function chunksForTile(tileX: number, tileY: number): { x: number; z: number }[] {
  const origin = tileToChunk(tileX, tileY);
  const chunks: { x: number; z: number }[] = [];
  for (let z = origin.z - 1; z < origin.z + CHUNKS_PER_TILE; z++) {
    for (let x = origin.x - 1; x < origin.x + CHUNKS_PER_TILE; x++) {
      chunks.push({ x, z });
    }
  }
  return chunks;
}

/** Chunks actually drawn into a tile (no shading border). */
export function chunksInTile(tileX: number, tileY: number): { x: number; z: number }[] {
  const origin = tileToChunk(tileX, tileY);
  const chunks: { x: number; z: number }[] = [];
  for (let z = origin.z; z < origin.z + CHUNKS_PER_TILE; z++) {
    for (let x = origin.x; x < origin.x + CHUNKS_PER_TILE; x++) {
      chunks.push({ x, z });
    }
  }
  return chunks;
}

/**
 * Renders one tile.
 *
 * Returns null when no chunk in the tile has block data, which lets the caller
 * serve a shared empty tile instead of writing a blank PNG to the cache.
 * Individual missing chunks and ungenerated columns are left transparent.
 */
export async function renderTile(
  tileX: number,
  tileY: number,
  loadSurface: SurfaceLoader,
): Promise<RenderedImage | null> {
  const surfaces = new Map<string, ChunkSurface | null>();
  const needed = chunksForTile(tileX, tileY);
  await mapPool(needed, TILE_CHUNK_LOAD_CONCURRENCY, async (chunk) => {
    surfaces.set(`${chunk.x},${chunk.z}`, await loadSurface(chunk.x, chunk.z));
  });

  const drawn = chunksInTile(tileX, tileY);
  if (!drawn.some((chunk) => surfaces.get(`${chunk.x},${chunk.z}`))) return null;

  const surfaceAt = (blockX: number, blockZ: number): ChunkSurface | null =>
    surfaces.get(`${floorDiv(blockX, 16)},${floorDiv(blockZ, 16)}`) ?? null;

  const columnOf = (blockX: number, blockZ: number): number =>
    columnIndex(blockX - floorDiv(blockX, 16) * 16, blockZ - floorDiv(blockZ, 16) * 16);

  const heightAt = (blockX: number, blockZ: number): number | null => {
    const surface = surfaceAt(blockX, blockZ);
    if (!surface) return null;
    const y = surface.heights[columnOf(blockX, blockZ)]!;
    return y === NO_SURFACE ? null : y;
  };

  const origin = tileToBlock(tileX, tileY);
  const data = new Uint8Array(TILE_SIZE * TILE_SIZE * CHANNELS);

  for (let pixelY = 0; pixelY < TILE_SIZE; pixelY++) {
    const blockZ = origin.z + pixelY;
    for (let pixelX = 0; pixelX < TILE_SIZE; pixelX++) {
      const blockX = origin.x + pixelX;
      const surface = surfaceAt(blockX, blockZ);
      if (!surface) continue;

      const column = columnOf(blockX, blockZ);
      const block = surface.blocks[column];
      if (!block) continue;

      const y = surface.heights[column]!;
      const slope = shadeFromNeighbors(y, heightAt(blockX, blockZ - 1), heightAt(blockX - 1, blockZ));
      const factor = shadeFactorForBlock(block, slope);
      const depth = surface.waterDepths?.[column] ?? 0;
      const biome = surface.biomes?.[column];
      const biomeId = biome === undefined || biome === NO_BIOME ? null : biome;
      const [r, g, b] = applyShade(surfaceBlockColor(block, depth, biomeId), factor);
      const offset = (pixelY * TILE_SIZE + pixelX) * CHANNELS;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }

  return { width: TILE_SIZE, height: TILE_SIZE, data };
}

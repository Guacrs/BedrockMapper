/**
 * Surface scan: the highest visible block of every X/Z column in a chunk.
 *
 * Subchunks are walked from the top of the world downwards and each column is
 * resolved once, so a chunk costs at most one pass over the subchunks that
 * actually exist. When the surface is water, the scan also measures how deep
 * the water column is (still only using already-decoded subchunks).
 */

import type { Dimension } from './dimensions.ts';
import { isInvisible, isWater } from './blocks.ts';
import { biomeIdAt, type ChunkBiomes } from './data3d.ts';
import { CHUNK_SIZE, blockIndex, columnIndex, SUBCHUNK_SIZE } from './keys.ts';
import type { SubChunk } from './subchunk.ts';
import type { BedrockWorld } from './world.ts';

/** Y value used for columns where no visible block was found. */
export const NO_SURFACE = -32768;

/** Cap stored water depth so a single byte stays meaningful on the map. */
export const MAX_WATER_DEPTH = 24;

export interface ChunkSurface {
  chunkX: number;
  chunkZ: number;
  /** 256 entries, indexed with `columnIndex(x, z)`. */
  heights: Int16Array;
  /** 256 entries; null where the column has no visible block. */
  blocks: (string | null)[];
  /**
   * 256 entries. Thickness of a water column when the surface block is water,
   * otherwise 0. Measured from already-decoded subchunks only.
   */
  waterDepths: Uint8Array;
  /**
   * 256 entries. Numeric biome id at the surface block, or `NO_BIOME` when
   * Data3D was missing for that column.
   */
  biomes: Uint16Array;
  /** Number of resolved columns (256 for fully generated terrain). */
  resolvedColumns: number;
  /** Subchunks that could not be decoded, e.g. legacy formats. */
  skipped: { index: number; version: number }[];
}

/** Sentinel stored in `ChunkSurface.biomes` when the biome is unknown. */
export const NO_BIOME = 0xffff;

function paletteName(subChunk: SubChunk, x: number, y: number, z: number): string | null {
  const layer = subChunk.layers[0];
  if (!layer) return null;
  const paletteIndex = layer.indices[blockIndex(x, y, z)] as number;
  return layer.palette[paletteIndex]?.name ?? null;
}

/**
 * Counts consecutive water blocks from `startY` downward in `startIndex`, then
 * through any lower subchunks already decoded for this chunk.
 */
function measureWaterDepth(
  orderedTopDown: SubChunk[],
  byIndex: Map<number, SubChunk>,
  startIndex: number,
  startLocalY: number,
  x: number,
  z: number,
): number {
  let depth = 1;
  let index = startIndex;
  let localY = startLocalY - 1;

  while (depth < MAX_WATER_DEPTH) {
    const subChunk = byIndex.get(index);
    if (!subChunk) {
      // No decoded subchunk at this level - stop rather than inventing depth.
      break;
    }
    while (localY >= 0 && depth < MAX_WATER_DEPTH) {
      const name = paletteName(subChunk, x, localY, z);
      if (!name || isInvisible(name) || !isWater(name)) return depth;
      depth++;
      localY--;
    }
    index--;
    localY = SUBCHUNK_SIZE - 1;
    if (!orderedTopDown.some((candidate) => candidate.index === index) && !byIndex.has(index)) {
      break;
    }
  }
  return depth;
}

/** Computes the surface of already-decoded subchunks (top-down order not required). */
export function surfaceFromSubChunks(
  chunkX: number,
  chunkZ: number,
  subChunks: SubChunk[],
  biomes: ChunkBiomes | null = null,
): ChunkSurface {
  const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(NO_SURFACE);
  const blocks: (string | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(null);
  const waterDepths = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const biomeIds = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(NO_BIOME);
  let resolvedColumns = 0;

  const ordered = [...subChunks].sort((a, b) => b.index - a.index);
  const byIndex = new Map(ordered.map((subChunk) => [subChunk.index, subChunk]));

  for (const subChunk of ordered) {
    if (resolvedColumns === blocks.length) break;
    const layer = subChunk.layers[0];
    if (!layer) continue;

    // Resolve palette visibility once per subchunk instead of per block.
    const visible = layer.palette.map((state) => !isInvisible(state.name));
    if (!visible.some(Boolean)) continue;

    const baseY = subChunk.index * SUBCHUNK_SIZE;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const column = columnIndex(x, z);
        if (blocks[column] !== null) continue;
        for (let y = SUBCHUNK_SIZE - 1; y >= 0; y--) {
          const paletteIndex = layer.indices[blockIndex(x, y, z)] as number;
          if (!visible[paletteIndex]) continue;
          const name = layer.palette[paletteIndex]!.name;
          const worldY = baseY + y;
          blocks[column] = name;
          heights[column] = worldY;
          if (isWater(name)) {
            waterDepths[column] = measureWaterDepth(ordered, byIndex, subChunk.index, y, x, z);
          }
          const biome = biomeIdAt(biomes, x, worldY, z);
          if (biome != null) biomeIds[column] = biome;
          resolvedColumns++;
          break;
        }
      }
    }
  }

  return {
    chunkX,
    chunkZ,
    heights,
    blocks,
    waterDepths,
    biomes: biomeIds,
    resolvedColumns,
    skipped: [],
  };
}

/** Reads a chunk from the world and computes its surface. */
export async function readChunkSurface(
  world: BedrockWorld,
  dimension: Dimension,
  chunkX: number,
  chunkZ: number,
  /** Known SubChunkPrefix indices from scan; omit to probe the full Y range. */
  subChunkIndices?: readonly number[],
): Promise<ChunkSurface | null> {
  const [{ subChunks, skipped }, biomes] = await Promise.all([
    world.readChunkSubChunks(dimension, chunkX, chunkZ, subChunkIndices),
    world.readChunkBiomes(dimension, chunkX, chunkZ),
  ]);
  if (!subChunks.length && !skipped.length) return null;
  const surface = surfaceFromSubChunks(chunkX, chunkZ, subChunks, biomes);
  surface.skipped = skipped;
  return surface;
}

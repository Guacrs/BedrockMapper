/**
 * Surface scan: the highest visible block of every X/Z column in a chunk.
 *
 * Subchunks are walked from the top of the world downwards and each column is
 * resolved once, so a chunk costs at most one pass over the subchunks that
 * actually exist.
 */

import type { Dimension } from './dimensions.ts';
import { isInvisible } from './blocks.ts';
import { CHUNK_SIZE, blockIndex, columnIndex, SUBCHUNK_SIZE } from './keys.ts';
import type { SubChunk } from './subchunk.ts';
import type { BedrockWorld } from './world.ts';

/** Y value used for columns where no visible block was found. */
export const NO_SURFACE = -32768;

export interface ChunkSurface {
  chunkX: number;
  chunkZ: number;
  /** 256 entries, indexed with `columnIndex(x, z)`. */
  heights: Int16Array;
  /** 256 entries; null where the column has no visible block. */
  blocks: (string | null)[];
  /** Number of resolved columns (256 for fully generated terrain). */
  resolvedColumns: number;
  /** Subchunks that could not be decoded, e.g. legacy formats. */
  skipped: { index: number; version: number }[];
}

/** Computes the surface of already-decoded subchunks (top-down order not required). */
export function surfaceFromSubChunks(
  chunkX: number,
  chunkZ: number,
  subChunks: SubChunk[],
): ChunkSurface {
  const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(NO_SURFACE);
  const blocks: (string | null)[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(null);
  let resolvedColumns = 0;

  const ordered = [...subChunks].sort((a, b) => b.index - a.index);
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
          blocks[column] = layer.palette[paletteIndex]!.name;
          heights[column] = baseY + y;
          resolvedColumns++;
          break;
        }
      }
    }
  }

  return { chunkX, chunkZ, heights, blocks, resolvedColumns, skipped: [] };
}

/** Reads a chunk from the world and computes its surface. */
export async function readChunkSurface(
  world: BedrockWorld,
  dimension: Dimension,
  chunkX: number,
  chunkZ: number,
): Promise<ChunkSurface | null> {
  const { subChunks, skipped } = await world.readChunkSubChunks(dimension, chunkX, chunkZ);
  if (!subChunks.length && !skipped.length) return null;
  const surface = surfaceFromSubChunks(chunkX, chunkZ, subChunks);
  surface.skipped = skipped;
  return surface;
}

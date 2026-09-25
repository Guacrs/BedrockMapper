/**
 * Decoded block volume for one chunk, used by the experimental voxel mesher.
 *
 * Built from already-parsed SubChunk records (same decode path as surfaces) —
 * no second LevelDB reader. Missing subchunks / empty columns read as air.
 *
 * Palette entries keep BlockRef { name, states } (PR20). Voxel cells still
 * store palette indices only — no per-voxel state allocations.
 */

import { isInvisible } from '../../world/blocks.ts';
import { blockIndex, blockYToSubChunkIndex, CHUNK_SIZE, SUBCHUNK_SIZE } from '../../world/keys.ts';
import type { BlockState, BlockStateValue as WorldStateValue, SubChunk } from '../../world/subchunk.ts';
import type { BlockRef, BlockStateValue } from './models/types.ts';

interface LayerView {
  palette: readonly BlockRef[];
  indices: ArrayLike<number>;
}

/**
 * Coerce palette NBT values into BlockRef state types.
 *
 * Bedrock stores boolean `*_bit` states as TAG_Byte (0/1). Model families use
 * `=== true` checks, so those bytes must become real booleans here.
 */
function normalizeStateValue(key: string, value: WorldStateValue): BlockStateValue {
  if (typeof value === 'bigint') return Number(value);
  if (key.endsWith('_bit') && (value === 0 || value === 1)) return value === 1;
  return value;
}

/** Freeze a SubChunk palette entry into a shared BlockRef. */
export function blockRefFromPaletteEntry(entry: BlockState): BlockRef {
  const states: Record<string, BlockStateValue> = {};
  for (const [key, value] of Object.entries(entry.states)) {
    states[key] = normalizeStateValue(key, value);
  }
  return Object.freeze({
    name: entry.name,
    states: Object.freeze(states),
  });
}

/** Blocks of one Minecraft chunk (16×16 columns, sparse in Y). */
export class ChunkBlocks {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly #layers = new Map<number, LayerView>();

  private constructor(chunkX: number, chunkZ: number) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
  }

  static fromSubChunks(chunkX: number, chunkZ: number, subChunks: readonly SubChunk[]): ChunkBlocks {
    const volume = new ChunkBlocks(chunkX, chunkZ);
    for (const subChunk of subChunks) {
      const layer = subChunk.layers[0];
      if (!layer) continue;
      volume.#layers.set(subChunk.index, {
        palette: layer.palette.map(blockRefFromPaletteEntry),
        indices: layer.indices,
      });
    }
    return volume;
  }

  /** Subchunk indices that actually have terrain layers. */
  get subchunkIndices(): number[] {
    return [...this.#layers.keys()].sort((a, b) => a - b);
  }

  /**
   * Block name at local x/z (0..15) and world Y, or null when empty / missing.
   * Kept for callers that only need the id string.
   */
  getLocal(localX: number, worldY: number, localZ: number): string | null {
    return this.getLocalRef(localX, worldY, localZ)?.name ?? null;
  }

  /**
   * Shared BlockRef at local coordinates, or null when empty / missing.
   * The returned object is owned by the palette — do not mutate.
   */
  getLocalRef(localX: number, worldY: number, localZ: number): BlockRef | null {
    if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) return null;
    const subIndex = blockYToSubChunkIndex(worldY);
    const layer = this.#layers.get(subIndex);
    if (!layer) return null;
    const localY = ((worldY % SUBCHUNK_SIZE) + SUBCHUNK_SIZE) % SUBCHUNK_SIZE;
    const paletteIndex = layer.indices[blockIndex(localX, localY, localZ)] as number;
    const ref = layer.palette[paletteIndex];
    if (!ref || isInvisible(ref.name)) return null;
    return ref;
  }
}

/** Face-adjacent (+ self) volumes for culling across chunk borders. */
export interface VoxelNeighborhood {
  self: ChunkBlocks | null;
  west: ChunkBlocks | null;
  east: ChunkBlocks | null;
  /** −Z neighbour (Minecraft north). */
  north: ChunkBlocks | null;
  /** +Z neighbour (Minecraft south). */
  south: ChunkBlocks | null;
}

function volumeAt(neighborhood: VoxelNeighborhood, chunkX: number, chunkZ: number): ChunkBlocks | null {
  const { self } = neighborhood;
  if (!self) return null;
  if (chunkX === self.chunkX && chunkZ === self.chunkZ) return neighborhood.self;
  if (chunkX === self.chunkX - 1 && chunkZ === self.chunkZ) return neighborhood.west;
  if (chunkX === self.chunkX + 1 && chunkZ === self.chunkZ) return neighborhood.east;
  if (chunkX === self.chunkX && chunkZ === self.chunkZ - 1) return neighborhood.north;
  if (chunkX === self.chunkX && chunkZ === self.chunkZ + 1) return neighborhood.south;
  return null;
}

/**
 * Block name at world coordinates. Missing neighbour volumes are treated as
 * air so boundary faces remain exposed (deterministic, never throws).
 */
export function blockAtWorld(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
): string | null {
  return blockRefAtWorld(neighborhood, worldX, worldY, worldZ)?.name ?? null;
}

/** Shared BlockRef at world coordinates, or null when empty / missing. */
export function blockRefAtWorld(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
): BlockRef | null {
  const chunkX = Math.floor(worldX / CHUNK_SIZE);
  const chunkZ = Math.floor(worldZ / CHUNK_SIZE);
  const volume = volumeAt(neighborhood, chunkX, chunkZ);
  if (!volume) return null;
  const localX = worldX - chunkX * CHUNK_SIZE;
  const localZ = worldZ - chunkZ * CHUNK_SIZE;
  return volume.getLocalRef(localX, worldY, localZ);
}

/**
 * Legacy helper: true when the cell has a renderable block (any model).
 * Name kept for existing tests; occlusion now uses model-aware checks.
 */
export function isSolidAt(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
): boolean {
  return blockRefAtWorld(neighborhood, worldX, worldY, worldZ) != null;
}

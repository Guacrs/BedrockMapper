/**
 * Build in-memory ChunkBlocks volumes from the model fixture layout.
 */

import { blockIndex } from '../../../world/keys.ts';
import type { BlockState, SubChunk } from '../../../world/subchunk.ts';
import { ChunkBlocks, type VoxelNeighborhood } from '../chunk-blocks.ts';
import {
  FIXTURE_CHUNK_RANGE,
  FIXTURE_PLATFORM_Y,
  modelFixtureCells,
  type FixtureBlock,
} from './model-fixture-layout.ts';

function makeSubChunk(
  index: number,
  fill: (lx: number, ly: number, lz: number) => BlockState | null,
): SubChunk {
  const keyToIndex = new Map<string, number>();
  const palette: BlockState[] = [];
  const ensure = (entry: BlockState) => {
    const key = `${entry.name}|${JSON.stringify(entry.states)}`;
    let id = keyToIndex.get(key);
    if (id === undefined) {
      id = palette.length;
      keyToIndex.set(key, id);
      palette.push(entry);
    }
    return id;
  };
  ensure({ name: 'minecraft:air', states: {} });
  const indices = new Uint16Array(4096);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        indices[blockIndex(x, y, z)] = ensure(
          fill(x, y, z) ?? { name: 'minecraft:air', states: {} },
        );
      }
    }
  }
  return { index, version: 9, layers: [{ palette, indices }] };
}

function toBlockState(block: FixtureBlock): BlockState {
  return {
    name: block.name,
    states: { ...(block.states ?? {}) },
  };
}

/**
 * Map of "wx,wy,wz" → block for all fixture structures + stone platform under them.
 */
export function fixtureWorldBlockMap(): Map<string, BlockState> {
  const map = new Map<string, BlockState>();
  const cells = modelFixtureCells();

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
  }
  // Pad platform slightly beyond structures.
  minX -= 2;
  maxX += 2;
  minZ -= 2;
  maxZ += 2;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      map.set(`${x},${FIXTURE_PLATFORM_Y},${z}`, {
        name: 'minecraft:stone',
        states: {},
      });
    }
  }

  for (const cell of cells) {
    map.set(`${cell.x},${cell.y},${cell.z}`, toBlockState(cell.block));
  }
  return map;
}

export function buildFixtureChunkBlocks(chunkX: number, chunkZ: number): ChunkBlocks {
  const map = fixtureWorldBlockMap();
  const subIndexes = new Set<number>();
  for (const key of map.keys()) {
    const y = Number(key.split(',')[1]);
    subIndexes.add(Math.floor(y / 16));
  }
  // Always include platform subchunk.
  subIndexes.add(Math.floor(FIXTURE_PLATFORM_Y / 16));

  const subs: SubChunk[] = [];
  for (const subIndex of [...subIndexes].sort((a, b) => a - b)) {
    const baseY = subIndex * 16;
    subs.push(
      makeSubChunk(subIndex, (lx, ly, lz) => {
        const wx = chunkX * 16 + lx;
        const wy = baseY + ly;
        const wz = chunkZ * 16 + lz;
        return map.get(`${wx},${wy},${wz}`) ?? null;
      }),
    );
  }
  return ChunkBlocks.fromSubChunks(chunkX, chunkZ, subs);
}

/** Neighborhood covering all fixture chunks (self + cardinals when present). */
export function buildFixtureNeighborhood(chunkX: number, chunkZ: number): VoxelNeighborhood {
  const inRange = (cx: number, cz: number) =>
    cx >= FIXTURE_CHUNK_RANGE.minX &&
    cx <= FIXTURE_CHUNK_RANGE.maxX &&
    cz >= FIXTURE_CHUNK_RANGE.minZ &&
    cz <= FIXTURE_CHUNK_RANGE.maxZ;

  const load = (cx: number, cz: number) =>
    inRange(cx, cz) ? buildFixtureChunkBlocks(cx, cz) : null;

  return {
    self: load(chunkX, chunkZ),
    west: load(chunkX - 1, chunkZ),
    east: load(chunkX + 1, chunkZ),
    north: load(chunkX, chunkZ - 1),
    south: load(chunkX, chunkZ + 1),
  };
}

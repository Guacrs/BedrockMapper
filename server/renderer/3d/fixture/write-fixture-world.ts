/**
 * Synthetic LevelDB writer for the PR28 constructed model fixture.
 *
 * This is **not** a BDS-generated world — it hand-builds SubChunkPrefix NBT so
 * `decodeSubChunk()` exercises the same parser path the production reader uses.
 * It proves writer → LevelDB → decoder → BlockRef, not “equivalent to a live BDS save.”
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDB } from '@8crafter/leveldb-zlib';
import { entryContentTypeToFormatMap } from 'mcbe-leveldb';
import nbt from 'prismarine-nbt';
import type { BlockStateValue } from '../models/types.ts';
import { OVERWORLD } from '../../../world/dimensions.ts';
import { blockIndex, chunkKey, subChunkKey, ChunkTag } from '../../../world/keys.ts';
import type { BlockState } from '../../../world/subchunk.ts';
import { fixtureWorldBlockMap } from './build-fixture-volumes.ts';
import {
  FIXTURE_CHUNK_RANGE,
  FIXTURE_PLATFORM_Y,
  FIXTURE_Y,
} from './model-fixture-layout.ts';

export const DEFAULT_FIXTURE_WORLD_ROOT = path.resolve('model-fixture-world');

type NbtStateTag =
  | { type: 'string'; value: string }
  | { type: 'int'; value: number }
  | { type: 'byte'; value: number };

function stateToNbt(value: BlockStateValue): NbtStateTag {
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'byte', value: value ? 1 : 0 };
  return { type: 'int', value: Number(value) };
}

function paletteEntry(entry: BlockState) {
  const states: Record<string, NbtStateTag> = {};
  for (const [key, value] of Object.entries(entry.states)) {
    states[key] = stateToNbt(value as BlockStateValue);
  }
  return {
    type: 'compound' as const,
    value: {
      name: { type: 'string' as const, value: entry.name },
      states: { type: 'compound' as const, value: states },
    },
  };
}

function buildSubChunk(
  subIndex: number,
  chunkX: number,
  chunkZ: number,
  map: Map<string, BlockState>,
): Buffer | null {
  const baseY = subIndex * 16;
  const keyToIndex = new Map<string, number>();
  const palette: ReturnType<typeof paletteEntry>[] = [];
  const ensure = (entry: BlockState) => {
    const key = `${entry.name}|${JSON.stringify(entry.states)}`;
    let id = keyToIndex.get(key);
    if (id === undefined) {
      id = palette.length;
      keyToIndex.set(key, id);
      palette.push(paletteEntry(entry));
    }
    return id;
  };
  ensure({ name: 'minecraft:air', states: {} });

  const indices = new Array(4096).fill(0);
  let anySolid = false;

  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let ly = 0; ly < 16; ly++) {
        const wx = chunkX * 16 + lx;
        const wy = baseY + ly;
        const wz = chunkZ * 16 + lz;
        const block = map.get(`${wx},${wy},${wz}`);
        if (!block) continue;
        anySolid = true;
        indices[blockIndex(lx, ly, lz)] = ensure(block);
      }
    }
  }
  if (!anySolid) return null;

  const data = {
    type: 'compound' as const,
    value: {
      version: { type: 'byte' as const, value: 9 },
      layerCount: { type: 'byte' as const, value: 1 },
      subChunkIndex: { type: 'byte' as const, value: subIndex & 0xff },
      layers: {
        type: 'list' as const,
        value: {
          type: 'compound' as const,
          value: [
            {
              storageVersion: { type: 'byte' as const, value: 0 },
              block_indices: { type: 'list' as const, value: { type: 'int' as const, value: indices } },
              palette: {
                type: 'compound' as const,
                value: Object.fromEntries(palette.map((entry, i) => [String(i), entry])),
              },
              isRuntimePalette: { type: 'byte' as const, value: 0 },
            },
          ],
        },
      },
    },
  };

  return Buffer.from(
    (
      entryContentTypeToFormatMap.SubChunkPrefix as unknown as {
        serialize(data: unknown): Uint8Array;
      }
    ).serialize(data),
  );
}

async function writeLevelDat(worldPath: string): Promise<void> {
  const root = nbt.comp({
    LevelName: nbt.string('ModelFixture3D'),
    SpawnX: nbt.int(8),
    SpawnY: nbt.int(FIXTURE_Y + 2),
    SpawnZ: nbt.int(8),
    StorageVersion: nbt.int(10),
    lastOpenedWithVersion: nbt.list({ type: 'int', value: [1, 26, 51, 1, 0] }),
  });
  // prismarine-nbt typings omit the little-endian overload used by Bedrock level.dat
  const write = nbt.writeUncompressed as (value: unknown, format?: string | boolean) => Buffer;
  const payload = write(root, 'little');
  const header = Buffer.alloc(8);
  header.writeInt32LE(10, 0);
  header.writeInt32LE(payload.length, 4);
  await fs.writeFile(path.join(worldPath, 'level.dat'), Buffer.concat([header, payload]));
  await fs.writeFile(path.join(worldPath, 'levelname.txt'), 'ModelFixture3D\n');
}

export interface WriteFixtureWorldResult {
  readonly worldPath: string;
  readonly chunks: number;
  readonly subchunks: number;
  readonly cells: number;
}

/**
 * Write (or rewrite) the constructed fixture LevelDB world.
 * Safe to call from tests via `before()` — order-independent.
 */
export async function writeModelFixtureWorld(
  worldPath: string = DEFAULT_FIXTURE_WORLD_ROOT,
): Promise<WriteFixtureWorldResult> {
  const map = fixtureWorldBlockMap();
  const subIndexes = new Set<number>();
  for (const key of map.keys()) {
    subIndexes.add(Math.floor(Number(key.split(',')[1]) / 16));
  }
  subIndexes.add(Math.floor(FIXTURE_PLATFORM_Y / 16));

  await fs.rm(worldPath, { recursive: true, force: true });
  const dbPath = path.join(worldPath, 'db');
  await fs.mkdir(dbPath, { recursive: true });
  await writeLevelDat(worldPath);

  const db = new LevelDB(dbPath, { createIfMissing: true });
  await db.open();

  let subchunks = 0;
  let chunks = 0;
  try {
    for (let cz = FIXTURE_CHUNK_RANGE.minZ; cz <= FIXTURE_CHUNK_RANGE.maxZ; cz++) {
      for (let cx = FIXTURE_CHUNK_RANGE.minX; cx <= FIXTURE_CHUNK_RANGE.maxX; cx++) {
        await db.put(chunkKey(OVERWORLD, cx, cz, ChunkTag.ChunkVersion), Buffer.from([0x28]));
        chunks++;
        for (const sub of [...subIndexes].sort((a, b) => a - b)) {
          const value = buildSubChunk(sub, cx, cz, map);
          if (!value) continue;
          await db.put(subChunkKey(OVERWORLD, cx, cz, sub), value);
          subchunks++;
        }
      }
    }
  } finally {
    await db.close();
  }

  return { worldPath, chunks, subchunks, cells: map.size };
}

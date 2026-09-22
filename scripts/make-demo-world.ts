/**
 * Builds a small synthetic Bedrock world for local/desktop demos.
 * Not used in production — only to exercise the 2D/3D map without a live BDS.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDB } from '@8crafter/leveldb-zlib';
import { entryContentTypeToFormatMap } from 'mcbe-leveldb';
import nbt from 'prismarine-nbt';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { ChunkTag, blockIndex, chunkKey, subChunkKey } from '../server/world/keys.ts';

const ROOT = path.resolve('demo-world');
const RADIUS = 6; // chunks -RADIUS..RADIUS in X and Z

function paletteEntry(name: string) {
  return {
    type: 'compound' as const,
    value: {
      name: { type: 'string' as const, value: name },
      states: { type: 'compound' as const, value: {} },
    },
  };
}

function heightAt(worldX: number, worldZ: number): number {
  const hills =
    68 +
    Math.round(10 * Math.sin(worldX / 18) * Math.cos(worldZ / 22)) +
    Math.round(4 * Math.sin((worldX + worldZ) / 9));
  // Pond near origin
  const dist = Math.hypot(worldX - 8, worldZ - 8);
  if (dist < 12) return 62;
  return hills;
}

function surfaceBlock(worldX: number, worldZ: number, y: number): string {
  const dist = Math.hypot(worldX - 8, worldZ - 8);
  if (dist < 12 && y <= 62) return 'minecraft:water';
  if (y > 78) return 'minecraft:stone';
  if ((worldX + worldZ) % 37 === 0) return 'minecraft:podzol';
  if ((worldX * 3 + worldZ) % 51 === 0) return 'minecraft:sand';
  return 'minecraft:grass_block';
}

/**
 * Vertical structures for validating voxel meshing (tower, wall, steps, tree).
 * Returns an override block name, or null to keep the terrain column.
 */
function structureBlock(worldX: number, worldY: number, worldZ: number): string | null {
  // Stone tower near (32, 70, 32)
  if (worldX >= 30 && worldX <= 33 && worldZ >= 30 && worldZ <= 33 && worldY >= 64 && worldY <= 82) {
    return 'minecraft:stone';
  }
  // Cobble wall along z=20, x=10..25
  if (worldZ === 20 && worldX >= 10 && worldX <= 25 && worldY >= 66 && worldY <= 72) {
    return 'minecraft:cobblestone';
  }
  // Stepped cliff at x=55
  if (worldX >= 54 && worldX <= 58 && worldZ >= 40 && worldZ <= 48) {
    const step = worldX - 54;
    if (worldY >= 64 && worldY <= 68 + step * 2) return 'minecraft:stone';
  }
  // Tiny oak-like tree at (45, ground, 12)
  if (worldX === 45 && worldZ === 12 && worldY >= 68 && worldY <= 72) return 'minecraft:oak_log';
  if (
    worldY >= 72 &&
    worldY <= 74 &&
    worldX >= 44 &&
    worldX <= 46 &&
    worldZ >= 11 &&
    worldZ <= 13 &&
    !(worldX === 45 && worldZ === 12 && worldY < 73)
  ) {
    return 'minecraft:oak_leaves';
  }
  return null;
}

function buildSubChunk(subIndex: number, chunkX: number, chunkZ: number): Buffer | null {
  const baseY = subIndex * 16;
  const indices = new Array(4096).fill(0); // air
  let anySolid = false;
  const palette = [
    paletteEntry('minecraft:air'),
    paletteEntry('minecraft:stone'),
    paletteEntry('minecraft:dirt'),
    paletteEntry('minecraft:grass_block'),
    paletteEntry('minecraft:water'),
    paletteEntry('minecraft:sand'),
    paletteEntry('minecraft:podzol'),
    paletteEntry('minecraft:cobblestone'),
    paletteEntry('minecraft:oak_log'),
    paletteEntry('minecraft:oak_leaves'),
  ];
  const idOf: Record<string, number> = {
    'minecraft:air': 0,
    'minecraft:stone': 1,
    'minecraft:dirt': 2,
    'minecraft:grass_block': 3,
    'minecraft:water': 4,
    'minecraft:sand': 5,
    'minecraft:podzol': 6,
    'minecraft:cobblestone': 7,
    'minecraft:oak_log': 8,
    'minecraft:oak_leaves': 9,
  };

  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const worldX = chunkX * 16 + lx;
      const worldZ = chunkZ * 16 + lz;
      const top = heightAt(worldX, worldZ);
      for (let ly = 0; ly < 16; ly++) {
        const y = baseY + ly;
        let block = 'minecraft:air';
        const structure = structureBlock(worldX, y, worldZ);
        if (structure) {
          block = structure;
        } else if (y < top - 3) {
          block = 'minecraft:stone';
        } else if (y < top) {
          block = 'minecraft:dirt';
        } else if (y === top) {
          block = surfaceBlock(worldX, worldZ, y);
        }
        if (block !== 'minecraft:air') anySolid = true;
        indices[blockIndex(lx, ly, lz)] = idOf[block] ?? 0;
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

  return Buffer.from(entryContentTypeToFormatMap.SubChunkPrefix.serialize(data as never));
}

async function writeLevelDat(worldPath: string): Promise<void> {
  const root = nbt.comp({
    LevelName: nbt.string('Demo3D'),
    SpawnX: nbt.int(8),
    SpawnY: nbt.int(70),
    SpawnZ: nbt.int(8),
    StorageVersion: nbt.int(10),
    lastOpenedWithVersion: nbt.list(nbt.int, [1, 26, 51, 1, 0]),
  });
  const payload = nbt.writeUncompressed(root, 'little');
  const header = Buffer.alloc(8);
  header.writeInt32LE(10, 0);
  header.writeInt32LE(payload.length, 4);
  await fs.writeFile(path.join(worldPath, 'level.dat'), Buffer.concat([header, payload]));
  await fs.writeFile(path.join(worldPath, 'levelname.txt'), 'Demo3D\n');
}

async function main(): Promise<void> {
  await fs.rm(ROOT, { recursive: true, force: true });
  const dbPath = path.join(ROOT, 'db');
  await fs.mkdir(dbPath, { recursive: true });
  await writeLevelDat(ROOT);

  const db = new LevelDB(dbPath, { createIfMissing: true });
  await db.open();

  let subchunks = 0;
  for (let cz = -RADIUS; cz <= RADIUS; cz++) {
    for (let cx = -RADIUS; cx <= RADIUS; cx++) {
      await db.put(chunkKey(OVERWORLD, cx, cz, ChunkTag.ChunkVersion), Buffer.from([0x28]));
      // Surface sits around y=60..80 → subchunk indices 3..5
      for (const sub of [3, 4, 5]) {
        const value = buildSubChunk(sub, cx, cz);
        if (!value) continue;
        await db.put(subChunkKey(OVERWORLD, cx, cz, sub), value);
        subchunks++;
      }
    }
  }

  await db.close();
  console.log(`Wrote demo world at ${ROOT}`);
  console.log(`chunks=${(RADIUS * 2 + 1) ** 2} subchunks=${subchunks}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

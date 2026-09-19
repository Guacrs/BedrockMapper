/**
 * Reads Bedrock Data3D (tag 0x2b) biome palettes for a chunk column.
 *
 * Parsing is delegated to `mcbe-leveldb`'s `readData3dValue`. We only need the
 * biome id at each surface column so map tints can follow the client biome
 * colours (e.g. orange dappled forest foliage).
 */

import { readData3dValue, getBiomeTypeFromID, type BiomePalette } from 'mcbe-leveldb';
import type { Dimension } from './dimensions.ts';
import { minSubChunkIndex } from './dimensions.ts';
import { blockIndex, CHUNK_SIZE, SUBCHUNK_SIZE } from './keys.ts';

export interface ChunkBiomes {
  /** One palette per subchunk, bottom → top (index 0 = minSubChunkIndex). */
  palettes: BiomePalette[];
  minSubChunkIndex: number;
}

/** Biome numeric id at a local column / world Y, or null when Data3D is missing. */
export function biomeIdAt(
  biomes: ChunkBiomes | null | undefined,
  localX: number,
  worldY: number,
  localZ: number,
): number | null {
  if (!biomes?.palettes.length) return null;
  if (localX < 0 || localZ < 0 || localX >= CHUNK_SIZE || localZ >= CHUNK_SIZE) return null;

  const subIndex = Math.floor(worldY / SUBCHUNK_SIZE);
  const paletteIndex = subIndex - biomes.minSubChunkIndex;
  const palette = biomes.palettes[paletteIndex];
  if (!palette || !palette.palette.length) {
    // Fall back to any non-empty palette in the column (caves often only fill lower ones).
    for (const candidate of biomes.palettes) {
      if (candidate.palette.length) return candidate.palette[0] ?? null;
    }
    return null;
  }

  if (!palette.values || palette.values.length === 0) {
    return palette.palette[0] ?? null;
  }

  const localY = ((worldY % SUBCHUNK_SIZE) + SUBCHUNK_SIZE) % SUBCHUNK_SIZE;
  const valueIndex = blockIndex(localX, localY, localZ);
  const entry = palette.values[valueIndex];
  if (entry === undefined) return palette.palette[0] ?? null;
  return palette.palette[entry] ?? null;
}

export function biomeName(id: number | null | undefined): string | null {
  if (id == null) return null;
  try {
    return getBiomeTypeFromID(id) ?? null;
  } catch {
    return null;
  }
}

/** Parses a raw Data3D LevelDB value into biome palettes for this dimension. */
export function parseData3D(raw: Uint8Array | Buffer | null, dimension: Dimension): ChunkBiomes | null {
  if (!raw?.length) return null;
  try {
    const parsed = readData3dValue(raw instanceof Buffer ? raw : Buffer.from(raw));
    if (!parsed?.biomes?.length) return null;
    return {
      palettes: parsed.biomes,
      minSubChunkIndex: minSubChunkIndex(dimension),
    };
  } catch {
    return null;
  }
}

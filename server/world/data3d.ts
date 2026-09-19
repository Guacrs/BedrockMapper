/**
 * Reads Bedrock Data3D (tag 0x2b) biome palettes for a chunk column.
 *
 * Parsing is delegated to `mcbe-leveldb`'s `readData3dValue`. We only need the
 * biome id at each surface column so map tints can follow the client biome
 * colours (e.g. orange dappled forest foliage).
 *
 * Data3D stores one biome palette per 16-block-tall subchunk (bottom → top).
 * `mcbe-leveldb` represents an omitted / empty subchunk as
 * `{ values: null, palette: [] }`. That means "no biome data for this Y range",
 * not "copy a biome from somewhere else in the column". Looking up a missing
 * palette must return null so the colour pipeline keeps its plains-like
 * default rather than inventing a wrong-Y biome.
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

type PopulatedBiomePalette = BiomePalette & { values: number[] };

function hasBiomeData(palette: BiomePalette | undefined): palette is PopulatedBiomePalette {
  return Boolean(palette && palette.values !== null && palette.palette.length > 0);
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
  if (paletteIndex < 0 || paletteIndex >= biomes.palettes.length) return null;

  const palette = biomes.palettes[paletteIndex];
  // Omitted subchunk (0xFF / values=null) or empty palette: no data at this Y.
  if (!hasBiomeData(palette)) return null;

  const { values, palette: ids } = palette;
  // Uniform single-biome subchunks still come back with a 4096-entry values
  // array of zeros from mcbe-leveldb (bits-per-block 0). Empty values mean we
  // cannot safely address a block, so refuse rather than guess palette[0].
  if (values.length === 0) return null;

  const localY = ((worldY % SUBCHUNK_SIZE) + SUBCHUNK_SIZE) % SUBCHUNK_SIZE;
  const valueIndex = blockIndex(localX, localY, localZ);
  const entry = values[valueIndex];
  if (entry === undefined) return null;
  return ids[entry] ?? null;
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

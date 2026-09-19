import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BiomePalette } from 'mcbe-leveldb';
import { biomeIdAt, type ChunkBiomes } from '../server/world/data3d.ts';
import { blockIndex } from '../server/world/keys.ts';
import { minSubChunkIndex, OVERWORLD } from '../server/world/dimensions.ts';

/** Empty / omitted subchunk as produced by mcbe-leveldb for header 0xFF. */
function emptyPalette(): BiomePalette {
  return { values: null, palette: [] };
}

/** Uniform single-biome subchunk (bits-per-block 0 → 4096 zeros). */
function uniformPalette(biomeId: number): BiomePalette {
  return { values: new Array(4096).fill(0), palette: [biomeId] };
}

/** Per-block palette: every block uses palette index 0 except one column. */
function mixedPalette(defaultId: number, specialId: number, specialX: number, specialZ: number): BiomePalette {
  const values = new Array(4096).fill(0);
  for (let y = 0; y < 16; y++) {
    values[blockIndex(specialX, y, specialZ)] = 1;
  }
  return { values, palette: [defaultId, specialId] };
}

function columnBiomes(palettes: BiomePalette[]): ChunkBiomes {
  return { palettes, minSubChunkIndex: minSubChunkIndex(OVERWORLD) };
}

describe('biomeIdAt Data3D lookup', () => {
  it('returns null when Data3D is missing', () => {
    assert.equal(biomeIdAt(null, 0, 64, 0), null);
    assert.equal(biomeIdAt({ palettes: [], minSubChunkIndex: -4 }, 0, 64, 0), null);
  });

  it('reads a uniform palette at the matching subchunk Y', () => {
    // Subchunk index 4 covers world Y 64..79. Index in array = 4 - (-4) = 8.
    const palettes = Array.from({ length: 24 }, () => emptyPalette());
    palettes[8] = uniformPalette(1); // plains
    const biomes = columnBiomes(palettes);

    assert.equal(biomeIdAt(biomes, 3, 64, 5), 1);
    assert.equal(biomeIdAt(biomes, 3, 79, 5), 1);
  });

  it('reads per-block palette values at the surface column', () => {
    const palettes = Array.from({ length: 24 }, () => emptyPalette());
    palettes[8] = mixedPalette(1, 195, 2, 7); // plains vs dappled forest
    const biomes = columnBiomes(palettes);

    assert.equal(biomeIdAt(biomes, 2, 70, 7), 195);
    assert.equal(biomeIdAt(biomes, 1, 70, 7), 1);
  });

  it('does not borrow a biome from a different subchunk when the target palette is missing', () => {
    // Only deep underground has biome data; surface subchunk is empty.
    const palettes = Array.from({ length: 24 }, () => emptyPalette());
    palettes[0] = uniformPalette(8); // deep frozen ocean-ish id, wrong for surface
    const biomes = columnBiomes(palettes);

    assert.equal(biomeIdAt(biomes, 0, -64, 0), 8);
    assert.equal(biomeIdAt(biomes, 0, 64, 0), null, 'missing surface palette must not use deep biome');
    assert.equal(biomeIdAt(biomes, 0, 100, 0), null);
  });

  it('keeps neighbouring subchunk biomes independent', () => {
    const palettes = Array.from({ length: 24 }, () => emptyPalette());
    palettes[7] = uniformPalette(4); // Y 48..63
    palettes[8] = uniformPalette(195); // Y 64..79 dappled
    palettes[9] = emptyPalette(); // Y 80..95 missing
    const biomes = columnBiomes(palettes);

    assert.equal(biomeIdAt(biomes, 0, 63, 0), 4);
    assert.equal(biomeIdAt(biomes, 0, 64, 0), 195);
    assert.equal(biomeIdAt(biomes, 0, 80, 0), null);
  });

  it('returns null for out-of-range local X/Z and for Y outside the palette list', () => {
    const palettes = [uniformPalette(1)];
    const biomes: ChunkBiomes = { palettes, minSubChunkIndex: 0 };

    assert.equal(biomeIdAt(biomes, -1, 0, 0), null);
    assert.equal(biomeIdAt(biomes, 16, 0, 0), null);
    assert.equal(biomeIdAt(biomes, 0, 0, -1), null);
    assert.equal(biomeIdAt(biomes, 0, 16, 0), null); // would need palette index 1
  });

  it('handles negative world Y local offsets inside a subchunk', () => {
    const palettes = Array.from({ length: 24 }, () => emptyPalette());
    palettes[0] = uniformPalette(5); // subchunk -4 → Y -64..-49
    const biomes = columnBiomes(palettes);

    assert.equal(biomeIdAt(biomes, 1, -64, 2), 5);
    assert.equal(biomeIdAt(biomes, 1, -49, 2), 5);
  });
});

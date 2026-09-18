import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';
import {
  CHANNELS,
  SHADE_MAX,
  SHADE_MIN,
  encodePng,
  pixelAt,
  renderChunkSurface,
  scaleNearest,
  shadeFactor,
} from '../server/renderer/chunk-image.ts';
import { blockColor, hasKnownColor } from '../server/renderer/colors.ts';
import { columnIndex } from '../server/world/keys.ts';
import { NO_SURFACE, type ChunkSurface } from '../server/world/surface.ts';

/** Builds a surface where every column has the same block, at heights from `heightAt`. */
function makeSurface(
  block: string | null,
  heightAt: (x: number, z: number) => number = () => 64,
): ChunkSurface {
  const heights = new Int16Array(256);
  const blocks: (string | null)[] = new Array(256).fill(null);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const column = columnIndex(x, z);
      blocks[column] = block;
      heights[column] = block ? heightAt(x, z) : NO_SURFACE;
    }
  }
  return {
    chunkX: 0,
    chunkZ: 0,
    heights,
    blocks,
    resolvedColumns: block ? 256 : 0,
    skipped: [],
  };
}

describe('block colours', () => {
  it('uses the curated palette for common surface blocks', () => {
    assert.deepEqual(blockColor('minecraft:water'), [59, 110, 190]);
    assert.deepEqual(blockColor('minecraft:grass_block'), [106, 168, 79]);
    assert.deepEqual(blockColor('minecraft:snow_layer'), [246, 250, 252]);
    assert.deepEqual(blockColor('minecraft:bedrock'), [58, 58, 58]);
  });

  it('matches families by name rule', () => {
    assert.deepEqual(blockColor('minecraft:spruce_leaves'), blockColor('minecraft:birch_leaves'));
    assert.deepEqual(blockColor('minecraft:oak_log'), blockColor('minecraft:jungle_log'));
    assert.deepEqual(blockColor('minecraft:cobbled_deepslate'), blockColor('minecraft:deepslate_bricks'));
    for (const name of ['minecraft:acacia_leaves', 'minecraft:deepslate_iron_ore', 'minecraft:red_sandstone']) {
      assert.equal(hasKnownColor(name), true, `${name} should match a rule`);
    }
  });

  it('gives unknown blocks a deterministic fallback instead of crashing', () => {
    const unknown = 'minecraft:some_block_from_a_future_update';
    assert.equal(hasKnownColor(unknown), false);
    const color = blockColor(unknown);
    assert.deepEqual(color, blockColor(unknown), 'fallback colour must be stable');
    assert.equal(color.length, 3);
    for (const channel of color) {
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
    }
    assert.notDeepEqual(color, blockColor('minecraft:another_unknown_block'));
    assert.deepEqual(blockColor(''), blockColor(''));
  });
});

describe('elevation shading', () => {
  const flat = makeSurface('minecraft:stone');

  it('leaves flat terrain unshaded', () => {
    assert.equal(shadeFactor(flat, 5, 5, 64), 1);
  });

  it('has no neighbours to compare at the north-west corner', () => {
    assert.equal(shadeFactor(flat, 0, 0, 64), 1);
  });

  it('brightens rises and darkens drops', () => {
    assert.ok(shadeFactor(flat, 5, 5, 70) > 1, 'a column above its neighbours should brighten');
    assert.ok(shadeFactor(flat, 5, 5, 58) < 1, 'a column below its neighbours should darken');
  });

  it('clamps extreme differences', () => {
    assert.equal(shadeFactor(flat, 5, 5, 5000), SHADE_MAX);
    assert.equal(shadeFactor(flat, 5, 5, -5000), SHADE_MIN);
  });

  it('can take neighbour heights from outside the chunk', () => {
    const withNeighbour = shadeFactor(flat, 0, 0, 64, () => 60);
    assert.ok(withNeighbour > 1, 'edge columns should shade against supplied neighbours');
  });

  it('changes pixel brightness without changing hue ordering', () => {
    const slope = makeSurface('minecraft:stone', (_x, z) => 64 + z);
    const image = renderChunkSurface(slope);
    const [flatR] = pixelAt(image, 5, 0);
    const [risingR] = pixelAt(image, 5, 5);
    assert.ok(risingR > flatR, 'rising terrain should be lighter than the reference row');

    const unshaded = renderChunkSurface(slope, { shading: false });
    assert.deepEqual(pixelAt(unshaded, 5, 5).slice(0, 3), [...blockColor('minecraft:stone')]);
  });
});

describe('chunk image', () => {
  it('renders a 16x16 RGBA image', () => {
    const image = renderChunkSurface(makeSurface('minecraft:water'));
    assert.equal(image.width, 16);
    assert.equal(image.height, 16);
    assert.equal(image.data.length, 16 * 16 * CHANNELS);
  });

  it('maps local X/Z to pixel X/Y', () => {
    const surface = makeSurface('minecraft:stone');
    // Mark one column with a distinctive block and check where it lands.
    surface.blocks[columnIndex(3, 11)] = 'minecraft:lava';
    const image = renderChunkSurface(surface, { shading: false });
    assert.deepEqual(pixelAt(image, 3, 11).slice(0, 3), [...blockColor('minecraft:lava')]);
    assert.deepEqual(pixelAt(image, 11, 3).slice(0, 3), [...blockColor('minecraft:stone')]);
  });

  it('leaves columns without a visible block transparent', () => {
    const surface = makeSurface('minecraft:stone');
    surface.blocks[columnIndex(0, 0)] = null;
    surface.heights[columnIndex(0, 0)] = NO_SURFACE;
    const image = renderChunkSurface(surface);
    assert.deepEqual(pixelAt(image, 0, 0), [0, 0, 0, 0]);
    assert.equal(pixelAt(image, 1, 0)[3], 255);
  });

  it('scales with nearest neighbour', () => {
    const surface = makeSurface('minecraft:stone');
    surface.blocks[columnIndex(0, 0)] = 'minecraft:lava';
    const scaled = scaleNearest(renderChunkSurface(surface, { shading: false }), 4);
    assert.equal(scaled.width, 64);
    assert.equal(scaled.height, 64);
    const lava = [...blockColor('minecraft:lava')];
    for (const [x, y] of [[0, 0], [3, 3], [1, 2]] as const) {
      assert.deepEqual(pixelAt(scaled, x, y).slice(0, 3), lava);
    }
    assert.deepEqual(pixelAt(scaled, 4, 0).slice(0, 3), [...blockColor('minecraft:stone')]);
    assert.throws(() => scaleNearest(renderChunkSurface(surface), 0));
  });

  it('round-trips through PNG unchanged', () => {
    const image = renderChunkSurface(makeSurface('minecraft:grass_block', (x, z) => 64 + ((x + z) % 5)));
    const png = encodePng(image);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');

    const decoded = decodePng(png);
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 16);
    assert.equal(decoded.channels, 4);
    assert.equal(decoded.depth, 8);
    assert.deepEqual(Uint8Array.from(decoded.data as Uint8Array), image.data);
  });
});

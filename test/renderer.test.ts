import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';
import {
  CHANNELS,
  SHADE_MAX,
  SHADE_MIN,
  WATER_SHADE_WEIGHT,
  encodePng,
  pixelAt,
  renderChunkSurface,
  scaleNearest,
  shadeFactor,
  shadeFactorForBlock,
} from '../server/renderer/chunk-image.ts';
import { blockColor, deepenWater, hasKnownColor, resolveBlockColor, surfaceBlockColor } from '../server/renderer/colors.ts';
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
    waterDepths: new Uint8Array(256),
    biomes: new Uint16Array(256).fill(0xffff),
    resolvedColumns: block ? 256 : 0,
    skipped: [],
  };
}

describe('block colours', () => {
  it('uses official map colours (with Bedrock tints) for common surface blocks', () => {
    // White map_color × plains-like Bedrock tint.
    assert.deepEqual(blockColor('minecraft:water'), [68, 175, 245]);
    assert.deepEqual(blockColor('minecraft:grass_block'), [146, 188, 88]);
    assert.deepEqual(blockColor('minecraft:spruce_leaves'), [97, 153, 97]);
    assert.deepEqual(blockColor('minecraft:podzol'), [129, 86, 49]);
    assert.deepEqual(blockColor('minecraft:sand'), [247, 233, 163]);
    assert.deepEqual(blockColor('minecraft:snow_layer'), [255, 255, 255]);
    assert.deepEqual(blockColor('minecraft:stone'), [112, 112, 112]);
    assert.deepEqual(blockColor('minecraft:bedrock'), [112, 112, 112]);
    assert.deepEqual(blockColor('minecraft:brown_mushroom'), [102, 76, 51]);
    assert.deepEqual(blockColor('minecraft:white_wool_stairs'), [233, 236, 236]);
  });

  it('keeps spruce and birch leaves distinct via Bedrock foliage tints', () => {
    assert.notDeepEqual(blockColor('minecraft:spruce_leaves'), blockColor('minecraft:birch_leaves'));
    assert.deepEqual(blockColor('minecraft:oak_leaves'), [119, 171, 47]);
    assert.deepEqual(blockColor('minecraft:birch_leaves'), [128, 167, 85]);
  });

  it('matches unknown members of a block family to that family map colour', () => {
    assert.deepEqual(blockColor('minecraft:future_update_leaves'), blockColor('minecraft:oak_leaves'));
    assert.deepEqual(blockColor('minecraft:future_update_planks'), blockColor('minecraft:oak_planks'));
    assert.equal(hasKnownColor('minecraft:future_update_leaves'), true);
    assert.equal(hasKnownColor('minecraft:deepslate_iron_ore'), true);
    assert.equal(hasKnownColor('minecraft:red_sandstone'), true);
    assert.deepEqual(blockColor('minecraft:future_deepslate_thing'), blockColor('minecraft:deepslate'));
    assert.deepEqual(blockColor('minecraft:mystery_ice_sheet'), blockColor('minecraft:ice'));
    assert.deepEqual(blockColor('minecraft:weird_brick_stairs'), blockColor('minecraft:brick_block'));
    assert.deepEqual(blockColor('minecraft:custom_dirt_path'), blockColor('minecraft:grass_path'));
  });

  it('aliases Java-style names onto Bedrock map colours', () => {
    assert.deepEqual(blockColor('minecraft:dirt_path'), blockColor('minecraft:grass_path'));
    assert.deepEqual(blockColor('minecraft:bricks'), blockColor('minecraft:brick_block'));
    assert.deepEqual(blockColor('minecraft:nether_bricks'), blockColor('minecraft:nether_brick'));
    assert.equal(hasKnownColor('minecraft:dirt_path'), true);
    assert.equal(hasKnownColor('minecraft:bricks'), true);
  });

  it('keeps constructed materials distinct from plain stone and dirt', () => {
    assert.notDeepEqual(blockColor('minecraft:brick_block'), blockColor('minecraft:stone'));
    assert.notDeepEqual(blockColor('minecraft:white_concrete'), blockColor('minecraft:stone'));
    assert.notDeepEqual(blockColor('minecraft:oak_planks'), blockColor('minecraft:stone'));
    assert.notDeepEqual(blockColor('minecraft:orange_terracotta'), blockColor('minecraft:dirt'));
    assert.notDeepEqual(blockColor('minecraft:iron_block'), blockColor('minecraft:dirt'));
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

  it('describes the colour source the way the debug report does', () => {
    assert.equal(resolveBlockColor('minecraft:grass_block').label, 'map-color + grass tint');
    assert.equal(resolveBlockColor('minecraft:spruce_leaves').label, 'map-color + evergreen foliage tint');
    assert.equal(resolveBlockColor('minecraft:podzol').label, 'map-color');
    assert.equal(resolveBlockColor('minecraft:some_block_from_a_future_update').label, 'hash fallback');
  });

  it('darkens deeper water without leaving the blue family', () => {
    const shallow = surfaceBlockColor('minecraft:water', 1);
    const deep = surfaceBlockColor('minecraft:water', 12);
    assert.deepEqual(shallow, blockColor('minecraft:water'));
    assert.ok(deep[2]! > deep[0]!, 'deep water should stay blue-dominant');
    assert.ok(deep[2]! < shallow[2]!, 'deeper water should be darker');
    assert.deepEqual(deepenWater(shallow, 1), shallow);
    // Non-water blocks ignore the depth argument.
    assert.deepEqual(surfaceBlockColor('minecraft:grass_block', 20), blockColor('minecraft:grass_block'));
  });

  it('applies dappled forest biome tints so foliage reads orange', () => {
    const dappledId = 195; // minecraft:dappled_forest
    const grass = surfaceBlockColor('minecraft:grass_block', 0, dappledId);
    const leaves = surfaceBlockColor('minecraft:oak_leaves', 0, dappledId);
    const plainsGrass = blockColor('minecraft:grass_block');
    assert.notDeepEqual(grass, plainsGrass);
    assert.ok(grass[0]! > grass[2]!, 'dappled grass should be orange-dominant');
    assert.ok(leaves[0]! > leaves[2]!, 'dappled oak leaves should be orange-dominant');
    // Spruce keeps its fixed evergreen tint even in dappled forest.
    assert.deepEqual(
      surfaceBlockColor('minecraft:spruce_leaves', 0, dappledId),
      blockColor('minecraft:spruce_leaves'),
    );
  });

  it('applies map colour, biome tint, then water depth (shade is applied later)', () => {
    const dappledId = 195;
    const resolved = resolveBlockColor('minecraft:water');
    const tinted = surfaceBlockColor('minecraft:water', 1, dappledId);
    const deepTinted = surfaceBlockColor('minecraft:water', 12, dappledId);
    // Biome replaces the neutral tint, using the untinted map-colour base.
    assert.notDeepEqual(tinted, resolved.rgb);
    assert.notDeepEqual(tinted, resolved.base);
    // Depth darkening runs after tinting; shallow biome water stays at the tinted colour.
    assert.deepEqual(tinted, surfaceBlockColor('minecraft:water', 0, dappledId));
    assert.notDeepEqual(deepTinted, tinted);
    // Depth blends toward deep-ocean blue from the already-tinted colour.
    assert.ok(deepTinted[0]! < tinted[0]!, 'depth darkens the tinted water');
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

  it('mutes slope shading on water so depth stays visible', () => {
    const steep = 1.3;
    const muted = shadeFactorForBlock('minecraft:water', steep);
    assert.ok(muted < steep);
    assert.ok(muted > 1);
    assert.equal(muted, 1 + (steep - 1) * WATER_SHADE_WEIGHT);
    assert.equal(shadeFactorForBlock('minecraft:stone', steep), steep);
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

  it('applies water depth when rendering a surface', () => {
    const surface = makeSurface('minecraft:water');
    surface.waterDepths.fill(1);
    surface.waterDepths[columnIndex(4, 4)] = 14;
    const image = renderChunkSurface(surface, { shading: false });
    const shallow = pixelAt(image, 0, 0).slice(0, 3);
    const deep = pixelAt(image, 4, 4).slice(0, 3);
    assert.deepEqual(shallow, [...blockColor('minecraft:water')]);
    assert.notDeepEqual(deep, shallow);
    assert.ok(deep[2]! < shallow[2]!);
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

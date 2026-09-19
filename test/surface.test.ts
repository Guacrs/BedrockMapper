import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isInvisible, shortBlockName } from '../server/world/blocks.ts';
import { blockIndex, columnIndex } from '../server/world/keys.ts';
import { NO_SURFACE, surfaceFromSubChunks } from '../server/world/surface.ts';
import type { SubChunk } from '../server/world/subchunk.ts';

/** Builds a subchunk whose blocks come from a `(x, y, z) -> palette index` function. */
function makeSubChunk(
  index: number,
  palette: string[],
  fill: (x: number, y: number, z: number) => number,
): SubChunk {
  const indices = new Uint16Array(4096);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) indices[blockIndex(x, y, z)] = fill(x, y, z);
    }
  }
  return {
    index,
    version: 9,
    layers: [{ palette: palette.map((name) => ({ name, states: {} })), indices }],
  };
}

const AIR = 'minecraft:air';

describe('block classification', () => {
  it('treats air and technical blocks as invisible', () => {
    assert.equal(isInvisible(AIR), true);
    assert.equal(isInvisible('minecraft:barrier'), true);
    assert.equal(isInvisible('minecraft:light_block'), true);
    assert.equal(isInvisible('minecraft:light_block_15'), true);
    assert.equal(isInvisible('minecraft:structure_void'), true);
  });

  it('treats terrain and foliage as visible', () => {
    for (const name of [
      'minecraft:grass_block',
      'minecraft:water',
      'minecraft:snow_layer',
      'minecraft:spruce_leaves',
      'minecraft:some_block_added_in_a_future_update',
    ]) {
      assert.equal(isInvisible(name), false);
    }
  });

  it('strips the namespace for display', () => {
    assert.equal(shortBlockName('minecraft:grass_block'), 'grass_block');
    assert.equal(shortBlockName('custom:block'), 'custom:block');
  });
});

describe('highest visible block detection', () => {
  it('finds the top block inside a single subchunk', () => {
    // y 0..7 stone, y 8 grass, y 9..15 air
    const subChunk = makeSubChunk(4, [AIR, 'minecraft:stone', 'minecraft:grass_block'], (_x, y) =>
      y < 8 ? 1 : y === 8 ? 2 : 0,
    );
    const surface = surfaceFromSubChunks(0, 0, [subChunk]);
    assert.equal(surface.resolvedColumns, 256);
    assert.equal(surface.blocks[columnIndex(0, 0)], 'minecraft:grass_block');
    assert.equal(surface.heights[columnIndex(0, 0)], 4 * 16 + 8);
    assert.equal(surface.heights[columnIndex(15, 15)], 72);
  });

  it('falls through empty subchunks to the one below', () => {
    const empty = makeSubChunk(6, [AIR], () => 0);
    const ground = makeSubChunk(5, [AIR, 'minecraft:sand'], (_x, y) => (y === 15 ? 1 : 0));
    const surface = surfaceFromSubChunks(0, 0, [empty, ground]);
    assert.equal(surface.blocks[columnIndex(3, 3)], 'minecraft:sand');
    assert.equal(surface.heights[columnIndex(3, 3)], 5 * 16 + 15);
  });

  it('prefers the highest subchunk regardless of input order', () => {
    const lower = makeSubChunk(2, [AIR, 'minecraft:stone'], (_x, y) => (y === 0 ? 1 : 0));
    const upper = makeSubChunk(3, [AIR, 'minecraft:snow'], (_x, y) => (y === 0 ? 1 : 0));
    for (const order of [[lower, upper], [upper, lower]]) {
      const surface = surfaceFromSubChunks(0, 0, order);
      assert.equal(surface.blocks[columnIndex(1, 1)], 'minecraft:snow');
      assert.equal(surface.heights[columnIndex(1, 1)], 48);
    }
  });

  it('handles negative subchunk indices', () => {
    const deep = makeSubChunk(-4, [AIR, 'minecraft:bedrock'], (_x, y) => (y === 0 ? 1 : 0));
    const surface = surfaceFromSubChunks(0, 0, [deep]);
    assert.equal(surface.heights[columnIndex(0, 0)], -64);
  });

  it('leaves fully invisible columns unresolved', () => {
    const air = makeSubChunk(0, [AIR], () => 0);
    const surface = surfaceFromSubChunks(0, 0, [air]);
    assert.equal(surface.resolvedColumns, 0);
    assert.equal(surface.blocks[columnIndex(0, 0)], null);
    assert.equal(surface.heights[columnIndex(0, 0)], NO_SURFACE);
  });

  it('resolves each column independently', () => {
    // A diagonal staircase: column (x, z) has its top block at y = x.
    const subChunk = makeSubChunk(0, [AIR, 'minecraft:stone'], (x, y) => (y <= x ? 1 : 0));
    const surface = surfaceFromSubChunks(0, 0, [subChunk]);
    for (let x = 0; x < 16; x++) {
      assert.equal(surface.heights[columnIndex(x, 7)], x);
    }
  });

  it('measures water column depth from already-decoded subchunks', () => {
    // Subchunk 4: water on top of stone. Depth is how many water blocks sit above stone.
    const subChunk = makeSubChunk(4, [AIR, 'minecraft:water', 'minecraft:stone'], (_x, y) => {
      if (y >= 10) return 1; // water at local 10..15 → 6 deep
      if (y >= 8) return 2; // stone floor
      return 0;
    });
    const surface = surfaceFromSubChunks(0, 0, [subChunk]);
    assert.equal(surface.blocks[columnIndex(2, 2)], 'minecraft:water');
    assert.equal(surface.waterDepths[columnIndex(2, 2)], 6);
    assert.equal(surface.heights[columnIndex(2, 2)], 4 * 16 + 15);
  });

  it('leaves waterDepth at 0 for non-water surfaces', () => {
    const subChunk = makeSubChunk(4, [AIR, 'minecraft:grass_block'], (_x, y) => (y === 8 ? 1 : 0));
    const surface = surfaceFromSubChunks(0, 0, [subChunk]);
    assert.equal(surface.waterDepths[columnIndex(0, 0)], 0);
  });
});

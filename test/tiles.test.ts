import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHUNKS_PER_TILE,
  TILE_SIZE,
  blockOffsetInTile,
  blockToTile,
  boundsCenter,
  boundsOfChunks,
  chunkBoundsToBlockBounds,
  chunkToTile,
  floorDiv,
  tileRangeForBlockBounds,
  tileToBlock,
  tileToChunk,
} from '../server/tiles/coords.ts';
import { chunksForTile, chunksInTile, renderTile } from '../server/tiles/tile-renderer.ts';
import { pixelAt, renderChunkSurface, type RenderedImage } from '../server/renderer/chunk-image.ts';
import { blockColor } from '../server/renderer/colors.ts';
import { blockToChunk, columnIndex } from '../server/world/keys.ts';
import { NO_SURFACE, type ChunkSurface } from '../server/world/surface.ts';

/** Chunk surface where the block and height depend on the world coordinates. */
function syntheticSurface(
  chunkX: number,
  chunkZ: number,
  block: (worldX: number, worldZ: number) => string | null,
  height: (worldX: number, worldZ: number) => number = () => 64,
): ChunkSurface {
  const heights = new Int16Array(256);
  const blocks: (string | null)[] = new Array(256).fill(null);
  let resolved = 0;
  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = chunkX * 16 + localX;
      const worldZ = chunkZ * 16 + localZ;
      const name = block(worldX, worldZ);
      const column = columnIndex(localX, localZ);
      blocks[column] = name;
      heights[column] = name ? height(worldX, worldZ) : NO_SURFACE;
      if (name) resolved++;
    }
  }
  return { chunkX, chunkZ, heights, blocks, resolvedColumns: resolved, skipped: [] };
}

function tilePixel(image: RenderedImage, x: number, y: number) {
  return pixelAt(image, x, y);
}

describe('tile coordinates', () => {
  it('uses floor division for blocks, chunks and tiles', () => {
    assert.equal(floorDiv(-1, 16), -1);
    assert.equal(floorDiv(-16, 16), -1);
    assert.equal(floorDiv(-17, 16), -2);
    assert.equal(CHUNKS_PER_TILE, 16);
    assert.equal(TILE_SIZE, 256);
  });

  it('maps blocks to tiles across the origin', () => {
    assert.deepEqual(blockToTile(0, 0), { x: 0, y: 0 });
    assert.deepEqual(blockToTile(255, 255), { x: 0, y: 0 });
    assert.deepEqual(blockToTile(256, -1), { x: 1, y: -1 });
    assert.deepEqual(blockToTile(-1, -256), { x: -1, y: -1 });
    assert.deepEqual(blockToTile(-257, -257), { x: -2, y: -2 });
  });

  it('maps chunks to tiles across the origin', () => {
    assert.deepEqual(chunkToTile(0, 0), { x: 0, y: 0 });
    assert.deepEqual(chunkToTile(15, 15), { x: 0, y: 0 });
    assert.deepEqual(chunkToTile(16, -1), { x: 1, y: -1 });
    // Previously verified negative-coordinate chunks.
    assert.deepEqual(chunkToTile(18, -1), { x: 1, y: -1 });
    assert.deepEqual(chunkToTile(-1, 10), { x: -1, y: 0 });
  });

  it('round-trips tile -> block/chunk origin -> tile', () => {
    for (const [tileX, tileY] of [[0, 0], [-1, -1], [3, 1], [-2, 5]] as const) {
      const block = tileToBlock(tileX, tileY);
      const chunk = tileToChunk(tileX, tileY);
      assert.deepEqual(blockToTile(block.x, block.z), { x: tileX, y: tileY });
      assert.deepEqual(chunkToTile(chunk.x, chunk.z), { x: tileX, y: tileY });
      assert.deepEqual(blockToChunk(block.x, block.z), { x: chunk.x, z: chunk.z });
    }
  });

  it('keeps in-tile pixel offsets in 0..255 for negative coordinates', () => {
    assert.deepEqual(blockOffsetInTile(0, 0), { x: 0, y: 0 });
    assert.deepEqual(blockOffsetInTile(-1, -1), { x: 255, y: 255 });
    assert.deepEqual(blockOffsetInTile(-32, -48), { x: 224, y: 208 });
    assert.deepEqual(blockOffsetInTile(815, 335), { x: 47, y: 79 });
  });

  it('reconstructs world coordinates from tile plus pixel', () => {
    for (const [blockX, blockZ] of [[0, 0], [-1, -1], [-32, -48], [815, 335], [288, -16]] as const) {
      const tile = blockToTile(blockX, blockZ);
      const offset = blockOffsetInTile(blockX, blockZ);
      const origin = tileToBlock(tile.x, tile.y);
      assert.equal(origin.x + offset.x, blockX);
      assert.equal(origin.z + offset.y, blockZ);
    }
  });
});

describe('map bounds', () => {
  it('is null without chunks', () => {
    assert.equal(boundsOfChunks([]), null);
  });

  it('covers negative and positive chunks', () => {
    const bounds = boundsOfChunks([
      { x: 0, z: 0 },
      { x: 50, z: 20 },
      { x: -2, z: -3 },
      { x: 18, z: -1 },
    ])!;
    assert.deepEqual(bounds, { minX: -2, maxX: 50, minZ: -3, maxZ: 20 });

    const blockBounds = chunkBoundsToBlockBounds(bounds);
    assert.deepEqual(blockBounds, { minX: -32, maxX: 815, minZ: -48, maxZ: 335 });
    assert.deepEqual(tileRangeForBlockBounds(blockBounds), { minX: -1, maxX: 3, minZ: -1, maxZ: 1 });
    assert.deepEqual(boundsCenter(blockBounds), { x: 392, z: 144 });
  });
});

describe('tile composition', () => {
  const stone = 'minecraft:stone';

  it('needs a one-chunk border for shading but only draws its own chunks', () => {
    assert.equal(chunksInTile(0, 0).length, 256);
    assert.equal(chunksForTile(0, 0).length, 17 * 17);
    assert.deepEqual(chunksInTile(0, 0)[0], { x: 0, z: 0 });
    assert.deepEqual(chunksForTile(0, 0)[0], { x: -1, z: -1 });
    assert.deepEqual(chunksInTile(-1, -1)[0], { x: -16, z: -16 });
  });

  it('renders a full tile from many chunks', async () => {
    const image = (await renderTile(0, 0, async (cx, cz) => syntheticSurface(cx, cz, () => stone)))!;
    assert.equal(image.width, TILE_SIZE);
    assert.equal(image.height, TILE_SIZE);
    for (const [x, y] of [[0, 0], [255, 255], [128, 7]] as const) {
      assert.deepEqual(tilePixel(image, x, y).slice(0, 3), [...blockColor(stone)]);
    }
  });

  it('places each block at the pixel its world coordinates say', async () => {
    // Every block is named after its own world coordinates, so a transposition
    // or one-block offset cannot pass unnoticed.
    const palette = new Map<string, string>();
    const nameFor = (worldX: number, worldZ: number) => `test:x${worldX}_z${worldZ}`;
    const image = (await renderTile(0, 0, async (cx, cz) =>
      syntheticSurface(cx, cz, (x, z) => {
        const name = nameFor(x, z);
        palette.set(name, name);
        return name;
      }),
    ))!;

    for (const [blockX, blockZ] of [[0, 0], [1, 0], [0, 1], [17, 3], [3, 17], [255, 255]] as const) {
      const expected = blockColor(nameFor(blockX, blockZ));
      assert.deepEqual(
        tilePixel(image, blockX, blockZ).slice(0, 3),
        [...expected],
        `block ${blockX},${blockZ} should be at pixel ${blockX},${blockZ}`,
      );
    }
  });

  it('handles a tile of negative coordinates', async () => {
    const nameFor = (worldX: number, worldZ: number) => `test:x${worldX}_z${worldZ}`;
    const image = (await renderTile(-1, -1, async (cx, cz) =>
      syntheticSurface(cx, cz, (x, z) => nameFor(x, z)),
    ))!;
    // Tile (-1,-1) covers block X/Z -256..-1.
    assert.deepEqual(tilePixel(image, 0, 0).slice(0, 3), [...blockColor(nameFor(-256, -256))]);
    assert.deepEqual(tilePixel(image, 255, 255).slice(0, 3), [...blockColor(nameFor(-1, -1))]);
    assert.deepEqual(tilePixel(image, 224, 208).slice(0, 3), [...blockColor(nameFor(-32, -48))]);
  });

  it('matches the per-chunk renderer at chunk boundaries', async () => {
    // Height varies per column so shading is exercised on both sides of a seam.
    const height = (worldX: number, worldZ: number) => 64 + ((worldX * 7 + worldZ * 3) % 9);
    const load = async (cx: number, cz: number) =>
      syntheticSurface(cx, cz, () => 'minecraft:stone', height);

    const tile = (await renderTile(0, 0, load))!;
    for (const [chunkX, chunkZ] of [[0, 0], [1, 0], [0, 1], [5, 9], [15, 15]] as const) {
      const surface = await load(chunkX, chunkZ);
      const chunkImage = renderChunkSurface(surface, {
        neighborHeight: (localX, localZ) => height(chunkX * 16 + localX, chunkZ * 16 + localZ),
      });
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          assert.deepEqual(
            tilePixel(tile, chunkX * 16 + localX, chunkZ * 16 + localZ),
            pixelAt(chunkImage, localX, localZ),
            `seam mismatch at chunk ${chunkX},${chunkZ} local ${localX},${localZ}`,
          );
        }
      }
    }
  });

  it('shades continuously across a chunk boundary', async () => {
    // A step in height exactly on the chunk border must shade the same as an
    // identical step inside a chunk.
    const height = (_worldX: number, worldZ: number) => (worldZ >= 16 ? 70 : 64);
    const load = async (cx: number, cz: number) =>
      syntheticSurface(cx, cz, () => 'minecraft:stone', height);
    const tile = (await renderTile(0, 0, load))!;

    const acrossBorder = tilePixel(tile, 5, 16); // first row of chunk z=1
    const insideChunk = tilePixel(tile, 5, 17);
    assert.ok(acrossBorder[0] > insideChunk[0], 'the raised row should be brighter than flat ground above it');
    assert.deepEqual(acrossBorder, tilePixel(tile, 9, 16), 'shading should be uniform along the step');
  });

  it('shades continuously across a tile boundary', async () => {
    // A height step exactly on the border between tile 0 and tile 1 must shade
    // like the same step in the middle of a tile - the first column of tile 1
    // has to see the height of the last column of tile 0.
    const stepAt = (border: number) => async (cx: number, cz: number) =>
      syntheticSurface(cx, cz, () => stone, (worldX) => (worldX >= border ? 70 : 64));

    const acrossTiles = (await renderTile(1, 0, stepAt(TILE_SIZE)))!;
    const insideTile = (await renderTile(0, 0, stepAt(128)))!;

    assert.deepEqual(
      tilePixel(acrossTiles, 0, 7),
      tilePixel(insideTile, 128, 7),
      'first column of a tile must shade against the previous tile',
    );
    assert.notDeepEqual(tilePixel(acrossTiles, 0, 7), tilePixel(acrossTiles, 5, 7));
  });

  it('joins adjacent tiles without repeating or skipping a block', async () => {
    const nameFor = (worldX: number, worldZ: number) => `test:x${worldX}_z${worldZ}`;
    const load = async (cx: number, cz: number) => syntheticSurface(cx, cz, nameFor);
    const left = (await renderTile(-1, 0, load))!;
    const right = (await renderTile(0, 0, load))!;

    // Last column of tile -1 is block X -1, first column of tile 0 is block X 0.
    assert.deepEqual(tilePixel(left, 255, 3).slice(0, 3), [...blockColor(nameFor(-1, 3))]);
    assert.deepEqual(tilePixel(right, 0, 3).slice(0, 3), [...blockColor(nameFor(0, 3))]);
    assert.notDeepEqual(tilePixel(left, 255, 3), tilePixel(right, 0, 3));
  });

  it('leaves missing chunks transparent without crashing', async () => {
    const image = (await renderTile(0, 0, async (cx, cz) =>
      // Only a checkerboard of chunks exists.
      (cx + cz) % 2 === 0 ? syntheticSurface(cx, cz, () => 'minecraft:stone') : null,
    ))!;
    assert.deepEqual(tilePixel(image, 0, 0).slice(0, 3), [...blockColor('minecraft:stone')]);
    assert.equal(tilePixel(image, 0, 0)[3], 255);
    assert.deepEqual(tilePixel(image, 16, 0), [0, 0, 0, 0], 'missing chunk should be transparent');
    assert.deepEqual(tilePixel(image, 0, 16), [0, 0, 0, 0]);
  });

  it('leaves ungenerated columns inside a chunk transparent', async () => {
    const image = (await renderTile(0, 0, async (cx, cz) =>
      syntheticSurface(cx, cz, (x, z) => (x === 3 && z === 4 ? null : 'minecraft:stone')),
    ))!;
    assert.deepEqual(tilePixel(image, 3, 4), [0, 0, 0, 0]);
    assert.equal(tilePixel(image, 3, 5)[3], 255);
  });

  it('reports an entirely empty tile instead of a blank image', async () => {
    assert.equal(await renderTile(9999, 9999, async () => null), null);
  });
});

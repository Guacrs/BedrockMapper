/**
 * PR39: candle family — 1–4 sticks from `candles` 0–3, lit wick + emissive.
 * Candle cakes deferred. No general flame/particle system.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import {
  blockLightingFor,
  isEmissiveBlock,
} from '../server/renderer/3d/lighting/block-lighting.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  candleCountFromStates,
  candleIsLit,
  candleLightLevel,
  candleModel,
  isCandleName,
  tryBuildCandle,
} from '../server/renderer/3d/models/families/candle.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import {
  buildVoxelMesh,
  countEmissiveFaces,
  countFaces,
} from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

function makeSubChunkWithStates(
  index: number,
  fill: (x: number, y: number, z: number) => BlockState | null,
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
        indices[blockIndex(x, y, z)] = ensure(fill(x, y, z) ?? { name: 'minecraft:air', states: {} });
      }
    }
  }
  return { index, version: 9, layers: [{ palette, indices }] };
}

function volumeFromStates(
  chunkX: number,
  chunkZ: number,
  fill: (localX: number, worldY: number, localZ: number) => BlockState | null,
): ChunkBlocks {
  return ChunkBlocks.fromSubChunks(chunkX, chunkZ, [
    makeSubChunkWithStates(4, (x, y, z) => fill(x, 64 + y, z)),
  ]);
}

function emptyNeighborhood(self: ChunkBlocks | null): VoxelNeighborhood {
  return { self, west: null, east: null, north: null, south: null };
}

describe('PR39 candle coverage', () => {
  it('classifies floor candles as explicit candle family; excludes cakes', () => {
    assert.equal(isCandleName('minecraft:candle'), true);
    assert.equal(isCandleName('minecraft:red_candle'), true);
    assert.equal(isCandleName('minecraft:white_candle'), true);
    assert.equal(isCandleName('minecraft:candle_cake'), false);
    assert.equal(isCandleName('minecraft:red_candle_cake'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:candle')?.family, 'candle');
    assert.equal(classifyBlockModelCoverage('minecraft:candle')?.implementation, 'explicit');
    assert.equal(classifyBlockModelCoverage('minecraft:blue_candle')?.family, 'candle');
    assert.equal(classifyGeometryAudit('minecraft:candle')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:candle_cake')?.bucket, 'known_incorrect');
  });
});

describe('PR39 candle states', () => {
  it('maps Bedrock candles 0–3 → stick count 1–4', () => {
    assert.equal(candleCountFromStates({}), 1);
    assert.equal(candleCountFromStates({ candles: 0 }), 1);
    assert.equal(candleCountFromStates({ candles: 1 }), 2);
    assert.equal(candleCountFromStates({ candles: 2 }), 3);
    assert.equal(candleCountFromStates({ candles: 3 }), 4);
    assert.equal(candleCountFromStates({ candles: '2' }), 3);
    assert.equal(candleCountFromStates({ candles: 9 }), 1);
  });

  it('reads lit bool / bit / string', () => {
    assert.equal(candleIsLit({}), false);
    assert.equal(candleIsLit({ lit: true }), true);
    assert.equal(candleIsLit({ lit: false }), false);
    assert.equal(candleIsLit({ lit: 1 }), true);
    assert.equal(candleIsLit({ lit: 0 }), false);
    assert.equal(candleIsLit({ lit: 'true' }), true);
    assert.equal(candleIsLit({ lit: 'false' }), false);
  });

  it('scales Bedrock light level with stick count', () => {
    assert.equal(candleLightLevel(1), 3);
    assert.equal(candleLightLevel(2), 6);
    assert.equal(candleLightLevel(3), 9);
    assert.equal(candleLightLevel(4), 12);
  });
});

describe('PR39 candle geometry', () => {
  it('builds one centred stick for candles=0', () => {
    const model = candleModel(ref('minecraft:candle', { candles: 0, lit: false }));
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 1);
    assert.equal(model.occlusionBoxes.length, 1);
    assert.deepEqual(model.renderBoxes[0]!.min, [7 * PX, 0, 7 * PX]);
    assert.deepEqual(model.renderBoxes[0]!.max, [9 * PX, 6 * PX, 9 * PX]);
    assert.match(model.key, /^candle:1:unlit:/);
  });

  it('adds two ±45° wick planes when lit', () => {
    const model = candleModel(ref('minecraft:candle', { candles: 0, lit: true }));
    assert.equal(model.renderBoxes.length, 3); // stick + 2 flame planes
    assert.equal(model.occlusionBoxes.length, 1); // flame excluded
    assert.equal(model.renderBoxes[1]!.rotation?.angle, 45);
    assert.equal(model.renderBoxes[2]!.rotation?.angle, -45);
    assert.match(model.key, /^candle:1:lit:/);
  });

  it('uses one model family for 2/3/4 sticks (not separate model files)', () => {
    const two = tryBuildCandle(ref('minecraft:red_candle', { candles: 1, lit: false }));
    const three = tryBuildCandle(ref('minecraft:blue_candle', { candles: 2, lit: false }));
    const four = tryBuildCandle(ref('minecraft:white_candle', { candles: 3, lit: false }));
    assert.equal(two.ok && two.count, 2);
    assert.equal(three.ok && three.count, 3);
    assert.equal(four.ok && four.count, 4);
    assert.equal(two.ok && two.model.renderBoxes.length, 2);
    assert.equal(three.ok && three.model.renderBoxes.length, 3);
    assert.equal(four.ok && four.model.renderBoxes.length, 4);
    // 4-candle lit: 4 sticks + 8 flame planes
    const fourLit = candleModel(ref('minecraft:yellow_candle', { candles: 3, lit: true }));
    assert.equal(fourLit.renderBoxes.length, 12);
    assert.equal(fourLit.occlusionBoxes.length, 4);
  });

  it('crops side UVs by stick height', () => {
    const model = candleModel(ref('minecraft:candle', { candles: 0 }));
    const stick = model.renderBoxes[0]!;
    assert.deepEqual(stick.faces.north!.tileUv, [0, 8 / 16, 2 / 16, 14 / 16]);
    assert.deepEqual(stick.faces.up!.tileUv, [0, 6 / 16, 2 / 16, 8 / 16]);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const candle = resolveBlockModel(ref('minecraft:candle', { candles: 3, lit: true }))!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', candle), false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', candle), false);
  });

  it('resolver caches count × lit separately', () => {
    resetBlockModelCache();
    const a = resolveBlockModel(ref('minecraft:candle', { candles: 0, lit: false }))!;
    const b = resolveBlockModel(ref('minecraft:candle', { candles: 0, lit: true }))!;
    const c = resolveBlockModel(ref('minecraft:candle', { candles: 3, lit: true }))!;
    assert.notEqual(a.key, b.key);
    assert.notEqual(b.key, c.key);
    assert.match(a.key, /:1:unlit:/);
    assert.match(b.key, /:1:lit:/);
    assert.match(c.key, /:4:lit:/);
  });
});

describe('PR39 candle emissive routing', () => {
  it('emits only when lit; scales emission with count', () => {
    assert.equal(isEmissiveBlock('minecraft:candle'), false);
    assert.equal(isEmissiveBlock('minecraft:candle', { lit: false }), false);
    assert.equal(isEmissiveBlock('minecraft:candle', { lit: true, candles: 0 }), true);
    assert.equal(blockLightingFor('minecraft:candle', { lit: true, candles: 0 })?.emission, 3 / 15);
    assert.equal(blockLightingFor('minecraft:red_candle', { lit: true, candles: 3 })?.emission, 12 / 15);
    assert.equal(blockLightingFor('minecraft:candle', { lit: false })?.emission, 0);
  });

  it('routes lit candle faces to emissive mesh; unlit to terrain', () => {
    resetBlockModelCache();
    const litSelf = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 4 && y === 64 && z === 4
        ? { name: 'minecraft:candle', states: { candles: 0, lit: true } }
        : null,
    );
    const litMesh = buildVoxelMesh(0, 0, emptyNeighborhood(litSelf));
    assertMeshInvariants(litMesh);
    assert.equal(countFaces(litMesh), 0);
    // stick 6 + 2 flame planes × 2 faces = 10
    assert.equal(countEmissiveFaces(litMesh), 10);

    resetBlockModelCache();
    const unlitSelf = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 5 && y === 64 && z === 5
        ? { name: 'minecraft:white_candle', states: { candles: 0, lit: false } }
        : null,
    );
    const unlitMesh = buildVoxelMesh(0, 0, emptyNeighborhood(unlitSelf));
    assertMeshInvariants(unlitMesh);
    assert.equal(countEmissiveFaces(unlitMesh), 0);
    assert.equal(countFaces(unlitMesh), 6);
  });
});

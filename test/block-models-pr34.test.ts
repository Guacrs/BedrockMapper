/**
 * PR34: lantern geometry / model coverage — floor vs hanging.
 * Emission levels stay in PR33 lighting catalog; this suite locks geometry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { blockLightingFor } from '../server/renderer/3d/lighting/block-lighting.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import {
  isLanternName,
  lanternIsHanging,
  lanternModel,
  LANTERN_FLOOR_BODY,
  LANTERN_HANGING_BODY,
} from '../server/renderer/3d/models/families/lantern.ts';
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

describe('PR34 lantern coverage', () => {
  it('classifies lantern / soul / copper; excludes sea and jack_o', () => {
    assert.equal(isLanternName('minecraft:lantern'), true);
    assert.equal(isLanternName('minecraft:soul_lantern'), true);
    assert.equal(isLanternName('minecraft:copper_lantern'), true);
    assert.equal(isLanternName('minecraft:waxed_oxidized_copper_lantern'), true);
    assert.equal(isLanternName('minecraft:sea_lantern'), false);
    assert.equal(isLanternName('minecraft:jack_o_lantern'), false);
    assert.equal(isLanternName('minecraft:torch'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:lantern')?.family, 'lantern');
    assert.equal(classifyBlockModelCoverage('minecraft:lantern')?.implementation, 'explicit');
    assert.equal(classifyBlockModelCoverage('minecraft:soul_lantern')?.family, 'lantern');
    assert.equal(classifyBlockModelCoverage('minecraft:sea_lantern')?.family, 'full_cube');
  });
});

describe('PR34 lantern hanging state', () => {
  it('reads hanging and hanging_bit', () => {
    assert.equal(lanternIsHanging({}), false);
    assert.equal(lanternIsHanging({ hanging: false }), false);
    assert.equal(lanternIsHanging({ hanging: true }), true);
    assert.equal(lanternIsHanging({ hanging_bit: true }), true);
    assert.equal(lanternIsHanging({ hanging_bit: false }), false);
    assert.equal(lanternIsHanging({ hanging: 1 }), true);
    assert.equal(lanternIsHanging({ hanging_bit: 0 }), false);
  });
});

describe('PR34 lantern geometry', () => {
  it('floor body matches Java template_lantern [5,0,5]–[11,7,11]', () => {
    const model = lanternModel(ref('minecraft:lantern', { hanging: false }));
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 4); // body + cap + 2 hangers
    assert.equal(model.occlusionBoxes.length, 2); // hangers excluded
    assert.deepEqual(model.renderBoxes[0]!.min, [...LANTERN_FLOOR_BODY.min]);
    assert.deepEqual(model.renderBoxes[0]!.max, [...LANTERN_FLOOR_BODY.max]);
    assert.deepEqual(model.renderBoxes[1]!.min, [6 * PX, 7 * PX, 6 * PX]);
    assert.deepEqual(model.renderBoxes[1]!.max, [10 * PX, 9 * PX, 10 * PX]);
    assert.equal(model.renderBoxes[2]!.rotation?.angle, 45);
    assert.equal(model.renderBoxes[2]!.rotation?.axis, 'y');
    assert.equal(model.renderBoxes[3]!.rotation?.angle, 45);
    assert.match(model.key, /^lantern:floor:/);
  });

  it('hanging body matches Java template_hanging_lantern [5,1,5]–[11,8,11]', () => {
    const model = lanternModel(ref('minecraft:lantern', { hanging: true }));
    assert.equal(model.isFullCube, false);
    assert.deepEqual(model.renderBoxes[0]!.min, [...LANTERN_HANGING_BODY.min]);
    assert.deepEqual(model.renderBoxes[0]!.max, [...LANTERN_HANGING_BODY.max]);
    assert.deepEqual(model.renderBoxes[1]!.min, [6 * PX, 8 * PX, 6 * PX]);
    assert.deepEqual(model.renderBoxes[1]!.max, [10 * PX, 10 * PX, 10 * PX]);
    assert.equal(model.renderBoxes[2]!.max[1], 15 * PX);
    assert.equal(model.renderBoxes[3]!.max[1], 1);
    assert.match(model.key, /^lantern:hanging:/);
  });

  it('crops lantern sprite UVs onto body faces', () => {
    const model = lanternModel(ref('minecraft:soul_lantern', { hanging_bit: false }));
    const body = model.renderBoxes[0]!;
    assert.ok(body.faces.north?.tileUv);
    assert.deepEqual(body.faces.north!.tileUv, [0 / 16, 2 / 16, 6 / 16, 9 / 16]);
    assert.deepEqual(body.faces.up!.tileUv, [0 / 16, 9 / 16, 6 / 16, 15 / 16]);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const lantern = resolveBlockModel(ref('minecraft:lantern', { hanging: false }))!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', lantern), false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', lantern), false);
  });

  it('resolver caches floor vs hanging separately', () => {
    resetBlockModelCache();
    const floor = resolveBlockModel(ref('minecraft:lantern', { hanging: false }))!;
    const hang = resolveBlockModel(ref('minecraft:lantern', { hanging: true }))!;
    assert.notEqual(floor.key, hang.key);
    assert.match(floor.key, /:floor:/);
    assert.match(hang.key, /:hanging:/);
  });
});

describe('PR34 lantern emission with geometry', () => {
  it('keeps PR33 lantern emission and routes floor lantern to emissive mesh', () => {
    assert.equal(blockLightingFor('minecraft:lantern')?.emission, 1);
    assert.equal(blockLightingFor('minecraft:soul_lantern')?.emission, 10 / 15);
    assert.equal(blockLightingFor('minecraft:copper_lantern')?.emission, 1);

    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 4 && y === 64 && z === 4
        ? { name: 'minecraft:lantern', states: { hanging: false } }
        : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 0);
    // body 6 + cap 5 + hangers 4 = 15
    assert.equal(countEmissiveFaces(mesh), 15);
    assert.ok(mesh.emissive);
  });

  it('routes hanging soul lantern to emissive with longer hangers', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 5 && y === 64 && z === 5
        ? { name: 'minecraft:soul_lantern', states: { hanging_bit: true } }
        : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 0);
    // body 6 + cap 6 + hangers 4 = 16
    assert.equal(countEmissiveFaces(mesh), 16);
  });
});

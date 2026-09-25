/**
 * PR33: rendered lighting + emissive materials.
 * Catalog + mesher routing. No Minecraft light propagation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import {
  blockLightingFor,
  emissiveBlockIds,
  isEmissiveBlock,
} from '../server/renderer/3d/lighting/block-lighting.ts';
import { assertMeshInvariants, isEmptyMesh } from '../server/renderer/3d/mesh-types.ts';
import { torchModel } from '../server/renderer/3d/models/families/torch.ts';
import { resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import {
  buildVoxelMesh,
  countEmissiveFaces,
  countFaces,
} from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

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

describe('PR33 block lighting catalog', () => {
  it('marks torch / glowstone / sea_lantern as emissive with Bedrock light levels', () => {
    const torch = blockLightingFor('minecraft:torch');
    assert.ok(torch);
    assert.equal(torch.emission, 14 / 15);
    assert.ok(torch.lightColor);
    assert.equal(isEmissiveBlock('minecraft:torch'), true);

    const glow = blockLightingFor('glowstone');
    assert.ok(glow);
    assert.equal(glow.emission, 1);
    assert.equal(isEmissiveBlock('minecraft:glowstone'), true);

    const sea = blockLightingFor('minecraft:sea_lantern');
    assert.ok(sea);
    assert.equal(sea.emission, 1);
  });

  it('keeps unlit redstone torch non-emissive (emission 0)', () => {
    const unlit = blockLightingFor('minecraft:unlit_redstone_torch');
    assert.ok(unlit);
    assert.equal(unlit.emission, 0);
    assert.equal(isEmissiveBlock('minecraft:unlit_redstone_torch'), false);
  });

  it('returns null for ordinary stone', () => {
    assert.equal(blockLightingFor('minecraft:stone'), null);
    assert.equal(isEmissiveBlock('minecraft:stone'), false);
  });

  it('lists sorted emissive ids with positive emission only', () => {
    const ids = emissiveBlockIds();
    assert.ok(ids.includes('torch'));
    assert.ok(ids.includes('glowstone'));
    assert.ok(!ids.includes('unlit_redstone_torch'));
    assert.deepEqual([...ids], [...ids].sort());
  });

  it('gives soul torch a cooler tint than regular torch', () => {
    const torch = blockLightingFor('torch')!;
    const soul = blockLightingFor('soul_torch')!;
    assert.ok(soul.lightColor![2]! > torch.lightColor![2]!);
    assert.ok(soul.emission < torch.emission);
  });
});

describe('PR33 emissive mesh layer', () => {
  it('routes glowstone faces into mesh.emissive, not terrain', () => {
    const self = volumeFromStates(0, 0, (x, y, z) =>
      x === 4 && y === 64 && z === 4 ? { name: 'minecraft:glowstone', states: {} } : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 0);
    assert.equal(countEmissiveFaces(mesh), 6);
    assert.ok(mesh.emissive);
    assert.equal(isEmptyMesh(mesh), false);
    // Warm glow tint (not pure white)
    assert.ok(mesh.emissive.colors[0]! > 0.5);
    assert.ok(mesh.emissive.colors[1]! > 0.5);
  });

  it('keeps stone on terrain and torch on emissive in the same chunk', () => {
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null => {
      if (x === 2 && y === 64 && z === 2) return { name: 'minecraft:stone', states: {} };
      if (x === 5 && y === 64 && z === 5) {
        return { name: 'minecraft:torch', states: { torch_facing_direction: 'top' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
    // Floor torch = two planes × 2 faces each (cross-face assignment, not 6×2).
    assert.equal(countEmissiveFaces(mesh), 4);
    assert.ok(mesh.emissive);
  });

  it('does not put unlit redstone torch on the emissive layer', () => {
    const self = volumeFromStates(0, 0, (x, y, z) =>
      x === 3 && y === 64 && z === 3
        ? { name: 'minecraft:unlit_redstone_torch', states: { torch_facing_direction: 'top' } }
        : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.ok(countFaces(mesh) > 0);
    assert.equal(countEmissiveFaces(mesh), 0);
    assert.equal(mesh.emissive, undefined);
  });

  it('still occludes shared faces between stone and glowstone', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 4 && y === 64 && z === 4) return { name: 'minecraft:stone', states: {} };
      if (x === 5 && y === 64 && z === 4) return { name: 'minecraft:glowstone', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // 6+6 − 2 shared = 10 total faces across both layers
    assert.equal(countFaces(mesh) + countEmissiveFaces(mesh), 10);
    assert.equal(countFaces(mesh), 5);
    assert.equal(countEmissiveFaces(mesh), 5);
  });
});

describe('PR33 torch cross-plane faces', () => {
  function faceIds(box: { faces: Record<string, unknown> }): string[] {
    return Object.keys(box.faces).sort();
  }

  it('floor torch planes texture only broad faces (like cross.ts)', () => {
    resetBlockModelCache();
    const floor = torchModel({
      name: 'minecraft:torch',
      states: { torch_facing_direction: 'top' },
    });
    assert.equal(floor.renderBoxes.length, 2);
    assert.equal(floor.isFullCube, false);
    assert.equal(floor.renderBoxes[0]!.max[1], 10 / 16);
    assert.equal(floor.renderBoxes[1]!.max[1], 10 / 16);
    assert.deepEqual(faceIds(floor.renderBoxes[0]!), ['north', 'south']);
    assert.deepEqual(faceIds(floor.renderBoxes[1]!), ['east', 'west']);
    for (const id of ['up', 'down'] as const) {
      assert.equal(floor.renderBoxes[0]!.faces[id], undefined);
      assert.equal(floor.renderBoxes[1]!.faces[id], undefined);
    }
    assert.equal(floor.renderBoxes[0]!.faces.east, undefined);
    assert.equal(floor.renderBoxes[0]!.faces.west, undefined);
    assert.equal(floor.renderBoxes[1]!.faces.north, undefined);
    assert.equal(floor.renderBoxes[1]!.faces.south, undefined);
  });

  it('soul / redstone floor torches share the same face assignment', () => {
    resetBlockModelCache();
    for (const name of [
      'minecraft:soul_torch',
      'minecraft:redstone_torch',
      'minecraft:copper_torch',
    ] as const) {
      const floor = torchModel({ name, states: { torch_facing_direction: 'top' } });
      assert.equal(floor.renderBoxes.length, 2, name);
      assert.deepEqual(faceIds(floor.renderBoxes[0]!), ['north', 'south'], name);
      assert.deepEqual(faceIds(floor.renderBoxes[1]!), ['east', 'west'], name);
    }
  });

  it('wall torch textures only broad stub faces; keeps attachment orientation', () => {
    resetBlockModelCache();
    const east = torchModel({
      name: 'minecraft:torch',
      states: { torch_facing_direction: 'east' },
    });
    assert.equal(east.renderBoxes.length, 1);
    assert.deepEqual(faceIds(east.renderBoxes[0]!), ['north', 'south']);
    assert.ok(east.renderBoxes[0]!.max[0] === 1);

    const north = torchModel({
      name: 'minecraft:soul_torch',
      states: { torch_facing_direction: 'west' },
    });
    assert.equal(north.renderBoxes.length, 1);
    assert.deepEqual(faceIds(north.renderBoxes[0]!), ['north', 'south']);
    assert.equal(north.renderBoxes[0]!.min[0], 0);
  });

  it('floor torch emissive mesh emits exactly four faces (2 planes × 2)', () => {
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 4 && y === 64 && z === 4
        ? { name: 'minecraft:torch', states: { torch_facing_direction: 'top' } }
        : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 0);
    assert.equal(countEmissiveFaces(mesh), 4);
  });
});

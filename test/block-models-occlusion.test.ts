/**
 * PR29: occlusion shared-plane gate — interior faces must not be culled by
 * neighbouring cells (docs §5.3 bottom-slab top stays; thin families keep
 * interior panels).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  faceLiesOnUnitSharedPlane,
  isFaceFullyOccluded,
} from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { buildVoxelMesh, countFaces } from '../server/renderer/3d/voxel-mesh-builder.ts';
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

describe('PR29 occlusion shared-plane gate', () => {
  it('faceLiesOnUnitSharedPlane distinguishes interior vs boundary faces', () => {
    const bottomSlab = {
      min: [0, 0, 0] as const,
      max: [1, 0.5, 1] as const,
      faces: {},
    };
    assert.equal(faceLiesOnUnitSharedPlane(bottomSlab, 'up'), false);
    assert.equal(faceLiesOnUnitSharedPlane(bottomSlab, 'down'), true);
    assert.equal(faceLiesOnUnitSharedPlane(bottomSlab, 'east'), true);

    const doorPanel = {
      min: [0, 0, 0] as const,
      max: [3 / 16, 1, 1] as const,
      faces: {},
    };
    assert.equal(faceLiesOnUnitSharedPlane(doorPanel, 'east'), false);
    assert.equal(faceLiesOnUnitSharedPlane(doorPanel, 'west'), true);
  });

  it('keeps bottom-slab top against a full cube above (docs §5.3)', () => {
    resetBlockModelCache();
    const slab = resolveBlockModel({
      name: 'minecraft:oak_slab',
      states: { 'minecraft:vertical_half': 'bottom' },
    } as BlockRef)!;
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    assert.equal(isFaceFullyOccluded(slab.renderBoxes[0]!, 'up', stone), false);
    // Side on the unit boundary may still cull against a full cube.
    assert.equal(isFaceFullyOccluded(slab.renderBoxes[0]!, 'east', stone), true);
  });

  it('keeps top-slab bottom against a full cube below', () => {
    resetBlockModelCache();
    const slab = resolveBlockModel({
      name: 'minecraft:oak_slab',
      states: { 'minecraft:vertical_half': 'top' },
    } as BlockRef)!;
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    assert.equal(isFaceFullyOccluded(slab.renderBoxes[0]!, 'down', stone), false);
    assert.equal(isFaceFullyOccluded(slab.renderBoxes[0]!, 'up', stone), true);
  });

  it('keeps closed-door interior face against a full cube on the open side', () => {
    resetBlockModelCache();
    const door = resolveBlockModel({
      name: 'minecraft:wooden_door',
      states: {
        'minecraft:cardinal_direction': 'east',
        door_hinge_bit: false,
        open_bit: false,
        upper_block_bit: false,
      },
    } as BlockRef)!;
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    const box = door.renderBoxes[0]!;
    // Closed east-facing door occupies the west strip — east face is interior.
    assert.equal(isFaceFullyOccluded(box, 'east', stone), false);
    // West face sits on the unit plane and may cull against a western cube.
    assert.equal(isFaceFullyOccluded(box, 'west', stone), true);
  });

  it('keeps cross-plane faces against full-cube neighbours', () => {
    resetBlockModelCache();
    const cross = resolveBlockModel({ name: 'minecraft:short_grass', states: {} } as BlockRef)!;
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    for (const box of cross.renderBoxes) {
      for (const face of ['east', 'west', 'north', 'south'] as const) {
        assert.equal(
          isFaceFullyOccluded(box, face, stone),
          false,
          `cross ${face} must not cull against stone`,
        );
      }
    }
  });

  it('mesh still emits bottom-slab top under a stone cube above', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null => {
      if (x !== 2 || z !== 3) return null;
      if (y === 70) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } };
      }
      if (y === 71) return { name: 'minecraft:stone', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Top of bottom slab at world y = 70.5 must remain.
    let hasSlabTop = false;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i + 1]!;
      const ny = mesh.normals[i + 1]!;
      if (Math.abs(y - 70.5) < 1e-6 && Math.abs(ny - 1) < 1e-6) hasSlabTop = true;
    }
    assert.equal(hasSlabTop, true);
    assert.ok(countFaces(mesh) > 6);
  });

  it('mesh still emits door interior face beside stone', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2) {
        return {
          name: 'minecraft:wooden_door',
          states: {
            'minecraft:cardinal_direction': 'east',
            door_hinge_bit: false,
            open_bit: false,
            upper_block_bit: false,
          },
        };
      }
      if (x === 3) return { name: 'minecraft:stone', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Door east face at local x ≈ 3/16 → world x ≈ 2.1875, normal +X.
    let hasInterior = false;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!;
      const nx = mesh.normals[i]!;
      if (Math.abs(x - (2 + 3 / 16)) < 1e-6 && Math.abs(nx - 1) < 1e-6) hasInterior = true;
    }
    assert.equal(hasInterior, true);
  });
});

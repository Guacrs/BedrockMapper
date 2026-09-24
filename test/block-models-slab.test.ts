/**
 * PR20: block-state retention, slab models, conservative occlusion.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blockRefFromPaletteEntry,
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants, type MeshChunk } from '../server/renderer/3d/mesh-types.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { isDoubleSlabName, isSingleSlabName, slabHalfFromStates } from '../server/renderer/3d/models/families/slab.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { buildVoxelMesh, countFaces, faceCornerUvsForBox } from '../server/renderer/3d/voxel-mesh-builder.ts';
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
        const entry = fill(x, y, z) ?? { name: 'minecraft:air', states: {} };
        indices[blockIndex(x, y, z)] = ensure(entry);
      }
    }
  }
  return { index, version: 9, layers: [{ palette, indices }] };
}

function volumeFromStates(
  chunkX: number,
  chunkZ: number,
  fill: (localX: number, worldY: number, localZ: number) => BlockState | null,
  subIndices: number[] = [4],
): ChunkBlocks {
  const subs = subIndices.map((index) =>
    makeSubChunkWithStates(index, (x, y, z) => fill(x, index * 16 + y, z)),
  );
  return ChunkBlocks.fromSubChunks(chunkX, chunkZ, subs);
}

function emptyNeighborhood(self: ChunkBlocks | null): VoxelNeighborhood {
  return { self, west: null, east: null, north: null, south: null };
}

function yBounds(mesh: MeshChunk): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i]!;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}

describe('ChunkBlocks state retention', () => {
  it('preserves minecraft:vertical_half on oak_slab palette entries', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 1 && y === 70 && z === 2) {
        return {
          name: 'minecraft:oak_slab',
          states: { 'minecraft:vertical_half': 'bottom' },
        };
      }
      return null;
    });
    const ref = self.getLocalRef(1, 70, 2);
    assert.ok(ref);
    assert.equal(ref!.name, 'minecraft:oak_slab');
    assert.equal(ref!.states['minecraft:vertical_half'], 'bottom');
    assert.equal(self.getLocal(1, 70, 2), 'minecraft:oak_slab');
  });

  it('blockRefFromPaletteEntry freezes states and coerces bigint', () => {
    const ref = blockRefFromPaletteEntry({
      name: 'minecraft:oak_stairs',
      states: { weirdo_direction: 2n, upside_down_bit: false },
    });
    assert.equal(ref.states['weirdo_direction'], 2);
    assert.equal(typeof ref.states['weirdo_direction'], 'number');
    assert.ok(Object.isFrozen(ref));
    assert.ok(Object.isFrozen(ref.states));
  });
});

describe('slab family classification', () => {
  it('recognises single vs double slab ids from Bedrock naming', () => {
    assert.equal(isSingleSlabName('minecraft:oak_slab'), true);
    assert.equal(isSingleSlabName('minecraft:cut_copper_slab'), true);
    assert.equal(isDoubleSlabName('minecraft:oak_double_slab'), true);
    assert.equal(isDoubleSlabName('minecraft:double_cut_copper_slab'), true);
    assert.equal(isSingleSlabName('minecraft:oak_double_slab'), false);
    assert.equal(isSingleSlabName('minecraft:stone'), false);
    assert.equal(isSingleSlabName('minecraft:oak_stairs'), false);
  });

  it('reads vertical_half bottom/top', () => {
    assert.equal(slabHalfFromStates({ 'minecraft:vertical_half': 'bottom' }), 'bottom');
    assert.equal(slabHalfFromStates({ 'minecraft:vertical_half': 'top' }), 'top');
    assert.equal(slabHalfFromStates({}), 'bottom');
  });
});

describe('slab models + meshing', () => {
  it('bottom slab spans Y 0..0.5 in local space (world Y offset)', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 2 && y === 70 && z === 3) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
    const { min, max } = yBounds(mesh);
    assert.ok(Math.abs(min - 70) < 1e-6, `minY=${min}`);
    assert.ok(Math.abs(max - 70.5) < 1e-6, `maxY=${max}`);
  });

  it('top slab spans Y 0.5..1', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 2 && y === 70 && z === 3) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'top' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
    const { min, max } = yBounds(mesh);
    assert.ok(Math.abs(min - 70.5) < 1e-6, `minY=${min}`);
    assert.ok(Math.abs(max - 71) < 1e-6, `maxY=${max}`);
  });

  it('culls the shared face between two adjacent bottom slabs', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2 || x === 3) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // 6+6-2 = 10 faces (shared east/west overlap fully culled).
    assert.equal(countFaces(mesh), 10);
  });

  it('does not cull non-overlapping faces between bottom and top slabs', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } };
      }
      if (x === 3) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'top' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // No shared overlap → all 12 faces remain.
    assert.equal(countFaces(mesh), 12);
  });

  it('keeps the full-cube face when only partially covered by a slab (Option A)', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2) return { name: 'minecraft:stone', states: {} as Record<string, never> };
      if (x === 3) {
        return { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Stone keeps all 6 faces (east only partially covered). Slab loses west face
    // (fully covered by stone) → 6 + 5 = 11.
    assert.equal(countFaces(mesh), 11);
  });

  it('removes a slab face fully covered by a neighbouring full cube', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({
      name: 'minecraft:oak_slab',
      states: { 'minecraft:vertical_half': 'bottom' },
    } as BlockRef)!;
    const cube = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    const box = model.renderBoxes[0]!;
    assert.equal(isFaceFullyOccluded(box, 'east', cube), true);
    assert.equal(isFaceFullyOccluded(cube.renderBoxes[0]!, 'west', model), false);
  });

  it('double slabs resolve as full cubes', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({
      name: 'minecraft:oak_double_slab',
      states: { 'minecraft:vertical_half': 'bottom' },
    } as BlockRef)!;
    assert.equal(model.isFullCube, true);
    assert.ok(model.key.startsWith('full_cube:'));
  });

  it('unknown renderable blocks fall back to full cube', () => {
    resetBlockModelCache();
    // Panes are not modelled yet (PR23) — must stay visible as full cubes.
    const model = resolveBlockModel({
      name: 'minecraft:glass_pane',
      states: {
        'minecraft:connection_north': true,
        'minecraft:connection_south': false,
        'minecraft:connection_east': false,
        'minecraft:connection_west': false,
      },
    } as BlockRef)!;
    assert.equal(model.isFullCube, true);
  });

  it('crops side-face UVs for half-height boxes', () => {
    const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
    const bottomBox = {
      min: [0, 0, 0] as const,
      max: [1, 0.5, 1] as const,
      faces: {},
    };
    const uvs = faceCornerUvsForBox(rect, 'south', bottomBox);
    // Bottom slab: y0=0 → v=1, y1=0.5 → v=0.5
    assert.equal(uvs[0]![1], 1);
    assert.equal(uvs[2]![1], 0.5);
  });
});

describe('full-cube regression via model path', () => {
  it('still emits six faces for an isolated stone block', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) =>
      x === 2 && y === 70 && z === 3 ? { name: 'minecraft:stone', states: {} } : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
  });

  it('still culls the shared face between two stones', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2 || x === 3) return { name: 'minecraft:stone', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assert.equal(countFaces(mesh), 10);
  });
});

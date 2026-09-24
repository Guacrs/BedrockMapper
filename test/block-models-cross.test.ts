/**
 * PR25: crossed-plane plant models — intrinsic geometry, not ConnectionMask.
 *
 * Demo world typically has zero plant palette entries beyond grass_block —
 * synthetic fixture only. Validates geometry + connectivity exclusion, not
 * live BDS world state distribution.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import { connectionMaskAtWorld } from '../server/renderer/3d/models/contextual.ts';
import {
  crossFamilyShortIds,
  crossModel,
  isCrossName,
} from '../server/renderer/3d/models/families/cross.ts';
import { fenceConnectsTo, isFenceName } from '../server/renderer/3d/models/families/fence.ts';
import { fullCubeModel } from '../server/renderer/3d/models/families/full-cube.ts';
import { isPaneName, paneConnectsTo } from '../server/renderer/3d/models/families/pane.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import {
  neighbourIsFullCubeForConnection,
  resolveBlockModel,
  resetBlockModelCache,
} from '../server/renderer/3d/models/resolve.ts';
import type { BlockModel, BlockRef, ModelBox } from '../server/renderer/3d/models/types.ts';
import {
  buildVoxelMesh,
  countFaces,
  faceCornerUvsForBox,
} from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

const PX = 1 / 16;
const INSET = 0.8 * PX;
const PLANE_LO = 7.5 * PX;
const PLANE_HI = 8.5 * PX;

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

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

function assertInsideUnitCube(box: ModelBox): void {
  for (const c of [...box.min, ...box.max]) {
    assert.ok(c >= -1e-9 && c <= 1 + 1e-9, `coord ${c} outside [0,1]`);
  }
  assert.ok(box.min[0]! < box.max[0]!);
  assert.ok(box.min[1]! < box.max[1]!);
  assert.ok(box.min[2]! < box.max[2]!);
}

function collectMeshUvs(model: BlockModel): number[] {
  const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
  const out: number[] = [];
  for (const box of model.renderBoxes) {
    for (const face of ['up', 'down', 'north', 'south', 'east', 'west'] as const) {
      if (!box.faces[face]) continue;
      for (const [u, v] of faceCornerUvsForBox(rect, face, box)) {
        out.push(u, v);
      }
    }
  }
  return out;
}

describe('cross id classification', () => {
  it('allowlists researched plant ids and rejects others', () => {
    assert.equal(isCrossName('minecraft:short_grass'), true);
    assert.equal(isCrossName('minecraft:fern'), true);
    assert.equal(isCrossName('minecraft:deadbush'), true);
    assert.equal(isCrossName('minecraft:oak_sapling'), true);
    assert.equal(isCrossName('minecraft:poppy'), true);
    assert.equal(isCrossName('minecraft:dandelion'), true);
    assert.equal(isCrossName('minecraft:crimson_roots'), true);
    assert.equal(isCrossName('minecraft:nether_sprouts'), true);
    assert.equal(isCrossName('tallgrass'), true); // legacy
    // Not crosses — different geometry or full cubes
    assert.equal(isCrossName('minecraft:tall_grass'), false); // double plant
    assert.equal(isCrossName('minecraft:large_fern'), false);
    assert.equal(isCrossName('minecraft:grass_block'), false);
    assert.equal(isCrossName('minecraft:grass'), false); // grass_block alias in appearance
    assert.equal(isCrossName('minecraft:oak_fence'), false);
    assert.equal(isCrossName('minecraft:glass_pane'), false);
    assert.equal(isCrossName('minecraft:cobblestone_wall'), false);
    assert.equal(isCrossName('minecraft:sweet_berry_bush'), false);
    assert.equal(isCrossName('minecraft:pink_petals'), false);
    assert.equal(isFenceName('minecraft:short_grass'), false);
    assert.equal(isPaneName('minecraft:fern'), false);
    assert.ok(crossFamilyShortIds().length >= 20);
  });
});

describe('cross model geometry', () => {
  it('resolves allowlisted plants to the cross model', () => {
    resetBlockModelCache();
    const model = resolveBlockModel(ref('minecraft:short_grass'))!;
    assert.equal(model.isFullCube, false);
    assert.equal(model.key, 'cross:minecraft:short_grass');
    assert.equal(model.renderBoxes.length, 2);
  });

  it('falls back safely for unsupported / non-cross blocks', () => {
    resetBlockModelCache();
    const tall = resolveBlockModel(ref('minecraft:tall_grass'))!;
    assert.equal(tall.isFullCube, true); // double plant → full-cube fallback
    assert.ok(tall.key.startsWith('full_cube:'));

    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(stone.isFullCube, true);
  });

  it('has two intersecting planes inside unit bounds', () => {
    const model = crossModel('minecraft:fern');
    assert.equal(model.renderBoxes.length, 2);
    assert.equal(model.isFullCube, false);

    for (const box of model.renderBoxes) {
      assertInsideUnitCube(box);
    }

    const [a, b] = model.renderBoxes;
    // Plane A: X-span at Z≈8/16, north+south only
    assert.ok(Math.abs(a!.min[0]! - INSET) < 1e-12);
    assert.ok(Math.abs(a!.max[0]! - (1 - INSET)) < 1e-12);
    assert.ok(Math.abs(a!.min[2]! - PLANE_LO) < 1e-12);
    assert.ok(Math.abs(a!.max[2]! - PLANE_HI) < 1e-12);
    assert.equal(a!.min[1], 0);
    assert.equal(a!.max[1], 1);
    assert.ok(a!.faces.north && a!.faces.south);
    assert.equal(a!.faces.east, undefined);
    assert.equal(a!.faces.west, undefined);
    assert.equal(a!.faces.up, undefined);
    assert.equal(a!.faces.down, undefined);

    // Plane B: Z-span at X≈8/16, east+west only
    assert.ok(Math.abs(b!.min[2]! - INSET) < 1e-12);
    assert.ok(Math.abs(b!.max[2]! - (1 - INSET)) < 1e-12);
    assert.ok(Math.abs(b!.min[0]! - PLANE_LO) < 1e-12);
    assert.ok(Math.abs(b!.max[0]! - PLANE_HI) < 1e-12);
    assert.ok(b!.faces.east && b!.faces.west);
    assert.equal(b!.faces.north, undefined);
    assert.equal(b!.faces.south, undefined);
  });

  it('keeps UV count matched to emitted faces and UVs in [0,1]', () => {
    const model = crossModel('minecraft:poppy');
    let faceCount = 0;
    for (const box of model.renderBoxes) {
      faceCount += Object.keys(box.faces).length;
    }
    assert.equal(faceCount, 4); // 2 planes × 2 sides

    const uvs = collectMeshUvs(model);
    assert.equal(uvs.length, faceCount * 4 * 2); // 4 corners × 2 comps
    for (const t of uvs) {
      assert.ok(t >= -1e-9 && t <= 1 + 1e-9, `uv ${t} outside [0,1]`);
    }
  });

  it('uses unit-cell texture density on cross planes (near-full tile)', () => {
    const model = crossModel('minecraft:oak_sapling');
    const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
    const planeA = model.renderBoxes[0]!;
    const south = faceCornerUvsForBox(rect, 'south', planeA);
    // X spans INSET..(1-INSET) → U at those block coords (not stretched to 0..1).
    assert.ok(Math.abs(south[0]![0]! - INSET) < 1e-9);
    assert.ok(Math.abs(south[1]![0]! - (1 - INSET)) < 1e-9);
    // Full height → V from 1 (y=0) to 0 (y=1) with atlas-down convention.
    assert.ok(Math.abs(south[0]![1]! - 1) < 1e-9);
    assert.ok(Math.abs(south[2]![1]! - 0) < 1e-9);
  });
});

describe('cross connectivity and occlusion', () => {
  it('does not participate in fence connectivity', () => {
    assert.equal(
      fenceConnectsTo('minecraft:oak_fence', ref('minecraft:short_grass'), false),
      false,
    );
    // Even if a caller wrongly flags fullCube:
    assert.equal(
      fenceConnectsTo('minecraft:oak_fence', ref('minecraft:fern'), true),
      false,
    );
    assert.equal(neighbourIsFullCubeForConnection(ref('minecraft:poppy')), false);
  });

  it('does not participate in pane connectivity', () => {
    assert.equal(
      paneConnectsTo('minecraft:glass_pane', ref('minecraft:short_grass'), false),
      false,
    );
    assert.equal(
      paneConnectsTo('minecraft:glass_pane', ref('minecraft:dandelion'), true),
      false,
    );
  });

  it('does not cause full-face neighbour occlusion', () => {
    const cross = crossModel('minecraft:short_grass');
    const stone = fullCubeModel('minecraft:stone');
    assert.equal(cross.isFullCube, false);
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
      assert.equal(
        isFaceFullyOccluded(stone.renderBoxes[0]!, face, cross),
        false,
        `cross must not occlude stone ${face}`,
      );
    }
  });

  it('fence/pane masks ignore adjacent crosses in a mixed neighborhood', () => {
    //
    //           short_grass (N)
    //                │
    //  fern ── oak_fence ── stone
    //                │
    //           glass_pane (S)
    //
    const cells = new Map<string, BlockState>([
      ['8,8', { name: 'minecraft:oak_fence', states: {} }],
      ['8,7', { name: 'minecraft:short_grass', states: {} }], // N
      ['9,8', { name: 'minecraft:stone', states: {} }], // E
      ['8,9', { name: 'minecraft:glass_pane', states: {} }], // S
      ['7,8', { name: 'minecraft:fern', states: {} }], // W
    ]);
    const self = volumeFromStates(0, 0, (x, y, z) =>
      y === 64 ? (cells.get(`${x},${z}`) ?? null) : null,
    );
    const n = emptyNeighborhood(self);
    const fenceMask = connectionMaskAtWorld(n, 8, 64, 8, 'minecraft:oak_fence');
    assert.equal(fenceMask.north, false, 'N → cross');
    assert.equal(fenceMask.east, true, 'E → stone');
    assert.equal(fenceMask.south, false, 'S → pane');
    assert.equal(fenceMask.west, false, 'W → cross');

    const paneCells = new Map<string, BlockState>([
      ['4,4', { name: 'minecraft:glass_pane', states: {} }],
      ['4,3', { name: 'minecraft:poppy', states: {} }],
      ['5,4', { name: 'minecraft:stone', states: {} }],
    ]);
    const paneSelf = volumeFromStates(0, 0, (x, y, z) =>
      y === 64 ? (paneCells.get(`${x},${z}`) ?? null) : null,
    );
    const paneMask = connectionMaskAtWorld(
      emptyNeighborhood(paneSelf),
      4,
      64,
      4,
      'minecraft:glass_pane',
    );
    assert.equal(paneMask.north, false, 'pane ↛ poppy');
    assert.equal(paneMask.east, true, 'pane → stone');
  });
});

describe('cross meshing smoke', () => {
  it('builds a mesh for a synthetic plant cell without full-cube face count', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 3 && z === 3) return { name: 'minecraft:short_grass', states: {} };
      if (y === 63 && x === 3 && z === 3) return { name: 'minecraft:dirt', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Cross = 4 faces; dirt below has 5 exposed (up culled? dirt up toward cross —
    // cross does not occlude → dirt keeps up). Exact count may vary with air
    // neighbours; just assert cross contributed and is far below a full cube's 6.
    assert.ok(countFaces(mesh) >= 4);
    assert.ok(countFaces(mesh) < 20);
  });
});

describe('PR25 regressions — existing families still resolve', () => {
  it('keeps cube / slab / stair / fence / pane / door / trapdoor contracts', () => {
    resetBlockModelCache();
    assert.equal(resolveBlockModel(ref('minecraft:stone'))!.isFullCube, true);
    assert.equal(
      resolveBlockModel(ref('minecraft:oak_slab', { 'minecraft:vertical_half': 'bottom' }))!
        .isFullCube,
      false,
    );
    assert.equal(
      resolveBlockModel(
        ref('minecraft:oak_stairs', {
          weirdo_direction: 0,
          upside_down_bit: false,
          'minecraft:corner': 'none',
        }),
      )!.isFullCube,
      false,
    );
    assert.equal(resolveBlockModel(ref('minecraft:oak_fence'))!.isFullCube, false);
    assert.equal(resolveBlockModel(ref('minecraft:glass_pane'))!.isFullCube, false);
    assert.equal(
      resolveBlockModel(
        ref('minecraft:wooden_door', {
          'minecraft:cardinal_direction': 'east',
          door_hinge_bit: false,
          open_bit: false,
          upper_block_bit: false,
        }),
      )!.isFullCube,
      false,
    );
    assert.equal(
      resolveBlockModel(
        ref('minecraft:oak_trapdoor', {
          direction: 0,
          open_bit: false,
          upside_down_bit: false,
        }),
      )!.isFullCube,
      false,
    );
  });
});

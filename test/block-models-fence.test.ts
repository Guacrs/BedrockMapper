/**
 * PR22: fence models — ConnectionMask architecture + Bedrock connection rules.
 *
 * Demo-world scan found zero fence palette entries, so geometry is validated
 * against this synthetic fixture neighborhood (not left unobserved).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  connectionCount,
  connectionMaskFromFlags,
  connectionMaskKey,
  EMPTY_CONNECTION_MASK,
} from '../server/renderer/3d/models/connection.ts';
import {
  connectionMaskFromNeighbours,
  fenceConnectsTo,
  fenceFamily,
  fenceModel,
  isFenceGateName,
  isFenceName,
} from '../server/renderer/3d/models/families/fence.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import {
  buildVoxelMesh,
  countFaces,
  fenceConnectionMaskAt,
} from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

const PX = 1 / 16;

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

/** Tiny known fence fixture layouts inside one chunk at Y=64. */
function fenceFixtureSelf(): ChunkBlocks {
  // Layout (local X,Z at Y=64):
  //  (2,2) isolated oak_fence
  //  (4,2) oak + stone east  → east rail
  //  (6,2)+(7,2) oak–oak     → E/W rails between them
  //  (2,4) oak + nether east → no rail (incompatible families)
  //  (4,4) oak + gate east   → east rail
  //  (6,4) oak + slab east   → no rail (slab not full cube)
  //  (8,2) plus centre — N/E/S/W to fences (west via (7,2))
  //  (12,5) oak with stored connection_* bits (ignored — still isolated)
  const cells = new Map<string, BlockState>([
    ['2,2', { name: 'minecraft:oak_fence', states: {} }],
    ['4,2', { name: 'minecraft:oak_fence', states: {} }],
    ['5,2', { name: 'minecraft:stone', states: {} }],
    ['6,2', { name: 'minecraft:oak_fence', states: {} }],
    ['7,2', { name: 'minecraft:oak_fence', states: {} }],
    ['2,4', { name: 'minecraft:oak_fence', states: {} }],
    ['3,4', { name: 'minecraft:nether_brick_fence', states: {} }],
    ['4,4', { name: 'minecraft:oak_fence', states: {} }],
    ['5,4', { name: 'minecraft:oak_fence_gate', states: {} }],
    ['6,4', { name: 'minecraft:oak_fence', states: {} }],
    ['7,4', { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } }],
    ['8,2', { name: 'minecraft:oak_fence', states: {} }],
    ['8,1', { name: 'minecraft:oak_fence', states: {} }],
    ['8,3', { name: 'minecraft:oak_fence', states: {} }],
    ['9,2', { name: 'minecraft:oak_fence', states: {} }],
    [
      '12,5',
      {
        name: 'minecraft:oak_fence',
        states: {
          'minecraft:connection_north': true,
          'minecraft:connection_east': true,
          'minecraft:connection_south': true,
          'minecraft:connection_west': true,
        },
      },
    ],
  ]);
  return volumeFromStates(0, 0, (x, y, z) => {
    if (y !== 64) return null;
    return cells.get(`${x},${z}`) ?? null;
  });
}

describe('ConnectionMask type', () => {
  it('keeps neighbour bits off BlockRef and formats stable keys', () => {
    const mask = connectionMaskFromFlags(true, false, true, false);
    assert.equal(connectionMaskKey(mask), 'n1e0s1w0');
    assert.equal(connectionCount(mask), 2);
    assert.equal(connectionMaskKey(EMPTY_CONNECTION_MASK), 'n0e0s0w0');
  });
});

describe('fence id classification', () => {
  it('detects fences vs gates', () => {
    assert.equal(isFenceName('minecraft:oak_fence'), true);
    assert.equal(isFenceName('minecraft:nether_brick_fence'), true);
    assert.equal(isFenceName('minecraft:oak_fence_gate'), false);
    assert.equal(isFenceGateName('minecraft:oak_fence_gate'), true);
    assert.equal(isFenceGateName('minecraft:fence_gate'), true);
    assert.equal(fenceFamily('minecraft:oak_fence'), 'wooden');
    assert.equal(fenceFamily('minecraft:nether_brick_fence'), 'nether_brick');
  });
});

describe('Bedrock fence connection rules', () => {
  it('uses an explicit classifier — not generic solidity', () => {
    // Decision matrix (connectivity ≠ occlusion / isRenderableCube):
    const cases: Array<{
      label: string;
      self: string;
      neighbour: BlockRef | null;
      fullCube: boolean;
      expect: boolean;
    }> = [
      {
        label: 'compatible wooden fence',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:spruce_fence'),
        fullCube: false,
        expect: true,
      },
      {
        label: 'compatible nether fence',
        self: 'minecraft:nether_brick_fence',
        neighbour: ref('minecraft:nether_brick_fence'),
        fullCube: false,
        expect: true,
      },
      {
        label: 'incompatible fence (oak↛nether) even if flagged fullCube',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:nether_brick_fence'),
        fullCube: true, // must still refuse — family check wins
        expect: false,
      },
      {
        label: 'incompatible fence (nether↛oak)',
        self: 'minecraft:nether_brick_fence',
        neighbour: ref('minecraft:oak_fence'),
        fullCube: true,
        expect: false,
      },
      {
        label: 'compatible gate (wooden fence)',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:birch_fence_gate'),
        fullCube: false,
        expect: true,
      },
      {
        label: 'compatible gate (nether fence → wooden gate)',
        self: 'minecraft:nether_brick_fence',
        neighbour: ref('minecraft:oak_fence_gate'),
        fullCube: false,
        expect: true,
      },
      {
        label: 'arbitrary full cube (stone)',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:stone'),
        fullCube: true,
        expect: true,
      },
      {
        label: 'stone without isFullCube flag must not connect',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:stone'),
        fullCube: false,
        expect: false,
      },
      {
        label: 'slab (renderable, not full cube)',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:oak_slab'),
        fullCube: false,
        expect: false,
      },
      {
        label: 'stair (renderable, not full cube)',
        self: 'minecraft:oak_fence',
        neighbour: ref('minecraft:oak_stairs'),
        fullCube: false,
        expect: false,
      },
      {
        label: 'air / missing neighbour',
        self: 'minecraft:oak_fence',
        neighbour: null,
        fullCube: false,
        expect: false,
      },
    ];

    for (const c of cases) {
      assert.equal(
        fenceConnectsTo(c.self, c.neighbour, c.fullCube),
        c.expect,
        c.label,
      );
    }
  });

  it('connects wooden fences to each other and to solid cubes', () => {
    assert.equal(fenceConnectsTo('minecraft:oak_fence', ref('minecraft:spruce_fence'), false), true);
    assert.equal(fenceConnectsTo('minecraft:oak_fence', ref('minecraft:stone'), true), true);
    assert.equal(fenceConnectsTo('minecraft:oak_fence', ref('minecraft:stone'), false), false);
  });

  it('does not connect wooden fences to nether brick fences', () => {
    assert.equal(
      fenceConnectsTo('minecraft:oak_fence', ref('minecraft:nether_brick_fence'), false),
      false,
    );
    assert.equal(
      fenceConnectsTo('minecraft:nether_brick_fence', ref('minecraft:oak_fence'), false),
      false,
    );
  });

  it('connects both families to fence gates', () => {
    assert.equal(fenceConnectsTo('minecraft:oak_fence', ref('minecraft:oak_fence_gate'), false), true);
    assert.equal(
      fenceConnectsTo('minecraft:nether_brick_fence', ref('minecraft:spruce_fence_gate'), false),
      true,
    );
  });

  it('does not connect to missing neighbours or non-solid partials', () => {
    assert.equal(fenceConnectsTo('minecraft:oak_fence', null, false), false);
    assert.equal(fenceConnectsTo('minecraft:oak_fence', ref('minecraft:oak_slab'), false), false);
  });

  it('builds masks from neighbour sets', () => {
    const mask = connectionMaskFromNeighbours(
      'minecraft:oak_fence',
      {
        north: ref('minecraft:oak_fence'),
        east: ref('minecraft:stone'),
        south: null,
        west: ref('minecraft:nether_brick_fence'),
      },
      { north: false, east: true, south: false, west: false },
    );
    assert.deepEqual({ ...mask }, { north: true, east: true, south: false, west: false });
  });
});

describe('fence geometry', () => {
  it('isolated fence is post-only', () => {
    const model = fenceModel('minecraft:oak_fence', EMPTY_CONNECTION_MASK);
    assert.equal(model.renderBoxes.length, 1);
    assert.equal(model.isFullCube, false);
    assert.deepEqual([...model.renderBoxes[0]!.min], [6 * PX, 0, 6 * PX]);
    assert.deepEqual([...model.renderBoxes[0]!.max], [10 * PX, 1, 10 * PX]);
    assert.equal(model.key, 'fence:n0e0s0w0:minecraft:oak_fence');
  });

  it('each single connection adds two rail boxes', () => {
    for (const dir of ['north', 'east', 'south', 'west'] as const) {
      const mask = connectionMaskFromFlags(
        dir === 'north',
        dir === 'east',
        dir === 'south',
        dir === 'west',
      );
      const model = fenceModel('minecraft:oak_fence', mask);
      assert.equal(model.renderBoxes.length, 3, dir); // post + 2 rails
    }
  });

  it('all four connections produce post + 8 rails', () => {
    const mask = connectionMaskFromFlags(true, true, true, true);
    const model = fenceModel('minecraft:oak_fence', mask);
    assert.equal(model.renderBoxes.length, 9);
    assert.equal(model.key, 'fence:n1e1s1w1:minecraft:oak_fence');
  });

  it('combination NE has north and east rails only', () => {
    const mask = connectionMaskFromFlags(true, true, false, false);
    const model = fenceModel('minecraft:oak_fence', mask);
    assert.equal(model.renderBoxes.length, 5);
    const northRail = model.renderBoxes.find(
      (b) => b.min[2] === 0 && b.max[2] === 6 * PX && b.min[1] === 6 * PX,
    );
    const eastRail = model.renderBoxes.find(
      (b) => b.min[0] === 10 * PX && b.max[0] === 1 && b.min[1] === 6 * PX,
    );
    assert.ok(northRail);
    assert.ok(eastRail);
  });
});

describe('model cache by connection mask', () => {
  it('caches distinct masks separately and reuses identical ones', () => {
    resetBlockModelCache();
    const fence = ref('minecraft:oak_fence');
    const a = resolveBlockModel(fence, connectionMaskFromFlags(true, false, false, false))!;
    const b = resolveBlockModel(fence, connectionMaskFromFlags(true, false, false, false))!;
    const c = resolveBlockModel(fence, connectionMaskFromFlags(false, true, false, false))!;
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.key, 'fence:n1e0s0w0:minecraft:oak_fence');
    assert.equal(c.key, 'fence:n0e1s0w0:minecraft:oak_fence');
  });

  it('ignores stored connection_* states on BlockRef for geometry', () => {
    resetBlockModelCache();
    const lying = ref('minecraft:oak_fence', {
      'minecraft:connection_north': true,
      'minecraft:connection_east': true,
      'minecraft:connection_south': true,
      'minecraft:connection_west': true,
    });
    const model = resolveBlockModel(lying)!; // no mask → isolated
    assert.equal(model.renderBoxes.length, 1);
    assert.match(model.key, /n0e0s0w0/);
  });
});

describe('fence fixture neighborhood (demo world has zero fences)', () => {
  it('isolated fence has empty mask', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 2, 64, 2, 'minecraft:oak_fence');
    assert.deepEqual({ ...mask }, { north: false, east: false, south: false, west: false });
  });

  it('connects east to a solid stone neighbour', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 4, 64, 2, 'minecraft:oak_fence');
    assert.equal(mask.east, true);
    assert.equal(mask.west, false);
  });

  it('connects same-fence neighbours on an axis', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const left = fenceConnectionMaskAt(n, 6, 64, 2, 'minecraft:oak_fence');
    const right = fenceConnectionMaskAt(n, 7, 64, 2, 'minecraft:oak_fence');
    assert.equal(left.east, true);
    assert.equal(right.west, true);
  });

  it('does not connect oak to adjacent nether brick fence', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 2, 64, 4, 'minecraft:oak_fence');
    assert.equal(mask.east, false);
  });

  it('connects to fence gates', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 4, 64, 4, 'minecraft:oak_fence');
    assert.equal(mask.east, true);
  });

  it('does not connect to non-full-cube slabs', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 6, 64, 4, 'minecraft:oak_fence');
    assert.equal(mask.east, false);
  });

  it('all-four centre of the plus cluster', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 8, 64, 2, 'minecraft:oak_fence');
    assert.deepEqual({ ...mask }, { north: true, east: true, south: true, west: true });
  });

  it('stored connection bits do not override missing neighbours', () => {
    const self = fenceFixtureSelf();
    const n = emptyNeighborhood(self);
    const mask = fenceConnectionMaskAt(n, 12, 64, 5, 'minecraft:oak_fence');
    assert.deepEqual({ ...mask }, { north: false, east: false, south: false, west: false });
  });

  it('missing neighbour volumes at chunk boundaries stay unconnected', () => {
    const self = volumeFromStates(1, 1, (x, y, z) => {
      if (y === 64 && x === 0 && z === 0) return { name: 'minecraft:oak_fence', states: {} };
      return null;
    });
    const n = emptyNeighborhood(self); // no west/north chunks
    const mask = fenceConnectionMaskAt(n, 16, 64, 16, 'minecraft:oak_fence');
    // world (16,16) is local (0,0) of chunk (1,1); west/north are missing → false
    assert.equal(mask.west, false);
    assert.equal(mask.north, false);
  });

  it('chunk-boundary neighbour volumes supply connections', () => {
    const self = volumeFromStates(1, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 5) return { name: 'minecraft:oak_fence', states: {} };
      return null;
    });
    const west = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 15 && z === 5) return { name: 'minecraft:oak_fence', states: {} };
      return null;
    });
    const n: VoxelNeighborhood = { self, west, east: null, north: null, south: null };
    const mask = fenceConnectionMaskAt(n, 16, 64, 5, 'minecraft:oak_fence');
    assert.equal(mask.west, true);
  });

  it('meshes the fixture without crashing and keeps cube/slab regressions', () => {
    resetBlockModelCache();
    const self = fenceFixtureSelf();
    // Also place a stone cube and bottom slab for regression in the same mesh.
    const mixedCells = new Map<string, BlockState>([
      ['2,2', { name: 'minecraft:oak_fence', states: {} }],
      ['0,0', { name: 'minecraft:stone', states: {} }],
      ['1,0', { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } }],
      [
        '2,0',
        {
          name: 'minecraft:oak_stairs',
          states: { weirdo_direction: 0, upside_down_bit: false, 'minecraft:corner': 'none' },
        },
      ],
    ]);
    const mixed = volumeFromStates(0, 0, (x, y, z) =>
      y === 64 ? (mixedCells.get(`${x},${z}`) ?? null) : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(mixed));
    assertMeshInvariants(mesh);
    assert.ok(countFaces(mesh) > 6);

    // Isolated stone still six faces when alone
    const stoneOnly = volumeFromStates(0, 0, (x, y, z) =>
      x === 3 && y === 64 && z === 3 ? { name: 'minecraft:stone', states: {} } : null,
    );
    const stoneMesh = buildVoxelMesh(0, 0, emptyNeighborhood(stoneOnly));
    assert.equal(countFaces(stoneMesh), 6);

    // Isolated fence emits post faces (6) — less than a full cube would with neighbours
    const fenceOnly = volumeFromStates(0, 0, (x, y, z) =>
      x === 3 && y === 64 && z === 3 ? { name: 'minecraft:oak_fence', states: {} } : null,
    );
    const fenceMesh = buildVoxelMesh(0, 0, emptyNeighborhood(fenceOnly));
    assertMeshInvariants(fenceMesh);
    assert.equal(countFaces(fenceMesh), 6); // post-only, all six sides exposed

    // Connected east fence has more faces than isolated post
    const pair = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 64) return null;
      if (x === 3 && z === 3) return { name: 'minecraft:oak_fence', states: {} };
      if (x === 4 && z === 3) return { name: 'minecraft:oak_fence', states: {} };
      return null;
    });
    const pairMesh = buildVoxelMesh(0, 0, emptyNeighborhood(pair));
    assert.ok(countFaces(pairMesh) > countFaces(fenceMesh));

    // Fixture mesh is non-empty and invariant-clean
    const fixtureMesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(fixtureMesh);
    assert.ok(countFaces(fixtureMesh) > 20);
  });
});

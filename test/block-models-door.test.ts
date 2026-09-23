/**
 * PR24: door + trapdoor models — state-driven transforms, non-cubic panels.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  DOOR_DIRECTION_TO_FACING,
  doorFacingFromStates,
  isDoorName,
  quarterTurnsForDoorFacing,
  tryBuildDoor,
} from '../server/renderer/3d/models/families/door.ts';
import {
  TRAPDOOR_DIRECTION_TO_FACING,
  isTrapdoorName,
  trapdoorFacingFromStates,
  tryBuildTrapdoor,
} from '../server/renderer/3d/models/families/trapdoor.ts';
import { fullCubeModel } from '../server/renderer/3d/models/families/full-cube.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { buildVoxelMesh, countFaces } from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

const DOOR_T = 3 / 16;

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

function doorRef(
  facing: string,
  opts: { hingeRight?: boolean; open?: boolean; upper?: boolean } = {},
): BlockRef {
  return {
    name: 'minecraft:oak_door',
    states: {
      'minecraft:cardinal_direction': facing,
      door_hinge_bit: opts.hingeRight === true,
      open_bit: opts.open === true,
      upper_block_bit: opts.upper === true,
    },
  };
}

function trapRef(
  direction: number,
  opts: { open?: boolean; top?: boolean } = {},
): BlockRef {
  return {
    name: 'minecraft:oak_trapdoor',
    states: {
      direction,
      open_bit: opts.open === true,
      upside_down_bit: opts.top === true,
    },
  };
}

describe('door id + facing', () => {
  it('classifies doors vs trapdoors', () => {
    assert.equal(isDoorName('minecraft:oak_door'), true);
    assert.equal(isDoorName('minecraft:iron_door'), true);
    assert.equal(isDoorName('minecraft:wooden_door'), true);
    assert.equal(isDoorName('minecraft:oak_trapdoor'), false);
    assert.equal(isTrapdoorName('minecraft:oak_trapdoor'), true);
    assert.equal(isTrapdoorName('minecraft:trapdoor'), true);
  });

  it('reads cardinal_direction and legacy direction ints', () => {
    assert.equal(doorFacingFromStates({ 'minecraft:cardinal_direction': 'east' }), 'east');
    assert.deepEqual({ ...DOOR_DIRECTION_TO_FACING }, {
      0: 'south',
      1: 'west',
      2: 'north',
      3: 'east',
    });
    assert.equal(doorFacingFromStates({ direction: 0 }), 'south');
    assert.equal(doorFacingFromStates({}), null);
  });
});

describe('door geometry', () => {
  it('closed east door occupies the west strip', () => {
    const built = tryBuildDoor(doorRef('east'));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.facing, 'east');
    assert.equal(built.open, false);
    assert.deepEqual([...built.model.renderBoxes[0]!.min], [0, 0, 0]);
    assert.deepEqual([...built.model.renderBoxes[0]!.max], [DOOR_T, 1, 1]);
    assert.equal(built.model.isFullCube, false);
  });

  it('open left-hinge east swings to the north strip', () => {
    const built = tryBuildDoor(doorRef('east', { open: true, hingeRight: false }));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual([...built.model.renderBoxes[0]!.min], [0, 0, 0]);
    assert.deepEqual([...built.model.renderBoxes[0]!.max], [1, 1, DOOR_T]);
  });

  it('open right-hinge east swings to the south strip', () => {
    const built = tryBuildDoor(doorRef('east', { open: true, hingeRight: true }));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual([...built.model.renderBoxes[0]!.min], [0, 0, 1 - DOOR_T]);
    assert.deepEqual([...built.model.renderBoxes[0]!.max], [1, 1, 1]);
  });

  it('orients closed doors for all four facings', () => {
    const expected: Record<string, [number, number, number, number, number, number]> = {
      east: [0, 0, 0, DOOR_T, 1, 1],
      south: [0, 0, 0, 1, 1, DOOR_T], // rotated: west strip → north strip
      west: [1 - DOOR_T, 0, 0, 1, 1, 1],
      north: [0, 0, 1 - DOOR_T, 1, 1, 1],
    };
    // Verify rotation table matches stairs
    assert.equal(quarterTurnsForDoorFacing('east'), 0);
    assert.equal(quarterTurnsForDoorFacing('south'), 1);

    for (const facing of ['east', 'south', 'west', 'north'] as const) {
      const built = tryBuildDoor(doorRef(facing));
      assert.equal(built.ok, true, facing);
      if (!built.ok) continue;
      const b = built.model.renderBoxes[0]!;
      const exp = expected[facing]!;
      assert.ok(Math.abs(b.min[0]! - exp[0]) < 1e-9, `${facing} minX`);
      assert.ok(Math.abs(b.min[2]! - exp[2]) < 1e-9, `${facing} minZ`);
      assert.ok(Math.abs(b.max[0]! - exp[3]) < 1e-9, `${facing} maxX`);
      assert.ok(Math.abs(b.max[2]! - exp[5]) < 1e-9, `${facing} maxZ`);
    }
  });

  it('covers every supported state combination via resolve', () => {
    resetBlockModelCache();
    let count = 0;
    for (const facing of ['east', 'south', 'west', 'north']) {
      for (const hingeRight of [false, true]) {
        for (const open of [false, true]) {
          for (const upper of [false, true]) {
            const model = resolveBlockModel(doorRef(facing, { hingeRight, open, upper }))!;
            assert.equal(model.isFullCube, false);
            assert.equal(model.renderBoxes.length, 1);
            assert.match(model.key, new RegExp(`door:${facing}:`));
            count++;
          }
        }
      }
    }
    assert.equal(count, 32);
  });

  it('falls back to full cube when facing is missing', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({
      name: 'minecraft:oak_door',
      states: { open_bit: false, door_hinge_bit: false, upper_block_bit: false },
    })!;
    assert.equal(model.isFullCube, true);
  });

  it('does not fully occlude neighbouring stone on uncovered sides', () => {
    const door = tryBuildDoor(doorRef('east'));
    assert.equal(door.ok, true);
    if (!door.ok) return;
    const stone = fullCubeModel('minecraft:stone');
    // Door panel is a west strip — its south/north faces are only 3/16 wide,
    // so they must not cull a full unit face (connectivity ≠ full-cube occlusion).
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'north', door.model), false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'south', door.model), false);
    assert.equal(door.model.isFullCube, false);
  });
});

describe('trapdoor geometry', () => {
  it('documents direction → facing', () => {
    assert.deepEqual({ ...TRAPDOOR_DIRECTION_TO_FACING }, {
      0: 'south',
      1: 'west',
      2: 'north',
      3: 'east',
    });
    assert.equal(trapdoorFacingFromStates({ direction: 2 }), 'north');
  });

  it('closed bottom / top plates', () => {
    const bottom = tryBuildTrapdoor(trapRef(0, { open: false, top: false }));
    const top = tryBuildTrapdoor(trapRef(0, { open: false, top: true }));
    assert.equal(bottom.ok && top.ok, true);
    if (!bottom.ok || !top.ok) return;
    assert.deepEqual([...bottom.model.renderBoxes[0]!.min], [0, 0, 0]);
    assert.deepEqual([...bottom.model.renderBoxes[0]!.max], [1, DOOR_T, 1]);
    assert.deepEqual([...top.model.renderBoxes[0]!.min], [0, 1 - DOOR_T, 0]);
    assert.deepEqual([...top.model.renderBoxes[0]!.max], [1, 1, 1]);
  });

  it('open flaps sit on each facing wall', () => {
    const expected: Record<number, [number, number, number, number, number, number]> = {
      0: [0, 0, 1 - DOOR_T, 1, 1, 1], // south
      1: [0, 0, 0, DOOR_T, 1, 1], // west
      2: [0, 0, 0, 1, 1, DOOR_T], // north
      3: [1 - DOOR_T, 0, 0, 1, 1, 1], // east
    };
    for (const dir of [0, 1, 2, 3]) {
      const built = tryBuildTrapdoor(trapRef(dir, { open: true }));
      assert.equal(built.ok, true, String(dir));
      if (!built.ok) continue;
      const b = built.model.renderBoxes[0]!;
      const e = expected[dir]!;
      assert.ok(Math.abs(b.min[0]! - e[0]) < 1e-9);
      assert.ok(Math.abs(b.min[2]! - e[2]) < 1e-9);
      assert.ok(Math.abs(b.max[0]! - e[3]) < 1e-9);
      assert.ok(Math.abs(b.max[2]! - e[5]) < 1e-9);
      assert.equal(built.model.isFullCube, false);
    }
  });

  it('covers every supported trapdoor state combination', () => {
    resetBlockModelCache();
    let count = 0;
    for (const dir of [0, 1, 2, 3]) {
      for (const open of [false, true]) {
        for (const top of [false, true]) {
          const model = resolveBlockModel(trapRef(dir, { open, top }))!;
          assert.equal(model.isFullCube, false);
          assert.equal(model.renderBoxes.length, 1);
          count++;
        }
      }
    }
    assert.equal(count, 16);
  });

  it('falls back to full cube when direction is missing', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({
      name: 'minecraft:oak_trapdoor',
      states: { open_bit: false, upside_down_bit: false },
    })!;
    assert.equal(model.isFullCube, true);
  });
});

describe('door/trapdoor meshing regressions', () => {
  it('meshes doors and trapdoors with cube/slab still intact', () => {
    resetBlockModelCache();
    const placements = new Map<string, BlockState>([
      [
        '2,64,2',
        {
          name: 'minecraft:oak_door',
          states: {
            'minecraft:cardinal_direction': 'south',
            door_hinge_bit: false,
            open_bit: false,
            upper_block_bit: false,
          },
        },
      ],
      [
        '2,65,2',
        {
          name: 'minecraft:oak_door',
          states: {
            'minecraft:cardinal_direction': 'south',
            door_hinge_bit: false,
            open_bit: false,
            upper_block_bit: true,
          },
        },
      ],
      [
        '4,64,2',
        {
          name: 'minecraft:oak_trapdoor',
          states: { direction: 3, open_bit: true, upside_down_bit: false },
        },
      ],
      ['0,64,0', { name: 'minecraft:stone', states: {} }],
      ['1,64,0', { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } }],
    ]);
    const self = volumeFromStates(0, 0, (x, y, z) => placements.get(`${x},${y},${z}`) ?? null);
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.ok(countFaces(mesh) > 6);

    const stoneOnly = volumeFromStates(0, 0, (x, y, z) =>
      x === 5 && y === 64 && z === 5 ? { name: 'minecraft:stone', states: {} } : null,
    );
    assert.equal(countFaces(buildVoxelMesh(0, 0, emptyNeighborhood(stoneOnly))), 6);
  });
});

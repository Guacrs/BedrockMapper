/**
 * PR26: wall models — ConnectionMask + post/tall shape; Bedrock attach rules.
 *
 * Demo world may lack walls — synthetic fixture validates geometry + connectivity.
 * Does not prove production BDS wall state distribution.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  connectionMaskAtWorld,
  wallShapeAtWorld,
} from '../server/renderer/3d/models/contextual.ts';
import { connectionMaskFromFlags } from '../server/renderer/3d/models/connection.ts';
import { fenceConnectsTo } from '../server/renderer/3d/models/families/fence.ts';
import { fullCubeModel } from '../server/renderer/3d/models/families/full-cube.ts';
import { paneConnectsTo } from '../server/renderer/3d/models/families/pane.ts';
import {
  isWallName,
  wallConnectsTo,
  wallModel,
  wallPostFromMask,
  wallShapeFromMask,
} from '../server/renderer/3d/models/families/wall.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import {
  neighbourIsFullCubeForConnection,
  resolveBlockModel,
  resetBlockModelCache,
} from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { buildVoxelMesh, countFaces } from '../server/renderer/3d/voxel-mesh-builder.ts';
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

describe('wall id classification', () => {
  it('detects stone walls and excludes signs / fans / banners', () => {
    assert.equal(isWallName('minecraft:cobblestone_wall'), true);
    assert.equal(isWallName('minecraft:mossy_cobblestone_wall'), true);
    assert.equal(isWallName('minecraft:blackstone_wall'), true);
    assert.equal(isWallName('minecraft:tuff_brick_wall'), true);
    assert.equal(isWallName('minecraft:oak_wall_sign'), false);
    assert.equal(isWallName('minecraft:wall_banner'), false);
    assert.equal(isWallName('minecraft:brain_coral_wall_fan'), false);
    assert.equal(isWallName('minecraft:oak_fence'), false);
  });
});

describe('Bedrock wall connection decision matrix', () => {
  it('uses an explicit classifier — not generic solidity', () => {
    const cases: Array<{
      label: string;
      neighbour: BlockRef | null;
      fullCube: boolean;
      expect: boolean;
    }> = [
      { label: 'same wall', neighbour: ref('minecraft:cobblestone_wall'), fullCube: false, expect: true },
      { label: 'compatible wall variant', neighbour: ref('minecraft:stone_brick_wall'), fullCube: false, expect: true },
      { label: 'full cube stone', neighbour: ref('minecraft:stone'), fullCube: true, expect: true },
      { label: 'fence gate', neighbour: ref('minecraft:oak_fence_gate'), fullCube: false, expect: true },
      { label: 'glass pane', neighbour: ref('minecraft:glass_pane'), fullCube: false, expect: true },
      { label: 'iron bars', neighbour: ref('minecraft:iron_bars'), fullCube: false, expect: true },
      { label: 'trapdoor', neighbour: ref('minecraft:oak_trapdoor'), fullCube: false, expect: true },
      { label: 'fence ↛', neighbour: ref('minecraft:oak_fence'), fullCube: false, expect: false },
      { label: 'fence even if fullCube flag', neighbour: ref('minecraft:oak_fence'), fullCube: true, expect: false },
      { label: 'slab ↛', neighbour: ref('minecraft:oak_slab'), fullCube: false, expect: false },
      { label: 'stair ↛', neighbour: ref('minecraft:oak_stairs'), fullCube: false, expect: false },
      { label: 'door ↛', neighbour: ref('minecraft:wooden_door'), fullCube: false, expect: false },
      { label: 'air', neighbour: null, fullCube: false, expect: false },
      { label: 'plant/cross ↛', neighbour: ref('minecraft:short_grass'), fullCube: true, expect: false },
      { label: 'fern ↛', neighbour: ref('minecraft:fern'), fullCube: true, expect: false },
      { label: 'poppy ↛', neighbour: ref('minecraft:poppy'), fullCube: false, expect: false },
    ];
    for (const c of cases) {
      assert.equal(
        wallConnectsTo('minecraft:cobblestone_wall', c.neighbour, c.fullCube),
        c.expect,
        c.label,
      );
    }
  });
});

describe('wall post / tall shape', () => {
  it('omits post on straight runs and four-way; keeps post otherwise', () => {
    assert.equal(wallPostFromMask(connectionMaskFromFlags(false, false, false, false), false), true);
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, false, false, false), false), true);
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, false, true, false), false), false); // N-S
    assert.equal(wallPostFromMask(connectionMaskFromFlags(false, true, false, true), false), false); // E-W
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, true, false, false), false), true); // corner
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, true, true, false), false), true); // T
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, true, true, true), false), false); // +
    assert.equal(wallPostFromMask(connectionMaskFromFlags(true, false, true, false), true), true); // above forces post
  });

  it('marks tall when hasAbove', () => {
    const short = wallShapeFromMask(connectionMaskFromFlags(true, false, false, false), false);
    const tall = wallShapeFromMask(connectionMaskFromFlags(true, false, false, false), true);
    assert.equal(short.tall, false);
    assert.equal(tall.tall, true);
    assert.equal(short.post, true);
    assert.equal(tall.post, true);
  });
});

describe('wall model geometry', () => {
  it('resolves walls with isFullCube false and expected boxes', () => {
    resetBlockModelCache();
    const isolated = resolveBlockModel(ref('minecraft:cobblestone_wall'))!;
    assert.equal(isolated.isFullCube, false);
    assert.equal(isolated.renderBoxes.length, 1); // post only
    assert.ok(isolated.key.startsWith('wall:'));

    const ns = wallModel(
      'minecraft:cobblestone_wall',
      wallShapeFromMask(connectionMaskFromFlags(true, false, true, false), false),
    );
    assert.equal(ns.isFullCube, false);
    assert.equal(ns.renderBoxes.length, 2); // no post + N + S
    assert.ok(ns.renderBoxes.every((b) => b.max[1]! <= 14 * PX + 1e-9)); // short arms

    const tallNs = wallModel(
      'minecraft:cobblestone_wall',
      wallShapeFromMask(connectionMaskFromFlags(true, false, true, false), true),
    );
    assert.equal(tallNs.renderBoxes.length, 3); // post forced + N + S
    assert.ok(tallNs.renderBoxes.some((b) => Math.abs(b.max[1]! - 1) < 1e-9));
  });

  it('ignores stored wall_connection_type bits on BlockRef', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 4 && z === 4) {
        return {
          name: 'minecraft:cobblestone_wall',
          states: {
            wall_connection_type_north: 'tall',
            wall_connection_type_east: 'tall',
            wall_connection_type_south: 'tall',
            wall_connection_type_west: 'tall',
            wall_post_bit: false,
          },
        };
      }
      return null;
    });
    const shape = wallShapeAtWorld(emptyNeighborhood(self), 4, 64, 4, 'minecraft:cobblestone_wall');
    assert.deepEqual({ ...shape.mask }, { north: false, east: false, south: false, west: false });
    assert.equal(shape.post, true);
  });
});

describe('wall mixed neighborhood + occlusion', () => {
  it('mixed: N wall, E stone, S pane, W fence', () => {
    //
    //           wall (N)
    //             │
    //  fence ── wall ── stone
    //             │
    //           pane (S)
    //
    const cells = new Map<string, BlockState>([
      ['8,8', { name: 'minecraft:cobblestone_wall', states: {} }],
      ['8,7', { name: 'minecraft:mossy_cobblestone_wall', states: {} }], // N
      ['9,8', { name: 'minecraft:stone', states: {} }], // E
      ['8,9', { name: 'minecraft:glass_pane', states: {} }], // S
      ['7,8', { name: 'minecraft:oak_fence', states: {} }], // W
    ]);
    const self = volumeFromStates(0, 0, (x, y, z) =>
      y === 64 ? (cells.get(`${x},${z}`) ?? null) : null,
    );
    const n = emptyNeighborhood(self);
    const mask = connectionMaskAtWorld(n, 8, 64, 8, 'minecraft:cobblestone_wall');
    assert.equal(mask.north, true, 'N → wall');
    assert.equal(mask.east, true, 'E → stone');
    assert.equal(mask.south, true, 'S → pane');
    assert.equal(mask.west, false, 'W → fence must not connect');

    const model = wallModel(
      'minecraft:cobblestone_wall',
      wallShapeFromMask(mask, false),
    );
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 4); // post + N + E + S

    const stone = fullCubeModel('minecraft:stone');
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'west', model), false);
  });

  it('does not occlude neighbour unit faces when isolated / connected / four-way', () => {
    const stone = fullCubeModel('minecraft:stone');
    const shapes = [
      wallShapeFromMask(connectionMaskFromFlags(false, false, false, false), false),
      wallShapeFromMask(connectionMaskFromFlags(true, false, false, false), false),
      wallShapeFromMask(connectionMaskFromFlags(true, true, true, true), false),
      wallShapeFromMask(connectionMaskFromFlags(true, true, true, true), true),
    ];
    for (const shape of shapes) {
      const model = wallModel('minecraft:cobblestone_wall', shape);
      assert.equal(model.isFullCube, false);
      for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
        assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, face, model), false);
      }
    }
  });

  it('chunk-boundary neighbour volumes supply wall connections', () => {
    const self = volumeFromStates(1, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 5) return { name: 'minecraft:cobblestone_wall', states: {} };
      return null;
    });
    const west = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 15 && z === 5) return { name: 'minecraft:stone_brick_wall', states: {} };
      return null;
    });
    const n: VoxelNeighborhood = { self, west, east: null, north: null, south: null };
    assert.equal(connectionMaskAtWorld(n, 16, 64, 5, 'minecraft:cobblestone_wall').west, true);
    assert.equal(connectionMaskAtWorld(n, 16, 64, 5, 'minecraft:cobblestone_wall').east, false);
  });

  it('missing neighbour data yields no connection', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 0) return { name: 'minecraft:cobblestone_wall', states: {} };
      return null;
    });
    const mask = connectionMaskAtWorld(emptyNeighborhood(self), 0, 64, 0, 'minecraft:cobblestone_wall');
    assert.deepEqual({ ...mask }, { north: false, east: false, south: false, west: false });
  });

  it('wall next to incompatible / plant / fence / pane / cube', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 64) return null;
      if (x === 5 && z === 5) return { name: 'minecraft:cobblestone_wall', states: {} };
      if (x === 5 && z === 4) return { name: 'minecraft:short_grass', states: {} }; // N plant
      if (x === 6 && z === 5) return { name: 'minecraft:oak_fence', states: {} }; // E fence
      if (x === 5 && z === 6) return { name: 'minecraft:glass_pane', states: {} }; // S pane
      if (x === 4 && z === 5) return { name: 'minecraft:stone', states: {} }; // W cube
      return null;
    });
    const mask = connectionMaskAtWorld(emptyNeighborhood(self), 5, 64, 5, 'minecraft:cobblestone_wall');
    assert.equal(mask.north, false);
    assert.equal(mask.east, false);
    assert.equal(mask.south, true);
    assert.equal(mask.west, true);
  });
});

describe('wall reciprocity with fence/pane', () => {
  it('fences and panes attach to walls; walls do not attach to fences', () => {
    assert.equal(
      fenceConnectsTo('minecraft:oak_fence', ref('minecraft:cobblestone_wall'), false),
      true,
    );
    assert.equal(
      paneConnectsTo('minecraft:glass_pane', ref('minecraft:cobblestone_wall'), false),
      true,
    );
    assert.equal(
      wallConnectsTo('minecraft:cobblestone_wall', ref('minecraft:oak_fence'), false),
      false,
    );
    assert.equal(neighbourIsFullCubeForConnection(ref('minecraft:cobblestone_wall')), false);
  });
});

describe('wall meshing smoke', () => {
  it('builds a mesh for a synthetic wall cell', () => {
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 2 && z === 2) return { name: 'minecraft:cobblestone_wall', states: {} };
      if (y === 64 && x === 3 && z === 2) return { name: 'minecraft:stone', states: {} };
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.ok(countFaces(mesh) > 6);
  });
});

describe('PR26 regressions', () => {
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

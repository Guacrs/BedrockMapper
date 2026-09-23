/**
 * PR23: pane / iron-bar models — reuse ConnectionMask; thin non-full-cube occlusion.
 *
 * Demo world has zero pane/iron_bars palette entries — synthetic fixture only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  connectionMaskFromFlags,
  connectionMaskKey,
  EMPTY_CONNECTION_MASK,
} from '../server/renderer/3d/models/connection.ts';
import { connectionMaskAtWorld } from '../server/renderer/3d/models/contextual.ts';
import { isFenceName } from '../server/renderer/3d/models/families/fence.ts';
import {
  isIronBarsName,
  isPaneName,
  paneConnectsTo,
  paneModel,
} from '../server/renderer/3d/models/families/pane.ts';
import { fullCubeModel } from '../server/renderer/3d/models/families/full-cube.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
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

function paneFixtureSelf(): ChunkBlocks {
  // Layout at Y=64:
  //  (2,2) isolated glass_pane
  //  (4,2)+(5,2) pane → stone
  //  (6,2)+(7,2) pane ↔ iron_bars
  //  (2,4)+(3,4) pane ↛ oak_fence
  //  (4,4)+(5,4) pane ↛ slab
  //  (8,2) plus centre (N/S/E glass, W iron_bars at 7,2)
  //  (12,5) stained pane with lying connection_* bits → still isolated
  const cells = new Map<string, BlockState>([
    ['2,2', { name: 'minecraft:glass_pane', states: {} }],
    ['4,2', { name: 'minecraft:glass_pane', states: {} }],
    ['5,2', { name: 'minecraft:stone', states: {} }],
    ['6,2', { name: 'minecraft:glass_pane', states: {} }],
    ['7,2', { name: 'minecraft:iron_bars', states: {} }],
    ['2,4', { name: 'minecraft:glass_pane', states: {} }],
    ['3,4', { name: 'minecraft:oak_fence', states: {} }],
    ['4,4', { name: 'minecraft:glass_pane', states: {} }],
    ['5,4', { name: 'minecraft:oak_slab', states: { 'minecraft:vertical_half': 'bottom' } }],
    ['8,2', { name: 'minecraft:glass_pane', states: {} }],
    ['8,1', { name: 'minecraft:glass_pane', states: {} }],
    ['8,3', { name: 'minecraft:glass_pane', states: {} }],
    ['9,2', { name: 'minecraft:glass_pane', states: {} }],
    [
      '12,5',
      {
        name: 'minecraft:white_stained_glass_pane',
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

describe('pane id classification', () => {
  it('detects panes and iron bars; excludes fences', () => {
    assert.equal(isPaneName('minecraft:glass_pane'), true);
    assert.equal(isPaneName('minecraft:white_stained_glass_pane'), true);
    assert.equal(isPaneName('minecraft:iron_bars'), true);
    assert.equal(isIronBarsName('minecraft:iron_bars'), true);
    assert.equal(isPaneName('minecraft:oak_fence'), false);
    assert.equal(isFenceName('minecraft:glass_pane'), false);
  });
});

describe('Bedrock pane connection rules', () => {
  it('uses an explicit classifier distinct from fences', () => {
    const cases: Array<{
      label: string;
      neighbour: BlockRef | null;
      fullCube: boolean;
      expect: boolean;
    }> = [
      { label: 'pane↔pane', neighbour: ref('minecraft:glass_pane'), fullCube: false, expect: true },
      { label: 'pane↔stained', neighbour: ref('minecraft:blue_stained_glass_pane'), fullCube: false, expect: true },
      { label: 'pane↔iron_bars', neighbour: ref('minecraft:iron_bars'), fullCube: false, expect: true },
      { label: 'bars↔pane', neighbour: ref('minecraft:glass_pane'), fullCube: false, expect: true },
      { label: 'pane↛fence', neighbour: ref('minecraft:oak_fence'), fullCube: false, expect: false },
      { label: 'pane↛fence even if fullCube flag', neighbour: ref('minecraft:oak_fence'), fullCube: true, expect: false },
      { label: 'pane→stone full cube', neighbour: ref('minecraft:stone'), fullCube: true, expect: true },
      { label: 'pane↛stone without flag', neighbour: ref('minecraft:stone'), fullCube: false, expect: false },
      { label: 'pane↛slab', neighbour: ref('minecraft:oak_slab'), fullCube: false, expect: false },
      { label: 'pane↛gate', neighbour: ref('minecraft:oak_fence_gate'), fullCube: false, expect: false },
      { label: 'air', neighbour: null, fullCube: false, expect: false },
    ];
    for (const c of cases) {
      assert.equal(
        paneConnectsTo('minecraft:glass_pane', c.neighbour, c.fullCube),
        c.expect,
        c.label,
      );
    }
  });
});

describe('pane geometry', () => {
  it('isolated pane is a 2×2 post only', () => {
    const model = paneModel('minecraft:glass_pane', EMPTY_CONNECTION_MASK);
    assert.equal(model.renderBoxes.length, 1);
    assert.equal(model.isFullCube, false);
    assert.deepEqual([...model.renderBoxes[0]!.min], [7 * PX, 0, 7 * PX]);
    assert.deepEqual([...model.renderBoxes[0]!.max], [9 * PX, 1, 9 * PX]);
    assert.equal(model.key, 'pane:n0e0s0w0:minecraft:glass_pane');
  });

  it('each connection adds one full-height arm', () => {
    for (const dir of ['north', 'east', 'south', 'west'] as const) {
      const mask = connectionMaskFromFlags(
        dir === 'north',
        dir === 'east',
        dir === 'south',
        dir === 'west',
      );
      const model = paneModel('minecraft:iron_bars', mask);
      assert.equal(model.renderBoxes.length, 2, dir);
    }
  });

  it('all four connections → post + 4 arms', () => {
    const model = paneModel(
      'minecraft:glass_pane',
      connectionMaskFromFlags(true, true, true, true),
    );
    assert.equal(model.renderBoxes.length, 5);
    assert.equal(connectionMaskKey(connectionMaskFromFlags(true, true, true, true)), 'n1e1s1w1');
  });
});

describe('panes are not full-cube occluders', () => {
  it('never sets isFullCube', () => {
    resetBlockModelCache();
    const isolated = resolveBlockModel(ref('minecraft:glass_pane'))!;
    const all = resolveBlockModel(
      ref('minecraft:iron_bars'),
      connectionMaskFromFlags(true, true, true, true),
    )!;
    assert.equal(isolated.isFullCube, false);
    assert.equal(all.isFullCube, false);
  });

  it('does not fully occlude a neighbouring stone face', () => {
    const stone = fullCubeModel('minecraft:stone');
    const pane = paneModel(
      'minecraft:glass_pane',
      connectionMaskFromFlags(false, false, false, true), // west arm toward stone on east of pane… 
    );
    // Stone's west face looking at a thin pane must stay (Option A: not fully covered).
    const stoneBox = stone.renderBoxes[0]!;
    assert.equal(isFaceFullyOccluded(stoneBox, 'west', pane), false);
    assert.equal(isFaceFullyOccluded(stoneBox, 'east', pane), false);
  });
});

describe('model cache by pane connection mask', () => {
  it('caches distinct masks separately', () => {
    resetBlockModelCache();
    const pane = ref('minecraft:glass_pane');
    const a = resolveBlockModel(pane, connectionMaskFromFlags(true, false, false, false))!;
    const b = resolveBlockModel(pane, connectionMaskFromFlags(true, false, false, false))!;
    const c = resolveBlockModel(pane, connectionMaskFromFlags(false, true, false, false))!;
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('ignores stored connection_* on BlockRef', () => {
    resetBlockModelCache();
    const lying = ref('minecraft:glass_pane', {
      'minecraft:connection_north': true,
      'minecraft:connection_east': true,
      'minecraft:connection_south': true,
      'minecraft:connection_west': true,
    });
    const model = resolveBlockModel(lying)!;
    assert.equal(model.renderBoxes.length, 1);
  });
});

describe('pane fixture neighborhood', () => {
  it('isolated / full-cube / bars / fence / slab / all-4 / stored bits', () => {
    const self = paneFixtureSelf();
    const n = emptyNeighborhood(self);
    assert.deepEqual(
      { ...connectionMaskAtWorld(n, 2, 64, 2, 'minecraft:glass_pane') },
      { north: false, east: false, south: false, west: false },
    );
    assert.equal(connectionMaskAtWorld(n, 4, 64, 2, 'minecraft:glass_pane').east, true);
    assert.equal(connectionMaskAtWorld(n, 6, 64, 2, 'minecraft:glass_pane').east, true); // → iron_bars
    assert.equal(connectionMaskAtWorld(n, 2, 64, 4, 'minecraft:glass_pane').east, false); // ↛ fence
    assert.equal(connectionMaskAtWorld(n, 4, 64, 4, 'minecraft:glass_pane').east, false); // ↛ slab
    assert.deepEqual(
      { ...connectionMaskAtWorld(n, 8, 64, 2, 'minecraft:glass_pane') },
      { north: true, east: true, south: true, west: true },
    );
    assert.deepEqual(
      { ...connectionMaskAtWorld(n, 12, 64, 5, 'minecraft:white_stained_glass_pane') },
      { north: false, east: false, south: false, west: false },
    );
  });

  it('chunk-boundary neighbour volumes supply pane connections', () => {
    const self = volumeFromStates(1, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 5) return { name: 'minecraft:glass_pane', states: {} };
      return null;
    });
    const west = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 15 && z === 5) return { name: 'minecraft:iron_bars', states: {} };
      return null;
    });
    const n: VoxelNeighborhood = { self, west, east: null, north: null, south: null };
    assert.equal(connectionMaskAtWorld(n, 16, 64, 5, 'minecraft:glass_pane').west, true);
  });

  it('missing neighbour = no connection; meshes without full-cube regression', () => {
    resetBlockModelCache();
    const self = volumeFromStates(1, 1, (x, y, z) => {
      if (y === 64 && x === 0 && z === 0) return { name: 'minecraft:glass_pane', states: {} };
      return null;
    });
    const mask = connectionMaskAtWorld(emptyNeighborhood(self), 16, 64, 16, 'minecraft:glass_pane');
    assert.equal(mask.west, false);
    assert.equal(mask.north, false);

    const stoneOnly = volumeFromStates(0, 0, (x, y, z) =>
      x === 3 && y === 64 && z === 3 ? { name: 'minecraft:stone', states: {} } : null,
    );
    assert.equal(countFaces(buildVoxelMesh(0, 0, emptyNeighborhood(stoneOnly))), 6);

    const paneOnly = volumeFromStates(0, 0, (x, y, z) =>
      x === 3 && y === 64 && z === 3 ? { name: 'minecraft:glass_pane', states: {} } : null,
    );
    const paneMesh = buildVoxelMesh(0, 0, emptyNeighborhood(paneOnly));
    assertMeshInvariants(paneMesh);
    assert.equal(countFaces(paneMesh), 6); // isolated post

    const fixtureMesh = buildVoxelMesh(0, 0, emptyNeighborhood(paneFixtureSelf()));
    assertMeshInvariants(fixtureMesh);
    assert.ok(countFaces(fixtureMesh) > 6);
  });
});

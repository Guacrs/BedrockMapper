/**
 * PR37: rail geometry — stored rail_direction authoritative; powered = texture.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blockRefAtWorld,
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import {
  isAscendingRailShape,
  isCornerRailShape,
  isRailName,
  RAIL_FLAT_Y,
  RAIL_RAISED_Y,
  railConnectsToNeighbour,
  railIsPowered,
  railShapeFromNeighbors,
  railShapeFromStates,
  tryBuildRail,
} from '../server/renderer/3d/models/families/rail.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import { applyModelBoxRotation } from '../server/renderer/3d/models/transform.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { BlockState, SubChunk } from '../server/world/subchunk.ts';

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
        indices[blockIndex(x, y, z)] = ensure(
          fill(x, y, z) ?? { name: 'minecraft:air', states: {} },
        );
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

describe('PR37 rail coverage', () => {
  it('classifies all four rail ids as explicit rail family', () => {
    for (const id of [
      'minecraft:rail',
      'minecraft:golden_rail',
      'minecraft:detector_rail',
      'minecraft:activator_rail',
    ]) {
      assert.equal(isRailName(id), true);
      const c = classifyBlockModelCoverage(id);
      assert.equal(c?.family, 'rail');
      assert.equal(c?.implementation, 'explicit');
    }
    assert.equal(isRailName('minecraft:oak_fence'), false);
  });
});

describe('PR37 rail states', () => {
  it('maps rail_direction 0–9; rejects corners on powered family', () => {
    assert.equal(railShapeFromStates({ rail_direction: 0 }, true), 'north_south');
    assert.equal(railShapeFromStates({ rail_direction: 1 }, true), 'east_west');
    assert.equal(railShapeFromStates({ rail_direction: 2 }, true), 'ascending_east');
    assert.equal(railShapeFromStates({ rail_direction: 5 }, true), 'ascending_south');
    assert.equal(railShapeFromStates({ rail_direction: 6 }, true), 'south_east');
    assert.equal(railShapeFromStates({ rail_direction: 9 }, true), 'north_east');
    assert.equal(railShapeFromStates({ rail_direction: '4' }, true), 'ascending_north');
    assert.equal(railShapeFromStates({ rail_direction: 6 }, false), null);
    assert.equal(railShapeFromStates({ rail_direction: 15 }, true), null);
    assert.equal(railShapeFromStates({}, true), null);
  });

  it('reads rail_data_bit as powered texture flag only', () => {
    assert.equal(railIsPowered({ rail_data_bit: true }), true);
    assert.equal(railIsPowered({ rail_data_bit: 1 }), true);
    assert.equal(railIsPowered({ rail_data_bit: false }), false);
    assert.equal(railIsPowered({}), false);
  });
});

describe('PR37 rail geometry', () => {
  it('flat NS is a zero-thickness plane at y=1/16 without rotation', () => {
    const built = tryBuildRail(ref('minecraft:rail', { rail_direction: 0 }));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'north_south');
    assert.equal(built.model.isFullCube, false);
    assert.equal(built.model.renderBoxes.length, 1);
    const box = built.model.renderBoxes[0]!;
    assert.equal(box.min[1], RAIL_FLAT_Y);
    assert.equal(box.max[1], RAIL_FLAT_Y);
    assert.equal(box.rotation, undefined);
    assert.ok(box.faces.up);
    assert.ok(box.faces.down);
    assert.match(built.model.key, /^rail:north_south:plain:/);
  });

  it('flat EW is Y-rotated flat; ascending uses ±45° + rescale', () => {
    const ew = tryBuildRail(ref('minecraft:rail', { rail_direction: 1 }));
    assert.equal(ew.ok, true);
    if (!ew.ok) return;
    assert.equal(ew.shape, 'east_west');
    assert.match(ew.model.key, /^rail:east_west:plain:/);

    const ascN = tryBuildRail(ref('minecraft:rail', { rail_direction: 4 }));
    assert.equal(ascN.ok, true);
    if (!ascN.ok) return;
    const box = ascN.model.renderBoxes[0]!;
    assert.equal(box.min[1], RAIL_RAISED_Y);
    assert.equal(box.rotation?.axis, 'x');
    assert.equal(box.rotation?.angle, 45);
    assert.equal(box.rotation?.rescale, true);

    const northEnd = applyModelBoxRotation(0.5, RAIL_RAISED_Y, 0, box.rotation);
    const southEnd = applyModelBoxRotation(0.5, RAIL_RAISED_Y, 1, box.rotation);
    assert.ok(northEnd[1] > 0.85, `north end y=${northEnd[1]}`);
    assert.ok(southEnd[1] < 0.2, `south end y=${southEnd[1]}`);
  });

  it('powered on/off share ascending geometry; differ only by texture/key', () => {
    const off = tryBuildRail(
      ref('minecraft:golden_rail', { rail_direction: 2, rail_data_bit: false }),
    );
    const on = tryBuildRail(
      ref('minecraft:golden_rail', { rail_direction: 2, rail_data_bit: true }),
    );
    assert.equal(off.ok, true);
    assert.equal(on.ok, true);
    if (!off.ok || !on.ok) return;
    assert.equal(off.shape, on.shape);
    assert.deepEqual(off.model.renderBoxes[0]!.min, on.model.renderBoxes[0]!.min);
    assert.deepEqual(off.model.renderBoxes[0]!.max, on.model.renderBoxes[0]!.max);
    assert.deepEqual(off.model.renderBoxes[0]!.rotation, on.model.renderBoxes[0]!.rotation);
    assert.notEqual(
      off.model.renderBoxes[0]!.faces.up!.textureKey,
      on.model.renderBoxes[0]!.faces.up!.textureKey,
    );
    assert.match(off.model.key, /^rail:ascending_east:off:/);
    assert.match(on.model.key, /^rail:ascending_east:on:/);
  });

  it('corner shapes use turned texture; powered family rejects corners', () => {
    const corner = tryBuildRail(ref('minecraft:rail', { rail_direction: 6 }));
    assert.equal(corner.ok, true);
    if (!corner.ok) return;
    assert.equal(isCornerRailShape(corner.shape), true);

    const bad = tryBuildRail(
      ref('minecraft:golden_rail', { rail_direction: 6, rail_data_bit: false }),
    );
    assert.equal(bad.ok, false);

    resetBlockModelCache();
    const fallback = resolveBlockModel(
      ref('minecraft:golden_rail', { rail_direction: 6, rail_data_bit: false }),
    );
    assert.equal(fallback?.isFullCube, true);
  });

  it('stored shape wins over neighbour-derived shape', () => {
    const neighbors = railShapeFromNeighbors(
      { north: true, east: true, south: false, west: false },
      true,
    );
    assert.equal(neighbors, 'north_east');
    const built = tryBuildRail(ref('minecraft:rail', { rail_direction: 0 }), neighbors);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'north_south');
  });

  it('missing rail_direction uses neighbour fallback when provided', () => {
    const shape = railShapeFromNeighbors(
      { north: false, east: true, south: true, west: false },
      true,
    );
    assert.equal(shape, 'south_east');
    const built = tryBuildRail(ref('minecraft:rail', {}), shape);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'south_east');
  });

  it('missing direction without neighbours defaults to north_south', () => {
    const built = tryBuildRail(ref('minecraft:rail', {}));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'north_south');
  });

  it('rails do not occlude as full cubes', () => {
    const model = resolveBlockModel(ref('minecraft:rail', { rail_direction: 0 }))!;
    assert.equal(model.isFullCube, false);
    assert.equal(isFaceFullyOccluded(model, 'up'), false);
  });
});

describe('PR37 rail neighbour helper + chunk boundaries', () => {
  it('railConnectsToNeighbour is rail↔rail only', () => {
    assert.equal(railConnectsToNeighbour(ref('minecraft:rail', { rail_direction: 0 })), true);
    assert.equal(
      railConnectsToNeighbour(ref('minecraft:golden_rail', { rail_direction: 0 })),
      true,
    );
    assert.equal(railConnectsToNeighbour(ref('minecraft:stone')), false);
    assert.equal(railConnectsToNeighbour(null), false);
  });

  it('neighbour helper does not invent ascending', () => {
    const shape = railShapeFromNeighbors(
      { north: true, east: false, south: true, west: false },
      true,
    );
    assert.equal(isAscendingRailShape(shape), false);
    assert.equal(shape, 'north_south');
  });

  it('missing neighbour volumes at chunk boundaries count as no rail', () => {
    const self = volumeFromStates(1, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 5) {
        return { name: 'minecraft:rail', states: { rail_direction: 1 } };
      }
      return null;
    });
    const n = emptyNeighborhood(self);
    // World (16,64,5) is local (0,*,5) of chunk (1,0); west is missing.
    const west = blockRefAtWorld(n, 15, 64, 5);
    assert.equal(west, null);
    const derived = railShapeFromNeighbors(
      {
        north: false,
        east: false,
        south: false,
        west: railConnectsToNeighbour(west),
      },
      true,
    );
    assert.equal(derived, 'north_south');
    // Stored EW direction still meshes as EW regardless of missing neighbour.
    const built = tryBuildRail(ref('minecraft:rail', { rail_direction: 1 }), derived);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'east_west');
  });

  it('chunk-boundary neighbour volumes can feed the narrow fallback only', () => {
    const self = volumeFromStates(1, 0, (x, y, z) => {
      if (y === 64 && x === 0 && z === 5) {
        return { name: 'minecraft:rail', states: {} };
      }
      return null;
    });
    const westVol = volumeFromStates(0, 0, (x, y, z) => {
      if (y === 64 && x === 15 && z === 5) {
        return { name: 'minecraft:rail', states: { rail_direction: 1 } };
      }
      return null;
    });
    const n: VoxelNeighborhood = {
      self,
      west: westVol,
      east: null,
      north: null,
      south: null,
    };
    const west = blockRefAtWorld(n, 15, 64, 5);
    assert.equal(railConnectsToNeighbour(west), true);
    const derived = railShapeFromNeighbors(
      { north: false, east: false, south: false, west: true },
      true,
    );
    assert.equal(derived, 'east_west');
    const built = tryBuildRail(ref('minecraft:rail', {}), derived);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.shape, 'east_west');
  });
});

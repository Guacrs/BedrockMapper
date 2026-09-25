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
import { torchModel, TORCH_WALL_LEAN_DEG } from '../server/renderer/3d/models/families/torch.ts';
import { resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import {
  applyModelBoxRotation,
  rotateModelY,
} from '../server/renderer/3d/models/transform.ts';
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

describe('PR33 wall torch cantilever geometry', () => {
  const PX = 1 / 16;
  /** Old incorrect horizontal stub length — must not reappear. */
  const OLD_STUB_LEN = 10 * PX;

  function rotatedCorners(box: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
    rotation?: {
      origin: readonly [number, number, number];
      axis: 'x' | 'y' | 'z';
      angle: number;
    };
  }): [number, number, number][] {
    const corners: [number, number, number][] = [];
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], box.max[2]]) {
          corners.push(applyModelBoxRotation(x, y, z, box.rotation));
        }
      }
    }
    return corners;
  }

  function bounds(corners: [number, number, number][]) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, c[i]!);
        max[i] = Math.max(max[i]!, c[i]!);
      }
    }
    return { min, max };
  }

  it('west wall torch leans +X with flame opposite the attachment face', () => {
    resetBlockModelCache();
    const wall = torchModel({
      name: 'minecraft:torch',
      states: { torch_facing_direction: 'west' },
    });
    assert.equal(wall.isFullCube, false);
    assert.equal(wall.renderBoxes.length, 1);
    const box = wall.renderBoxes[0]!;
    assert.ok(box.rotation);
    assert.equal(box.rotation!.angle, TORCH_WALL_LEAN_DEG);
    assert.equal(box.rotation!.axis, 'z');
    // Not the old axis-aligned stub (would span 10/16 along X without lean).
    assert.ok(box.rotation!.angle !== 0);
    assert.notEqual(box.max[0]! - box.min[0]!, OLD_STUB_LEN);

    const { min, max } = bounds(rotatedCorners(box));
    // Attachment near west (x≈0); flame/end reaches further +X and higher Y.
    assert.ok(min[0]! < 0.05, 'base near west face');
    assert.ok(max[0]! > min[0]! + 0.15, 'leans into +X');
    assert.ok(max[1]! > min[1]! + 0.4, 'has vertical extent');
    // Tip (max Y corner set) is outward (+X) relative to base.
    const tipX = Math.max(
      ...rotatedCorners(box)
        .filter((c) => c[1]! > (min[1]! + max[1]!) / 2)
        .map((c) => c[0]!),
    );
    const baseX = Math.min(
      ...rotatedCorners(box)
        .filter((c) => c[1]! < (min[1]! + max[1]!) / 2)
        .map((c) => c[0]!),
    );
    assert.ok(tipX > baseX, 'flame end opposite west attachment');
  });

  it('all four wall orientations are rotationally equivalent cantilevers', () => {
    resetBlockModelCache();
    // Face cycle under rotateModelY: west → north → east → south
    const dirs = ['west', 'north', 'east', 'south'] as const;
    const models = dirs.map((dir) =>
      torchModel({ name: 'minecraft:torch', states: { torch_facing_direction: dir } }),
    );
    for (let i = 0; i < dirs.length; i++) {
      const box = models[i]!.renderBoxes[0]!;
      assert.ok(box.rotation, dirs[i]);
      assert.equal(Math.abs(box.rotation!.angle), 22.5, dirs[i]);
      assert.deepEqual(Object.keys(box.faces).sort(), ['east', 'north', 'south', 'west']);
      assert.equal(box.faces.up, undefined);
      assert.equal(box.faces.down, undefined);
      assert.ok(box.faces.north?.tileUv, 'wall torch uses torch sprite UV crop');
    }

    // Rotating west→north→east→south by +1 Y turn each matches the next state.
    let cursor = models[0]!;
    for (let i = 1; i < dirs.length; i++) {
      cursor = rotateModelY(cursor, 1);
      const expected = models[i]!.renderBoxes[0]!;
      const got = cursor.renderBoxes[0]!;
      assert.equal(got.rotation!.axis, expected.rotation!.axis, dirs[i]);
      assert.ok(
        Math.abs(got.rotation!.angle - expected.rotation!.angle) < 1e-9,
        dirs[i],
      );
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(got.min[c]! - expected.min[c]!) < 1e-9, `${dirs[i]} min`);
        assert.ok(Math.abs(got.max[c]! - expected.max[c]!) < 1e-9, `${dirs[i]} max`);
      }
    }
  });

  it('east/north/south attachment put the torch on the correct cell face', () => {
    resetBlockModelCache();
    const cases = [
      {
        dir: 'east' as const,
        onFace: (b: ReturnType<typeof bounds>) => b.max[0]! > 0.95,
        intoCell: (high: number, low: number) => high < low, // tip x < base x
        axis: 0,
      },
      {
        dir: 'west' as const,
        onFace: (b: ReturnType<typeof bounds>) => b.min[0]! < 0.05,
        intoCell: (high: number, low: number) => high > low,
        axis: 0,
      },
      {
        dir: 'south' as const,
        onFace: (b: ReturnType<typeof bounds>) => b.max[2]! > 0.95,
        intoCell: (high: number, low: number) => high < low,
        axis: 2,
      },
      {
        dir: 'north' as const,
        onFace: (b: ReturnType<typeof bounds>) => b.min[2]! < 0.05,
        intoCell: (high: number, low: number) => high > low,
        axis: 2,
      },
    ];
    for (const c of cases) {
      const wall = torchModel({
        name: 'minecraft:soul_torch',
        states: { torch_facing_direction: c.dir },
      });
      const box = wall.renderBoxes[0]!;
      const corners = rotatedCorners(box);
      const b = bounds(corners);
      assert.ok(c.onFace(b), `${c.dir} attachment on cell face`);
      const midY = (b.min[1]! + b.max[1]!) / 2;
      const high = corners.filter((p) => p[1]! >= midY);
      const low = corners.filter((p) => p[1]! < midY);
      const avg = (pts: [number, number, number][]) =>
        pts.reduce((s, p) => s + p[c.axis]!, 0) / pts.length;
      assert.ok(
        c.intoCell(avg(high), avg(low)),
        `${c.dir} flame leans into the cell`,
      );
    }
  });

  it('wall torch emissive mesh keeps four vertical faces', () => {
    const self = volumeFromStates(0, 0, (x, y, z): BlockState | null =>
      x === 4 && y === 64 && z === 4
        ? { name: 'minecraft:torch', states: { torch_facing_direction: 'west' } }
        : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 0);
    assert.equal(countEmissiveFaces(mesh), 4);
  });
});

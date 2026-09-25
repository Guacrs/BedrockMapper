/**
 * PR21: straight stair models + weirdo_direction mapping.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChunkBlocks,
  type VoxelNeighborhood,
} from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants, type MeshChunk } from '../server/renderer/3d/mesh-types.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import {
  baseEastBottomStair,
  describeWeirdoDirection,
  isStairName,
  quarterTurnsForFacing,
  tryBuildStraightStair,
  WEIRDO_DIRECTION_TO_FACING,
  weirdoDirectionFromStates,
} from '../server/renderer/3d/models/families/stair.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import { flipModelY, rotateModelY, rotatePointXZ } from '../server/renderer/3d/models/transform.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';
import { buildVoxelMesh, countFaces, faceCornerUvsForBox } from '../server/renderer/3d/voxel-mesh-builder.ts';
import { fullCubeFaceTexture } from '../server/renderer/3d/textures/models.ts';
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

function stairRef(
  weirdo: number,
  upsideDown = false,
  corner: string = 'none',
): BlockRef {
  return {
    name: 'minecraft:oak_stairs',
    states: {
      weirdo_direction: weirdo,
      upside_down_bit: upsideDown,
      'minecraft:corner': corner,
    },
  };
}

function boxBounds(model: { renderBoxes: readonly { min: readonly number[]; max: readonly number[] }[] }) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const b of model.renderBoxes) {
    minX = Math.min(minX, b.min[0]!);
    minY = Math.min(minY, b.min[1]!);
    minZ = Math.min(minZ, b.min[2]!);
    maxX = Math.max(maxX, b.max[0]!);
    maxY = Math.max(maxY, b.max[1]!);
    maxZ = Math.max(maxZ, b.max[2]!);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

describe('weirdo_direction mapping', () => {
  it('documents the Bedrock facing table explicitly', () => {
    assert.deepEqual({ ...WEIRDO_DIRECTION_TO_FACING }, {
      0: 'east',
      1: 'west',
      2: 'south',
      3: 'north',
    });
    assert.match(describeWeirdoDirection(), /0=east/);
    assert.equal(weirdoDirectionFromStates({ weirdo_direction: 2 }), 2);
  });
});

describe('straight stair geometry', () => {
  it('classifies *_stairs ids', () => {
    assert.equal(isStairName('minecraft:oak_stairs'), true);
    assert.equal(isStairName('minecraft:stone'), false);
    assert.equal(isStairName('minecraft:oak_slab'), false);
  });

  it('builds an east-facing bottom stair with expected boxes', () => {
    const built = tryBuildStraightStair(stairRef(0));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.facing, 'east');
    assert.equal(built.upsideDown, false);
    assert.equal(built.corner, 'none');
    assert.equal(built.model.renderBoxes.length, 2);
    const lower = built.model.renderBoxes[0]!;
    const upper = built.model.renderBoxes[1]!;
    assert.deepEqual([...lower.min], [0, 0, 0]);
    assert.deepEqual([...lower.max], [1, 0.5, 1]);
    assert.deepEqual([...upper.min], [0.5, 0.5, 0]);
    assert.deepEqual([...upper.max], [1, 1, 1]);
    assert.match(built.model.key, /^stair:east:bottom:none:/);
  });

  it('orients all four weirdo_direction values', () => {
    const expectedUpper: Record<number, [number, number, number, number, number, number]> = {
      // minX,minY,minZ,maxX,maxY,maxZ of the upper step
      0: [0.5, 0.5, 0, 1, 1, 1], // east
      2: [0, 0.5, 0.5, 1, 1, 1], // south
      1: [0, 0.5, 0, 0.5, 1, 1], // west
      3: [0, 0.5, 0, 1, 1, 0.5], // north
    };
    for (const weirdo of [0, 1, 2, 3]) {
      const built = tryBuildStraightStair(stairRef(weirdo));
      assert.equal(built.ok, true, `weirdo=${weirdo}`);
      if (!built.ok) continue;
      const upper = built.model.renderBoxes.find((b) => b.min[1] === 0.5 && b.max[1] === 1)!;
      assert.ok(upper, `upper step missing for ${weirdo}`);
      const exp = expectedUpper[weirdo]!;
      assert.ok(Math.abs(upper.min[0]! - exp[0]!) < 1e-9, `wx=${weirdo} minX`);
      assert.ok(Math.abs(upper.min[2]! - exp[2]!) < 1e-9, `wx=${weirdo} minZ`);
      assert.ok(Math.abs(upper.max[0]! - exp[3]!) < 1e-9, `wx=${weirdo} maxX`);
      assert.ok(Math.abs(upper.max[2]! - exp[5]!) < 1e-9, `wx=${weirdo} maxZ`);
    }
  });

  it('flips upside-down stairs vertically', () => {
    const built = tryBuildStraightStair(stairRef(0, true));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.upsideDown, true);
    const bounds = boxBounds(built.model);
    assert.ok(Math.abs(bounds.minY - 0) < 1e-9);
    assert.ok(Math.abs(bounds.maxY - 1) < 1e-9);
    // Upper slab-like volume should sit at y 0.5..1
    const topSlab = built.model.renderBoxes.find((b) => b.min[1] === 0.5 && b.max[1] === 1 && b.min[0] === 0)!;
    assert.ok(topSlab);
    const hanging = built.model.renderBoxes.find((b) => b.max[1] === 0.5)!;
    assert.ok(hanging);
    assert.ok(hanging.min[0]! >= 0.5 - 1e-9); // still on the east side
  });

  it('rotate Y four times returns equivalent geometry', () => {
    const base = baseEastBottomStair('minecraft:oak_stairs');
    let m = base;
    for (let i = 0; i < 4; i++) m = rotateModelY(m, 1);
    assert.equal(m.renderBoxes.length, base.renderBoxes.length);
    for (let i = 0; i < base.renderBoxes.length; i++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(m.renderBoxes[i]!.min[c]! - base.renderBoxes[i]!.min[c]!) < 1e-9);
        assert.ok(Math.abs(m.renderBoxes[i]!.max[c]! - base.renderBoxes[i]!.max[c]!) < 1e-9);
      }
    }
    // Point round-trip
    let [x, z] = [0.25, 0.75];
    for (let i = 0; i < 4; i++) [x, z] = rotatePointXZ(x, z, 1);
    assert.ok(Math.abs(x - 0.25) < 1e-9 && Math.abs(z - 0.75) < 1e-9);
  });

  it('does not mutate the base model when rotating', () => {
    const base = baseEastBottomStair('minecraft:oak_stairs');
    const before = JSON.stringify(base.renderBoxes);
    rotateModelY(base, 1);
    flipModelY(base);
    assert.equal(JSON.stringify(base.renderBoxes), before);
  });

  it('caches equivalent stair BlockRefs', () => {
    resetBlockModelCache();
    const a = resolveBlockModel(stairRef(2))!;
    const b = resolveBlockModel(stairRef(2))!;
    assert.equal(a, b);
  });

  it('falls back to full cube for unsupported corner shapes', () => {
    resetBlockModelCache();
    const built = tryBuildStraightStair(stairRef(0, false, 'diagonal_nonsense'));
    assert.equal(built.ok, false);
    const model = resolveBlockModel(stairRef(0, false, 'diagonal_nonsense'))!;
    assert.equal(model.isFullCube, true);
  });

  it('resolves supported corner shapes as non-full-cube stairs', () => {
    resetBlockModelCache();
    for (const corner of ['inner_left', 'inner_right', 'outer_left', 'outer_right'] as const) {
      const built = tryBuildStraightStair(stairRef(0, false, corner));
      assert.equal(built.ok, true, corner);
      if (!built.ok) continue;
      assert.equal(built.corner, corner);
      assert.equal(built.model.isFullCube, false);
      assert.match(built.model.key, new RegExp(`:${corner}:`));
      const resolved = resolveBlockModel(stairRef(0, false, corner))!;
      assert.equal(resolved.isFullCube, false);
      assert.equal(resolved.key, built.model.key);
    }
  });

  it('falls back to full cube for invalid weirdo_direction', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({
      name: 'minecraft:oak_stairs',
      states: { weirdo_direction: 9, upside_down_bit: false, 'minecraft:corner': 'none' },
    })!;
    assert.equal(model.isFullCube, true);
  });

  it('uses PR17 appearance keys for stair faces', () => {
    const built = tryBuildStraightStair(stairRef(0));
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(
      built.model.renderBoxes[0]!.faces.up?.textureKey,
      fullCubeFaceTexture('minecraft:oak_stairs', 'up'),
    );
    assert.equal(
      built.model.renderBoxes[0]!.faces.south?.textureKey,
      fullCubeFaceTexture('minecraft:oak_stairs', 'south'),
    );
  });

  it('emits a mesh with valid UVs for an isolated stair', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 2 && y === 70 && z === 3) {
        return {
          name: 'minecraft:oak_stairs',
          states: {
            weirdo_direction: 0,
            upside_down_bit: false,
            'minecraft:corner': 'none',
          },
        };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.ok(countFaces(mesh) >= 8); // two boxes, some faces internal-ish but still emitted if not occluded
    for (const uv of mesh.uvs) {
      assert.ok(Number.isFinite(uv) && uv >= 0 && uv <= 1);
    }
  });

  it('keeps full-cube faces when only partially covered by a stair (Option A)', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2) return { name: 'minecraft:stone', states: {} as Record<string, never> };
      if (x === 3) {
        return {
          name: 'minecraft:oak_stairs',
          states: {
            weirdo_direction: 0,
            upside_down_bit: false,
            'minecraft:corner': 'none',
          },
        };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Stone must retain its east face (partial stair cover) → at least the
    // isolated stone's 6 faces worth of contribution remain plausible.
    assert.ok(countFaces(mesh) > 6);
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} })!;
    const stair = resolveBlockModel(stairRef(0))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', stair), false);
  });

  it('crops stair UV density on partial side faces', () => {
    const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
    const upperEast = {
      min: [0.5, 0.5, 0] as const,
      max: [1, 1, 1] as const,
      faces: {},
    };
    const uvs = faceCornerUvsForBox(rect, 'south', upperEast);
    // X spans 0.5..1 → U 0.5..1; Y 0.5..1 → V 0.5..0
    assert.equal(uvs[0]![0], 0.5);
    assert.equal(uvs[1]![0], 1);
    assert.equal(uvs[0]![1], 0.5);
    assert.equal(uvs[2]![1], 0);
  });

  it('quarterTurnsForFacing matches weirdo table', () => {
    assert.equal(quarterTurnsForFacing('east'), 0);
    assert.equal(quarterTurnsForFacing('south'), 1);
    assert.equal(quarterTurnsForFacing('west'), 2);
    assert.equal(quarterTurnsForFacing('north'), 3);
  });
});

describe('PR32 stair corner geometry', () => {
  it('outer corners use one upper quarter (east-bottom canonical)', () => {
    const left = tryBuildStraightStair(stairRef(0, false, 'outer_left'));
    const right = tryBuildStraightStair(stairRef(0, false, 'outer_right'));
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    if (!left.ok || !right.ok) return;
    assert.equal(left.model.renderBoxes.length, 2);
    assert.equal(right.model.renderBoxes.length, 2);
    const lu = left.model.renderBoxes[1]!;
    const ru = right.model.renderBoxes[1]!;
    // left → NE: Z 0..0.5; right → SE: Z 0.5..1
    assert.deepEqual([...lu.min], [0.5, 0.5, 0]);
    assert.deepEqual([...lu.max], [1, 1, 0.5]);
    assert.deepEqual([...ru.min], [0.5, 0.5, 0.5]);
    assert.deepEqual([...ru.max], [1, 1, 1]);
  });

  it('inner corners use three boxes (lower + east half + west quarter)', () => {
    const left = tryBuildStraightStair(stairRef(0, false, 'inner_left'));
    const right = tryBuildStraightStair(stairRef(0, false, 'inner_right'));
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    if (!left.ok || !right.ok) return;
    assert.equal(left.model.renderBoxes.length, 3);
    assert.equal(right.model.renderBoxes.length, 3);
    // West quarters: left = NW, right = SW
    assert.deepEqual([...left.model.renderBoxes[2]!.min], [0, 0.5, 0]);
    assert.deepEqual([...left.model.renderBoxes[2]!.max], [0.5, 1, 0.5]);
    assert.deepEqual([...right.model.renderBoxes[2]!.min], [0, 0.5, 0.5]);
    assert.deepEqual([...right.model.renderBoxes[2]!.max], [0.5, 1, 1]);
  });

  it('orients all four facings for outer_right without becoming full cube', () => {
    for (const weirdo of [0, 1, 2, 3]) {
      const built = tryBuildStraightStair(stairRef(weirdo, false, 'outer_right'));
      assert.equal(built.ok, true, `weirdo=${weirdo}`);
      if (!built.ok) continue;
      assert.equal(built.model.isFullCube, false);
      assert.equal(built.model.renderBoxes.length, 2);
      const bounds = boxBounds(built.model);
      assert.ok(bounds.maxX - bounds.minX <= 1 + 1e-9);
      assert.ok(bounds.maxY - bounds.minY <= 1 + 1e-9);
      // Outer corner upper volume is a quarter → not a full upper slab.
      const upper = built.model.renderBoxes.find((b) => b.min[1]! >= 0.5 - 1e-9)!;
      const ux = upper.max[0]! - upper.min[0]!;
      const uz = upper.max[2]! - upper.min[2]!;
      assert.ok(ux * uz < 0.5 + 1e-9, `outer upper footprint weirdo=${weirdo}`);
    }
  });

  it('upside-down outer_left flips vertically', () => {
    const built = tryBuildStraightStair(stairRef(0, true, 'outer_left'));
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.upsideDown, true);
    assert.equal(built.model.isFullCube, false);
    // After flip, the small step hangs below y=0.5 on the east-north side.
    const hanging = built.model.renderBoxes.find((b) => b.max[1]! <= 0.5 + 1e-9 && b.min[1]! < 0.5)!;
    assert.ok(hanging);
    assert.ok(hanging.min[0]! >= 0.5 - 1e-9);
    assert.ok(hanging.max[2]! <= 0.5 + 1e-9);
  });

  it('rotational equivalence: east outer_right + rotY = south outer_right', () => {
    const east = tryBuildStraightStair(stairRef(0, false, 'outer_right'));
    const south = tryBuildStraightStair(stairRef(2, false, 'outer_right'));
    assert.equal(east.ok && south.ok, true);
    if (!east.ok || !south.ok) return;
    const rotated = rotateModelY(east.model, 1);
    assert.equal(rotated.renderBoxes.length, south.model.renderBoxes.length);
    for (let i = 0; i < south.model.renderBoxes.length; i++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(
          Math.abs(rotated.renderBoxes[i]!.min[c]! - south.model.renderBoxes[i]!.min[c]!) < 1e-9,
          `min[${c}] box ${i}`,
        );
        assert.ok(
          Math.abs(rotated.renderBoxes[i]!.max[c]! - south.model.renderBoxes[i]!.max[c]!) < 1e-9,
          `max[${c}] box ${i}`,
        );
      }
    }
  });

  it('missing corner state defaults to straight', () => {
    const built = tryBuildStraightStair({
      name: 'minecraft:oak_stairs',
      states: { weirdo_direction: 0, upside_down_bit: false },
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.corner, 'none');
    assert.equal(built.model.renderBoxes.length, 2);
  });

  it('corner against full cube does not fully occlude the cube side', () => {
    resetBlockModelCache();
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} })!;
    const corner = resolveBlockModel(stairRef(0, false, 'outer_right'))!;
    assert.equal(corner.isFullCube, false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'west', corner), false);
  });

  it('meshes an inner corner without full-cube face count', () => {
    resetBlockModelCache();
    const self = volumeFromStates(0, 0, (x, y, z) => {
      if (x === 2 && y === 70 && z === 3) {
        return {
          name: 'minecraft:oak_stairs',
          states: {
            weirdo_direction: 0,
            upside_down_bit: false,
            'minecraft:corner': 'inner_left',
          },
        };
      }
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Inner = 3 boxes → more faces than a lone cube's 6, but not a solid cube mesh.
    assert.ok(countFaces(mesh) > 6);
  });
});

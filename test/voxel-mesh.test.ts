/**
 * Experimental voxel / full-cube mesh tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChunkBlocks, type VoxelNeighborhood } from '../server/renderer/3d/chunk-blocks.ts';
import { MeshCache } from '../server/renderer/3d/mesh-cache.ts';
import { assertMeshInvariants, isEmptyMesh, type MeshChunk } from '../server/renderer/3d/mesh-types.ts';
import { buildVoxelMesh, countFaces } from '../server/renderer/3d/voxel-mesh-builder.ts';
import { blockColor } from '../server/renderer/colors.ts';
import { isRenderableCube } from '../server/world/blocks.ts';
import { blockIndex } from '../server/world/keys.ts';
import type { SubChunk } from '../server/world/subchunk.ts';

function makeSubChunk(
  index: number,
  fill: (x: number, y: number, z: number) => string | null,
): SubChunk {
  const nameToIndex = new Map<string, number>();
  const palette: { name: string; states: Record<string, never> }[] = [];
  const ensure = (name: string) => {
    let id = nameToIndex.get(name);
    if (id === undefined) {
      id = palette.length;
      nameToIndex.set(name, id);
      palette.push({ name, states: {} });
    }
    return id;
  };
  ensure('minecraft:air');
  const indices = new Uint16Array(4096);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        const name = fill(x, y, z) ?? 'minecraft:air';
        indices[blockIndex(x, y, z)] = ensure(name);
      }
    }
  }
  return {
    index,
    version: 9,
    layers: [{ palette, indices }],
  };
}

function volumeFromFill(
  chunkX: number,
  chunkZ: number,
  fill: (localX: number, worldY: number, localZ: number) => string | null,
  subIndices: number[] = [4],
): ChunkBlocks {
  const subs = subIndices.map((index) =>
    makeSubChunk(index, (x, y, z) => fill(x, index * 16 + y, z)),
  );
  return ChunkBlocks.fromSubChunks(chunkX, chunkZ, subs);
}

function emptyNeighborhood(self: ChunkBlocks | null): VoxelNeighborhood {
  return { self, west: null, east: null, north: null, south: null };
}

function faceHasNormal(mesh: MeshChunk, nx: number, ny: number, nz: number): boolean {
  for (let i = 0; i < mesh.normals.length; i += 3) {
    if (
      Math.abs(mesh.normals[i]! - nx) < 1e-6 &&
      Math.abs(mesh.normals[i + 1]! - ny) < 1e-6 &&
      Math.abs(mesh.normals[i + 2]! - nz) < 1e-6
    ) {
      return true;
    }
  }
  return false;
}

describe('isRenderableCube', () => {
  it('treats air as empty and ordinary blocks as cubes', () => {
    assert.equal(isRenderableCube(null), false);
    assert.equal(isRenderableCube('minecraft:air'), false);
    assert.equal(isRenderableCube('minecraft:stone'), true);
    assert.equal(isRenderableCube('minecraft:water'), true);
    assert.equal(isRenderableCube('minecraft:oak_stairs'), true); // full cube until special models
  });
});

describe('voxel mesh builder', () => {
  it('emits six faces for a single solid block in air', () => {
    const self = volumeFromFill(0, 0, (x, y, z) =>
      x === 2 && y === 70 && z === 3 ? 'minecraft:stone' : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
    assert.ok(faceHasNormal(mesh, 0, 1, 0));
    assert.ok(faceHasNormal(mesh, 0, -1, 0));
    assert.ok(faceHasNormal(mesh, 1, 0, 0));
    assert.ok(faceHasNormal(mesh, -1, 0, 0));
    assert.ok(faceHasNormal(mesh, 0, 0, 1));
    assert.ok(faceHasNormal(mesh, 0, 0, -1));
  });

  it('omits the shared face between two adjacent solid blocks', () => {
    const self = volumeFromFill(0, 0, (x, y, z) => {
      if (y !== 70 || z !== 3) return null;
      if (x === 2 || x === 3) return 'minecraft:stone';
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // Two cubes share one face → 6+6-2 = 10 faces.
    assert.equal(countFaces(mesh), 10);
  });

  it('omits internal faces in a solid vertical column', () => {
    const self = volumeFromFill(0, 0, (x, y, z) => {
      if (x === 4 && z === 4 && y >= 64 && y <= 67) return 'minecraft:cobblestone';
      return null;
    });
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    // 4 stacked cubes: top+bottom + 4*4 sides = 2 + 16 = 18 faces.
    assert.equal(countFaces(mesh), 18);
  });

  it('uses neighbour chunk solidity to cull a boundary face', () => {
    const self = volumeFromFill(0, 0, (x, y, z) =>
      x === 15 && y === 70 && z === 5 ? 'minecraft:stone' : null,
    );
    const east = volumeFromFill(1, 0, (x, y, z) =>
      x === 0 && y === 70 && z === 5 ? 'minecraft:stone' : null,
    );

    const open = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assert.equal(countFaces(open), 6);

    const sealed = buildVoxelMesh(0, 0, {
      self,
      west: null,
      east,
      north: null,
      south: null,
    });
    assert.equal(countFaces(sealed), 5);
    assert.equal(faceHasNormal(sealed, 1, 0, 0), false);
  });

  it('treats a missing neighbour as air without crashing', () => {
    const self = volumeFromFill(2, 2, (x, y, z) =>
      x === 0 && y === 70 && z === 0 ? 'minecraft:dirt' : null,
    );
    const mesh = buildVoxelMesh(2, 2, {
      self,
      west: null,
      east: null,
      north: null,
      south: null,
    });
    assertMeshInvariants(mesh);
    assert.equal(countFaces(mesh), 6);
  });

  it('returns an empty mesh for an empty chunk', () => {
    const self = volumeFromFill(0, 0, () => null);
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(isEmptyMesh(mesh), true);
  });

  it('emits UVs for every vertex (zeroes when no atlas is built)', () => {
    const self = volumeFromFill(0, 0, (x, y, z) =>
      x === 0 && y === 70 && z === 0 ? 'minecraft:stone' : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    assertMeshInvariants(mesh);
    assert.equal(mesh.uvs.length, (mesh.positions.length / 3) * 2);
    assert.equal(countFaces(mesh), 6);
  });

  it('uses blockColor from the existing palette pipeline', () => {
    const self = volumeFromFill(0, 0, (x, y, z) =>
      x === 1 && y === 70 && z === 1 ? 'minecraft:gold_block' : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    const expected = blockColor('minecraft:gold_block');
    assert.ok(mesh.colors.length >= 3);
    // Untinted textured blocks use white vertex colours; without an atlas the
    // face keeps the map-colour RGB.
    const r = mesh.colors[0]!;
    const g = mesh.colors[1]!;
    const b = mesh.colors[2]!;
    const white = r === 1 && g === 1 && b === 1;
    const mapColor =
      Math.abs(r - expected[0] / 255) < 1e-6 &&
      Math.abs(g - expected[1] / 255) < 1e-6 &&
      Math.abs(b - expected[2] / 255) < 1e-6;
    assert.ok(white || mapColor, `unexpected vertex colour ${r},${g},${b}`);
  });

  it('gives the top face an upward normal', () => {
    const self = volumeFromFill(0, 0, (x, y, z) =>
      x === 0 && y === 70 && z === 0 ? 'minecraft:stone' : null,
    );
    const mesh = buildVoxelMesh(0, 0, emptyNeighborhood(self));
    // First face emitted is top (+Y).
    assert.equal(mesh.normals[0], 0);
    assert.equal(mesh.normals[1], 1);
    assert.equal(mesh.normals[2], 0);
  });
});

describe('voxel mesh cache invalidation', () => {
  it('invalidates neighbours whose boundary visibility depends on a changed chunk', () => {
    const cache = new MeshCache();
    const stub = (cx: number, cz: number): MeshChunk => ({
      chunkX: cx,
      chunkZ: cz,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      colors: [1, 0, 0, 1, 0, 0, 1, 0, 0],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    });

    // Chunk (1,0) has a west-boundary block that culls against (0,0).
    cache.set('overworld', 0, 0, stub(0, 0));
    cache.set('overworld', 1, 0, stub(1, 0));
    cache.set('overworld', 0, 1, stub(0, 1));
    cache.set('overworld', 5, 5, stub(5, 5));

    const removed = cache.invalidateAround('overworld', 0, 0);
    assert.ok(removed >= 3);
    assert.equal(cache.get('overworld', 0, 0), undefined);
    assert.equal(cache.get('overworld', 1, 0), undefined);
    assert.equal(cache.get('overworld', 0, 1), undefined);
    assert.ok(cache.get('overworld', 5, 5));
  });
});

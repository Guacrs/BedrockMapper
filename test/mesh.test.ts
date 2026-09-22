import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTerrainMesh } from '../server/renderer/3d/mesh-builder.ts';
import { MeshCache } from '../server/renderer/3d/mesh-cache.ts';
import {
  assertMeshInvariants,
  isEmptyMesh,
  meshChunkKey,
  type MeshChunk,
} from '../server/renderer/3d/mesh-types.ts';
import { surfaceBlockColor } from '../server/renderer/colors.ts';
import { columnIndex } from '../server/world/keys.ts';
import { NO_BIOME, NO_SURFACE, type ChunkSurface } from '../server/world/surface.ts';

function flatSurface(
  chunkX: number,
  chunkZ: number,
  height: number,
  block = 'minecraft:grass_block',
): ChunkSurface {
  const heights = new Int16Array(256).fill(height);
  const blocks: (string | null)[] = new Array(256).fill(block);
  const waterDepths = new Uint8Array(256);
  const biomes = new Uint16Array(256).fill(NO_BIOME);
  return {
    chunkX,
    chunkZ,
    heights,
    blocks,
    waterDepths,
    biomes,
    resolvedColumns: 256,
    skipped: [],
  };
}

function rampSurface(chunkX: number, chunkZ: number): ChunkSurface {
  const heights = new Int16Array(256);
  const blocks: (string | null)[] = new Array(256).fill('minecraft:stone');
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      heights[columnIndex(lx, lz)] = 64 + lx;
    }
  }
  return {
    chunkX,
    chunkZ,
    heights,
    blocks,
    waterDepths: new Uint8Array(256),
    biomes: new Uint16Array(256).fill(NO_BIOME),
    resolvedColumns: 256,
    skipped: [],
  };
}

function emptySurface(chunkX: number, chunkZ: number): ChunkSurface {
  return {
    chunkX,
    chunkZ,
    heights: new Int16Array(256).fill(NO_SURFACE),
    blocks: new Array(256).fill(null),
    waterDepths: new Uint8Array(256),
    biomes: new Uint16Array(256).fill(NO_BIOME),
    resolvedColumns: 0,
    skipped: [],
  };
}

function heightAt(mesh: MeshChunk, x: number, z: number): number | null {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i] === x && mesh.positions[i + 2] === z) {
      return mesh.positions[i + 1]!;
    }
  }
  return null;
}

describe('mesh types', () => {
  it('builds cache keys from dimension and chunk coordinates', () => {
    assert.equal(meshChunkKey('overworld', 12, -7), 'overworld:12:-7');
  });

  it('validates geometry invariants', () => {
    const ok: MeshChunk = {
      chunkX: 0,
      chunkZ: 0,
      positions: [0, 1, 0, 1, 1, 0, 0, 1, 1],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      colors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      indices: [0, 1, 2],
    };
    assertMeshInvariants(ok);
    assert.throws(() =>
      assertMeshInvariants({ ...ok, positions: [0, 1] }),
    );
    assert.throws(() =>
      assertMeshInvariants({ ...ok, indices: [0, 1, 99] }),
    );
  });
});

describe('terrain mesh builder', () => {
  it('preserves chunk coordinates and produces valid arrays', () => {
    const self = flatSurface(3, -2, 72);
    const mesh = buildTerrainMesh(3, -2, {
      self,
      east: flatSurface(4, -2, 72),
      south: flatSurface(3, -1, 72),
      southEast: flatSurface(4, -1, 72),
    });
    assert.equal(mesh.chunkX, 3);
    assert.equal(mesh.chunkZ, -2);
    assertMeshInvariants(mesh);
    assert.equal(isEmptyMesh(mesh), false);
    assert.ok(mesh.positions.length > 0);
    assert.ok(mesh.indices.length % 3 === 0);
  });

  it('places vertices in Minecraft block space', () => {
    const mesh = buildTerrainMesh(1, 2, {
      self: flatSurface(1, 2, 70),
      east: flatSurface(2, 2, 70),
      south: flatSurface(1, 3, 70),
      southEast: flatSurface(2, 3, 70),
    });
    assert.equal(heightAt(mesh, 16, 32), 70);
    assert.equal(heightAt(mesh, 31, 47), 70);
    // Shared eastern / southern edge at chunkOrigin + 16.
    assert.equal(heightAt(mesh, 32, 32), 70);
    assert.equal(heightAt(mesh, 16, 48), 70);
  });

  it('uses surfaceBlockColor for vertex colours (no 2D slope shade)', () => {
    const block = 'minecraft:grass_block';
    const expected = surfaceBlockColor(block, 0, null);
    const mesh = buildTerrainMesh(0, 0, {
      self: flatSurface(0, 0, 64, block),
      east: flatSurface(1, 0, 64, block),
      south: flatSurface(0, 1, 64, block),
      southEast: flatSurface(1, 1, 64, block),
    });
    assert.ok(mesh.colors.length >= 3);
    assert.ok(Math.abs(mesh.colors[0]! - expected[0] / 255) < 1e-6);
    assert.ok(Math.abs(mesh.colors[1]! - expected[1] / 255) < 1e-6);
    assert.ok(Math.abs(mesh.colors[2]! - expected[2] / 255) < 1e-6);
  });

  it('produces upward normals for a flat surface', () => {
    const mesh = buildTerrainMesh(0, 0, {
      self: flatSurface(0, 0, 70),
      east: flatSurface(1, 0, 70),
      south: flatSurface(0, 1, 70),
      southEast: flatSurface(1, 1, 70),
    });
    assert.ok(mesh.normals.length >= 3);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      assert.ok(Math.abs(mesh.normals[i]!) < 1e-6, `nx≈0 at vertex ${i / 3}`);
      assert.ok(mesh.normals[i + 1]! > 0.99, `ny≈1 at vertex ${i / 3}`);
      assert.ok(Math.abs(mesh.normals[i + 2]!) < 1e-6, `nz≈0 at vertex ${i / 3}`);
    }
  });

  it('matches neighbour edge heights so adjacent chunks do not crack', () => {
    const west = rampSurface(0, 0);
    const east = rampSurface(1, 0);
    // East neighbour's local x=0 column is height 64; west chunk's edge at
    // world X=16 should use that when sampling the east surface.
    const westMesh = buildTerrainMesh(0, 0, {
      self: west,
      east,
      south: flatSurface(0, 1, 64, 'minecraft:stone'),
      southEast: flatSurface(1, 1, 64, 'minecraft:stone'),
    });
    const eastMesh = buildTerrainMesh(1, 0, {
      self: east,
      east: flatSurface(2, 0, 64, 'minecraft:stone'),
      south: flatSurface(1, 1, 64, 'minecraft:stone'),
      southEast: flatSurface(2, 1, 64, 'minecraft:stone'),
    });

    for (let z = 0; z <= 15; z++) {
      const sharedX = 16;
      const worldZ = z;
      assert.equal(
        heightAt(westMesh, sharedX, worldZ),
        heightAt(eastMesh, sharedX, worldZ),
        `edge height mismatch at z=${worldZ}`,
      );
    }
  });

  it('returns an empty mesh when the chunk has no visible surface', () => {
    const mesh = buildTerrainMesh(9, 9, {
      self: emptySurface(9, 9),
      east: null,
      south: null,
      southEast: null,
    });
    assert.equal(mesh.chunkX, 9);
    assert.equal(mesh.chunkZ, 9);
    assertMeshInvariants(mesh);
    assert.equal(isEmptyMesh(mesh), true);
  });
});

describe('mesh cache', () => {
  it('returns the same object on a hit and counts hits/misses', () => {
    const cache = new MeshCache();
    const mesh = buildTerrainMesh(0, 0, {
      self: flatSurface(0, 0, 64),
      east: flatSurface(1, 0, 64),
      south: flatSurface(0, 1, 64),
      southEast: flatSurface(1, 1, 64),
    });
    assert.equal(cache.get('overworld', 0, 0), undefined);
    cache.set('overworld', 0, 0, mesh);
    assert.equal(cache.get('overworld', 0, 0), mesh);
    assert.equal(cache.stats.misses, 1);
    assert.equal(cache.stats.hits, 1);
  });

  it('invalidateAround drops the chunk and face-adjacent neighbours', () => {
    const cache = new MeshCache();
    const stub = (cx: number, cz: number): MeshChunk => ({
      chunkX: cx,
      chunkZ: cz,
      positions: [],
      normals: [],
      colors: [],
      indices: [],
    });
    // Voxel face culling: self + four orthogonal neighbours.
    cache.set('overworld', 5, 5, stub(5, 5));
    cache.set('overworld', 4, 5, stub(4, 5)); // west
    cache.set('overworld', 6, 5, stub(6, 5)); // east
    cache.set('overworld', 5, 4, stub(5, 4)); // north
    cache.set('overworld', 5, 6, stub(5, 6)); // south
    cache.set('overworld', 4, 4, stub(4, 4)); // diagonal — not needed
    cache.set('overworld', 7, 7, stub(7, 7));

    const removed = cache.invalidateAround('overworld', 5, 5);
    assert.equal(removed, 5);
    assert.equal(cache.get('overworld', 5, 5), undefined);
    assert.equal(cache.get('overworld', 4, 5), undefined);
    assert.equal(cache.get('overworld', 6, 5), undefined);
    assert.equal(cache.get('overworld', 5, 4), undefined);
    assert.equal(cache.get('overworld', 5, 6), undefined);
    assert.ok(cache.get('overworld', 4, 4));
    assert.ok(cache.get('overworld', 7, 7));
  });
});

/**
 * PR28 — constructed model fixture: expectations + mesh smoke + optional
 * LevelDB round-trip of palette states.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildFixtureChunkBlocks,
  buildFixtureNeighborhood,
  fixtureWorldBlockMap,
} from '../server/renderer/3d/fixture/build-fixture-volumes.ts';
import {
  FIXTURE_CHUNK_RANGE,
  modelFixtureCells,
  modelFixtureExpectations,
} from '../server/renderer/3d/fixture/model-fixture-layout.ts';
import {
  assertFixtureExpectations,
  formatModelFixtureReport,
  reportModelFixture,
} from '../server/renderer/3d/fixture/report-model-fixture.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import { buildVoxelMesh } from '../server/renderer/3d/voxel-mesh-builder.ts';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { ChunkTag, chunkKey, subChunkKey } from '../server/world/keys.ts';
import { decodeSubChunk } from '../server/world/subchunk.ts';
import { LevelDB } from '@8crafter/leveldb-zlib';
import { ChunkBlocks } from '../server/renderer/3d/chunk-blocks.ts';
import {
  connectionMaskAtWorld,
  wallShapeAtWorld,
} from '../server/renderer/3d/models/contextual.ts';
import { isWallName } from '../server/renderer/3d/models/families/wall.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';

describe('PR28 model fixture layout', () => {
  it('authors cells across chunk boundaries at x=16 and within chunk range', () => {
    const cells = modelFixtureCells();
    assert.ok(cells.length >= 40);
    const boundary = cells.filter((c) => c.x === 15 || c.x === 16);
    assert.ok(boundary.length >= 4, 'expected chunk-boundary pairs');
    for (const cell of cells) {
      const cx = Math.floor(cell.x / 16);
      const cz = Math.floor(cell.z / 16);
      assert.ok(cx >= FIXTURE_CHUNK_RANGE.minX && cx <= FIXTURE_CHUNK_RANGE.maxX);
      assert.ok(cz >= FIXTURE_CHUNK_RANGE.minZ && cz <= FIXTURE_CHUNK_RANGE.maxZ);
    }
  });

  it('covers every implemented model family in expectations', () => {
    const families = new Set(modelFixtureExpectations().map((e) => e.family));
    for (const need of ['slab', 'stair', 'fence', 'pane', 'door', 'trapdoor', 'wall', 'cross', 'full_cube']) {
      assert.ok(families.has(need), `missing family ${need}`);
    }
  });
});

describe('PR28 model-resolution report', () => {
  it('matches deterministic expectations (masks / post / tall / keys)', () => {
    const lines = reportModelFixture();
    const failures = assertFixtureExpectations(lines);
    assert.deepEqual(failures, [], failures.map((f) => `${f.id}: ${f.message}`).join('\n'));
  });

  it('formats a stable human-readable report', () => {
    const text = formatModelFixtureReport(reportModelFixture());
    assert.match(text, /# Model fixture resolution report/);
    assert.match(text, /fence-boundary-w/);
    assert.match(text, /mask = n0e1s0w0/);
    assert.match(text, /mix-centre/);
  });
});

describe('PR28 fixture mesh smoke', () => {
  it('builds meshes for every fixture chunk without invariant failures', () => {
    resetBlockModelCache();
    let totalFaces = 0;
    for (let cz = FIXTURE_CHUNK_RANGE.minZ; cz <= FIXTURE_CHUNK_RANGE.maxZ; cz++) {
      for (let cx = FIXTURE_CHUNK_RANGE.minX; cx <= FIXTURE_CHUNK_RANGE.maxX; cx++) {
        const neighborhood = buildFixtureNeighborhood(cx, cz);
        assert.ok(neighborhood.self, `missing chunk ${cx},${cz}`);
        const mesh = buildVoxelMesh(cx, cz, neighborhood);
        assertMeshInvariants(mesh);
        totalFaces += mesh.indices.length / 6;
      }
    }
    assert.ok(totalFaces > 100, `expected substantial fixture mesh, got ${totalFaces} faces`);
  });

  it('platform stone is present under structures', () => {
    const map = fixtureWorldBlockMap();
    const cell = modelFixtureCells()[0]!;
    const under = map.get(`${cell.x},64,${cell.z}`);
    assert.equal(under?.name, 'minecraft:stone');
  });
});

describe('PR28 LevelDB fixture world', () => {
  const worldRoot = path.resolve('model-fixture-world');

  it('writes and reloads palette states (including *_bit bytes → bool)', async () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        'scripts/make-model-fixture-world.ts',
      ],
      { cwd: path.resolve('.'), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Wrote model fixture world/);
    assert.ok(fs.existsSync(path.join(worldRoot, 'level.dat')));
    assert.ok(fs.existsSync(path.join(worldRoot, 'db')));

    const db = new LevelDB(path.join(worldRoot, 'db'), { createIfMissing: false });
    await db.open();
    try {
      // Stair upside-down at (2,65,5) — weirdo 0, upside_down_bit true
      const stairCell = modelFixtureCells().find((c) => c.id === 'stair-east-up')!;
      const cx = Math.floor(stairCell.x / 16);
      const cz = Math.floor(stairCell.z / 16);
      const sub = Math.floor(stairCell.y / 16);
      const raw = await db.get(subChunkKey(OVERWORLD, cx, cz, sub));
      assert.ok(raw, 'missing subchunk');
      const decoded = await decodeSubChunk(Buffer.from(raw as Uint8Array), sub);
      const volume = ChunkBlocks.fromSubChunks(cx, cz, [decoded]);
      const lx = ((stairCell.x % 16) + 16) % 16;
      const lz = ((stairCell.z % 16) + 16) % 16;
      const ref = volume.getLocalRef(lx, stairCell.y, lz);
      assert.ok(ref);
      assert.equal(ref.name, 'minecraft:oak_stairs');
      assert.equal(ref.states['upside_down_bit'], true);
      assert.equal(ref.states['weirdo_direction'], 0);

      // Door open bit
      const door = modelFixtureCells().find((c) => c.id === 'door-open-lower')!;
      const dCx = Math.floor(door.x / 16);
      const dCz = Math.floor(door.z / 16);
      const dSub = Math.floor(door.y / 16);
      const dRaw = await db.get(subChunkKey(OVERWORLD, dCx, dCz, dSub));
      const dDecoded = await decodeSubChunk(Buffer.from(dRaw as Uint8Array), dSub);
      const dVol = ChunkBlocks.fromSubChunks(dCx, dCz, [dDecoded]);
      const dRef = dVol.getLocalRef(
        ((door.x % 16) + 16) % 16,
        door.y,
        ((door.z % 16) + 16) % 16,
      );
      assert.ok(dRef);
      assert.equal(dRef.states['open_bit'], true);
      assert.equal(dRef.states['door_hinge_bit'], true);

      // Chunk version keys exist for fixture range
      const ver = await db.get(
        chunkKey(OVERWORLD, FIXTURE_CHUNK_RANGE.minX, FIXTURE_CHUNK_RANGE.minZ, ChunkTag.ChunkVersion),
      );
      assert.ok(ver);
    } finally {
      await db.close();
    }
  });

  it('LevelDB-backed volumes reproduce fence boundary mask', async () => {
    // Reuse world from previous test (same describe, sequential by default in node:test)
    assert.ok(fs.existsSync(path.join(worldRoot, 'db')));
    const db = new LevelDB(path.join(worldRoot, 'db'), { createIfMissing: false });
    await db.open();
    try {
      const loadChunk = async (chunkX: number, chunkZ: number) => {
        const subs = [];
        for (const sub of [4]) {
          try {
            const raw = await db.get(subChunkKey(OVERWORLD, chunkX, chunkZ, sub));
            if (!raw) continue;
            subs.push(await decodeSubChunk(Buffer.from(raw as Uint8Array), sub));
          } catch {
            // missing
          }
        }
        return ChunkBlocks.fromSubChunks(chunkX, chunkZ, subs);
      };

      const self = await loadChunk(0, 0);
      const east = await loadChunk(1, 0);
      const neighborhood = {
        self,
        west: null,
        east,
        north: null,
        south: null,
      };
      const mask = connectionMaskAtWorld(neighborhood, 15, 65, 8, 'minecraft:oak_fence');
      assert.deepEqual(mask, { north: false, east: true, south: false, west: false });

      const wallMask = wallShapeAtWorld(
        { self: await loadChunk(1, 2), west: await loadChunk(0, 2), east: await loadChunk(2, 2), north: await loadChunk(1, 1), south: await loadChunk(1, 3) },
        16,
        65,
        32,
        'minecraft:cobblestone_wall',
      );
      assert.equal(isWallName('minecraft:cobblestone_wall'), true);
      assert.deepEqual(wallMask.mask, { north: true, east: true, south: true, west: false });
      assert.equal(wallMask.post, true);
      assert.equal(wallMask.tall, false);

      resetBlockModelCache();
      const model = resolveBlockModel(
        { name: 'minecraft:cobblestone_wall', states: {} },
        wallMask.mask,
        wallMask,
      )!;
      assert.match(model.key, /^wall:n1e1s1w0:p1:t0:/);
    } finally {
      await db.close();
    }
  });
});

describe('PR28 in-memory volumes', () => {
  it('buildFixtureChunkBlocks returns non-empty palettes for pad chunks', () => {
    const vol = buildFixtureChunkBlocks(0, 0);
    assert.ok(vol.subchunkIndices.length > 0);
    assert.ok(vol.getLocalRef(2, 65, 2)?.name.includes('slab'));
  });
});

/**
 * PR28 — constructed model fixture validation.
 *
 * In-memory report + reciprocal connectivity + behavioral geometry + LevelDB
 * round-trip through `decodeSubChunk`. Does not change model-family code.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  buildFixtureChunkBlocks,
  buildFixtureNeighborhood,
  fixtureWorldBlockMap,
} from '../server/renderer/3d/fixture/build-fixture-volumes.ts';
import {
  FIXTURE_CHUNK_RANGE,
  FIXTURE_Y,
  modelFixtureCells,
  modelFixtureExpectations,
} from '../server/renderer/3d/fixture/model-fixture-layout.ts';
import {
  assertFixtureExpectations,
  assertReciprocalConnectivity,
  formatModelFixtureReport,
  reportModelFixture,
  type ModelFixtureReportLine,
} from '../server/renderer/3d/fixture/report-model-fixture.ts';
import {
  DEFAULT_FIXTURE_WORLD_ROOT,
  writeModelFixtureWorld,
} from '../server/renderer/3d/fixture/write-fixture-world.ts';
import { ChunkBlocks } from '../server/renderer/3d/chunk-blocks.ts';
import { assertMeshInvariants } from '../server/renderer/3d/mesh-types.ts';
import {
  connectionMaskAtWorld,
  isContextualConnectedName,
  wallShapeAtWorld,
} from '../server/renderer/3d/models/contextual.ts';
import { isWallName } from '../server/renderer/3d/models/families/wall.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import { buildVoxelMesh } from '../server/renderer/3d/voxel-mesh-builder.ts';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { ChunkTag, chunkKey, subChunkKey } from '../server/world/keys.ts';
import { decodeSubChunk } from '../server/world/subchunk.ts';
import { LevelDB } from '@8crafter/leveldb-zlib';

function lineById(lines: readonly ModelFixtureReportLine[], id: string): ModelFixtureReportLine {
  const line = lines.find((l) => l.id === id);
  assert.ok(line, `missing report line ${id}`);
  return line;
}

/** Resolve the live BlockModel for a fixture cell (boxes / Y extents). */
function modelForCell(id: string) {
  const cell = modelFixtureCells().find((c) => c.id === id);
  assert.ok(cell, `missing cell ${id}`);
  const chunkX = Math.floor(cell.x / 16);
  const chunkZ = Math.floor(cell.z / 16);
  const neighborhood = buildFixtureNeighborhood(chunkX, chunkZ);
  const ref = { name: cell.block.name, states: { ...(cell.block.states ?? {}) } };
  if (isWallName(ref.name)) {
    const shape = wallShapeAtWorld(neighborhood, cell.x, cell.y, cell.z, ref.name);
    return resolveBlockModel(ref, shape.mask, shape)!;
  }
  if (isContextualConnectedName(ref.name)) {
    const mask = connectionMaskAtWorld(neighborhood, cell.x, cell.y, cell.z, ref.name);
    return resolveBlockModel(ref, mask)!;
  }
  return resolveBlockModel(ref)!;
}

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
    for (const need of [
      'slab',
      'stair',
      'fence',
      'pane',
      'door',
      'trapdoor',
      'wall',
      'cross',
      'full_cube',
      'carpet',
      'pressure_plate',
      'snow_layer',
      'ladder',
      'torch',
      'cactus',
    ]) {
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

  it('asserts reciprocal connectivity on authored links', () => {
    const failures = assertReciprocalConnectivity(reportModelFixture());
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

describe('PR28 behavioral geometry', () => {
  it('isolated fence has fewer boxes than a four-way fence', () => {
    const lines = reportModelFixture();
    const isolated = lineById(lines, 'fence-isolated');
    const plus = lineById(lines, 'fence-plus');
    assert.ok(isolated.boxCount < plus.boxCount);
    assert.equal(isolated.boxCount, 1); // post only
    assert.equal(plus.boxCount, 9); // post + 4× dual rails
  });

  it('isolated pane has fewer boxes than a connected pane pair', () => {
    const lines = reportModelFixture();
    const isolated = lineById(lines, 'pane-isolated');
    const pair = lineById(lines, 'pane-pair-a');
    assert.ok(isolated.boxCount < pair.boxCount);
  });

  it('bottom and top slabs occupy different Y halves', () => {
    resetBlockModelCache();
    const bottom = modelForCell('slab-bottom');
    const top = modelForCell('slab-top');
    const b = bottom.renderBoxes[0]!;
    const t = top.renderBoxes[0]!;
    assert.equal(b.min[1], 0);
    assert.equal(b.max[1], 0.5);
    assert.equal(t.min[1], 0.5);
    assert.equal(t.max[1], 1);
  });

  it('upside-down stair has its full-width slab in the upper half', () => {
    resetBlockModelCache();
    const bottom = modelForCell('stair-east');
    const upside = modelForCell('stair-east-up');
    const lowerSlab = bottom.renderBoxes.find(
      (b) => b.min[0] === 0 && b.max[0] === 1 && b.min[1] === 0 && b.max[1] === 0.5,
    );
    const upperSlab = upside.renderBoxes.find(
      (b) => b.min[0] === 0 && b.max[0] === 1 && b.min[1] === 0.5 && b.max[1] === 1,
    );
    assert.ok(lowerSlab, 'bottom stair should have full-width lower slab');
    assert.ok(upperSlab, 'upside-down stair should have full-width upper slab');
    assert.match(upside.key, /:top:/);
  });

  it('tall wall arms reach y=1 while short wall arms stop below', () => {
    resetBlockModelCache();
    const tall = modelForCell('wall-tall');
    const straight = modelForCell('wall-straight-b');
    const tallMaxY = Math.max(...tall.renderBoxes.map((b) => b.max[1]));
    const shortArmMax = Math.max(...straight.renderBoxes.map((b) => b.max[1]));
    assert.equal(tallMaxY, 1);
    assert.equal(shortArmMax, 14 / 16);
  });

  it('cross plants are thin planes, not a full cube', () => {
    const lines = reportModelFixture();
    const cross = lineById(lines, 'cross-grass');
    assert.equal(cross.isFullCube, false);
    assert.equal(cross.boxCount, 2);
    resetBlockModelCache();
    const model = modelForCell('cross-grass');
    for (const box of model.renderBoxes) {
      const dx = box.max[0] - box.min[0];
      const dz = box.max[2] - box.min[2];
      assert.ok(dx < 1 && dz < 1, 'cross plane must be thinner than a unit cube in X or Z');
      assert.ok(dx * dz < 0.1, 'cross footprint must not fill the cell');
    }
  });

  it('intentional asymmetries stay asymmetric (wall↛fence, pane↛fence)', () => {
    const lines = reportModelFixture();
    const wallNoFence = lineById(lines, 'wall-no-fence');
    assert.deepEqual(wallNoFence.maskFlags, {
      north: false,
      east: false,
      south: false,
      west: false,
    });
    const paneNoFence = lineById(lines, 'pane-no-fence');
    assert.deepEqual(paneNoFence.maskFlags, {
      north: false,
      east: false,
      south: false,
      west: false,
    });
    // mix-centre: wall attaches N/E/S but not west fence
    const mix = lineById(lines, 'mix-centre');
    assert.equal(mix.maskFlags?.west, false);
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
  const worldRoot = DEFAULT_FIXTURE_WORLD_ROOT;
  let db: LevelDB;

  before(async () => {
    const result = await writeModelFixtureWorld(worldRoot);
    assert.ok(result.chunks > 0);
    assert.ok(fs.existsSync(path.join(worldRoot, 'level.dat')));
    db = new LevelDB(path.join(worldRoot, 'db'), { createIfMissing: false });
    await db.open();
  });

  after(async () => {
    await db?.close();
  });

  async function loadChunk(chunkX: number, chunkZ: number): Promise<ChunkBlocks> {
    const subs = [];
    for (const sub of [Math.floor(FIXTURE_Y / 16)]) {
      try {
        const raw = await db.get(subChunkKey(OVERWORLD, chunkX, chunkZ, sub));
        if (!raw) continue;
        subs.push(await decodeSubChunk(Buffer.from(raw as Uint8Array), sub));
      } catch {
        // missing subchunk
      }
    }
    return ChunkBlocks.fromSubChunks(chunkX, chunkZ, subs);
  }

  it('reloads palette states (including *_bit bytes → bool)', async () => {
    const stairCell = modelFixtureCells().find((c) => c.id === 'stair-east-up')!;
    const cx = Math.floor(stairCell.x / 16);
    const cz = Math.floor(stairCell.z / 16);
    const volume = await loadChunk(cx, cz);
    const lx = ((stairCell.x % 16) + 16) % 16;
    const lz = ((stairCell.z % 16) + 16) % 16;
    const ref = volume.getLocalRef(lx, stairCell.y, lz);
    assert.ok(ref);
    assert.equal(ref.name, 'minecraft:oak_stairs');
    assert.equal(ref.states['upside_down_bit'], true);
    assert.equal(ref.states['weirdo_direction'], 0);

    const door = modelFixtureCells().find((c) => c.id === 'door-open-lower')!;
    const dVol = await loadChunk(Math.floor(door.x / 16), Math.floor(door.z / 16));
    const dRef = dVol.getLocalRef(
      ((door.x % 16) + 16) % 16,
      door.y,
      ((door.z % 16) + 16) % 16,
    );
    assert.ok(dRef);
    assert.equal(dRef.states['open_bit'], true);
    assert.equal(dRef.states['door_hinge_bit'], true);

    const ver = await db.get(
      chunkKey(OVERWORLD, FIXTURE_CHUNK_RANGE.minX, FIXTURE_CHUNK_RANGE.minZ, ChunkTag.ChunkVersion),
    );
    assert.ok(ver);
  });

  it('loads fence chunk-boundary pair independently and sees reciprocal masks', async () => {
    const westVol = await loadChunk(0, 0);
    const eastVol = await loadChunk(1, 0);
    const neighborhood = {
      self: westVol,
      west: null,
      east: eastVol,
      north: null,
      south: null,
    };
    const maskW = connectionMaskAtWorld(neighborhood, 15, FIXTURE_Y, 8, 'minecraft:oak_fence');
    assert.deepEqual(maskW, { north: false, east: true, south: false, west: false });

    const neighborhoodE = {
      self: eastVol,
      west: westVol,
      east: null,
      north: null,
      south: null,
    };
    const maskE = connectionMaskAtWorld(neighborhoodE, 16, FIXTURE_Y, 8, 'minecraft:oak_fence');
    assert.deepEqual(maskE, { north: false, east: false, south: false, west: true });
  });

  it('LevelDB-backed volumes reproduce mixed wall neighbourhood', async () => {
    const wallMask = wallShapeAtWorld(
      {
        self: await loadChunk(1, 2),
        west: await loadChunk(0, 2),
        east: await loadChunk(2, 2),
        north: await loadChunk(1, 1),
        south: await loadChunk(1, 3),
      },
      16,
      FIXTURE_Y,
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
  });
});

describe('PR28 in-memory volumes', () => {
  it('buildFixtureChunkBlocks returns non-empty palettes for pad chunks', () => {
    const vol = buildFixtureChunkBlocks(0, 0);
    assert.ok(vol.subchunkIndices.length > 0);
    assert.ok(vol.getLocalRef(2, 65, 2)?.name.includes('slab'));
  });
});

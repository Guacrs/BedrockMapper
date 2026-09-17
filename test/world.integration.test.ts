/**
 * Integration tests against a real Bedrock Dedicated Server world.
 *
 * Point TEST_WORLD_PATH (or WORLD_PATH) at a BDS world directory to run them:
 *
 *   TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
 *
 * Without it the suite is skipped rather than falling back to mock data.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { OVERWORLD, maxSubChunkIndex, minSubChunkIndex } from '../server/world/dimensions.ts';
import { BLOCKS_PER_SUBCHUNK, columnIndex } from '../server/world/keys.ts';
import { snapshotWorld } from '../server/world/snapshot.ts';
import { NO_SURFACE, readChunkSurface } from '../server/world/surface.ts';
import { BedrockWorld, type ChunkSummary } from '../server/world/world.ts';

const worldPath = process.env.TEST_WORLD_PATH ?? process.env.WORLD_PATH;

/** Hashes the world's LevelDB directory listing plus file contents. */
async function hashDb(dbPath: string): Promise<string> {
  const hash = createHash('sha256');
  for (const name of (await fs.readdir(dbPath)).sort()) {
    hash.update(name);
    hash.update(await fs.readFile(path.join(dbPath, name)));
  }
  return hash.digest('hex');
}

describe('real Bedrock world', { skip: worldPath ? false : 'set TEST_WORLD_PATH to a BDS world' }, () => {
  let world: BedrockWorld;
  let cacheDir: string;
  let chunks: ChunkSummary[];

  before(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-test-'));
    world = await BedrockWorld.open({ worldPath: worldPath!, cacheDir });
    chunks = await world.listChunks(OVERWORLD);
  });

  after(async () => {
    await world?.close();
    if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('opens the world and reads level.dat', () => {
    assert.ok(world.levelInfo.name.length > 0, 'world should have a name');
    assert.match(
      world.levelInfo.lastOpenedWithVersion ?? '',
      /^\d+\.\d+\.\d+/,
      'level.dat should report the version it was last opened with',
    );
    assert.ok((world.levelInfo.storageVersion ?? 0) >= 8, 'expected a modern storage version');
  });

  it('copies the database instead of opening the live world', async () => {
    assert.notEqual(path.resolve(world.snapshot.dbPath), path.resolve(worldPath!, 'db'));
    assert.ok(world.snapshot.fileCount > 0);
  });

  it('leaves the source world untouched while reading', async () => {
    const sourceDb = path.join(worldPath!, 'db');
    const before = await hashDb(sourceDb);
    const sample = chunks.slice(0, 5);
    for (const chunk of sample) {
      await readChunkSurface(world, OVERWORLD, chunk.x, chunk.z);
    }
    assert.equal(await hashDb(sourceDb), before, 'reading must not modify the BDS world');
  });

  it('lists stored chunks with plausible metadata', () => {
    assert.ok(chunks.length > 0, 'world should contain at least one chunk');
    for (const chunk of chunks) {
      assert.ok(Number.isInteger(chunk.x) && Number.isInteger(chunk.z));
      for (const index of chunk.subChunkIndices) {
        assert.ok(
          index >= minSubChunkIndex(OVERWORLD) && index <= maxSubChunkIndex(OVERWORLD),
          `subchunk index ${index} outside the Overworld height range`,
        );
      }
    }
    assert.ok(
      chunks.some((chunk) => chunk.subChunkIndices.length > 0),
      'at least one chunk should have block data',
    );
  });

  it('decodes subchunk block data in a modern palette format', async () => {
    const chunk = chunks.find((candidate) => candidate.subChunkIndices.length > 0)!;
    const { subChunks } = await world.readChunkSubChunks(OVERWORLD, chunk.x, chunk.z);
    assert.ok(subChunks.length > 0);

    for (const subChunk of subChunks) {
      assert.ok(subChunk.version >= 1, `unexpected SubChunkPrefix version ${subChunk.version}`);
      assert.ok(chunk.subChunkIndices.includes(subChunk.index));
      assert.ok(subChunk.layers.length >= 1);
      for (const layer of subChunk.layers) {
        assert.equal(layer.indices.length, BLOCKS_PER_SUBCHUNK);
        assert.ok(layer.palette.length > 0);
        for (const state of layer.palette) {
          assert.match(state.name, /^[a-z0-9_]+:[a-z0-9_]+$/, `odd block name ${state.name}`);
        }
        for (let i = 0; i < BLOCKS_PER_SUBCHUNK; i++) {
          const index = layer.indices[i]!;
          assert.ok(index >= 0 && index < layer.palette.length, `palette index ${index} out of range`);
        }
      }
    }
  });

  it('returns subchunks ordered from the top of the world down', async () => {
    const chunk = chunks.find((candidate) => candidate.subChunkIndices.length > 1)!;
    const { subChunks } = await world.readChunkSubChunks(OVERWORLD, chunk.x, chunk.z);
    const indices = subChunks.map((subChunk) => subChunk.index);
    assert.deepEqual(indices, [...indices].sort((a, b) => b - a));
  });

  it('finds the highest visible block of every column', async () => {
    const chunk = chunks.find((candidate) => candidate.subChunkIndices.length > 4)!;
    const surface = (await readChunkSurface(world, OVERWORLD, chunk.x, chunk.z))!;
    assert.equal(surface.resolvedColumns, 256, 'a generated chunk should have a full surface');

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const column = columnIndex(x, z);
        const y = surface.heights[column]!;
        assert.notEqual(y, NO_SURFACE);
        assert.ok(y >= OVERWORLD.minY && y <= OVERWORLD.maxY, `surface Y ${y} outside world height`);
        assert.match(surface.blocks[column]!, /^minecraft:/);
      }
    }
  });

  it('returns null for a chunk that is not stored', async () => {
    const faraway = 1_000_000;
    assert.equal(await world.hasChunk(OVERWORLD, faraway, faraway), false);
    assert.equal(await readChunkSurface(world, OVERWORLD, faraway, faraway), null);
  });

  it('reuses the snapshot while the source world is unchanged', async () => {
    const again = await snapshotWorld(worldPath!, cacheDir);
    assert.equal(again.copied, false, 'unchanged world should not be copied again');
    assert.equal(again.dbPath, world.snapshot.dbPath);
    assert.equal(again.fileCount, world.snapshot.fileCount);
  });
});

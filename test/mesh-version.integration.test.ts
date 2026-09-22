/**
 * meshVersion bumps on any chunk digest change — including underground edits
 * that leave the 2D top-down tile unchanged.
 *
 * Uses the synthetic demo world so this always runs (no TEST_WORLD_PATH).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MapService } from '../server/map-service.ts';
import { copyWorld, WorldWriter } from './live-world.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoSource = path.join(repoRoot, 'demo-world');

async function ensureDemoWorld(): Promise<void> {
  try {
    await fs.access(path.join(demoSource, 'db'));
  } catch {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', 'scripts/make-demo-world.ts'],
        { cwd: repoRoot, stdio: 'inherit' },
      );
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`demo world exit ${code}`))));
      child.on('error', reject);
    });
  }
}

describe('demo-world meshVersion live refresh', () => {
  let worldPath: string;
  let cacheDir: string;
  let temp: string;
  let map: MapService;

  before(async () => {
    await ensureDemoWorld();
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-mesh-version-'));
    worldPath = path.join(temp, 'world');
    cacheDir = path.join(temp, 'cache');
    await copyWorld(demoSource, worldPath);
    map = await MapService.create({ worldPath, cacheDir });
  });

  after(async () => {
    await map?.close();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });

  it('bumps meshVersion when a visible chunk changes and invalidates its mesh', async () => {
    const chunk = { x: 1, z: 1 };
    assert.ok(map.hasChunkData(chunk.x, chunk.z));

    const beforeMesh = await map.mesh('overworld', chunk.x, chunk.z);
    assert.ok(beforeMesh?.positions.length);

    const versionBefore = map.version;
    const meshVersionBefore = map.meshVersion;

    const writer = await WorldWriter.open(worldPath);
    try {
      const removed = await writer.removeTopSubChunk(chunk);
      assert.notEqual(removed, null);
    } finally {
      await writer.close();
    }

    const stats = await map.refresh();
    assert.equal(stats.error, null);
    assert.equal(stats.changedChunks, 1);
    assert.equal(map.meshVersion, meshVersionBefore + 1);
    assert.equal(stats.meshVersion, map.meshVersion);
    // Top-subchunk removal usually changes the 2D tile too; either way meshVersion moved.
    assert.ok(map.version >= versionBefore);

    const afterMesh = await map.mesh('overworld', chunk.x, chunk.z);
    assert.ok(afterMesh);
    assert.notEqual(
      afterMesh!.positions.length,
      beforeMesh!.positions.length,
      'visible mesh geometry should change after the top subchunk is removed',
    );
  });

  it('bumps meshVersion for an underground edit even when 2D version stays put', async () => {
    // Prefer a chunk whose bottom subchunk is below the surface column of the demo world.
    const chunk = { x: 2, z: 2 };
    assert.ok(map.hasChunkData(chunk.x, chunk.z));

    const beforeMesh = await map.mesh('overworld', chunk.x, chunk.z);
    assert.ok(beforeMesh);

    const versionBefore = map.version;
    const meshVersionBefore = map.meshVersion;

    const writer = await WorldWriter.open(worldPath);
    try {
      const removed = await writer.removeBottomSubChunk(chunk);
      assert.notEqual(removed, null);
    } finally {
      await writer.close();
    }

    const stats = await map.refresh();
    assert.equal(stats.error, null);
    assert.equal(stats.changedChunks, 1);
    assert.equal(map.meshVersion, meshVersionBefore + 1, '3D must refresh on any digest change');
    assert.equal(stats.meshVersion, map.meshVersion);

    // Demo columns often keep the same top-down appearance after deleting the
    // lowest subchunk; when they do, version must stay while meshVersion moves.
    if (stats.tilesChanged === 0) {
      assert.equal(map.version, versionBefore);
    }

    // Cache was invalidated around the chunk — a fresh build is served.
    const afterMesh = await map.mesh('overworld', chunk.x, chunk.z);
    assert.ok(afterMesh);
  });
});

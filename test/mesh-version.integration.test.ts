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
import { chunkToTile } from '../server/tiles/coords.ts';
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

async function openDemoMap(): Promise<{ map: MapService; worldPath: string; temp: string }> {
  await ensureDemoWorld();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-mesh-version-'));
  const worldPath = path.join(temp, 'world');
  const cacheDir = path.join(temp, 'cache');
  await copyWorld(demoSource, worldPath);
  const map = await MapService.create({ worldPath, cacheDir });
  return { map, worldPath, temp };
}

describe('demo-world meshVersion live refresh', () => {
  it('bumps meshVersion when a visible chunk changes and invalidates its mesh', async () => {
    const { map, worldPath, temp } = await openDemoMap();
    try {
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
      assert.ok(map.version >= versionBefore);

      const afterMesh = await map.mesh('overworld', chunk.x, chunk.z);
      assert.ok(afterMesh);
      assert.notEqual(
        afterMesh!.positions.length,
        beforeMesh!.positions.length,
        'visible mesh geometry should change after the top subchunk is removed',
      );
    } finally {
      await map.close();
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  it('bumps meshVersion for an underground edit even when 2D version stays put', async () => {
    const { map, worldPath, temp } = await openDemoMap();
    try {
      // Inland hill chunk: lowest subchunk is below the surface column, so the
      // top-down tile is byte-identical after removal (verified on this demo world).
      const chunk = { x: 5, z: 5 };
      assert.ok(map.hasChunkData(chunk.x, chunk.z));

      const tile = chunkToTile(chunk.x, chunk.z);
      await map.tile('overworld', 0, tile.x, tile.y);

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
      assert.equal(stats.tilesChanged, 0, 'underground edit must not change the top-down tile');
      assert.equal(map.version, versionBefore, '2D version stays put when tiles are identical');
      assert.equal(map.info.meshVersion, map.meshVersion);

      const afterMesh = await map.mesh('overworld', chunk.x, chunk.z);
      assert.ok(afterMesh);
    } finally {
      await map.close();
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});

/**
 * Production startup against a real world: health, graceful shutdown, cache
 * leftovers and the npm run start entry point.
 *
 *   TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../server/index.ts';
import { silentLogger } from '../server/log.ts';
import { snapshotRootFor } from '../server/world/snapshot.ts';
import { copyWorld } from './live-world.ts';

const sourceWorld = process.env.TEST_WORLD_PATH ?? process.env.WORLD_PATH;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe(
  'production startup against a real world',
  { skip: sourceWorld ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let temp: string;
    let worldPath: string;
    let cacheDir: string;
    let started: Awaited<ReturnType<typeof main>>;
    let base: string;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-prod-'));
      worldPath = path.join(temp, 'world');
      cacheDir = path.join(temp, 'cache');
      await copyWorld(sourceWorld!, worldPath);
      started = await main({
        env: {
          WORLD_PATH: worldPath,
          MAP_CACHE: cacheDir,
          HOST: '127.0.0.1',
          PORT: '0',
          WORLD_REFRESH_INTERVAL: '0',
          PLAYER_UPDATE_INTERVAL: '3000',
          PLAYER_DATA_TIMEOUT: '10000',
          API_KEY: 'production-test-key',
          LOG_LEVEL: 'error',
        },
        log: silentLogger,
      });
      base = `http://127.0.0.1:${started.port}`;
    });

    after(async () => {
      await started?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    it('serves the production web map without a development server', async () => {
      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /id="map"/);
      assert.match(html, /id="terrain-status"/);
      for (const asset of ['/map.js', '/status.js', '/style.css', '/vendor/leaflet/leaflet.js']) {
        assert.equal((await fetch(`${base}${asset}`)).status, 200, asset);
      }
    });

    it('reports health without secrets or paths', async () => {
      const body = (await fetch(`${base}/api/health`).then((response) => response.json())) as {
        status: string;
        world: string;
        worldVersion: string | null;
        mapVersion: number;
        lastWorldRefresh: string | null;
        playerDataAge: number | null;
      };
      assert.equal(body.status, 'ok');
      assert.ok(body.world);
      assert.match(body.worldVersion ?? '', /^\d+\.\d+/);
      assert.equal(body.mapVersion, 1);
      const dumped = JSON.stringify(body);
      assert.doesNotMatch(dumped, /production-test-key|MAP_CACHE|WORLD_PATH|cacheDir/);
    });

    it('leaves the last good map in place when a later snapshot would fail', async () => {
      const before = await started.map.tile('overworld', 0, 0, 0);
      assert.ok(before.bytes.length > 0);
      const version = started.map.version;
      const sourceId = started.map.world.snapshot.sourceId;

      const db = path.join(worldPath, 'db');
      const hidden = `${db}.hidden-for-test`;
      await fs.rename(db, hidden);
      try {
        const stats = await started.map.refresh();
        assert.ok(stats.error);
        assert.match(stats.error, /could not read the world directory|snapshot failed/);
        assert.equal(started.map.version, version);
        assert.equal(started.map.world.snapshot.sourceId, sourceId);
        assert.equal(started.map.consecutiveRefreshFailures, 1);

        const health = (await fetch(`${base}/api/health`).then((response) => response.json())) as {
          status: string;
          mapVersion: number;
        };
        assert.equal(health.status, 'degraded');
        assert.equal(health.mapVersion, version);

        const state = (await fetch(`${base}/api/map/state`).then((response) => response.json())) as {
          refreshError: string | null;
          consecutiveRefreshFailures: number;
        };
        assert.ok(state.refreshError);
        assert.equal(state.consecutiveRefreshFailures, 1);

        const after = await started.map.tile('overworld', 0, 0, 0);
        assert.deepEqual([...after.bytes], [...before.bytes]);
      } finally {
        await fs.rename(hidden, db);
      }
    });
  },
);

describe(
  'graceful shutdown of npm run start',
  { skip: sourceWorld ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    it('stops on SIGTERM, keeps the current snapshot and leaves no temp files', async () => {
      const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-sigterm-'));
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            WORLD_PATH: sourceWorld,
            MAP_CACHE: cacheDir,
            HOST: '127.0.0.1',
            PORT: '0',
            WORLD_REFRESH_INTERVAL: '0',
            API_KEY: 'sigterm-test-key',
            LOG_LEVEL: 'info',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      try {
        const url = await waitForUrl(() => stdout, 60_000, child);
        const health = await fetch(`${url}/api/health`).then((response) => response.json());
        assert.equal((health as { status: string }).status, 'ok');

        child.kill('SIGTERM');
        const code = await waitForExit(child, 15_000);
        assert.equal(code, 0, `stderr=${stderr}\nstdout=${stdout}`);
        assert.match(stdout, /shutdown/);

        const leftovers = await findTempFiles(cacheDir);
        assert.deepEqual(leftovers, []);
        const snapshots = await fs.readdir(snapshotRootFor(sourceWorld!, cacheDir)).catch(() => []);
        assert.ok(snapshots.length >= 1, 'the current snapshot should survive shutdown');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    });
  },
);

function waitForUrl(
  read: () => string,
  timeoutMs: number,
  child: ReturnType<typeof spawn>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const match = /Bedrock map server on (http:\/\/\S+)/.exec(read());
      if (match) {
        clearInterval(timer);
        resolve(match[1]!);
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited before listening: code=${child.exitCode} signal=${child.signalCode} output=${read()}`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`server did not start: ${read()}`));
      }
    }, 100);
  });
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process did not exit')), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function findTempFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await findTempFiles(target)));
    else if (/\.tmp$|^\.write-probe-/.test(entry.name)) found.push(target);
  }
  return found;
}

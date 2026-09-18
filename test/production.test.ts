import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanCache, cleanupHappened } from '../server/cache.ts';
import {
  ConfigError,
  configWarnings,
  DEFAULTS,
  describeConfig,
  loadConfig,
} from '../server/config.ts';
import { listenUrl } from '../server/index.ts';
import { createLogger, formatLine } from '../server/log.ts';
import { PlayerActivity } from '../server/players/activity.ts';
import { checkCache, checkEnvironment, checkWorld, formatProblems } from '../server/startup.ts';
import { snapshotRootFor } from '../server/world/snapshot.ts';
import { ageOf, formatAge, terrainStatus, trackingStatus } from '../web/status.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { WORLD_PATH: '/tmp/bedrock-world', ...extra };
}

describe('configuration validation', () => {
  it('loads the documented defaults', () => {
    const config = loadConfig({}, env());
    assert.equal(config.host, DEFAULTS.host);
    assert.equal(config.port, DEFAULTS.port);
    assert.equal(config.worldRefreshInterval, DEFAULTS.worldRefreshInterval);
    assert.equal(config.playerUpdateInterval, DEFAULTS.playerUpdateInterval);
    assert.equal(config.playerDataTimeout, DEFAULTS.playerDataTimeout);
    assert.equal(config.logLevel, DEFAULTS.logLevel);
    assert.equal(config.apiKey, '');
    assert.equal(config.worldPath, path.resolve('/tmp/bedrock-world'));
  });

  it('rejects a missing WORLD_PATH with a sentence that says what to do', () => {
    try {
      loadConfig({}, {});
      assert.fail('expected ConfigError');
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.match(error.problems[0]!, /WORLD_PATH is not set/);
      assert.match(error.problems[0]!, /Copy \.env\.example/);
    }
  });

  it('rejects values that are set but unusable, all at once', () => {
    try {
      loadConfig(
        {},
        env({
          PORT: 'abc',
          WORLD_REFRESH_INTERVAL: '-5',
          PLAYER_UPDATE_INTERVAL: '10',
          PLAYER_DATA_TIMEOUT: 'nope',
          LOG_LEVEL: 'verbose',
          HOST: '   ',
        }),
      );
      assert.fail('expected ConfigError');
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      const text = error.problems.join('\n');
      assert.match(text, /PORT/);
      assert.match(text, /WORLD_REFRESH_INTERVAL/);
      assert.match(text, /PLAYER_UPDATE_INTERVAL/);
      assert.match(text, /PLAYER_DATA_TIMEOUT/);
      assert.match(text, /LOG_LEVEL/);
      assert.match(text, /HOST/);
    }
  });

  it('allows PORT=0 and WORLD_REFRESH_INTERVAL=0', () => {
    const config = loadConfig({}, env({ PORT: '0', WORLD_REFRESH_INTERVAL: '0' }));
    assert.equal(config.port, 0);
    assert.equal(config.worldRefreshInterval, 0);
  });

  it('does not silently fall back when a number is out of range', () => {
    assert.throws(() => loadConfig({}, env({ PORT: '70000' })), ConfigError);
    assert.throws(() => loadConfig({}, env({ WORLD_REFRESH_INTERVAL: '500' })), ConfigError);
  });

  it('warns about a public bind, a missing key and a disabled refresh', () => {
    const config = loadConfig({}, env({ HOST: '0.0.0.0', WORLD_REFRESH_INTERVAL: '0', API_KEY: '' }));
    const warnings = configWarnings(config).join('\n');
    assert.match(warnings, /every interface/);
    assert.match(warnings, /no authentication/);
    assert.match(warnings, /API_KEY is not set/);
    assert.match(warnings, /never refreshed/);
  });

  it('warns when the API key is still the example value', () => {
    const config = loadConfig({}, env({ API_KEY: 'change-this' }));
    assert.match(configWarnings(config).join('\n'), /example value/);
  });

  it('never puts the API key into the startup summary', () => {
    const config = loadConfig({}, env({ API_KEY: 'super-secret-value' }));
    const summary = describeConfig(config);
    assert.equal(summary.apiKey, 'set');
    assert.equal(JSON.stringify(summary).includes('super-secret-value'), false);
  });
});

describe('world and cache startup checks', () => {
  it('rejects a WORLD_PATH that does not exist', async () => {
    const report = await checkWorld(path.join(os.tmpdir(), 'no-such-bedrock-world'));
    assert.match(report.problems.join('\n'), /does not exist/);
  });

  it('rejects a WORLD_PATH that points at the db folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-dbpath-'));
    try {
      await fs.writeFile(path.join(root, 'CURRENT'), 'MANIFEST-000001\n');
      const report = await checkWorld(root);
      assert.match(report.problems.join('\n'), /LevelDB directory/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a world directory with no db/', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-noworld-'));
    try {
      const report = await checkWorld(root);
      assert.match(report.problems.join('\n'), /No db\/ directory/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a directory that looks like a Bedrock world', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-world-'));
    try {
      await fs.mkdir(path.join(root, 'db'));
      await fs.writeFile(path.join(root, 'db', 'CURRENT'), 'MANIFEST-000001\n');
      await fs.writeFile(path.join(root, 'db', '000001.log'), 'x');
      const report = await checkWorld(root);
      assert.deepEqual(report.problems, []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a cache directory inside the world', async () => {
    const world = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-inside-'));
    try {
      await fs.mkdir(path.join(world, 'db'));
      await fs.writeFile(path.join(world, 'db', 'CURRENT'), 'MANIFEST-000001\n');
      await fs.writeFile(path.join(world, 'db', '000001.log'), 'x');
      const report = await checkCache(path.join(world, 'cache'), world);
      assert.match(report.problems.join('\n'), /inside WORLD_PATH/);
    } finally {
      await fs.rm(world, { recursive: true, force: true });
    }
  });

  it('collects every problem before giving up', async () => {
    const report = await checkEnvironment({
      worldPath: path.join(os.tmpdir(), 'missing-world'),
      host: '127.0.0.1',
      port: 3000,
      cacheDir: path.join(os.tmpdir(), 'missing-world', 'cache'),
      worldRefreshInterval: 30000,
      playerUpdateInterval: 3000,
      playerDataTimeout: 10000,
      apiKey: '',
      logLevel: 'info',
    });
    assert.ok(report.problems.length >= 1);
    assert.match(formatProblems(report.problems), /cannot start/);
    assert.match(formatProblems(report.problems), /\.env\.example/);
  });
});

describe('cache cleanup', () => {
  it('deletes abandoned snapshots and temp files, not the current tiles', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-cleanup-'));
    const worldPath = path.join(temp, 'world');
    const cacheDir = path.join(temp, 'cache');
    try {
      const root = snapshotRootFor(worldPath, cacheDir);
      await fs.mkdir(path.join(root, 'keep-me', 'db'), { recursive: true });
      await fs.writeFile(path.join(root, 'keep-me', 'source-fingerprint.json'), '{}');
      await fs.mkdir(path.join(root, 'stale', 'db'), { recursive: true });
      await fs.writeFile(path.join(root, 'stale', 'junk'), 'old');
      await fs.mkdir(path.join(cacheDir, 'tiles', 'overworld', '0', '0'), { recursive: true });
      const tile = path.join(cacheDir, 'tiles', 'overworld', '0', '0', '1.png');
      await fs.writeFile(tile, 'png');
      await fs.writeFile(`${tile}.9.tmp`, 'half');
      await fs.writeFile(path.join(cacheDir, '.write-probe-9'), 'x');

      const result = await cleanCache(cacheDir, {
        worldPath,
        keepSourceIds: ['keep-me'],
        tempGraceMs: 0,
      });
      assert.deepEqual(result.snapshotsRemoved, ['stale']);
      assert.equal(result.tempFilesRemoved, 2);
      assert.ok(cleanupHappened(result));
      assert.equal(await fs.readFile(tile, 'utf8'), 'png');
      assert.ok(await fs.stat(path.join(root, 'keep-me')).then(() => true));
      await assert.rejects(() => fs.stat(path.join(root, 'stale')));
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  it('leaves a snapshot that was just created alone when a grace period is set', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-grace-'));
    const worldPath = path.join(temp, 'world');
    const cacheDir = path.join(temp, 'cache');
    try {
      const root = snapshotRootFor(worldPath, cacheDir);
      await fs.mkdir(path.join(root, 'in-flight'), { recursive: true });
      const result = await cleanCache(cacheDir, {
        worldPath,
        keepSourceIds: [],
        tempGraceMs: 60_000,
      });
      assert.deepEqual(result.snapshotsRemoved, []);
      assert.ok(await fs.stat(path.join(root, 'in-flight')));
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});

describe('structured logging', () => {
  it('formats a single scannable line', () => {
    const line = formatLine('info', 'terrain.updated', { chunks: 3, version: 2, note: 'hello world' });
    assert.match(line, /info\s+terrain\.updated/);
    assert.match(line, /chunks=3/);
    assert.match(line, /version=2/);
    assert.match(line, /note="hello world"/);
  });

  it('honours the log level and does not print debug at info', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', write: (_level, line) => lines.push(line) });
    log.debug('players.moved', { name: 'Alex' });
    log.info('players.online', { count: 1 });
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /players\.online/);
  });
});

describe('player activity logging', () => {
  it('logs start, join, leave, stale and resume, not every movement', () => {
    const activity = new PlayerActivity(1000);
    const alex = { name: 'Alex', x: 1, y: 64, z: 1, dimension: 'overworld' };
    const steve = { name: 'Steve', x: 2, y: 64, z: 2, dimension: 'overworld' };

    assert.deepEqual(activity.record([alex], 0), [{ kind: 'started', online: 1, names: ['Alex'] }]);
    assert.deepEqual(activity.record([{ ...alex, x: 8 }], 100), []);
    assert.deepEqual(activity.record([alex, steve], 200), [
      { kind: 'changed', joined: ['Steve'], left: [], online: 2 },
    ]);
    assert.deepEqual(activity.poll(1500), [
      { kind: 'stale', ageMs: 1300, lastUpdate: new Date(200).toISOString() },
    ]);
    assert.deepEqual(activity.poll(2000), []);
    assert.deepEqual(activity.record([steve], 2500), [{ kind: 'resumed', online: 1, downMs: 2300 }]);
  });
});

describe('map status indicator', () => {
  const now = Date.parse('2026-09-18T00:00:12.000Z');

  it('formats ages in seconds, minutes and hours', () => {
    assert.equal(formatAge(0), '0s ago');
    assert.equal(formatAge(12_000), '12s ago');
    assert.equal(formatAge(120_000), '2m ago');
    assert.equal(formatAge(7_200_000), '2h ago');
    assert.equal(ageOf('2026-09-18T00:00:00.000Z', now), '12s ago');
  });

  it('reports current, failed and unreachable terrain', () => {
    assert.deepEqual(terrainStatus(null, {}, now), { text: 'Terrain: current', kind: 'ok' });
    assert.deepEqual(
      terrainStatus({ lastWorldRefresh: '2026-09-18T00:00:00.000Z' }, {}, now),
      { text: 'Terrain: updated 12s ago', kind: 'ok' },
    );
    assert.equal(
      terrainStatus({ refreshError: 'could not read the world directory', consecutiveRefreshFailures: 2 }, {}, now)
        .kind,
      'error',
    );
    assert.match(
      terrainStatus({ refreshError: 'boom', terrainUpdatedAt: '2026-09-18T00:00:00.000Z' }, {}, now).text,
      /refresh failed/,
    );
    assert.deepEqual(terrainStatus(null, { unreachable: true }, now), {
      text: 'Terrain: map server unreachable',
      kind: 'error',
    });
  });

  it('reports waiting, live and stale player tracking', () => {
    assert.deepEqual(trackingStatus(null), { text: 'Players: waiting', kind: 'warn' });
    assert.deepEqual(trackingStatus({ stale: false, updatedAt: '2026-09-18T00:00:00.000Z', players: [] }), {
      text: 'Players: live',
      kind: 'ok',
    });
    assert.deepEqual(trackingStatus({ stale: true, updatedAt: '2026-09-18T00:00:00.000Z', players: [] }), {
      text: 'Players: stale',
      kind: 'error',
    });
  });
});

describe('listen URL', () => {
  it('prints loopback when bound to every interface', () => {
    assert.equal(listenUrl('127.0.0.1', 3000), 'http://127.0.0.1:3000');
    assert.equal(listenUrl('0.0.0.0', 3000), 'http://127.0.0.1:3000');
    assert.equal(listenUrl('::', 8080), 'http://127.0.0.1:8080');
  });
});

describe('production startup command', () => {
  it('exits with a readable error when WORLD_PATH does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'no-such-bds-world');
    const result = await runStart({ WORLD_PATH: missing, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'error' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot start/i);
    assert.match(result.stderr, /WORLD_PATH does not exist/);
    assert.doesNotMatch(result.stderr, /undefined/);
  });
});

function runStart(extra: Record<string, string>): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
      {
        cwd: projectRoot,
        env: { ...process.env, ...extra },
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
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

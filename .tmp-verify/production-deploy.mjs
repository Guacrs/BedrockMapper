/**
 * Milestone 6 production deployment against the real BDS 1.26.51.1 server.
 *
 * Starts the map with `npm run start`, then checks the ten production-readiness
 * items: map load, existing terrain, refresh, new chunks, surface changes,
 * player tracking, stale players, restart, failed-refresh recovery, read-only.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const run = promisify(execFile);
const BASE = 'http://127.0.0.1:3000';
const WORLD = '/tmp/bds/worlds/Bedrock level';
const CACHE = '/tmp/m6-live-cache';
const TMUX = ['-f', '/exec-daemon/tmux.portal.conf'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

async function bds(command) {
  await run('tmux', [...TMUX, 'send-keys', '-t', 'bds-server:0.0', command, 'C-m']);
  console.log(`   > ${command}`);
}

const get = (path) => fetch(`${BASE}${path}`).then((response) => response.json());

async function waitUntil(label, fn, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return { value, waitedMs: Date.now() - started };
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  return { value: null, waitedMs: Date.now() - started, timedOut: true };
}

async function tilePixels(chunk, version) {
  const info = await get('/api/map/info');
  const perTile = info.chunksPerTile;
  const tileX = Math.floor(chunk.x / perTile);
  const tileY = Math.floor(chunk.z / perTile);
  const v = version ?? info.version;
  const response = await fetch(`${BASE}/tiles/overworld/0/${tileX}/${tileY}.png?v=${v}`);
  const tile = decodePng(new Uint8Array(await response.arrayBuffer()));
  const originX = (chunk.x - tileX * perTile) * 16;
  const originZ = (chunk.z - tileY * perTile) * 16;
  const pixels = [];
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const offset = ((originZ + z) * tile.width + originX + x) * tile.channels;
      pixels.push([tile.data[offset], tile.data[offset + 1], tile.data[offset + 2], tile.data[offset + 3]]);
    }
  }
  return pixels;
}

const opaqueCount = (pixels) => pixels.filter((pixel) => pixel[3] === 255).length;
const differing = (a, b) =>
  a.filter((pixel, i) => JSON.stringify(pixel.slice(0, 3)) !== JSON.stringify(b[i].slice(0, 3))).length;

async function drawnChunkNearSpawn() {
  for (let radius = 0; radius <= 8; radius++) {
    for (let z = -radius; z <= radius; z++) {
      for (let x = -radius; x <= radius; x++) {
        const pixels = await tilePixels({ x, z });
        if (opaqueCount(pixels) === 256) return { x, z };
      }
    }
  }
  throw new Error('no fully drawn chunk near spawn');
}

async function mapPid() {
  try {
    const { stdout } = await run('pgrep', ['-af', 'node.*server/index.ts']);
    for (const line of stdout.trim().split('\n')) {
      if (!line.includes('node')) continue;
      if (line.includes('pgrep')) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (!Number.isFinite(pid)) continue;
      const cmd = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
      if (cmd.includes('server/index.ts') && !cmd.includes('pgrep')) return pid;
    }
  } catch {
    return null;
  }
  return null;
}

async function liveWorldHandles(pid) {
  const { stdout } = await run('bash', [
    '-lc',
    `ls -l /proc/${pid}/fd 2>/dev/null; echo '---'; grep -a "${WORLD}" /proc/${pid}/maps 2>/dev/null || true`,
  ]);
  const hits = stdout
    .split('\n')
    .filter((line) => line.includes(WORLD) && !line.includes(CACHE) && !line.includes('world-snapshot'));
  return hits;
}

async function restartMap() {
  await run('tmux', [...TMUX, 'send-keys', '-t', 'map-server:0.0', 'C-c']).catch(() => {});
  await sleep(2000);
  const pid = await mapPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
    await sleep(2000);
  }
  await fs.rm(CACHE, { recursive: true, force: true });
  const start =
    `cd /workspace && rm -rf ${CACHE} && ` +
    `HOST=127.0.0.1 PORT=3000 MAP_CACHE=${CACHE} WORLD_PATH="${WORLD}" ` +
    `WORLD_REFRESH_INTERVAL=15000 API_KEY=milestone4-test-key LOG_LEVEL=info ` +
    `npm run start 2>&1 | tee /tmp/m6-map-server.log`;
  await run('tmux', [...TMUX, 'send-keys', '-t', 'map-server:0.0', 'C-c']);
  await sleep(500);
  await run('tmux', [...TMUX, 'send-keys', '-t', 'map-server:0.0', start, 'C-m']);
  const ready = await waitUntil('map listening', async () => {
    const response = await fetch(`${BASE}/api/health`).catch(() => null);
    return response?.ok ? await response.json() : null;
  }, 120000);
  if (ready.timedOut) throw new Error(`map server did not start: ${await fs.readFile('/tmp/m6-map-server.log', 'utf8').catch(() => '')}`);
  return ready.value;
}

console.log('0. starting production map with npm run start');
const health0 = await restartMap();
console.log(`   health ${JSON.stringify(health0)}`);

console.log('\n1. Map loads');
{
  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  const css = await fetch(`${BASE}/style.css`);
  const js = await fetch(`${BASE}/map.js`);
  const leaflet = await fetch(`${BASE}/vendor/leaflet/leaflet.js`);
  check('HTML is served', page.ok && html.includes('id="map"') && html.includes('id="terrain-status"'));
  check('static CSS/JS/Leaflet are served', css.ok && js.ok && leaflet.ok);
  check('GET /api/health is ok', health0?.status === 'ok', JSON.stringify(health0));
}

console.log('\n2. Existing terrain appears');
const reference = await drawnChunkNearSpawn();
{
  const info = await get('/api/map/info');
  check('existing terrain renders', true, `chunk ${reference.x},${reference.z} is fully drawn`);
  check('world identity is the live BDS world', info.world.name === 'Bedrock level', info.world.name);
  check('Bedrock version is 1.26.x', /^1\.26/.test(info.world.version ?? ''), info.world.version);
}

console.log('\n3. Terrain refresh works');
const beforeRefresh = await get('/api/map/state');
{
  const idle = await waitUntil(
    'a completed refresh',
    async () => {
      const state = await get('/api/map/state');
      return state.lastRefresh ? state : null;
    },
    45000,
  );
  check('refresh loop ran', Boolean(idle.value?.lastRefresh), JSON.stringify(idle.value?.lastRefresh));
  check(
    'a no-op or successful refresh does not take the map down',
    (await fetch(`${BASE}/api/health`)).ok,
  );
}

console.log('\n4. New chunks appear');
const infoStart = await get('/api/map/info');
const freshX = (infoStart.blockBounds.maxX + 800) | 0;
const freshZ = (infoStart.blockBounds.maxZ + 800) | 0;
const freshChunk = { x: Math.floor(freshX / 16), z: Math.floor(freshZ / 16) };
{
  await bds(`tickingarea add ${freshX - 48} 80 ${freshZ - 48} ${freshX + 48} 80 ${freshZ + 48} m6fresh`);
  const grown = await waitUntil(
    'new area on the map',
    async () => {
      const state = await get('/api/map/state');
      if (state.blockBounds.maxX < freshX && state.blockBounds.maxZ < freshZ) return null;
      let drawn = 0;
      for (let z = freshChunk.z - 2; z <= freshChunk.z + 2; z++) {
        for (let x = freshChunk.x - 2; x <= freshChunk.x + 2; x++) {
          const pixels = await tilePixels({ x, z }, state.version);
          if (opaqueCount(pixels) >= 200) drawn++;
        }
      }
      return drawn >= 4 ? { state, drawn } : null;
    },
    180000,
  );
  check(
    'new chunks appear on the map',
    Boolean(grown.value),
    grown.value ? `${grown.value.drawn} chunks drawn after ${grown.waitedMs} ms` : `timed out after ${grown.waitedMs} ms`,
  );
}

console.log('\n5. Surface changes appear');
{
  const before = await tilePixels(reference);
  const origin = { x: reference.x * 16, z: reference.z * 16 };
  await bds(`fill ${origin.x} 90 ${origin.z} ${origin.x + 15} 90 ${origin.z + 15} snow`);
  const changed = await waitUntil(
    'snow on the surface',
    async () => {
      const now = await tilePixels(reference);
      return differing(before, now) >= 80 ? now : null;
    },
    120000,
  );
  check(
    'surface change is visible',
    Boolean(changed.value),
    changed.value ? `${differing(before, changed.value)} pixels after ${changed.waitedMs} ms` : 'timed out',
  );
  await bds(`fill ${origin.x} 90 ${origin.z} ${origin.x + 15} 90 ${origin.z + 15} air`);
}

console.log('\n6. Player tracking works');
{
  const players = await get('/api/players');
  check(
    'live players are reported',
    !players.stale && Array.isArray(players.players) && players.players.length > 0,
    JSON.stringify(players.players?.map((p) => p.name)),
  );
}

console.log('\n8. Restarting BedrockMapper restores the map');
{
  const before = await get('/api/map/info');
  const health = await restartMap();
  const after = await get('/api/map/info');
  const pixels = await tilePixels(reference);
  check('map comes back after restart', health?.status === 'ok', JSON.stringify(health));
  check('terrain is still there after restart', opaqueCount(pixels) === 256, `${opaqueCount(pixels)}/256`);
  check('world is the same world', after.world.name === before.world.name);
}

console.log('\n9. A refresh failure leaves the previous valid map working');
{
  const before = await tilePixels(reference);
  const version = (await get('/api/map/state')).version;
  const db = `${WORLD}/db`;
  const hidden = `${db}.m6-hidden`;
  await bds('save hold');
  await sleep(2000);
  await bds('stop');
  await sleep(8000);
  // BDS is down, so renaming db cannot race a writer. Restore before we start it again.
  await fs.rename(db, hidden);
  try {
    const failed = await waitUntil(
      'degraded health',
      async () => {
        const health = await get('/api/health');
        return health.status === 'degraded' ? health : null;
      },
      45000,
    );
    const after = await tilePixels(reference);
    const page = await fetch(`${BASE}/`);
    check('health becomes degraded', Boolean(failed.value), JSON.stringify(failed.value));
    check('last good terrain is still served', opaqueCount(after) === 256 && differing(before, after) < 40);
    check('the web map is still served', page.ok);
    check('map version did not reset to empty', (await get('/api/map/state')).version === version);
  } finally {
    await fs.rename(hidden, db).catch(async () => {
      if (!(await fs.stat(db).catch(() => null))) await fs.rename(hidden, db);
    });
  }
}

console.log('\n7. Players become stale when BDS stops');
{
  const stale = await waitUntil(
    'stale players',
    async () => {
      const players = await get('/api/players');
      return players.stale ? players : null;
    },
    20000,
  );
  check('player list is stale after BDS stopped', Boolean(stale.value), JSON.stringify(stale.value));
}

console.log('\n10. The live BDS database remains untouched by the map process');
{
  const pid = await mapPid();
  check('map process is running', Number.isFinite(pid), String(pid));
  if (pid) {
    const hits = await liveWorldHandles(pid);
    check('no open file handle inside the live world', hits.length === 0, hits.join(' | '));
  }
  const snapshot = await fs.readdir(`${CACHE}/world-snapshot`).catch(() => []);
  check('the snapshot lives in MAP_CACHE, not in the world', snapshot.length > 0, snapshot.join(','));
}

console.log('\nrestoring BDS');
{
  // Start BDS again so the environment is left usable.
  await run('tmux', [...TMUX, 'send-keys', '-t', 'bds-server:0.0', 'C-c']).catch(() => {});
  await sleep(1000);
  await run('tmux', [
    ...TMUX,
    'send-keys',
    '-t',
    'bds-server:0.0',
    'cd /tmp/bds && ./bedrock_server',
    'C-m',
  ]);
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join('; ')}`);
  process.exit(1);
}

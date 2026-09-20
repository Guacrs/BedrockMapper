/**
 * Independent browser verification of milestone 5.
 *
 * Runs a map server against a *copy* of a real world (so it may be modified the
 * way BDS modifies its own), loads the real page in headless Chrome over CDP and
 * checks what the browser actually ends up showing:
 *   1. tiles are requested with the map version in the URL,
 *   2. an unchanged world changes nothing in the browser,
 *   3. a changed chunk shows up as different pixels on screen, without the page
 *      being reloaded and without the view moving,
 *   4. a chunk generated outside the previous extent becomes visible and the
 *      status bar picks up the new chunk count,
 *   5. the tile URL version moved exactly in step with the server.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';
import { copyWorld, WorldWriter } from '../test/live-world.ts';

const SOURCE_WORLD = process.env.WORLD_PATH ?? '/tmp/bds/worlds/Bedrock level';
const PORT = Number(process.env.MAP_PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;
const REFRESH_MS = 1000;
const DEBUG_PORT = 9335;

const failures = [];
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'terrain-verify-'));
const worldPath = path.join(temp, 'world');
await copyWorld(SOURCE_WORLD, worldPath);

const mapServer = spawn(
  process.execPath,
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
  {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      WORLD_PATH: worldPath,
      MAP_CACHE: path.join(temp, 'cache'),
      PORT: String(PORT),
      API_KEY: 'terrain-verify-key',
      WORLD_REFRESH_INTERVAL: String(REFRESH_MS),
      PLAYER_UPDATE_INTERVAL: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const serverLog = [];
mapServer.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
mapServer.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/map/info`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(500);
  }
  throw new Error('map server did not start');
}

const info = await waitForServer();

/** A chunk inside the mapped area whose 16x16 pixels are all terrain. */
async function findSolidChunk() {
  const tileX = Math.floor(info.center.x / info.tileSize);
  const tileY = Math.floor(info.center.z / info.tileSize);
  const bytes = new Uint8Array(
    await fetch(`${BASE}/tiles/${info.dimension}/0/${tileX}/${tileY}.png`).then((r) => r.arrayBuffer()),
  );
  const tile = decodePng(bytes);
  for (let chunkZ = 2; chunkZ < 14; chunkZ++) {
    for (let chunkX = 2; chunkX < 14; chunkX++) {
      let solid = true;
      for (let z = 0; z < 16 && solid; z++) {
        for (let x = 0; x < 16; x++) {
          const offset = ((chunkZ * 16 + z) * tile.width + chunkX * 16 + x) * tile.channels;
          if (tile.data[offset + 3] !== 255) {
            solid = false;
            break;
          }
        }
      }
      if (!solid) continue;
      return {
        x: tileX * (info.tileSize / 16) + chunkX,
        z: tileY * (info.tileSize / 16) + chunkZ,
      };
    }
  }
  throw new Error('no fully generated chunk found in the central tile');
}

/** The chunk's 16x16 block area, read from the tile the server renders it into. */
async function chunkPixelsFromTile(chunk, version) {
  const chunksPerTile = info.tileSize / 16;
  const tileX = Math.floor(chunk.x / chunksPerTile);
  const tileY = Math.floor(chunk.z / chunksPerTile);
  const query = version === undefined ? '' : `?v=${version}`;
  const bytes = new Uint8Array(
    await fetch(`${BASE}/tiles/${info.dimension}/0/${tileX}/${tileY}.png${query}`).then((r) => r.arrayBuffer()),
  );
  const tile = decodePng(bytes);
  const originX = (chunk.x - tileX * chunksPerTile) * 16;
  const originZ = (chunk.z - tileY * chunksPerTile) * 16;
  const pixels = [];
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const offset = ((originZ + z) * tile.width + originX + x) * tile.channels;
      pixels.push([tile.data[offset], tile.data[offset + 1], tile.data[offset + 2], tile.data[offset + 3]]);
    }
  }
  return pixels;
}

const countDiffering = (a, b) =>
  a.filter((pixel, i) => JSON.stringify(pixel.slice(0, 3)) !== JSON.stringify(b[i].slice(0, 3))).length;

const target = await findSolidChunk();
console.log(`world copy: ${worldPath}`);
console.log(`test chunk: ${target.x},${target.z} (blocks ${target.x * 16}..${target.x * 16 + 15})`);

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'terrain-verify-chrome-'));
const chrome = spawn('/opt/google/chrome/chrome', [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1280,800',
  '--hide-scrollbars',
  BASE,
]);
chrome.stderr.on('data', () => {});

async function cdpTarget() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith(BASE));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not expose a page target');
}

const socket = new WebSocket(await cdpTarget());
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`));
  else entry.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function evaluate(fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  }
  return result.result.value;
}

/** Pins the view so one CSS pixel is one block over the test chunk. */
async function centreOnChunk(chunk) {
  return evaluate(async (block) => {
    window.__map.setView(L.latLng(block.z, block.x), 0, { animate: false });
    await new Promise((r) => setTimeout(r, 1500));
    const point = window.__map.latLngToContainerPoint(L.latLng(block.z, block.x));
    const box = window.__map.getContainer().getBoundingClientRect();
    return {
      point: { x: point.x, y: point.y },
      container: { left: box.left, top: box.top },
      windowWidth: window.innerWidth,
    };
  }, { x: chunk.x * 16 + 8, z: chunk.z * 16 + 8 });
}

/** The 16x16 block area of a chunk, read from a real screenshot. */
async function chunkPixelsOnScreen(anchor) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const screen = decodePng(Buffer.from(shot.data, 'base64'));
  const ratio = screen.width / anchor.windowWidth;
  const pixels = [];
  for (let dz = -8; dz < 8; dz++) {
    for (let dx = -8; dx < 8; dx++) {
      const sx = Math.floor((anchor.container.left + anchor.point.x + dx + 0.5) * ratio);
      const sy = Math.floor((anchor.container.top + anchor.point.y + dz + 0.5) * ratio);
      const offset = (sy * screen.width + sx) * screen.channels;
      pixels.push([screen.data[offset], screen.data[offset + 1], screen.data[offset + 2]]);
    }
  }
  return pixels;
}

const tileState = () =>
  evaluate(() => ({
    versions: [...new Set([...document.querySelectorAll('img.leaflet-tile')].map((img) => new URL(img.src).searchParams.get('v')))],
    layerVersion: window.__terrain.version,
    world: document.getElementById('world').textContent,
    sentinel: window.__sentinel ?? null,
    centre: (() => {
      const centre = window.__map.getCenter();
      return { lat: centre.lat, lng: centre.lng };
    })(),
  }));

async function waitForServerVersion(minimum) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await fetch(`${BASE}/api/map/state`).then((r) => r.json());
    if (state.version >= minimum) return state;
    await sleep(200);
  }
  throw new Error(`server never reached map version ${minimum}`);
}

/** Waits until the tile the server renders a chunk into really looks different. */
async function waitForRedraw(chunk, baseline, atLeast) {
  const deadline = Date.now() + 30000;
  let last = { state: null, diff: 0 };
  while (Date.now() < deadline) {
    const state = await fetch(`${BASE}/api/map/state`).then((r) => r.json());
    if (state.version > 1) {
      const diff = countDiffering(await chunkPixelsFromTile(chunk, state.version), baseline);
      last = { state, diff };
      if (diff >= atLeast) return last;
    }
    await sleep(250);
  }
  return last;
}

const writeToWorld = async (use) => {
  const writer = await WorldWriter.open(worldPath);
  try {
    return await use(writer);
  } finally {
    await writer.close();
  }
};

try {
  await evaluate(async () => {
    const start = Date.now();
    while (!window.__terrain && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 100));
    if (!window.__terrain) throw new Error('terrain layer never appeared');
    await new Promise((resolve) => window.__map.whenReady(resolve));
    window.__sentinel = 'first-load';
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  });

  console.log('\n1. tiles carry the map version');
  {
    const state = await tileState();
    check('every tile is requested with ?v=1', state.versions.join(',') === '1', state.versions.join(','));
    check('the page knows the version it is showing', state.layerVersion === 1, String(state.layerVersion));
  }

  console.log('\n2. an unchanged world changes nothing');
  const anchor = await centreOnChunk(target);
  const before = await chunkPixelsOnScreen(anchor);
  const centreBefore = (await tileState()).centre;
  {
    await sleep(REFRESH_MS * 3);
    const state = await evaluate(async () => {
      await window.__pollTerrain();
      return {
        versions: [...new Set([...document.querySelectorAll('img.leaflet-tile')].map((img) => new URL(img.src).searchParams.get('v')))],
        layerVersion: window.__terrain.version,
      };
    });
    check('the version stays at 1 while the world is idle', state.layerVersion === 1, String(state.layerVersion));
    check('tiles are not re-requested', state.versions.join(',') === '1', state.versions.join(','));
    const same = await chunkPixelsOnScreen(anchor);
    check('what the browser shows is unchanged', JSON.stringify(same) === JSON.stringify(before));
  }

  console.log('\n3. a changed chunk becomes visible without reloading the page');
  {
    // Replace the chunk's block data with another chunk's, so most of its columns
    // end up at a different height and colour: a surface-visible change.
    const targetTilePixels = await chunkPixelsFromTile(target, 1);
    let donor = null;
    let donorDiff = 0;
    for (let dz = 1; dz <= 24; dz++) {
      for (let dx = 1; dx <= 24; dx++) {
        const candidate = { x: target.x + dx, z: target.z + dz };
        const pixels = await chunkPixelsFromTile(candidate, 1);
        if (!pixels.every((pixel) => pixel[3] === 255)) continue;
        const diff = countDiffering(pixels, targetTilePixels);
        if (diff > donorDiff) {
          donor = candidate;
          donorDiff = diff;
        }
      }
    }
    console.log(`   donor chunk ${donor?.x},${donor?.z} differs from the target in ${donorDiff}/256 pixels`);
    if (!donor || donorDiff < 200) throw new Error('no donor chunk with a clearly different surface');
    const copied = await writeToWorld(async (writer) => {
      const written = await writer.copyChunk(donor, target);
      // Drop whatever the target kept above the donor's highest subchunk, so its
      // surface really becomes the donor's rather than staying where it was.
      const donorTop = (await writer.subChunkIndices(donor)).at(-1);
      for (;;) {
        const indices = await writer.subChunkIndices(target);
        if ((indices.at(-1) ?? donorTop) <= donorTop) break;
        await writer.removeTopSubChunk(target);
      }
      return written;
    });
    console.log(`   wrote ${copied} subchunks of chunk ${donor.x},${donor.z} over chunk ${target.x},${target.z}`);
    const redraw = await waitForRedraw(target, targetTilePixels, 200);
    const state = redraw.state ?? (await waitForServerVersion(2));
    check('the server noticed on its own timer', state.version >= 2, `version ${state.version}`);

    // The page's own poll interval is 2 s here; drive it once to keep the run short.
    await evaluate(async () => {
      await window.__pollTerrain();
      await new Promise((r) => setTimeout(r, 2500));
    });
    const after = await tileState();
    check(
      'tiles are re-requested with the new version',
      after.versions.includes(String(state.version)),
      after.versions.join(','),
    );
    check(
      `the layer moved to version ${state.version}`,
      after.layerVersion === state.version,
      String(after.layerVersion),
    );
    check('the page was never reloaded', after.sentinel === 'first-load', String(after.sentinel));
    check(
      'the view did not move',
      Math.abs(after.centre.lat - centreBefore.lat) < 0.001 &&
        Math.abs(after.centre.lng - centreBefore.lng) < 0.001,
      `centre ${centreBefore.lng},${centreBefore.lat} -> ${after.centre.lng},${after.centre.lat}`,
    );

    const serverDiff = redraw.diff;
    check(
      'the server redrew the chunk',
      serverDiff > 200,
      `${serverDiff}/256 block pixels differ in the tile it renders`,
    );

    const changedPixels = await chunkPixelsOnScreen(anchor);
    const differing = changedPixels.filter((pixel, index) => JSON.stringify(pixel) !== JSON.stringify(before[index]));
    check(
      'the browser shows the changed terrain',
      differing.length >= serverDiff * 0.9,
      `${differing.length}/256 block pixels differ on screen, ${serverDiff} in the tile`,
    );
  }

  console.log('\n4. terrain generated outside the mapped area appears');
  {
    const donor = { x: target.x + 1, z: target.z + 1 };
    const beforeBounds = await fetch(`${BASE}/api/map/state`).then((r) => r.json());
    const fresh = { x: beforeBounds.chunkBounds.maxX + 12, z: beforeBounds.chunkBounds.maxZ + 12 };
    await writeToWorld((writer) => writer.copyChunk(donor, fresh));
    const state = await waitForServerVersion(beforeBounds.version + 1);
    check(
      'the world extent grew',
      state.chunkBounds.maxX === fresh.x && state.chunkBounds.maxZ === fresh.z,
      `X ..${state.chunkBounds.maxX}, Z ..${state.chunkBounds.maxZ}`,
    );

    await evaluate(async () => {
      await window.__pollTerrain();
    });
    const label = await evaluate(() => document.getElementById('world').textContent);
    check(
      'the status bar reports the new chunk count and extent',
      label.includes(String(state.chunkCount)) && label.includes(`${state.blockBounds.maxX}`),
      label,
    );

    const freshAnchor = await centreOnChunk(fresh);
    await evaluate(async () => {
      await new Promise((r) => setTimeout(r, 2000));
    });
    const pixels = await chunkPixelsOnScreen(freshAnchor);
    // Anything that is not the page background (#10151c) is drawn terrain.
    const terrain = pixels.filter((pixel) => !(pixel[0] === 0x10 && pixel[1] === 0x15 && pixel[2] === 0x1c));
    check(
      'the newly generated chunk is drawn in the browser',
      terrain.length > 200,
      `${terrain.length}/${pixels.length} pixels are terrain rather than page background`,
    );
    const finalState = await tileState();
    check('the page was still never reloaded', finalState.sentinel === 'first-load');
    check(
      'browser and server agree on the version',
      finalState.layerVersion === state.version,
      `browser ${finalState.layerVersion}, server ${state.version}`,
    );
  }

  console.log('\nserver log:');
  for (const line of serverLog.join('').split('\n').filter((line) => /terrain|version/.test(line))) {
    console.log(`   ${line}`);
  }
} finally {
  socket.close();
  chrome.kill('SIGKILL');
  mapServer.kill('SIGTERM');
  await sleep(500);
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('failed:', failures.join('; '));
  process.exit(1);
}

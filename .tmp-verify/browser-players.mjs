/**
 * Independent browser verification of milestone 4.
 *
 * Starts its own map server with a short staleness timeout, loads the real page
 * in headless Chrome over CDP, POSTs player updates and checks what the browser
 * actually does:
 *   1. no markers before any update, and the status bar says so,
 *   2. one player -> one marker at that player's block coordinates,
 *   3. a moving player keeps the same marker, which moves,
 *   4. several players, with Nether/End players excluded from the Overworld map,
 *   5. a disconnect removes just that marker,
 *   6. hovering shows the name, clicking shows name/X/Y/Z/dimension,
 *   7. the marker is actually painted where the player stands (canvas pixel),
 *   8. stale data clears every marker and says player data is unavailable.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const WORLD = process.env.WORLD_PATH ?? '/tmp/bedrock-fixture/world';
const PORT = Number(process.env.MAP_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'browser-verify-key';
const STALE_MS = 2500;
const DEBUG_PORT = 9334;

const failures = [];
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'players-verify-cache-'));
const mapServer = spawn(
  process.execPath,
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
  {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      WORLD_PATH: WORLD,
      // Its own cache: only one process may hold a snapshot's LevelDB lock.
      MAP_CACHE: cacheDir,
      PORT: String(PORT),
      API_KEY: KEY,
      PLAYER_DATA_TIMEOUT: String(STALE_MS),
      PLAYER_UPDATE_INTERVAL: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
mapServer.stdout.on('data', () => {});
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

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'players-verify-chrome-'));
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
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith(BASE));
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

async function postPlayers(players) {
  const response = await fetch(`${BASE}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ players }),
  });
  if (!response.ok) throw new Error(`POST /api/players failed: ${response.status}`);
}

/** Forces the page to poll now, then reports what it drew. */
function readMarkers() {
  return evaluate(async () => {
    await window.__pollPlayers();
    const map = window.__map;
    const layer = window.__players;
    const markers = [];
    for (const key of layer.keys()) {
      const marker = layer.markerFor(key);
      const latlng = marker.getLatLng();
      const point = map.latLngToContainerPoint(latlng);
      markers.push({
        key,
        blockX: latlng.lng,
        blockZ: latlng.lat,
        screen: { x: point.x, y: point.y },
        tooltip: marker.getTooltip()?.getContent() ?? null,
      });
    }
    return { markers, status: document.getElementById('players').textContent };
  });
}

try {
  await evaluate(async () => {
    const start = Date.now();
    while (!window.__players && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 100));
    if (!window.__players) throw new Error('player layer never appeared');
    await new Promise((resolve) => window.__map.whenReady(resolve));
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  });

  console.log('\n1. no player data yet');
  {
    const { markers, status } = await readMarkers();
    check('no markers before an update', markers.length === 0);
    check('status says player data is unavailable', /unavailable/i.test(status), status);
  }

  console.log('\n2. one player');
  const alex = { name: 'Alex', id: '4294967295', x: 392.5, y: 68, z: 144.25, dimension: 'minecraft:overworld' };
  await postPlayers([alex]);
  {
    const { markers, status } = await readMarkers();
    check('exactly one marker', markers.length === 1, `keys ${markers.map((m) => m.key).join(',')}`);
    const marker = markers[0];
    check('marker keyed by the Script API player id', marker?.key === 'id:4294967295', marker?.key);
    check(
      'marker sits at the player block coordinates',
      marker?.blockX === alex.x && marker?.blockZ === alex.z,
      `marker at X ${marker?.blockX}, Z ${marker?.blockZ} for player X ${alex.x}, Z ${alex.z}`,
    );
    check('tooltip is the player name', marker?.tooltip === 'Alex', String(marker?.tooltip));
    check('status names the player', /1 player: Alex/.test(status), status);
  }

  console.log('\n3. the same player moves');
  const moved = { ...alex, x: alex.x + 120, z: alex.z - 90, y: 71 };
  await postPlayers([moved]);
  {
    const { markers } = await readMarkers();
    check('still one marker, not a second one', markers.length === 1);
    check('same marker key after moving', markers[0]?.key === 'id:4294967295');
    check(
      'marker followed the player',
      markers[0]?.blockX === moved.x && markers[0]?.blockZ === moved.z,
      `now X ${markers[0]?.blockX}, Z ${markers[0]?.blockZ}`,
    );
  }

  console.log('\n4. several players, other dimensions excluded');
  const steve = { name: 'Steve', id: '2', x: 250, y: 64, z: 200, dimension: 'minecraft:overworld' };
  const nether = { name: 'Nether Nick', id: '3', x: 300, y: 40, z: 100, dimension: 'minecraft:nether' };
  const end = { name: 'End Ellie', id: '4', x: 100, y: 60, z: 100, dimension: 'minecraft:the_end' };
  await postPlayers([moved, steve, nether, end]);
  {
    const { markers, status } = await readMarkers();
    const keys = markers.map((marker) => marker.key).sort();
    check('only the overworld players have markers', keys.join(',') === 'id:2,id:4294967295', keys.join(','));
    check('nether player is not on the overworld map', !keys.includes('id:3'));
    check('end player is not on the overworld map', !keys.includes('id:4'));
    check('status counts the two elsewhere', /2 elsewhere/.test(status), status);
  }

  console.log('\n5. hover and click one marker');
  {
    const { markers } = await readMarkers();
    const target = markers.find((marker) => marker.key === 'id:2');
    const container = await evaluate(() => {
      const box = window.__map.getContainer().getBoundingClientRect();
      return { left: box.left, top: box.top };
    });
    const point = { x: container.left + target.screen.x, y: container.top + target.screen.y };

    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await sleep(400);
    const tooltip = await evaluate(() => document.querySelector('.leaflet-tooltip')?.textContent ?? null);
    check('hovering the marker shows the player name', tooltip === 'Steve', String(tooltip));

    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    }
    await sleep(500);
    const popup = await evaluate(
      () => document.querySelector('.leaflet-popup-content')?.innerText?.split('\n').filter(Boolean) ?? null,
    );
    check(
      'clicking the marker shows name, X, Y, Z and dimension',
      Array.isArray(popup) &&
        popup[0] === 'Steve' &&
        popup.includes('X 250') &&
        popup.includes('Y 64') &&
        popup.includes('Z 200') &&
        popup.includes('dimension overworld'),
      Array.isArray(popup) ? popup.join(' / ') : String(popup),
    );
    // An open popup must follow the player without dragging the map around:
    // replacing the popup content made Leaflet re-pan on every poll.
    const centreBefore = await evaluate(() => {
      const centre = window.__map.getCenter();
      return { lat: centre.lat, lng: centre.lng };
    });
    for (const [step, x] of [300, 350, 400].entries()) {
      await postPlayers([{ ...steve, x, z: 200 + step }, moved]);
      await evaluate(async () => {
        await window.__pollPlayers();
      });
      await sleep(200);
    }
    const afterMoving = await evaluate(() => {
      const centre = window.__map.getCenter();
      return {
        centre: { lat: centre.lat, lng: centre.lng },
        popup: document.querySelector('.leaflet-popup-content')?.innerText?.split('\n').filter(Boolean) ?? null,
        open: !!document.querySelector('.leaflet-popup'),
      };
    });
    check('the popup stays open while the player moves', afterMoving.open);

    // The popup must not cover the dot it describes.
    const markerPoint = await evaluate(() => {
      const marker = window.__players.markerFor('id:2');
      const point = window.__map.latLngToContainerPoint(marker.getLatLng());
      const box = window.__map.getContainer().getBoundingClientRect();
      return { x: box.left + point.x, y: box.top + point.y, window: window.innerWidth };
    });
    const popupShot = await send('Page.captureScreenshot', { format: 'png' });
    const popupScreen = decodePng(Buffer.from(popupShot.data, 'base64'));
    const popupRatio = popupScreen.width / markerPoint.window;
    const px = Math.floor((markerPoint.x + 0.5) * popupRatio);
    const py = Math.floor((markerPoint.y + 0.5) * popupRatio);
    const popupOffset = (py * popupScreen.width + px) * popupScreen.channels;
    const markerPixel = [
      popupScreen.data[popupOffset],
      popupScreen.data[popupOffset + 1],
      popupScreen.data[popupOffset + 2],
    ];
    check(
      'the marker is still visible while its popup is open',
      Math.abs(markerPixel[0] - 0xf0) <= 12 &&
        Math.abs(markerPixel[1] - 0x88) <= 12 &&
        Math.abs(markerPixel[2] - 0x3e) <= 12,
      `rgb(${markerPixel.join(',')}) at the marker position`,
    );
    check(
      'the popup shows the latest position',
      Array.isArray(afterMoving.popup) && afterMoving.popup.includes('X 400') && afterMoving.popup.includes('Z 202'),
      Array.isArray(afterMoving.popup) ? afterMoving.popup.join(' / ') : String(afterMoving.popup),
    );
    check(
      'an open popup does not pan the map',
      Math.abs(afterMoving.centre.lat - centreBefore.lat) < 0.001 &&
        Math.abs(afterMoving.centre.lng - centreBefore.lng) < 0.001,
      `centre ${centreBefore.lng},${centreBefore.lat} -> ${afterMoving.centre.lng},${afterMoving.centre.lat}`,
    );

    await evaluate(() => {
      window.__map.closePopup();
    });
  }

  console.log('\n6. the marker is painted where the player stands');
  {
    // Pin the view so one CSS pixel is one block, then read the pixel the
    // player's own coordinates convert to.
    const target = { name: 'Pixel', id: '9', x: 400, y: 70, z: 150, dimension: 'overworld' };
    await postPlayers([target]);
    const anchor = await evaluate(async (player) => {
      window.__map.setView(L.latLng(player.z, player.x), 0, { animate: false });
      await new Promise((r) => setTimeout(r, 1200));
      await window.__pollPlayers();
      await new Promise((r) => setTimeout(r, 400));
      const point = window.__map.latLngToContainerPoint(L.latLng(player.z, player.x));
      const box = window.__map.getContainer().getBoundingClientRect();
      return {
        point: { x: point.x, y: point.y },
        container: { left: box.left, top: box.top },
        window: { width: window.innerWidth },
      };
    }, target);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const screen = decodePng(Buffer.from(shot.data, 'base64'));
    const ratio = screen.width / anchor.window.width;
    const sx = Math.floor((anchor.container.left + anchor.point.x + 0.5) * ratio);
    const sy = Math.floor((anchor.container.top + anchor.point.y + 0.5) * ratio);
    const offset = (sy * screen.width + sx) * screen.channels;
    const pixel = [screen.data[offset], screen.data[offset + 1], screen.data[offset + 2]];
    // The marker fill is #f0883e.
    const isMarker =
      Math.abs(pixel[0] - 0xf0) <= 12 && Math.abs(pixel[1] - 0x88) <= 12 && Math.abs(pixel[2] - 0x3e) <= 12;
    check(
      'the pixel at the player position is the marker colour',
      isMarker,
      `rgb(${pixel.join(',')}) at screen ${sx},${sy} for block ${target.x},${target.z}`,
    );
  }

  console.log('\n7. a player disconnects');
  await postPlayers([steve]);
  {
    const { markers, status } = await readMarkers();
    check('only the remaining player has a marker', markers.length === 1 && markers[0].key === 'id:2', status);
  }

  console.log('\n8. nobody online, then stale data');
  await postPlayers([]);
  {
    const { markers, status } = await readMarkers();
    check('no markers when nobody is online', markers.length === 0);
    check('status distinguishes empty from unavailable', /no players in the overworld/.test(status), status);
  }

  await postPlayers([steve, moved]);
  const before = await readMarkers();
  check('markers are back after an update', before.markers.length === 2);

  console.log(`   waiting ${STALE_MS + 600} ms without updates...`);
  await sleep(STALE_MS + 600);
  {
    const { markers, status } = await readMarkers();
    check('stale data removes every marker', markers.length === 0, `still ${markers.length}`);
    check('status says player data is unavailable', /unavailable/i.test(status), status);
  }

  await postPlayers([steve]);
  {
    const { markers } = await readMarkers();
    check('markers return once updates resume', markers.length === 1);
  }
} finally {
  socket.close();
  chrome.kill('SIGKILL');
  mapServer.kill('SIGTERM');
  await sleep(500);
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  await fs.rm(cacheDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('failed:', failures.join('; '));
  process.exit(1);
}

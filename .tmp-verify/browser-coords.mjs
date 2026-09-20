/**
 * Independent browser-side verification of milestone 3.
 *
 * Loads the real map page in headless Chrome over CDP and checks, inside the
 * page, that:
 *   1. block coordinates <-> Leaflet <-> screen round-trip exactly,
 *   2. every loaded tile image sits exactly where its {x}/{y} URL says it should,
 *   3. the on-screen HUD readout matches the block under the cursor,
 *   4. the initial view is fitted to the world bounds reported by the API,
 *   5. the pixel drawn on screen for a block equals the pixel the server put in
 *      that tile for that block.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const BASE = process.env.MAP_URL ?? 'http://127.0.0.1:3000';
const PORT = 9333;

const failures = [];
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  if (ok) console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'map-verify-chrome-'));
const chrome = spawn('/opt/google/chrome/chrome', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
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
      const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith(BASE));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
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
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Runs an async function in the page and returns its JSON result. */
async function evaluate(fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(',')})`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  }
  return result.result.value;
}

try {
  // Wait for the map and its tiles to settle.
  await evaluate(async () => {
    const start = Date.now();
    while (!window.__map && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 100));
    if (!window.__map) throw new Error('window.__map was never set');
    await new Promise((resolve) => {
      const done = () => resolve();
      if (window.__mapReady) done();
      else window.__map.whenReady(done);
    });
    await new Promise((r) => setTimeout(r, 3000));
    return true;
  });

  const info = await fetch(`${BASE}/api/map/info`).then((r) => r.json());

  console.log('\n1. block <-> Leaflet <-> screen round trips');
  const roundTrip = await evaluate((blocks) => {
    const map = window.__map;
    return blocks.map(([x, z]) => {
      const latlng = L.latLng(z, x);
      const point = map.latLngToContainerPoint(latlng);
      const back = map.containerPointToLatLng(point);
      return { x, z, lat: latlng.lat, lng: latlng.lng, point: { x: point.x, y: point.y }, backX: Math.round(back.lng), backZ: Math.round(back.lat) };
    });
  }, [
    [0, 0],
    [-1, -1],
    [-32, -48],
    [815, 335],
    [288, -16],
  ]);
  for (const entry of roundTrip) {
    check(
      `block ${entry.x},${entry.z} survives block -> LatLng -> screen -> block`,
      entry.backX === entry.x && entry.backZ === entry.z && entry.lng === entry.x && entry.lat === entry.z,
      `lat/lng ${entry.lat}/${entry.lng}, screen ${entry.point.x.toFixed(1)},${entry.point.y.toFixed(1)} -> ${entry.backX},${entry.backZ}`,
    );
  }

  console.log('\n2. loaded tiles sit where their URL says');
  const tiles = await evaluate(() => {
    const map = window.__map;
    const container = map.getContainer().getBoundingClientRect();
    const images = [...document.querySelectorAll('img.leaflet-tile-loaded')];
    return images.map((img) => {
      const match = /\/tiles\/(\w+)\/(-?\d+)\/(-?\d+)\/(-?\d+)\.png/.exec(img.src);
      const box = img.getBoundingClientRect();
      // Where the tile's north-west block corner actually landed on screen.
      const screen = { x: box.left - container.left, y: box.top - container.top };
      const asBlock = map.containerPointToLatLng(L.point(screen.x, screen.y));
      return {
        dimension: match?.[1],
        zoom: Number(match?.[2]),
        tileX: Number(match?.[3]),
        tileY: Number(match?.[4]),
        blockX: Math.round(asBlock.lng),
        blockZ: Math.round(asBlock.lat),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    });
  });
  check('tiles are loaded', tiles.length > 0, `${tiles.length} tile images`);
  check(
    'all tiles requested at the native zoom only',
    tiles.every((tile) => tile.zoom === info.nativeZoom),
    `zooms: ${[...new Set(tiles.map((tile) => tile.zoom))].join(',')}`,
  );
  const misplaced = tiles.filter(
    (tile) => tile.blockX !== tile.tileX * info.tileSize || tile.blockZ !== tile.tileY * info.tileSize,
  );
  check(
    'every tile image is positioned at tile*256 in block coordinates',
    misplaced.length === 0,
    misplaced.length
      ? `first bad: tile ${misplaced[0].tileX},${misplaced[0].tileY} drawn at block ${misplaced[0].blockX},${misplaced[0].blockZ}`
      : tiles
          .slice(0, 3)
          .map((tile) => `${tile.tileX},${tile.tileY}@${tile.blockX},${tile.blockZ}`)
          .join(' '),
  );
  check(
    'tiles are square and consistently scaled',
    new Set(tiles.map((tile) => `${tile.width}x${tile.height}`)).size === 1 &&
      tiles.every((tile) => tile.width === tile.height),
    `size ${tiles[0]?.width}x${tiles[0]?.height} css px`,
  );
  // A transposed URL template would put tile (a,b) where (b,a) belongs; make
  // sure the loaded set is not symmetric by accident.
  check(
    'tile set is asymmetric, so an x/y swap could not pass unnoticed',
    tiles.some((tile) => !tiles.some((other) => other.tileX === tile.tileY && other.tileY === tile.tileX)),
  );

  console.log('\n3. HUD readout matches the block under the cursor');
  const hud = await evaluate(async (points) => {
    const map = window.__map;
    const container = map.getContainer();
    const box = container.getBoundingClientRect();
    const out = [];
    for (const [x, y] of points) {
      const expected = map.containerPointToLatLng(L.point(x, y));
      container.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: box.left + x,
          clientY: box.top + y,
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
      out.push({
        point: [x, y],
        expected: { x: Math.floor(expected.lng), z: Math.floor(expected.lat) },
        text: document.getElementById('cursor').textContent,
        view: document.getElementById('view').textContent,
      });
    }
    return out;
  }, [
    [100, 100],
    [640, 400],
    [1200, 700],
  ]);
  for (const entry of hud) {
    check(
      `cursor readout at screen ${entry.point.join(',')}`,
      entry.text === `cursor X ${entry.expected.x}, Z ${entry.expected.z}`,
      entry.text,
    );
  }
  check(
    'readout changed between cursor positions',
    new Set(hud.map((entry) => entry.text)).size === hud.length,
  );

  console.log('\n4. initial view is fitted to the world bounds from the API');
  const view = await evaluate(() => {
    const map = window.__map;
    const bounds = map.getBounds();
    return {
      zoom: map.getZoom(),
      centre: { x: map.getCenter().lng, z: map.getCenter().lat },
      west: bounds.getWest(),
      east: bounds.getEast(),
      north: bounds.getSouth(),
      south: bounds.getNorth(),
    };
  });
  check(
    'world bounds are inside the visible area',
    view.west <= info.blockBounds.minX &&
      view.east >= info.blockBounds.maxX &&
      view.north <= info.blockBounds.minZ &&
      view.south >= info.blockBounds.maxZ,
    `visible X ${view.west.toFixed(0)}..${view.east.toFixed(0)}, Z ${view.north.toFixed(0)}..${view.south.toFixed(0)} at zoom ${view.zoom}`,
  );
  check(
    'view is centred on the middle of the world bounds',
    Math.abs(view.centre.x - info.center.x) <= 1 && Math.abs(view.centre.z - info.center.z) <= 1,
    `centre ${view.centre.x.toFixed(1)},${view.centre.z.toFixed(1)} vs API ${info.center.x},${info.center.z}`,
  );

  console.log('\n5. the pixel on screen for a block is the pixel the server rendered');
  // Pin the map to zoom 0 (1 css px per block) so a screenshot pixel maps to
  // exactly one block, then compare a screenshot against the served tiles.
  const anchor = await evaluate((info) => {
    const map = window.__map;
    map.setView(L.latLng(info.center.z, info.center.x), 0, { animate: false });
    return new Promise((resolve) => {
      setTimeout(() => {
        const container = map.getContainer().getBoundingClientRect();
        const topLeft = map.containerPointToLatLng(L.point(0, 0));
        resolve({
          container: { width: container.width, height: container.height, left: container.left, top: container.top },
          window: { width: window.innerWidth, height: window.innerHeight },
          block: { x: topLeft.lng, z: topLeft.lat },
          devicePixelRatio: window.devicePixelRatio,
        });
      }, 4000);
    });
  }, info);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screen = decodePng(Buffer.from(shot.data, 'base64'));
  const ratio = screen.width / anchor.window.width;

  async function servedPixel(blockX, blockZ) {
    const tileX = Math.floor(blockX / info.tileSize);
    const tileY = Math.floor(blockZ / info.tileSize);
    const bytes = await fetch(`${BASE}/tiles/${info.dimension}/0/${tileX}/${tileY}.png`).then((r) =>
      r.arrayBuffer(),
    );
    const tile = decodePng(new Uint8Array(bytes));
    const px = blockX - tileX * info.tileSize;
    const py = blockZ - tileY * info.tileSize;
    const offset = (py * tile.width + px) * tile.channels;
    return [tile.data[offset], tile.data[offset + 1], tile.data[offset + 2], tile.channels === 4 ? tile.data[offset + 3] : 255];
  }

  let matched = 0;
  let compared = 0;
  const samples = [];
  for (let i = 0; i < 120; i++) {
    // Sample the middle of the viewport, away from the HUD.
    const screenX = 60 + Math.floor(Math.random() * (anchor.container.width - 120));
    const screenY = 40 + Math.floor(Math.random() * (anchor.container.height - 140));
    const blockX = Math.floor(anchor.block.x + screenX);
    const blockZ = Math.floor(anchor.block.z + screenY);
    const served = await servedPixel(blockX, blockZ);
    if (served[3] !== 255) continue; // transparent: background shows through
    // Centre of that CSS pixel, in device pixels.
    const sx = Math.floor((anchor.container.left + screenX + 0.5) * ratio);
    const sy = Math.floor((anchor.container.top + screenY + 0.5) * ratio);
    const offset = (sy * screen.width + sx) * screen.channels;
    const onScreen = [screen.data[offset], screen.data[offset + 1], screen.data[offset + 2]];
    const close = onScreen.every((value, index) => Math.abs(value - served[index]) <= 2);
    compared++;
    if (close) matched++;
    else if (samples.length < 5) samples.push({ blockX, blockZ, onScreen, served });
  }
  check(
    'screen pixels equal the served tile pixels for the block under them',
    compared >= 20 && matched === compared,
    `${matched}/${compared} sampled blocks match` +
      (samples.length ? `; e.g. block ${samples[0].blockX},${samples[0].blockZ} screen ${samples[0].onScreen} vs tile ${samples[0].served}` : ''),
  );
} finally {
  socket.close();
  chrome.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('failed:', failures.join('; '));
  process.exit(1);
}

/**
 * Drives the walkthrough recording: places a visible platform on the real BDS
 * server, waits for the open map page to show it, removes it again, and reports
 * what the page was showing at each step so the recording can be trusted.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const run = promisify(execFile);
const DEBUG_PORT = 9333;
const AREA = { minX: 400, minZ: 144, maxX: 447, maxZ: 191, y: 120 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bds = async (command) => {
  await run('tmux', ['-f', '/exec-daemon/tmux.portal.conf', 'send-keys', '-t', 'bds-server:0.0', command, 'C-m']);
  console.log(`${stamp()} bds> ${command}`);
};

const stamp = () => new Date().toISOString().slice(11, 19);

const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:3000'));
if (!page) throw new Error('the map page is not open in the visible browser');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const reply = JSON.parse(event.data);
  const entry = pending.get(reply.id);
  if (!entry) return;
  pending.delete(reply.id);
  if (reply.error) entry.reject(new Error(JSON.stringify(reply.error)));
  else entry.resolve(reply.result);
});

function evaluate(fn) {
  const id = nextId++;
  socket.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true },
    }),
  );
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject })).then((result) => result.result.value);
}

const pageState = () =>
  evaluate(() => ({
    version: window.__terrain.version,
    tileVersions: [...new Set([...document.querySelectorAll('img.leaflet-tile')].map((img) => new URL(img.src).searchParams.get('v')))].sort(),
    players: document.getElementById('players').textContent,
    marker: (() => {
      const key = window.__players.keys()[0];
      if (!key) return null;
      const at = window.__players.markerFor(key).getLatLng();
      return `${Math.round(at.lng)},${Math.round(at.lat)}`;
    })(),
  }));

/** How much of the platform area the map currently draws as snow, 0..1. */
async function snowFraction() {
  const info = await fetch('http://127.0.0.1:3000/api/map/info').then((response) => response.json());
  const tileX = Math.floor(AREA.minX / info.tileSize);
  const tileY = Math.floor(AREA.minZ / info.tileSize);
  const bytes = new Uint8Array(
    await fetch(`http://127.0.0.1:3000/tiles/overworld/0/${tileX}/${tileY}.png?v=${info.version}`).then((r) =>
      r.arrayBuffer(),
    ),
  );
  const tile = decodePng(bytes);
  let white = 0;
  let total = 0;
  for (let z = AREA.minZ; z <= AREA.maxZ; z++) {
    for (let x = AREA.minX; x <= AREA.maxX; x++) {
      const offset = ((z - tileY * info.tileSize) * tile.width + (x - tileX * info.tileSize)) * tile.channels;
      total++;
      if (tile.data[offset] > 220 && tile.data[offset + 1] > 220 && tile.data[offset + 2] > 220) white++;
    }
  }
  return white / total;
}

/** Waits for the map to draw the platform (or stop drawing it) and for the page to catch up. */
async function watchUntil(label, wanted, timeoutMs = 120000) {
  const started = Date.now();
  let previous = '';
  while (Date.now() - started < timeoutMs) {
    const snow = await snowFraction();
    const state = await pageState();
    const line =
      `v${state.version} tiles ?v=${state.tileVersions.join('/')} | platform ${(snow * 100).toFixed(0)}% drawn` +
      ` | ${state.players}${state.marker ? ` at ${state.marker}` : ''}`;
    if (line !== previous) console.log(`${stamp()} page  ${line}`);
    previous = line;
    const drawn = wanted === 'placed' ? snow > 0.9 : snow < 0.05;
    if (drawn && state.tileVersions.every((version) => Number(version) === state.version)) {
      console.log(`${stamp()} ${label} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return state;
    }
    await sleep(1000);
  }
  console.log(`${stamp()} ${label}: TIMED OUT`);
  return null;
}

const start = await pageState();
console.log(`${stamp()} page  showing map version ${start.version}, ${start.players}`);

await bds('scriptevent bmap:patrol');
await sleep(4000);

await bds(`fill ${AREA.minX} ${AREA.y} ${AREA.minZ} ${AREA.maxX} ${AREA.y} ${AREA.maxZ} snow`);
await watchUntil('the platform is on the map', 'placed');
await sleep(8000);

await bds(`fill ${AREA.minX} ${AREA.y} ${AREA.minZ} ${AREA.maxX} ${AREA.y} ${AREA.maxZ} air`);
await watchUntil('the platform is gone again', 'removed');
await sleep(5000);

await bds('scriptevent bmap:stop');
console.log(`${stamp()} done: ${JSON.stringify(await pageState())}`);
socket.close();

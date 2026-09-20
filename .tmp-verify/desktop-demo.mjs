/**
 * Drives the browser on the VM's desktop for the walkthrough recording, and
 * reports what the page is doing at the same time (over CDP) so the recording
 * can be trusted: marker keys, status bar text, map centre and any page errors.
 *
 *   node .tmp-verify/desktop-demo.mjs [--dry-run] [--samples 10]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const DISPLAY = ':1';
const DEBUG_PORT = 9333;
const MARKER = [0xf0, 0x88, 0x3e];
const dryRun = process.argv.includes('--dry-run');
const samples = Number(process.argv[process.argv.indexOf('--samples') + 1]) || 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync('xdotool', args, { env: { ...process.env, DISPLAY } }).toString().trim();
const [width, height] = xdo('getdisplaygeometry').split(/\s+/).map(Number);

function grabFrame(file = '/tmp/desktop-frame.png') {
  fs.rmSync(file, { force: true });
  execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`, '-i', DISPLAY, '-frames:v', '1', file],
    { env: { ...process.env, DISPLAY } },
  );
  return decodePng(fs.readFileSync(file));
}

/** Centre of the marker-coloured pixels; the status bar text is ignored. */
function findMarker(image) {
  const hits = [];
  for (let y = 0; y < image.height - 80; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * image.channels;
      if (
        Math.abs(image.data[offset] - MARKER[0]) <= 16 &&
        Math.abs(image.data[offset + 1] - MARKER[1]) <= 16 &&
        Math.abs(image.data[offset + 2] - MARKER[2]) <= 16
      ) {
        hits.push({ x, y });
      }
    }
  }
  if (!hits.length) return null;
  const sum = hits.reduce((total, hit) => ({ x: total.x + hit.x, y: total.y + hit.y }), { x: 0, y: 0 });
  return { x: Math.round(sum.x / hits.length), y: Math.round(sum.y / hits.length), pixels: hits.length };
}

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
const pageErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    pageErrors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(' '));
    return;
  }
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

async function evaluate(fn) {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  return result.result.value;
}

await send('Runtime.enable');

const pageState = () =>
  evaluate(() => {
    const centre = window.__map.getCenter();
    return {
      keys: window.__players.keys(),
      status: document.getElementById('players').textContent,
      centre: { x: Math.round(centre.lng), z: Math.round(centre.lat) },
      zoom: window.__map.getZoom(),
      popup: !!document.querySelector('.leaflet-popup'),
    };
  });

const api = () => fetch('http://127.0.0.1:3000/api/players').then((response) => response.json());

console.log(`display ${width}x${height}, page ${page.url}`);
console.log('api:', JSON.stringify((await api()).players));
console.log('page:', JSON.stringify(await pageState()));

let marker = null;
for (let attempt = 0; attempt < 8 && !marker; attempt++) {
  marker = findMarker(grabFrame());
  if (!marker) await sleep(1500);
}
if (!marker) throw new Error('no player marker found on screen');
console.log(`marker at ${marker.x},${marker.y} (${marker.pixels} px)`);

if (dryRun) {
  console.log('dry run: not touching the mouse');
  socket.close();
  process.exit(0);
}

// Hover: rest the pointer on the marker so the name tooltip appears.
xdo('mousemove', String(marker.x), String(marker.y));
await sleep(2500);
console.log('hovered:', JSON.stringify(await pageState()));

// Click: the popup lists name, X, Y, Z and dimension. The player keeps moving,
// so only click once the pointer and the marker agree on where it is.
let clickState = null;
for (let attempt = 0; attempt < 8; attempt++) {
  const target = findMarker(grabFrame());
  if (!target) continue;
  xdo('mousemove', String(target.x), String(target.y));
  const confirmed = findMarker(grabFrame());
  if (!confirmed || Math.hypot(confirmed.x - target.x, confirmed.y - target.y) > 4) continue;
  xdo('click', '1');
  await sleep(2500);
  clickState = await pageState();
  if (clickState.popup) break;
}
console.log('clicked:', JSON.stringify(clickState));
if (!clickState?.popup) throw new Error('the popup did not open');
await sleep(3500);

// Close the popup and step back, then let the marker move on its own.
xdo('key', '--clearmodifiers', 'Escape');
await sleep(1200);
xdo('mousemove', String(Math.round(width * 0.1)), String(Math.round(height * 0.75)));
const leaveAfter = Number(process.argv[process.argv.indexOf('--leave-after') + 1]) || 0;
for (let sample = 0; sample < samples; sample++) {
  if (leaveAfter && sample === leaveAfter) {
    // Make the player disconnect mid-demo, so the marker is seen to vanish.
    execFileSync('tmux', [
      '-f',
      '/exec-daemon/tmux.portal.conf',
      'send-keys',
      '-t',
      'bds-server:0.0',
      'scriptevent bmap:leave',
      'C-m',
    ]);
    console.log('--- player disconnecting ---');
  }
  await sleep(4000);
  const found = findMarker(grabFrame());
  const state = await pageState();
  const players = (await api()).players.map((player) => `${player.name} ${player.x},${player.z}`);
  console.log(
    `t+${(sample + 1) * 4}s screen ${found ? `${found.x},${found.y}` : 'no marker'} | ` +
      `page ${JSON.stringify(state.keys)} centre ${state.centre.x},${state.centre.z} | api ${JSON.stringify(players)} | ` +
      `status "${state.status}"`,
  );
}

if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
socket.close();

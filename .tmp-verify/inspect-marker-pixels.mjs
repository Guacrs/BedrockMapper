/**
 * Compares where the page thinks the player marker is with what is actually
 * painted there, while a popup is open.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const DISPLAY = ':1';
const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync('xdotool', args, { env: { ...process.env, DISPLAY } }).toString().trim();
const [width, height] = xdo('getdisplaygeometry').split(/\s+/).map(Number);

function grab(name) {
  const file = `/tmp/marker-${name}.png`;
  fs.rmSync(file, { force: true });
  execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`, '-i', DISPLAY, '-frames:v', '1', file],
    { env: { ...process.env, DISPLAY } },
  );
  return { file, image: decodePng(fs.readFileSync(file)) };
}

const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json());
const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:3000'));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  entry.resolve(message.result);
});
const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, { resolve }));
};
const evaluate = async (fn) => {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
};

const where = () =>
  evaluate(() => {
    const layer = window.__players;
    const key = layer.keys()[0];
    if (!key) return null;
    const marker = layer.markerFor(key);
    const point = window.__map.latLngToContainerPoint(marker.getLatLng());
    const box = window.__map.getContainer().getBoundingClientRect();
    const canvas = document.querySelector('canvas.leaflet-zoom-animated');
    const canvasBox = canvas?.getBoundingClientRect();
    return {
      key,
      latlng: marker.getLatLng(),
      point: { x: Math.round(point.x), y: Math.round(point.y) },
      containerOffset: { left: box.left, top: box.top },
      onMap: !!marker._map,
      inLayer: !!marker._renderer,
      canvas: canvas
        ? {
            css: { width: Math.round(canvasBox.width), height: Math.round(canvasBox.height) },
            attr: { width: canvas.width, height: canvas.height },
            classes: canvas.className,
          }
        : null,
      popupOpen: !!document.querySelector('.leaflet-popup'),
      screenY: window.outerHeight - window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    };
  });

function samplePixels(image, cx, cy, radius = 10) {
  const seen = new Map();
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const offset = (y * image.width + x) * image.channels;
      const key = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

const state = await where();
console.log('page says:', JSON.stringify(state));

const frame = grab('now');
const screenX = Math.round(state.containerOffset.left + state.point.x);
const screenY = Math.round(state.containerOffset.top + state.point.y + state.screenY);
console.log(`expected on screen near ${screenX},${screenY} (window chrome ${state.screenY}px)`);
console.log('pixels there:', JSON.stringify(samplePixels(frame.image, screenX, screenY)));
console.log('frame:', frame.file);

await sleep(3000);
const later = await where();
const frame2 = grab('later');
const screenX2 = Math.round(later.containerOffset.left + later.point.x);
const screenY2 = Math.round(later.containerOffset.top + later.point.y + later.screenY);
console.log(`3 s later expected near ${screenX2},${screenY2}`);
console.log('pixels there:', JSON.stringify(samplePixels(frame2.image, screenX2, screenY2)));
console.log('frame:', frame2.file);

socket.close();

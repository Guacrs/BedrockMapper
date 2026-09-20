/** Checks whether the player marker is still drawn while its popup is open. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const DISPLAY = ':1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) => execFileSync('xdotool', args, { env: { ...process.env, DISPLAY } }).toString().trim();
const [width, height] = xdo('getdisplaygeometry').split(/\s+/).map(Number);

function grab(name) {
  const file = `/tmp/inspect-${name}.png`;
  fs.rmSync(file, { force: true });
  execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`, '-i', DISPLAY, '-frames:v', '1', file],
    { env: { ...process.env, DISPLAY } },
  );
  return { file, image: decodePng(fs.readFileSync(file)) };
}

function findMarker(image) {
  const hits = [];
  for (let y = 0; y < image.height - 80; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * image.channels;
      if (
        Math.abs(image.data[offset] - 0xf0) <= 16 &&
        Math.abs(image.data[offset + 1] - 0x88) <= 16 &&
        Math.abs(image.data[offset + 2] - 0x3e) <= 16
      ) {
        hits.push({ x, y });
      }
    }
  }
  if (!hits.length) return null;
  const sum = hits.reduce((total, hit) => ({ x: total.x + hit.x, y: total.y + hit.y }), { x: 0, y: 0 });
  return { x: Math.round(sum.x / hits.length), y: Math.round(sum.y / hits.length), pixels: hits.length };
}

const api = () => fetch('http://127.0.0.1:3000/api/players').then((response) => response.json());

const before = findMarker(grab('before').image);
console.log('before:', JSON.stringify(before), JSON.stringify((await api()).players));
if (!before) throw new Error('no marker to click');

xdo('mousemove', String(before.x), String(before.y));
await sleep(2000);
const hovered = grab('hovered');
console.log('while hovering:', JSON.stringify(findMarker(hovered.image)), hovered.file);

const now = findMarker(grab('recheck').image);
if (now) xdo('mousemove', String(now.x), String(now.y));
await sleep(500);
xdo('click', '1');
await sleep(2500);
const clicked = grab('clicked');
console.log('right after click:', JSON.stringify(findMarker(clicked.image)), clicked.file);

for (const step of [1, 2, 3]) {
  await sleep(4000);
  const frame = grab(`after-${step}`);
  console.log(
    `after click +${step * 4}s:`,
    JSON.stringify(findMarker(frame.image)),
    JSON.stringify((await api()).players.map((player) => `${player.x},${player.z}`)),
    frame.file,
  );
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decode as decodePng } from '../node_modules/fast-png/lib/index.js';

const run = promisify(execFile);
const TMUX = ['-f', '/exec-daemon/tmux.portal.conf'];
const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
const bds = async (command) => {
  await run('tmux', [...TMUX, 'send-keys', '-t', 'bds-server:0.0', command, 'C-m']);
  console.log('>', command);
};

async function tilePixels(chunk) {
  const info = await get('/api/map/info');
  const perTile = info.chunksPerTile;
  const tileX = Math.floor(chunk.x / perTile);
  const tileY = Math.floor(chunk.z / perTile);
  const response = await fetch(`${BASE}/tiles/overworld/0/${tileX}/${tileY}.png?v=${info.version}`);
  const tile = decodePng(new Uint8Array(await response.arrayBuffer()));
  const originX = (chunk.x - tileX * perTile) * 16;
  const originZ = (chunk.z - tileY * perTile) * 16;
  const pixels = [];
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const offset = ((originZ + z) * tile.width + originX + x) * tile.channels;
      pixels.push(tile.data[offset + 3] === 255);
    }
  }
  return pixels.filter(Boolean).length;
}

await bds('tickingarea remove m5fresh');
await bds('tickingarea remove m6fresh');
await sleep(1000);

const start = await get('/api/map/info');
const x = start.blockBounds.maxX + 160;
const z = start.blockBounds.maxZ + 160;
const chunk = { x: Math.floor(x / 16), z: Math.floor(z / 16) };
console.log('target', { x, z, chunk, before: start.blockBounds, drawnBefore: await tilePixels(chunk) });

await bds(`tickingarea add ${x - 32} 80 ${z - 32} ${x + 32} 80 ${z + 32} m6fresh`);
await bds(`tp @a ${x} 90 ${z}`);

const started = Date.now();
while (Date.now() - started < 180000) {
  const state = await get('/api/map/state');
  let drawn = 0;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if ((await tilePixels({ x: chunk.x + dx, z: chunk.z + dz })) >= 200) drawn++;
    }
  }
  console.log(
    `  t=${Math.round((Date.now() - started) / 1000)}s version=${state.version} chunks=${state.chunkCount} ` +
      `max=${state.blockBounds.maxX},${state.blockBounds.maxZ} drawn=${drawn}`,
  );
  if (drawn >= 4 || state.blockBounds.maxX >= x - 16 || state.blockBounds.maxZ >= z - 16) {
    if (drawn >= 1) {
      console.log('PASS new chunks appeared', { drawn, waited: Date.now() - started });
      process.exit(0);
    }
  }
  await sleep(5000);
}
console.error('FAIL new chunks did not appear');
process.exit(1);

/**
 * Drives and observes the map page in the visible browser during the milestone 5
 * walkthrough recording, so the recording can be trusted: it reports the map
 * version the page is showing, the tile URLs it requested, the player marker it
 * drew and any page errors.
 *
 *   node .tmp-verify/live-demo.mjs setup            centre the view for recording
 *   node .tmp-verify/live-demo.mjs monitor 60        report every second for 60 s
 */

const DEBUG_PORT = 9333;
const [command = 'report', argument] = process.argv.slice(2);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  return result.result.value;
}

const report = () =>
  evaluate(() => ({
    version: window.__terrain.version,
    tileVersions: [...new Set([...document.querySelectorAll('img.leaflet-tile')].map((img) => new URL(img.src).searchParams.get('v')))].sort(),
    tiles: document.querySelectorAll('img.leaflet-tile').length,
    world: document.getElementById('world').textContent,
    players: document.getElementById('players').textContent,
    markers: window.__players.keys().map((key) => {
      const latlng = window.__players.markerFor(key).getLatLng();
      return { key, x: Math.round(latlng.lng * 10) / 10, z: Math.round(latlng.lat * 10) / 10 };
    }),
    centre: (() => {
      const centre = window.__map.getCenter();
      return { x: Math.round(centre.lng), z: Math.round(centre.lat) };
    })(),
    zoom: window.__map.getZoom(),
  }));

if (command === 'setup') {
  const [x, z, zoom] = (argument ?? '420,165,2').split(',').map(Number);
  await evaluate(
    async (view) => {
      window.__map.setView(L.latLng(view.z, view.x), view.zoom, { animate: false });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return true;
    },
    { x, z, zoom },
  );
}

if (command === 'monitor') {
  const seconds = Number(argument ?? 60);
  let previous = null;
  for (let i = 0; i < seconds; i++) {
    const state = await report();
    const line =
      `${new Date().toISOString().slice(11, 19)} v${state.version} tiles ${state.tiles} (?v=${state.tileVersions.join('/')}) ` +
      `| ${state.players} | ${state.markers.map((m) => `${m.key} at ${m.x},${m.z}`).join(' ')}`;
    if (line.slice(9) !== previous) console.log(line);
    previous = line.slice(9);
    await sleep(1000);
  }
}

console.log(JSON.stringify(await report(), null, 1));
socket.close();

/** Zooms the visible map to the tracked players and opens one popup. */

const targets = await fetch('http://127.0.0.1:9333/json/list').then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:3000'));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry) {
    pending.delete(message.id);
    entry(message.result);
  }
});
const send = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
};

const result = await send('Runtime.evaluate', {
  expression: `(async () => {
    await window.__pollPlayers();
    const layer = window.__players;
    const markers = layer.keys().map((key) => layer.markerFor(key));
    if (markers.length < 1) return 'no markers';
    const bounds = L.latLngBounds(markers.map((marker) => marker.getLatLng()));
    window.__map.fitBounds(bounds.pad(0.6), { animate: false, maxZoom: 3 });
    await new Promise((r) => setTimeout(r, 1500));
    markers[0].openPopup();
    await new Promise((r) => setTimeout(r, 800));
    return {
      status: document.getElementById('players').textContent,
      zoom: window.__map.getZoom(),
      markers: markers.map((marker) => {
        const point = window.__map.latLngToContainerPoint(marker.getLatLng());
        return { block: { x: marker.getLatLng().lng, z: marker.getLatLng().lat }, screen: { x: Math.round(point.x), y: Math.round(point.y) } };
      }),
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(result.result.value));
socket.close();

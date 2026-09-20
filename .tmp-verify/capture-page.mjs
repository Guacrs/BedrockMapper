/** Saves a clean screenshot of the visible map page over CDP. */

import fs from 'node:fs/promises';

const output = process.argv[2];
if (!output) throw new Error('usage: capture-page.mjs <output.png>');

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

const state = await send('Runtime.evaluate', {
  expression: `(async () => {
    await window.__pollPlayers();
    await new Promise((r) => setTimeout(r, 600));
    return { keys: window.__players.keys(), status: document.getElementById('players').textContent };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log('page:', JSON.stringify(state.result.value));

const shot = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile(output, Buffer.from(shot.data, 'base64'));
console.log('wrote', output);
socket.close();

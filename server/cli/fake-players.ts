/**
 * Posts fake player positions to the map server, so the endpoint and the
 * browser markers can be tested without a running BDS.
 *
 *   npm run fake-players                          # 2 players walking about
 *   npm run fake-players -- --count 4 --nether 1  # plus one player off-map
 *   npm run fake-players -- --empty --once        # nobody online
 *   npm run fake-players -- --invalid-key --once  # expect 401
 *   npm run fake-players -- --malformed --once    # expect 400
 *
 * Stop it (Ctrl-C) and the data goes stale, which is how the stale-data
 * behaviour is tested by hand.
 */

import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:3000' },
    key: { type: 'string' },
    count: { type: 'string', default: '2' },
    nether: { type: 'string', default: '0' },
    interval: { type: 'string' },
    once: { type: 'boolean', default: false },
    empty: { type: 'boolean', default: false },
    'invalid-key': { type: 'boolean', default: false },
    malformed: { type: 'boolean', default: false },
  },
});

const config = loadConfig({ worldPath: process.env.WORLD_PATH ?? '(not needed)' });
const base = (values.url ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const endpoint = `${base}/api/players`;
const apiKey = values['invalid-key'] ? 'not-the-right-key' : (values.key ?? config.apiKey);
const overworldCount = values.empty ? 0 : Number(values.count);
const netherCount = values.empty ? 0 : Number(values.nether);
const interval = Number(values.interval ?? config.playerUpdateInterval);

if (!apiKey) {
  throw new Error('No API key. Set API_KEY in .env or pass --key <key>.');
}

const NAMES = ['Alex', 'Steve', 'Zuri', 'Efe', 'Makena', 'Kai', 'Noor', 'Ari'];

interface FakePlayer {
  name: string;
  id: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  radius: number;
  centreX: number;
  centreZ: number;
}

/** Walks the fake players in circles around the middle of the rendered world. */
function makePlayers(centre: { x: number; z: number }): FakePlayer[] {
  const players: FakePlayer[] = [];
  const total = overworldCount + netherCount;
  for (let index = 0; index < total; index++) {
    const dimension = index < overworldCount ? 'minecraft:overworld' : 'minecraft:nether';
    players.push({
      name: NAMES[index % NAMES.length] + (index >= NAMES.length ? String(index) : ''),
      id: `fake-${index + 1}`,
      dimension,
      x: centre.x,
      y: 70,
      z: centre.z,
      angle: (index / Math.max(1, total)) * Math.PI * 2,
      radius: 60 + index * 25,
      centreX: centre.x,
      centreZ: centre.z,
    });
  }
  return players;
}

function step(player: FakePlayer): void {
  player.angle += 0.15;
  player.x = player.centreX + Math.cos(player.angle) * player.radius;
  player.z = player.centreZ + Math.sin(player.angle) * player.radius;
  player.y = 64 + Math.round(Math.sin(player.angle * 2) * 8);
}

async function worldCentre(): Promise<{ x: number; z: number }> {
  try {
    const info = (await fetch(`${base}/api/map/info`).then((response) => response.json())) as {
      center?: { x: number; z: number } | null;
    };
    if (info.center) return info.center;
  } catch {
    // The server may not be up yet; the origin is a fine fallback.
  }
  return { x: 0, z: 0 };
}

async function post(body: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body,
  });
  const text = await response.text();
  console.log(`  -> HTTP ${response.status} ${text.slice(0, 200)}`);
  if (!response.ok) process.exitCode = 1;
}

const centre = await worldCentre();
const players = makePlayers(centre);

console.log(`POSTing to ${endpoint}`);
console.log(
  `  ${overworldCount} overworld + ${netherCount} nether player(s) around ${centre.x},${centre.z}` +
    `${values.once ? ', once' : `, every ${interval} ms`}`,
);

async function sendUpdate(): Promise<void> {
  if (values.malformed) {
    console.log('sending malformed JSON');
    await post('{"players": [{"name": "Alex", ');
    return;
  }

  for (const player of players) step(player);
  const payload = {
    players: players.map((player) => ({
      name: player.name,
      id: player.id,
      x: Number(player.x.toFixed(2)),
      y: player.y,
      z: Number(player.z.toFixed(2)),
      dimension: player.dimension,
    })),
  };
  console.log(
    payload.players
      .map((player) => `${player.name} ${player.x},${player.y},${player.z} ${player.dimension}`)
      .join(' | ') || '(no players)',
  );
  await post(JSON.stringify(payload));
}

await sendUpdate();
if (!values.once) {
  setInterval(() => {
    void sendUpdate();
  }, interval);
}

/**
 * Persistent shared map markers: store, validation, and HTTP CRUD/auth.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startServer, type StartedServer } from '../server/index.ts';
import { JsonMarkerStore, MarkerConflictError, MarkerNotFoundError, markersFilePath } from '../server/markers/store.ts';
import { MARKER_CATEGORIES } from '../server/markers/types.ts';
import { MarkerValidationError, parseMarkerCreate, parseMarkerPatch } from '../server/markers/validate.ts';
import { blockToLatLng, latLngToBlock } from '../web/coords.js';

const fixtureWorld = '/tmp/m5-fixture-world';
const fixtureAvailable = await fs
  .access(path.join(fixtureWorld, 'level.dat'))
  .then(() => true)
  .catch(() => false);

describe('marker validation', () => {
  it('accepts a well formed create body and drops unknown fields', () => {
    const parsed = parseMarkerCreate({
      name: ' Spawn Base ',
      description: ' main house ',
      x: 100,
      z: -20,
      category: 'base',
      color: '#aabbcc',
      extra: 'nope',
    });
    assert.deepEqual(parsed, {
      name: 'Spawn Base',
      description: 'main house',
      x: 100,
      z: -20,
      category: 'base',
      color: '#AABBCC',
    });
  });

  it('rejects malformed coordinates and unknown categories', () => {
    assert.throws(() => parseMarkerCreate({ name: 'A', x: 1.5, z: 0, category: 'poi' }), MarkerValidationError);
    assert.throws(() => parseMarkerCreate({ name: 'A', x: NaN, z: 0, category: 'poi' }), MarkerValidationError);
    assert.throws(() => parseMarkerCreate({ name: 'A', x: 0, z: 0, category: 'castle' }), MarkerValidationError);
    assert.throws(() => parseMarkerCreate({ name: 'A', x: 1e12, z: 0, category: 'poi' }), MarkerValidationError);
  });

  it('rejects bad ids and colours', () => {
    assert.throws(() => parseMarkerCreate({ id: 'bad id', name: 'A', x: 0, z: 0, category: 'poi' }), /id/);
    assert.throws(() => parseMarkerCreate({ name: 'A', x: 0, z: 0, category: 'poi', color: 'red' }), /colour/);
  });

  it('requires at least one patch field and allows clearing description/color', () => {
    assert.throws(() => parseMarkerPatch({}), /at least one field/);
    assert.deepEqual(parseMarkerPatch({ description: null, color: null }), {
      description: null,
      color: null,
    });
  });

  it('lists the documented categories', () => {
    assert.deepEqual([...MARKER_CATEGORIES], [
      'base',
      'village',
      'portal',
      'farm',
      'shop',
      'poi',
      'warning',
      'custom',
    ]);
  });
});

describe('JSON marker store', () => {
  let cacheDir: string;

  before(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-markers-'));
  });

  after(async () => {
    if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('persists markers and reloads them from disk', async () => {
    const store = new JsonMarkerStore(cacheDir, () => Date.parse('2026-01-01T00:00:00.000Z'));
    const created = await store.create({
      name: 'Farm',
      x: 32,
      z: 64,
      category: 'farm',
      description: 'wheat',
    });
    assert.equal(created.name, 'Farm');
    assert.ok(created.id);
    assert.equal(created.createdAt, '2026-01-01T00:00:00.000Z');

    const onDisk = JSON.parse(await fs.readFile(markersFilePath(cacheDir), 'utf8'));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.markers.length, 1);

    const reloaded = new JsonMarkerStore(cacheDir);
    await reloaded.reloadFromDisk();
    const listed = await reloaded.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, created.id);
    assert.equal(listed[0]!.description, 'wheat');
  });

  it('rejects duplicate ids and missing updates', async () => {
    const store = new JsonMarkerStore(cacheDir);
    await store.create({ id: 'alpha', name: 'A', x: 0, z: 0, category: 'poi' });
    await assert.rejects(
      () => store.create({ id: 'alpha', name: 'B', x: 1, z: 1, category: 'poi' }),
      MarkerConflictError,
    );
    await assert.rejects(() => store.update('missing', { name: 'Nope' }), MarkerNotFoundError);
    assert.equal(await store.delete('missing'), false);
  });

  it('updates and deletes markers', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-markers-mut-'));
    try {
      const store = new JsonMarkerStore(dir);
      const created = await store.create({ name: 'Portal', x: 10, z: 20, category: 'portal' });
      const updated = await store.update(created.id, { name: 'Nether Portal', z: 21, description: 'obsidian' });
      assert.equal(updated.name, 'Nether Portal');
      assert.equal(updated.z, 21);
      assert.equal(updated.description, 'obsidian');
      assert.equal(await store.delete(created.id), true);
      assert.equal((await store.list()).length, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('marker coordinates match the map CRS', () => {
  it('round-trips Minecraft X/Z through Leaflet lat/lng', () => {
    const [lat, lng] = blockToLatLng(-120, 455);
    assert.deepEqual(latLngToBlock({ lat, lng }), { x: -120, z: 455 });
  });
});

describe(
  'marker HTTP API',
  { skip: fixtureAvailable ? false : 'fixture world missing at /tmp/m5-fixture-world' },
  () => {
    const apiKey = 'marker-test-key';
    let temp: string;
    let started: StartedServer;
    let base: string;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-markers-http-'));
      started = await startServer({
        worldPath: fixtureWorld,
        cacheDir: path.join(temp, 'cache'),
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 3000,
        playerDataTimeout: 10000,
        apiKey,
        logLevel: 'error',
      });
      base = `http://127.0.0.1:${started.port}`;
    });

    after(async () => {
      await started?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    async function create(body: unknown, headers: Record<string, string> = { 'x-api-key': apiKey }) {
      return fetch(`${base}/api/markers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    }

    it('lists markers without auth and starts empty', async () => {
      const response = await fetch(`${base}/api/markers`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { markers: unknown[] };
      assert.deepEqual(body.markers, []);
    });

    it('rejects create without a key, with a wrong key, and when the body is invalid', async () => {
      assert.equal((await create({ name: 'A', x: 0, z: 0, category: 'poi' }, {})).status, 401);
      assert.equal(
        (await create({ name: 'A', x: 0, z: 0, category: 'poi' }, { 'x-api-key': 'nope' })).status,
        401,
      );
      const bad = await create({ name: 'A', x: 1.25, z: 0, category: 'poi' });
      assert.equal(bad.status, 400);
      const message = ((await bad.json()) as { error: string }).error;
      assert.match(message, /integer/);
    });

    it('creates, reads, patches and deletes a marker', async () => {
      const createdResponse = await create({
        id: 'spawn-base',
        name: 'Spawn',
        x: 8,
        z: -4,
        category: 'base',
        description: 'starter house',
        color: '#4c8bf5',
      });
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()) as { id: string; name: string; x: number; z: number };
      assert.equal(created.id, 'spawn-base');
      assert.equal(created.x, 8);
      assert.equal(created.z, -4);

      const listed = (await fetch(`${base}/api/markers`).then((r) => r.json())) as {
        markers: { id: string }[];
      };
      assert.equal(listed.markers.length, 1);

      const one = await fetch(`${base}/api/markers/spawn-base`);
      assert.equal(one.status, 200);

      const patched = await fetch(`${base}/api/markers/spawn-base`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ name: 'Spawn Base', z: -5 }),
      });
      assert.equal(patched.status, 200);
      const updated = (await patched.json()) as { name: string; z: number };
      assert.equal(updated.name, 'Spawn Base');
      assert.equal(updated.z, -5);

      const deleted = await fetch(`${base}/api/markers/spawn-base`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey },
      });
      assert.equal(deleted.status, 200);
      assert.equal((await fetch(`${base}/api/markers/spawn-base`)).status, 404);
    });

    it('rejects a duplicate id with 409', async () => {
      assert.equal((await create({ id: 'dup', name: 'One', x: 0, z: 0, category: 'poi' })).status, 201);
      assert.equal((await create({ id: 'dup', name: 'Two', x: 1, z: 1, category: 'poi' })).status, 409);
    });

    it('survives a store reload from disk after the HTTP create', async () => {
      await create({ id: 'persist-me', name: 'Keep', x: 3, z: 4, category: 'shop' });
      await started.markers.reloadFromDisk();
      const again = await started.markers.get('persist-me');
      assert.equal(again?.name, 'Keep');
      assert.equal(again?.category, 'shop');
    });
  },
);

describe(
  'marker edits disabled without API_KEY',
  { skip: fixtureAvailable ? false : 'fixture world missing at /tmp/m5-fixture-world' },
  () => {
    let temp: string;
    let started: StartedServer;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-markers-nokey-'));
      started = await startServer({
        worldPath: fixtureWorld,
        cacheDir: path.join(temp, 'cache'),
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 3000,
        playerDataTimeout: 10000,
        apiKey: '',
        logLevel: 'error',
      });
    });

    after(async () => {
      await started?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    it('returns 503 for mutating routes when API_KEY is empty', async () => {
      const base = `http://127.0.0.1:${started.port}`;
      const response = await fetch(`${base}/api/markers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'anything' },
        body: JSON.stringify({ name: 'A', x: 0, z: 0, category: 'poi' }),
      });
      assert.equal(response.status, 503);
      assert.equal((await fetch(`${base}/api/markers`)).status, 200);
    });
  },
);

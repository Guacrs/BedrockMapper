/**
 * Integration tests for the tile pipeline and map server against a real world.
 *
 *   TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';
import { MapService, type MapInfo } from '../server/map-service.ts';
import { startServer, type StartedServer } from '../server/index.ts';
import { pixelAt, renderChunkSurface } from '../server/renderer/chunk-image.ts';
import { blockToTile, chunkToTile, tileToBlock, TILE_SIZE } from '../server/tiles/coords.ts';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { chunkToBlock } from '../server/world/keys.ts';

const worldPath = process.env.TEST_WORLD_PATH ?? process.env.WORLD_PATH;

async function hashDb(dbPath: string): Promise<string> {
  const hash = createHash('sha256');
  for (const name of (await fs.readdir(dbPath)).sort()) {
    hash.update(name);
    hash.update(await fs.readFile(path.join(dbPath, name)));
  }
  return hash.digest('hex');
}

function decodeTile(bytes: Uint8Array) {
  const decoded = decodePng(bytes);
  return {
    width: decoded.width,
    height: decoded.height,
    data: Uint8Array.from(decoded.data as Uint8Array),
  };
}

/** Geometric centre of a grown world can sit in an unexplored hole. */
function tileWithTerrain(map: MapService) {
  const bounds = map.info.chunkBounds;
  if (!bounds) throw new Error('world has no chunks');
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (map.hasChunkData(x, z)) return chunkToTile(x, z);
    }
  }
  throw new Error('world has no chunks with block data');
}

describe(
  'tile pipeline against a real world',
  { skip: worldPath ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let map: MapService;
    let cacheDir: string;

    before(async () => {
      cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-tiles-'));
      map = await MapService.create({ worldPath: worldPath!, cacheDir });
    });

    after(async () => {
      await map?.close();
      if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
    });

    it('reports bounds derived from the chunks that have block data', () => {
      const { chunkBounds, blockBounds, center, chunkCount } = map.info;
      assert.ok(chunkCount > 0);
      assert.ok(chunkBounds && blockBounds && center);
      assert.equal(blockBounds!.minX, chunkBounds!.minX * 16);
      assert.equal(blockBounds!.maxX, chunkBounds!.maxX * 16 + 15);
      assert.equal(blockBounds!.minZ, chunkBounds!.minZ * 16);
      assert.equal(blockBounds!.maxZ, chunkBounds!.maxZ * 16 + 15);
      assert.ok(center!.x >= blockBounds!.minX && center!.x <= blockBounds!.maxX);
      assert.ok(center!.z >= blockBounds!.minZ && center!.z <= blockBounds!.maxZ);
    });

    it('renders a tile of real terrain', async () => {
      const bounds = map.info.chunkBounds!;
      const tile = blockToTile(chunkToBlock(bounds.minX + 1, bounds.minZ + 1).x, chunkToBlock(bounds.minX + 1, bounds.minZ + 1).z);
      const result = await map.tile('overworld', 0, tile.x, tile.y);
      assert.equal(result.empty, false);

      const image = decodeTile(result.bytes);
      assert.equal(image.width, TILE_SIZE);
      assert.equal(image.height, TILE_SIZE);
      let opaque = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 255) opaque++;
      assert.ok(opaque > 0, 'a tile inside the world should have terrain pixels');
    });

    it('places real chunks at the right tile pixels, including negative coordinates', async () => {
      // Chunks verified in milestones 1 and 2, one with a negative Z and one
      // with a negative X.
      const candidates = [
        { chunkX: 18, chunkZ: -1 },
        { chunkX: -1, chunkZ: 10 },
        { chunkX: 30, chunkZ: 10 },
        { chunkX: 0, chunkZ: 0 },
      ].filter((chunk) => map.hasChunkData(chunk.chunkX, chunk.chunkZ));
      assert.ok(candidates.length >= 2, 'expected the verified test chunks to be present');

      for (const { chunkX, chunkZ } of candidates) {
        const origin = chunkToBlock(chunkX, chunkZ);
        const tile = blockToTile(origin.x, origin.z);
        const tileOrigin = tileToBlock(tile.x, tile.y);
        const result = await map.tile('overworld', 0, tile.x, tile.y);
        const image = decodeTile(result.bytes);

        const surface = (await map.surface(chunkX, chunkZ))!;
        // Same shading inputs the tile uses: heights from the neighbouring chunks.
        const north = await map.surface(chunkX, chunkZ - 1);
        const west = await map.surface(chunkX - 1, chunkZ);
        const chunkImage = renderChunkSurface(surface, {
          neighborHeight: (localX, localZ) => {
            const source = localZ < 0 ? north : localX < 0 ? west : null;
            if (!source) return null;
            const x = (localX + 16) % 16;
            const z = (localZ + 16) % 16;
            const y = source.heights[(x << 4) | z]!;
            return y === -32768 ? null : y;
          },
        });

        for (let localZ = 0; localZ < 16; localZ++) {
          for (let localX = 0; localX < 16; localX++) {
            const pixelX = origin.x + localX - tileOrigin.x;
            const pixelY = origin.z + localZ - tileOrigin.z;
            assert.deepEqual(
              [...pixelAt(image, pixelX, pixelY)],
              [...pixelAt(chunkImage, localX, localZ)],
              `chunk ${chunkX},${chunkZ} local ${localX},${localZ} -> tile pixel ${pixelX},${pixelY}`,
            );
          }
        }
      }
    });

    it('lines adjacent chunks up with no gap or overlap', async () => {
      const bounds = map.info.chunkBounds!;
      // Find two horizontally adjacent chunks that both have data.
      let pair: { x: number; z: number } | null = null;
      for (let z = bounds.minZ; z <= bounds.maxZ && !pair; z++) {
        for (let x = bounds.minX; x < bounds.maxX; x++) {
          if (map.hasChunkData(x, z) && map.hasChunkData(x + 1, z)) {
            pair = { x, z };
            break;
          }
        }
      }
      assert.ok(pair, 'expected two adjacent chunks with data');

      const left = (await map.surface(pair!.x, pair!.z))!;
      const right = (await map.surface(pair!.x + 1, pair!.z))!;
      const origin = chunkToBlock(pair!.x, pair!.z);
      const tile = blockToTile(origin.x, origin.z);
      const tileOrigin = tileToBlock(tile.x, tile.y);
      const image = decodeTile((await map.tile('overworld', 0, tile.x, tile.y)).bytes);

      // The last column of the left chunk and the first of the right chunk must
      // be neighbouring pixels, and both must be opaque terrain.
      for (let localZ = 0; localZ < 16; localZ++) {
        const leftPixelX = origin.x + 15 - tileOrigin.x;
        const rightPixelX = origin.x + 16 - tileOrigin.x;
        if (rightPixelX >= TILE_SIZE) continue;
        const pixelY = origin.z + localZ - tileOrigin.z;
        assert.equal(rightPixelX - leftPixelX, 1);
        assert.equal(pixelAt(image, leftPixelX, pixelY)[3], 255);
        assert.equal(pixelAt(image, rightPixelX, pixelY)[3], 255);
        assert.ok(left.blocks[(15 << 4) | localZ]);
        assert.ok(right.blocks[(0 << 4) | localZ]);
      }
    });

    it('joins real tiles at a tile border with no gap', async () => {
      // Chunk -1,z is the last chunk of tile -1,0 and chunk 0,z the first of
      // tile 0,0, so block X -1 and 0 are drawn by different tiles.
      const bounds = map.info.chunkBounds!;
      let found = -1;
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        if (map.hasChunkData(-1, z) && map.hasChunkData(0, z)) {
          found = z;
          break;
        }
      }
      assert.notEqual(found, -1, 'expected chunks either side of block X 0 to have data');
      const chunkZ: number = found;
      const tileY = blockToTile(0, chunkZ * 16).y;

      const west = decodeTile((await map.tile('overworld', 0, -1, tileY)).bytes);
      const east = decodeTile((await map.tile('overworld', 0, 0, tileY)).bytes);
      const westSurface = (await map.surface(-1, chunkZ))!;
      const eastSurface = (await map.surface(0, chunkZ))!;
      const tileOriginZ = tileToBlock(0, tileY).z;

      for (let localZ = 0; localZ < 16; localZ++) {
        const pixelY = chunkZ * 16 + localZ - tileOriginZ;
        // Block X -1 is the rightmost pixel of the western tile, block X 0 the
        // leftmost of the eastern one.
        assert.equal(pixelAt(west, 255, pixelY)[3], 255);
        assert.equal(pixelAt(east, 0, pixelY)[3], 255);
        assert.ok(westSurface.blocks[(15 << 4) | localZ], 'block -1 should be a real surface block');
        assert.ok(eastSurface.blocks[(0 << 4) | localZ], 'block 0 should be a real surface block');
      }
    });

    it('caches tiles on disk and does not decode chunks twice', async () => {
      const tile = tileWithTerrain(map);
      // Start from a cold disk cache: earlier tests may already have rendered
      // this tile.
      await fs.rm(map.tileCache.tilePath('overworld', 0, tile.x, tile.y), { force: true });

      const first = await map.tile('overworld', 0, tile.x, tile.y);
      const decodedAfterFirst = map.decodedChunks;
      const second = await map.tile('overworld', 0, tile.x, tile.y);

      assert.equal(first.cached, false);
      assert.equal(second.cached, true);
      assert.equal(map.decodedChunks, decodedAfterFirst, 'a cached tile must not decode chunks');
      assert.deepEqual(Uint8Array.from(second.bytes), Uint8Array.from(first.bytes));
      const onDisk = await fs.readFile(map.tileCache.tilePath('overworld', 0, tile.x, tile.y));
      assert.deepEqual(Uint8Array.from(onDisk), Uint8Array.from(first.bytes));
    });

    it('serves a transparent tile far outside the world', async () => {
      const result = await map.tile('overworld', 0, 9999, 9999);
      assert.equal(result.empty, true);
      const image = decodeTile(result.bytes);
      for (let i = 3; i < image.data.length; i += 4) assert.equal(image.data[i], 0);
    });

    it('rejects zoom levels it does not render and other dimensions', async () => {
      await assert.rejects(() => map.tile('overworld', 3, 0, 0), /zoom/);
      await assert.rejects(() => map.tile('nether', 0, 0, 0), /Dimension not rendered/);
    });

    it('leaves the source world untouched while serving tiles', async () => {
      const sourceDb = path.join(worldPath!, 'db');
      const before = await hashDb(sourceDb);
      await map.tile('overworld', 0, 0, 0);
      await map.tile('overworld', 0, 1, 0);
      assert.equal(await hashDb(sourceDb), before);
      assert.notEqual(path.resolve(map.world.snapshot.dbPath), path.resolve(sourceDb));
    });
  },
);

interface PlayerSnapshotResponse {
  players: { name: string; id?: string; x: number; y: number; z: number; dimension: string }[];
  updatedAt: string | null;
  stale: boolean;
  ageMs: number | null;
  timeoutMs: number;
}

const API_KEY = 'test-api-key';

describe(
  'map server HTTP interface',
  { skip: worldPath ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let started: StartedServer;
    let cacheDir: string;
    let base: string;

    const postPlayers = (players: unknown[]) =>
      fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ players }),
      });

    const getPlayers = (query = ''): Promise<PlayerSnapshotResponse> =>
      fetch(`${base}/api/players${query}`).then((response) => response.json() as Promise<PlayerSnapshotResponse>);

    before(async () => {
      cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-http-'));
      started = await startServer({
        worldPath: worldPath!,
        cacheDir,
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 3000,
        playerDataTimeout: 10000,
        apiKey: API_KEY,
        markerApiKey: '',
        logLevel: 'error',
      });
      base = `http://127.0.0.1:${started.port}`;
    });

    after(async () => {
      await started?.close();
      if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
    });

    it('serves the map page and its assets', async () => {
      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      const html = await page.text();
      assert.match(html, /<div id="map">/);
      assert.match(html, /id="view3d"/);
      assert.match(html, /id="mode-3d"/);

      for (const asset of [
        '/map.js',
        '/style.css',
        '/vendor/leaflet/leaflet.js',
        '/vendor/leaflet/leaflet.css',
        '/vendor/three/build/three.module.js',
        '/viewer3d/viewer.js',
      ]) {
        const response = await fetch(`${base}${asset}`);
        assert.equal(response.status, 200, `${asset} should be served`);
      }
    });

    it('serves terrain mesh JSON for a chunk with block data', async () => {
      const bounds = started.map.info.chunkBounds;
      assert.ok(bounds);
      let chunkX = bounds!.minX;
      let chunkZ = bounds!.minZ;
      outer: for (let z = bounds!.minZ; z <= bounds!.maxZ; z++) {
        for (let x = bounds!.minX; x <= bounds!.maxX; x++) {
          if (started.map.hasChunkData(x, z)) {
            chunkX = x;
            chunkZ = z;
            break outer;
          }
        }
      }

      const url = `${base}/api/mesh/overworld/${chunkX}/${chunkZ}`;
      const first = await fetch(url);
      assert.equal(first.status, 200);
      const body = (await first.json()) as {
        dimension: string;
        chunkX: number;
        chunkZ: number;
        positions: number[];
        normals: number[];
        colors: number[];
        indices: number[];
      };
      assert.equal(body.dimension, 'overworld');
      assert.equal(body.chunkX, chunkX);
      assert.equal(body.chunkZ, chunkZ);
      assert.equal(body.positions.length % 3, 0);
      assert.equal(body.normals.length, body.positions.length);
      assert.equal(body.colors.length, body.positions.length);
      assert.equal(body.indices.length % 3, 0);

      const before = started.map.meshCacheStats;
      const second = await fetch(url);
      assert.equal(second.status, 200);
      const after = started.map.meshCacheStats;
      assert.ok(after.hits > before.hits, 'second mesh request should hit the cache');
    });

    it('returns 204 for mesh of an empty chunk and 404 for unknown dimension', async () => {
      const missing = await fetch(`${base}/api/mesh/overworld/999999/999999`);
      assert.equal(missing.status, 204);
      const badDim = await fetch(`${base}/api/mesh/not-a-dimension/0/0`);
      assert.equal(badDim.status, 404);
    });

    it('serves map info describing the real world', async () => {
      const info = (await fetch(`${base}/api/map/info`).then((response) => response.json())) as MapInfo & {
        textureAtlas?: boolean;
      };
      assert.equal(info.dimension, 'overworld');
      assert.equal(info.tileSize, TILE_SIZE);
      assert.ok(info.chunkCount > 0);
      assert.ok(info.blockBounds);
      assert.equal(typeof info.textureAtlas, 'boolean');
      assert.match(info.world.version ?? '', /^\d+\.\d+/);
    });

    it('serves PNG tiles, from cache on the second request', async () => {
      const tile = tileWithTerrain(started.map);
      const url = `${base}/tiles/overworld/0/${tile.x}/${tile.y}.png`;

      const first = await fetch(url);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('content-type'), 'image/png');
      const bytes = new Uint8Array(await first.arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
      const image = decodeTile(bytes);
      assert.equal(image.width, TILE_SIZE);

      const second = await fetch(url);
      assert.equal(second.headers.get('x-tile-source'), 'cache');
    });

    it('serves an empty tile outside the world instead of failing', async () => {
      const response = await fetch(`${base}/tiles/overworld/0/9999/9999.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-tile-source'), 'empty');
    });

    it('handles negative tile coordinates in the URL', async () => {
      const response = await fetch(`${base}/tiles/overworld/0/-1/-1.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
    });

    it('reports no players before any update arrives', async () => {
      const snapshot = (await fetch(`${base}/api/players`).then((response) => response.json())) as {
        players: unknown[];
        updatedAt: string | null;
        stale: boolean;
      };
      assert.deepEqual(snapshot.players, []);
      assert.equal(snapshot.updatedAt, null);
      assert.equal(snapshot.stale, true);
    });

    it('accepts an authenticated player update and serves it back', async () => {
      const posted = await postPlayers([
        { name: 'Alex', id: '1', x: 1234.5, y: 68, z: -543.2, dimension: 'minecraft:overworld' },
        { name: 'Steve', id: '2', x: -12.25, y: 71, z: 8, dimension: 'minecraft:overworld' },
      ]);
      assert.equal(posted.status, 200);
      assert.deepEqual(await posted.json(), { ok: true, players: 2 });

      const snapshot = await getPlayers();
      assert.equal(snapshot.stale, false);
      assert.ok(snapshot.updatedAt);
      assert.deepEqual(snapshot.players, [
        { name: 'Alex', id: '1', x: 1234.5, y: 68, z: -543.2, dimension: 'overworld' },
        { name: 'Steve', id: '2', x: -12.25, y: 71, z: 8, dimension: 'overworld' },
      ]);
    });

    it('replaces the list, so movement and disconnects are reflected', async () => {
      await postPlayers([
        { name: 'Alex', id: '1', x: 0, y: 68, z: 0, dimension: 'overworld' },
        { name: 'Steve', id: '2', x: 50, y: 68, z: 50, dimension: 'overworld' },
      ]);
      await postPlayers([{ name: 'Alex', id: '1', x: 64.5, y: 70, z: -32.5, dimension: 'overworld' }]);

      const snapshot = await getPlayers();
      assert.equal(snapshot.players.length, 1, 'Steve left, so he is gone');
      assert.deepEqual(snapshot.players[0], {
        name: 'Alex',
        id: '1',
        x: 64.5,
        y: 70,
        z: -32.5,
        dimension: 'overworld',
      });

      await postPlayers([]);
      const empty = await getPlayers();
      assert.deepEqual(empty.players, []);
      assert.equal(empty.stale, false, 'an empty server is not stale data');
    });

    it('keeps the dimension and can filter by it', async () => {
      await postPlayers([
        { name: 'Alex', x: 0, y: 68, z: 0, dimension: 'minecraft:overworld' },
        { name: 'Steve', x: 10, y: 40, z: 10, dimension: 'minecraft:nether' },
        { name: 'Zuri', x: 100, y: 60, z: 100, dimension: 'minecraft:the_end' },
      ]);

      const all = await getPlayers();
      assert.deepEqual(
        all.players.map((player) => `${player.name}:${player.dimension}`),
        ['Alex:overworld', 'Steve:nether', 'Zuri:the_end'],
      );

      const overworld = await getPlayers('?dimension=overworld');
      assert.deepEqual(
        overworld.players.map((player) => player.name),
        ['Alex'],
        'nether and end players are not on the overworld map',
      );
      const nether = await getPlayers('?dimension=minecraft:nether');
      assert.deepEqual(
        nether.players.map((player) => player.name),
        ['Steve'],
      );
    });

    it('rejects updates without a valid API key', async () => {
      await postPlayers([{ name: 'Ghost', x: 0, y: 0, z: 0, dimension: 'overworld' }]);

      const noHeader = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ players: [] }),
      });
      assert.equal(noHeader.status, 401);
      assert.match(noHeader.headers.get('www-authenticate') ?? '', /Bearer/);

      const wrongKey = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
        body: JSON.stringify({ players: [] }),
      });
      assert.equal(wrongKey.status, 401);

      const wrongScheme = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: API_KEY },
        body: JSON.stringify({ players: [] }),
      });
      assert.equal(wrongScheme.status, 401);

      const wrongDirectKey = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'nope' },
        body: JSON.stringify({ players: [] }),
      });
      assert.equal(wrongDirectKey.status, 401);

      const snapshot = await getPlayers();
      assert.deepEqual(
        snapshot.players.map((player) => player.name),
        ['Ghost'],
        'a rejected update must not change the stored list',
      );
    });

    it('accepts the key in X-Api-Key, which is what the BDS addon can send', async () => {
      // The Script API hands out the server secret as a SecretString that can
      // only be passed as a whole header value, never concatenated after
      // "Bearer ", so this header has to work too.
      const response = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({
          players: [{ name: 'Secret', x: 1, y: 2, z: 3, dimension: 'minecraft:overworld' }],
        }),
      });
      assert.equal(response.status, 200);
      const snapshot = await getPlayers();
      assert.deepEqual(
        snapshot.players.map((player) => player.name),
        ['Secret'],
      );
    });

    it('rejects malformed and oversized bodies', async () => {
      const malformed = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: '{"players": [{"name": "Alex", ',
      });
      assert.equal(malformed.status, 400);
      assert.match(((await malformed.json()) as { error: string }).error, /valid JSON/);

      const invalid = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ players: [{ name: 'Alex', x: 'over there', y: 1, z: 2, dimension: 'overworld' }] }),
      });
      assert.equal(invalid.status, 400);
      assert.match(((await invalid.json()) as { error: string }).error, /players\[0\]\.x/);

      const huge = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ players: [], padding: 'x'.repeat(100_000) }),
      });
      assert.equal(huge.status, 413);
    });

    it('drops players once the data goes stale', async () => {
      // A second server with a very short timeout, so this does not wait long.
      const staleCache = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-stale-'));
      const shortLived = await startServer({
        worldPath: worldPath!,
        cacheDir: staleCache,
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 1000,
        playerDataTimeout: 300,
        apiKey: API_KEY,
        markerApiKey: '',
        logLevel: 'error',
      });
      try {
        const url = `http://127.0.0.1:${shortLived.port}/api/players`;
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
          body: JSON.stringify({ players: [{ name: 'Alex', x: 0, y: 68, z: 0, dimension: 'overworld' }] }),
        });

        const fresh = (await fetch(url).then((response) => response.json())) as PlayerSnapshotResponse;
        assert.equal(fresh.players.length, 1);
        assert.equal(fresh.stale, false);

        await new Promise((resolve) => setTimeout(resolve, 400));

        const stale = (await fetch(url).then((response) => response.json())) as PlayerSnapshotResponse;
        assert.deepEqual(stale.players, [], 'stale data must not keep showing players');
        assert.equal(stale.stale, true);
        assert.ok(stale.updatedAt, 'it still reports when the last update arrived');
        assert.equal(stale.timeoutMs, 300);
      } finally {
        await shortLived.close();
        await fs.rm(staleCache, { recursive: true, force: true });
      }
    });

    it('publishes the poll interval and staleness timeout to the browser', async () => {
      const info = (await fetch(`${base}/api/map/info`).then((response) => response.json())) as MapInfo & {
        playerPollInterval: number;
        playerDataTimeout: number;
      };
      assert.equal(info.playerPollInterval, 3000);
      assert.equal(info.playerDataTimeout, 10000);
    });

    it('refuses player updates when no API key is configured', async () => {
      const openCache = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-nokey-'));
      const unconfigured = await startServer({
        worldPath: worldPath!,
        cacheDir: openCache,
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 3000,
        playerDataTimeout: 10000,
        apiKey: '',
        markerApiKey: '',
        logLevel: 'error',
      });
      try {
        const response = await fetch(`http://127.0.0.1:${unconfigured.port}/api/players`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
          body: JSON.stringify({ players: [] }),
        });
        assert.equal(response.status, 503);
        assert.match(((await response.json()) as { error: string }).error, /API_KEY/);
      } finally {
        await unconfigured.close();
        await fs.rm(openCache, { recursive: true, force: true });
      }
    });

    it('serves a health endpoint without secrets', async () => {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.status, 'ok');
      assert.equal(typeof body.world, 'string');
      assert.ok(body.world);
      assert.equal(body.mapVersion, 1);
      assert.equal(body.lastWorldRefresh, null);
      assert.ok(body.playerDataAge === null || typeof body.playerDataAge === 'number');
      const dumped = JSON.stringify(body);
      assert.doesNotMatch(dumped, /apiKey|API_KEY|cacheDir|WORLD_PATH|127\.0\.0\.1/);
      assert.doesNotMatch(dumped, new RegExp(API_KEY));
    });

    it('stops accepting requests after a graceful close', async () => {
      const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-close-'));
      const extra = await startServer({
        worldPath: worldPath!,
        cacheDir: cache,
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 0,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 3000,
        playerDataTimeout: 10000,
        apiKey: API_KEY,
        markerApiKey: '',
        logLevel: 'error',
      });
      const url = `http://127.0.0.1:${extra.port}/api/health`;
      assert.equal((await fetch(url)).status, 200);
      await extra.close();
      await assert.rejects(() => fetch(url), { name: 'TypeError' });
      await fs.rm(cache, { recursive: true, force: true });
    });

    it('refuses unknown routes, other methods and path traversal', async () => {
      assert.equal((await fetch(`${base}/nope`)).status, 404);
      assert.equal((await fetch(`${base}/tiles/mars/0/0/0.png`)).status, 404);
      assert.equal((await fetch(`${base}/tiles/overworld/9/0/0.png`)).status, 404);
      assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
      assert.equal((await fetch(`${base}/../package.json`)).status, 404);
      assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
      assert.equal((await fetch(`${base}/vendor/leaflet/../../package.json`)).status, 404);
    });
  },
);

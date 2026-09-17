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
import { blockToTile, tileToBlock, TILE_SIZE } from '../server/tiles/coords.ts';
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

    it('caches tiles on disk and does not decode chunks twice', async () => {
      const tile = blockToTile(map.info.center!.x, map.info.center!.z);
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

describe(
  'map server HTTP interface',
  { skip: worldPath ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let started: StartedServer;
    let cacheDir: string;
    let base: string;

    before(async () => {
      cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-http-'));
      started = await startServer({
        worldPath: worldPath!,
        cacheDir,
        port: 0,
        playerUpdateInterval: 3000,
        apiKey: 'test',
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
      assert.match(await page.text(), /<div id="map">/);

      for (const asset of ['/map.js', '/style.css', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css']) {
        const response = await fetch(`${base}${asset}`);
        assert.equal(response.status, 200, `${asset} should be served`);
      }
    });

    it('serves map info describing the real world', async () => {
      const info = (await fetch(`${base}/api/map/info`).then((response) => response.json())) as MapInfo;
      assert.equal(info.dimension, 'overworld');
      assert.equal(info.tileSize, TILE_SIZE);
      assert.ok(info.chunkCount > 0);
      assert.ok(info.blockBounds);
      assert.match(info.world.version ?? '', /^\d+\.\d+/);
    });

    it('serves PNG tiles, from cache on the second request', async () => {
      const { center } = started.map.info;
      const tile = blockToTile(center!.x, center!.z);
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

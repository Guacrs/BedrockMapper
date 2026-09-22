/**
 * Live terrain refresh against a real world.
 *
 * The world under test is a *copy* of a real BDS world, written to with LevelDB
 * the same way the server writes to its own - the real world is only ever read,
 * and only through snapshots.
 *
 *   TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';
import { startServer, type StartedServer } from '../server/index.ts';
import { MapService } from '../server/map-service.ts';
import { blockToTile, chunkToTile, tileToBlock } from '../server/tiles/coords.ts';
import { chunkToBlock, type ChunkPos } from '../server/world/keys.ts';
import { snapshotRootFor } from '../server/world/snapshot.ts';
import { copyWorld, hashDatabase, WorldWriter } from './live-world.ts';

const sourceWorld = process.env.TEST_WORLD_PATH ?? process.env.WORLD_PATH;

interface Tile {
  width: number;
  height: number;
  data: Uint8Array;
}

function decodeTile(bytes: Uint8Array): Tile {
  const decoded = decodePng(bytes);
  return { width: decoded.width, height: decoded.height, data: Uint8Array.from(decoded.data as Uint8Array) };
}

function pixel(tile: Tile, x: number, y: number): number[] {
  const offset = (y * tile.width + x) * 4;
  return [...tile.data.subarray(offset, offset + 4)];
}

/** The 16x16 pixels a chunk occupies inside its tile. */
function chunkPixels(tile: Tile, chunk: ChunkPos): number[][] {
  const origin = chunkToBlock(chunk.x, chunk.z);
  const tileOrigin = tileToBlock(...(Object.values(blockToTile(origin.x, origin.z)) as [number, number]));
  const pixels: number[][] = [];
  for (let localZ = 0; localZ < 16; localZ++) {
    for (let localX = 0; localX < 16; localX++) {
      pixels.push(pixel(tile, origin.x + localX - tileOrigin.x, origin.z + localZ - tileOrigin.z));
    }
  }
  return pixels;
}

describe(
  'live terrain refresh',
  { skip: sourceWorld ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let worldPath: string;
    let cacheDir: string;
    let temp: string;
    let map: MapService;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-refresh-'));
      worldPath = path.join(temp, 'world');
      cacheDir = path.join(temp, 'cache');
      await copyWorld(sourceWorld!, worldPath);
      map = await MapService.create({ worldPath, cacheDir });
    });

    after(async () => {
      await map?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    /** A chunk with block data, at least `margin` chunks inside the mapped area. */
    const chunkWithData = (margin = 2, predicate: (chunk: ChunkPos) => boolean = () => true): ChunkPos => {
      const bounds = map.info.chunkBounds!;
      for (let z = bounds.minZ + margin; z <= bounds.maxZ - margin; z++) {
        for (let x = bounds.minX + margin; x <= bounds.maxX - margin; x++) {
          if (!predicate({ x, z })) continue;
          let complete = true;
          for (let dz = -1; dz <= 1 && complete; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!map.hasChunkData(x + dx, z + dz)) complete = false;
            }
          }
          if (complete) return { x, z };
        }
      }
      throw new Error('no chunk with a full ring of neighbours found in the test world');
    };

    const readTile = async (tile: { x: number; y: number }) =>
      decodeTile((await map.tile('overworld', 0, tile.x, tile.y)).bytes);

    const writer = async <T>(use: (writer: WorldWriter) => Promise<T>): Promise<T> => {
      const handle = await WorldWriter.open(worldPath);
      try {
        return await use(handle);
      } finally {
        await handle.close();
      }
    };

    it('does almost nothing when the world has not changed', async () => {
      // Warm the caches first so "no work" is measurable.
      const tile = chunkToTile(chunkWithData().x, chunkWithData().z);
      await map.tile('overworld', 0, tile.x, tile.y);

      const decoded = map.decodedChunks;
      const writes = map.tileCache.stats.writes;
      const version = map.version;

      const first = await map.refresh();
      const second = await map.refresh();

      for (const stats of [first, second]) {
        assert.equal(stats.error, null);
        assert.equal(stats.sourceChanged, false, 'an untouched world must not be re-snapshotted');
        assert.equal(stats.snapshotCopied, false);
        assert.equal(stats.chunksScanned, 0, 'nothing should be scanned');
        assert.equal(stats.tilesInvalidated, 0);
        assert.equal(stats.tilesRegenerated, 0);
        assert.ok(stats.totalMs < 500, `a no-change refresh should be cheap, took ${stats.totalMs} ms`);
      }
      assert.equal(map.decodedChunks, decoded, 'no chunk should be decoded again');
      assert.equal(map.tileCache.stats.writes, writes, 'no tile should be rendered again');
      assert.equal(map.version, version, 'the map version only moves when terrain changes');
    });

    it('picks up a newly generated chunk and invalidates only the tiles it touches', async () => {
      // A hole inside the mapped area: its tile is already cached, so this is
      // the "new chunk appears in an existing tile" case.
      const donor = chunkWithData();
      const bounds = map.info.chunkBounds!;
      let target: ChunkPos | null = null;
      for (let z = bounds.minZ + 2; z <= bounds.maxZ - 2 && !target; z++) {
        for (let x = bounds.minX + 2; x <= bounds.maxX - 2; x++) {
          if (map.hasChunkData(x, z)) continue;
          // Not on a tile edge, so exactly one tile is affected.
          if (x % 16 === 15 || z % 16 === 15) continue;
          const tile = chunkToTile(x, z);
          if (map.hasChunkData(tile.x * 16 + 8, tile.y * 16 + 8)) target = { x, z };
          if (target) break;
        }
      }
      assert.ok(target, 'expected an ungenerated chunk inside the mapped area');

      const tile = chunkToTile(target!.x, target!.z);
      const before = await readTile(tile);
      assert.ok(
        chunkPixels(before, target!).every((rgba) => rgba[3] === 0),
        'the chunk should start out as a transparent hole',
      );
      const farAway = chunkWithData(2, (chunk) => chunkToTile(chunk.x, chunk.z).x === tile.x
        && chunkToTile(chunk.x, chunk.z).y === tile.y
        && Math.abs(chunk.x - target!.x) > 2
        && Math.abs(chunk.z - target!.z) > 2);
      const farAwayBefore = chunkPixels(before, farAway);

      const version = map.version;
      const subChunks = await writer((handle) => handle.copyChunk(donor, target!));
      assert.ok(subChunks > 0);

      const stats = await map.refresh();
      assert.equal(stats.error, null);
      assert.equal(stats.sourceChanged, true);
      assert.equal(stats.snapshotCopied, true);
      assert.equal(stats.addedChunks, 1, 'exactly one chunk gained block data');
      assert.equal(stats.changedChunks, 0);
      assert.equal(stats.removedChunks, 0);
      assert.equal(stats.tilesInvalidated, 1, 'only the tile containing the new chunk');
      assert.equal(stats.tilesRegenerated, 1);
      assert.equal(stats.chunksDecoded, 1, 'only the new chunk should be decoded');
      assert.equal(map.version, version + 1);
      assert.ok(map.hasChunkData(target!.x, target!.z));

      const after = await readTile(tile);
      assert.ok(
        chunkPixels(after, target!).some((rgba) => rgba[3] === 255),
        'the new chunk should now be drawn',
      );
      assert.deepEqual(
        chunkPixels(after, farAway),
        farAwayBefore,
        'unrelated chunks in the same tile must be unchanged',
      );
    });

    it('extends the map when terrain appears outside the previous bounds', async () => {
      const bounds = map.info.chunkBounds!;
      const donor = chunkWithData();
      const target = { x: bounds.maxX + 20, z: bounds.maxZ + 20 };
      const tile = chunkToTile(target.x, target.z);
      assert.equal((await map.tile('overworld', 0, tile.x, tile.y)).empty, true);

      const version = map.version;
      await writer((handle) => handle.copyChunk(donor, target));
      const stats = await map.refresh();

      assert.equal(stats.error, null);
      assert.equal(stats.addedChunks, 1);
      assert.equal(map.version, version + 1);
      assert.equal(map.info.chunkBounds!.maxX, target.x, 'the reported extent should grow');
      assert.equal(map.info.chunkBounds!.maxZ, target.z);
      assert.equal(map.info.chunkCount, bounds ? map.info.chunkCount : 0);
      assert.deepEqual(map.state.chunkBounds, map.info.chunkBounds);

      const rendered = await map.tile('overworld', 0, tile.x, tile.y);
      assert.equal(rendered.empty, false, 'the new area should render on request');
    });

    it('re-renders a changed chunk and leaves the rest of the tile alone', async () => {
      const chunk = chunkWithData(3, (candidate) => candidate.x % 16 !== 15 && candidate.z % 16 !== 15);
      const tile = chunkToTile(chunk.x, chunk.z);
      const before = await readTile(tile);
      const beforePixels = chunkPixels(before, chunk);
      const untouched = chunkWithData(3, (candidate) =>
        chunkToTile(candidate.x, candidate.z).x === tile.x &&
        chunkToTile(candidate.x, candidate.z).y === tile.y &&
        Math.abs(candidate.x - chunk.x) > 2 &&
        Math.abs(candidate.z - chunk.z) > 2);
      const untouchedBefore = chunkPixels(before, untouched);

      const version = map.version;
      const removed = await writer((handle) => handle.removeTopSubChunk(chunk));
      assert.notEqual(removed, null);

      const stats = await map.refresh();
      assert.equal(stats.error, null);
      assert.equal(stats.addedChunks, 0);
      assert.equal(stats.changedChunks, 1, 'exactly one chunk changed');
      assert.equal(stats.tilesInvalidated, 1);
      assert.equal(stats.tilesRegenerated, 1);
      assert.equal(stats.chunksDecoded, 1, 'unchanged chunks must stay cached');
      assert.equal(map.version, version + 1);

      const after = await readTile(tile);
      assert.notDeepEqual(chunkPixels(after, chunk), beforePixels, 'the changed chunk should look different');
      assert.deepEqual(chunkPixels(after, untouched), untouchedBefore);
    });

    it('invalidates the neighbouring tile a changed chunk shades into', async () => {
      // Shading reads the column to the west, so the first pixel column of the
      // tile east of a changed chunk depends on that chunk.
      const chunk = chunkWithData(3, (candidate) => candidate.x % 16 === 15 && candidate.z % 16 !== 15);
      const ownTile = chunkToTile(chunk.x, chunk.z);
      const eastTile = { x: ownTile.x + 1, y: ownTile.y };
      const beforeOwn = await readTile(ownTile);
      const beforeEast = await readTile(eastTile);
      const eastColumnBefore = Array.from({ length: 16 }, (_, i) =>
        pixel(beforeEast, 0, chunk.z * 16 + i - tileToBlock(eastTile.x, eastTile.y).z),
      );

      const stats = await (async () => {
        await writer((handle) => handle.removeTopSubChunk(chunk));
        return map.refresh();
      })();

      assert.equal(stats.error, null);
      assert.equal(stats.changedChunks, 1);
      assert.equal(stats.tilesInvalidated, 2, 'the chunk\'s tile and the tile it shades into');
      assert.equal(stats.tilesRegenerated, 2);

      const afterEast = await readTile(eastTile);
      const eastColumnAfter = Array.from({ length: 16 }, (_, i) =>
        pixel(afterEast, 0, chunk.z * 16 + i - tileToBlock(eastTile.x, eastTile.y).z),
      );
      assert.notDeepEqual(
        eastColumnAfter,
        eastColumnBefore,
        'the neighbouring tile should be reshaded against the changed chunk',
      );
      assert.notDeepEqual(chunkPixels(await readTile(ownTile), chunk), chunkPixels(beforeOwn, chunk));
    });

    it('leaves the browser alone when a change is invisible from above', async () => {
      const chunk = chunkWithData(3, (candidate) => candidate.x % 16 !== 15 && candidate.z % 16 !== 15);
      const tile = chunkToTile(chunk.x, chunk.z);
      const before = await readTile(tile);
      const version = map.version;
      const meshVersion = map.meshVersion;

      // Deep underground: a running server rewrites chunks like this constantly.
      const removed = await writer((handle) => handle.removeBottomSubChunk(chunk));
      assert.notEqual(removed, null);

      const stats = await map.refresh();
      assert.equal(stats.error, null);
      assert.equal(stats.changedChunks, 1, 'the chunk\'s block data did change');
      assert.ok(stats.tilesRegenerated >= 1, 'so its tile is drawn again from the new snapshot');
      assert.equal(stats.tilesChanged, 0, 'but the tile came out identical');
      assert.equal(map.version, version, 'so no browser is asked to re-fetch it');
      assert.equal(map.meshVersion, meshVersion + 1, 'but 3D must still reload meshes');
      assert.deepEqual(await readTile(tile), before);
    });

    it('notices block data disappearing', async () => {
      const chunk = chunkWithData(3, (candidate) => candidate.x % 16 !== 15 && candidate.z % 16 !== 15);
      const tile = chunkToTile(chunk.x, chunk.z);
      await readTile(tile);

      const version = map.version;
      const removed = await writer((handle) => handle.removeAllSubChunks(chunk));
      assert.ok(removed > 0);

      const stats = await map.refresh();
      assert.equal(stats.error, null);
      assert.equal(stats.removedChunks, 1);
      assert.equal(stats.tilesInvalidated, 1);
      assert.equal(map.version, version + 1);
      assert.equal(map.hasChunkData(chunk.x, chunk.z), false);

      const after = await readTile(tile);
      assert.ok(
        chunkPixels(after, chunk).every((rgba) => rgba[3] === 0),
        'a chunk without block data should become a transparent hole again',
      );
    });

    it('keeps the previous snapshot when a new one cannot be opened', async () => {
      const currentPath = path.join(worldPath, 'db', 'CURRENT');
      const good = await fs.readFile(currentPath);
      const snapshotBefore = map.world.snapshot.sourceId;
      const version = map.version;
      const chunk = chunkWithData();
      const tile = chunkToTile(chunk.x, chunk.z);
      const tileBefore = await readTile(tile);

      // A CURRENT pointing at a manifest that does not exist is exactly what a
      // torn copy looks like: the copy is taken, but nothing can open it.
      try {
        await fs.writeFile(currentPath, 'MANIFEST-999999\n');
        const failed = await map.refresh();

        assert.ok(failed.error, 'the refresh should report a failure');
        assert.match(failed.error!, /snapshot failed, keeping the previous one/);
        assert.equal(map.world.snapshot.sourceId, snapshotBefore, 'the good snapshot must be kept');
        assert.equal(map.version, version, 'a failed refresh must not bump the map version');
        assert.deepEqual(await readTile(tile), tileBefore, 'the map keeps serving the last known terrain');
        const snapshots = await fs.readdir(snapshotRootFor(worldPath, cacheDir));
        assert.deepEqual(snapshots, [snapshotBefore], 'the unusable copy should be discarded');
      } finally {
        await fs.writeFile(currentPath, good);
      }

      // ... and the next interval recovers, on a fresh snapshot.
      const recovered = await map.refresh();
      assert.equal(recovered.error, null);
      assert.equal(recovered.sourceChanged, true);
      assert.notEqual(map.world.snapshot.sourceId, snapshotBefore);
      assert.equal(map.version, version, 'restoring the file changed no terrain');
      assert.deepEqual(await readTile(tile), tileBefore);
    });

    it('survives the world directory going missing', async () => {
      const dbPath = path.join(worldPath, 'db');
      const hidden = path.join(worldPath, 'db-hidden');
      const version = map.version;
      await fs.rename(dbPath, hidden);
      try {
        const stats = await map.refresh();
        assert.match(stats.error!, /could not read the world directory/);
        assert.equal(map.version, version);
      } finally {
        await fs.rename(hidden, dbPath);
      }

      const chunk = chunkWithData();
      const tile = chunkToTile(chunk.x, chunk.z);
      assert.equal((await map.tile('overworld', 0, tile.x, tile.y)).empty, false, 'the map still works');
    });

    it('snapshots a world that is being written to', async () => {
      // The BDS case: another process holds the database open while we copy it.
      const handle = await WorldWriter.open(worldPath);
      try {
        const donor = chunkWithData();
        const bounds = map.info.chunkBounds!;
        await handle.copyChunk(donor, { x: bounds.minX - 5, z: bounds.minZ - 5 });
        const stats = await map.refresh();
        assert.equal(stats.error, null, 'a live writer must not break the snapshot');
        assert.ok(stats.addedChunks >= 1);
      } finally {
        await handle.close();
      }
    });

    it('leaves the world database untouched through all of this', async () => {
      const dbPath = path.join(worldPath, 'db');
      const before = await hashDatabase(dbPath);
      await map.refresh();
      await map.refresh();
      const chunk = chunkWithData();
      await map.tile('overworld', 0, chunkToTile(chunk.x, chunk.z).x, chunkToTile(chunk.x, chunk.z).y);
      assert.equal(await hashDatabase(dbPath), before, 'refreshing must not write to the world');
      assert.notEqual(path.resolve(map.world.snapshot.dbPath), path.resolve(dbPath));
    });

    it('keeps exactly one snapshot on disk', async () => {
      const snapshots = await fs.readdir(snapshotRootFor(worldPath, cacheDir));
      assert.deepEqual(snapshots, [map.world.snapshot.sourceId]);
    });
  },
);

describe(
  'tile update cooldown',
  { skip: sourceWorld ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let worldPath: string;
    let cacheDir: string;
    let temp: string;
    let map: MapService;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-cooldown-'));
      worldPath = path.join(temp, 'world');
      cacheDir = path.join(temp, 'cache');
      await copyWorld(sourceWorld!, worldPath);
      map = await MapService.create({
        worldPath,
        cacheDir,
        tileUpdateCooldownMs: 60_000,
        refreshRenderConcurrency: 2,
      });
    });

    after(async () => {
      await map?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    const chunkWithData = (margin = 3): ChunkPos => {
      const bounds = map.info.chunkBounds!;
      for (let z = bounds.minZ + margin; z <= bounds.maxZ - margin; z++) {
        for (let x = bounds.minX + margin; x <= bounds.maxX - margin; x++) {
          if (x % 16 === 15 || z % 16 === 15) continue;
          let complete = true;
          for (let dz = -1; dz <= 1 && complete; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!map.hasChunkData(x + dx, z + dz)) complete = false;
            }
          }
          if (complete) return { x, z };
        }
      }
      throw new Error('no interior chunk found');
    };

    it('skips redrawing a tile that is still cooling down after a digest change', async () => {
      const chunk = chunkWithData();
      const tile = chunkToTile(chunk.x, chunk.z);
      await map.tile('overworld', 0, tile.x, tile.y);

      const writer = await WorldWriter.open(worldPath);
      try {
        assert.notEqual(await writer.removeTopSubChunk(chunk), null);
      } finally {
        await writer.close();
      }

      const first = await map.refresh();
      assert.equal(first.error, null);
      assert.equal(first.changedChunks, 1);
      assert.equal(first.tilesInvalidated, 1);
      assert.equal(first.tilesSkippedCooldown, 0);
      assert.ok(first.tilesRegenerated >= 1);

      const writer2 = await WorldWriter.open(worldPath);
      try {
        // Another surface change in the same tile while cooldown is active.
        assert.notEqual(await writer2.removeTopSubChunk(chunk), null);
      } finally {
        await writer2.close();
      }

      const second = await map.refresh();
      assert.equal(second.error, null);
      assert.equal(second.changedChunks, 1);
      assert.equal(second.tilesInvalidated, 0, 'cooldown must keep the cached tile');
      assert.equal(second.tilesSkippedCooldown, 1);
      assert.equal(second.tilesRegenerated, 0);
    });

    it('still invalidates when a chunk is added, even during cooldown', async () => {
      const bounds = map.info.chunkBounds!;
      const donor = chunkWithData();
      let target: ChunkPos | null = null;
      for (let z = bounds.minZ + 2; z <= bounds.maxZ - 2 && !target; z++) {
        for (let x = bounds.minX + 2; x <= bounds.maxX - 2; x++) {
          if (map.hasChunkData(x, z)) continue;
          if (x % 16 === 15 || z % 16 === 15) continue;
          const tile = chunkToTile(x, z);
          // Prefer a hole inside a tile that already has terrain (so the tile is cached).
          if (map.hasChunkData(tile.x * 16 + 8, tile.y * 16 + 8)) {
            target = { x, z };
            break;
          }
        }
      }
      assert.ok(target);
      const tile = chunkToTile(target!.x, target!.z);
      await map.tile('overworld', 0, tile.x, tile.y);

      // Put that tile on cooldown via an unrelated digest change in the same tile.
      // A prior test may already have cooled it - either outcome is fine.
      const neighbour = (() => {
        for (let z = tile.y * 16; z < tile.y * 16 + 16; z++) {
          for (let x = tile.x * 16; x < tile.x * 16 + 16; x++) {
            if (x === target!.x && z === target!.z) continue;
            if (x % 16 === 15 || z % 16 === 15) continue;
            if (map.hasChunkData(x, z)) return { x, z };
          }
        }
        return null;
      })();
      assert.ok(neighbour);
      const warm = await WorldWriter.open(worldPath);
      try {
        assert.notEqual(await warm.removeTopSubChunk(neighbour!), null);
      } finally {
        await warm.close();
      }
      const warmed = await map.refresh();
      assert.equal(warmed.error, null);
      assert.ok(
        warmed.tilesRegenerated >= 1 || warmed.tilesSkippedCooldown >= 1,
        'the tile should be cooling down (or already was)',
      );

      const writer = await WorldWriter.open(worldPath);
      try {
        assert.ok((await writer.copyChunk(donor, target!)) > 0);
      } finally {
        await writer.close();
      }

      const stats = await map.refresh();
      assert.equal(stats.error, null);
      assert.equal(stats.addedChunks, 1);
      assert.ok(stats.tilesInvalidated >= 1, 'new chunks bypass cooldown');
    });
  },
);

describe(
  'terrain refresh over HTTP',
  { skip: sourceWorld ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    const apiKey = 'refresh-test-key';
    let temp: string;
    let worldPath: string;
    let started: StartedServer;
    let base: string;

    before(async () => {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-refresh-http-'));
      worldPath = path.join(temp, 'world');
      await copyWorld(sourceWorld!, worldPath);
      started = await startServer({
        worldPath,
        cacheDir: path.join(temp, 'cache'),
        host: '127.0.0.1',
        port: 0,
        worldRefreshInterval: 250,
        tileUpdateCooldown: 0,
        refreshRenderConcurrency: 2,
        playerUpdateInterval: 1000,
        playerDataTimeout: 10000,
        apiKey,
        markerApiKey: '',
        logLevel: 'error',
      });
      base = `http://127.0.0.1:${started.port}`;
    });

    after(async () => {
      await started?.close();
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    });

    it('publishes the map version and the poll interval', async () => {
      const info = (await fetch(`${base}/api/map/info`).then((response) => response.json())) as {
        version: number;
        terrainPollInterval: number;
        worldRefreshInterval: number;
      };
      assert.equal(info.version, 1);
      assert.equal(info.worldRefreshInterval, 250);
      assert.equal(info.terrainPollInterval, 5000);

      const state = (await fetch(`${base}/api/map/state`).then((response) => response.json())) as {
        version: number;
        terrainUpdatedAt: string | null;
        chunkCount: number;
      };
      assert.equal(state.version, 1);
      assert.equal(state.terrainUpdatedAt, null);
      assert.ok(state.chunkCount > 0);
    });

    it('bumps the version on its own timer, and keeps serving players meanwhile', async () => {
      const players = [{ name: 'Refresher', id: '1', x: 12.5, y: 68, z: -34.5, dimension: 'overworld' }];
      const posted = await fetch(`${base}/api/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ players }),
      });
      assert.equal(posted.status, 200);

      const bounds = started.map.info.chunkBounds!;
      const donor = { x: bounds.minX + 2, z: bounds.minZ + 2 };
      const target = { x: bounds.maxX + 30, z: bounds.maxZ + 30 };
      const handle = await WorldWriter.open(worldPath);
      try {
        await handle.copyChunk(started.map.hasChunkData(donor.x, donor.z) ? donor : { x: bounds.maxX - 2, z: bounds.maxZ - 2 }, target);
      } finally {
        await handle.close();
      }

      const deadline = Date.now() + 20000;
      let state = { version: 1, chunkCount: 0, terrainUpdatedAt: null as string | null };
      while (Date.now() < deadline) {
        state = (await fetch(`${base}/api/map/state`).then((response) => response.json())) as typeof state;
        if (state.version > 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(state.version > 1, 'the refresh timer should have picked the new chunk up');
      assert.ok(state.terrainUpdatedAt, 'and recorded when terrain last changed');

      const tile = chunkToTile(target.x, target.z);
      const response = await fetch(`${base}/tiles/overworld/0/${tile.x}/${tile.y}.png?v=${state.version}`);
      assert.equal(response.status, 200);
      assert.notEqual(response.headers.get('x-tile-source'), 'empty', 'the new area should be renderable');

      const snapshot = (await fetch(`${base}/api/players`).then((response) => response.json())) as {
        players: { name: string }[];
        stale: boolean;
      };
      assert.equal(snapshot.stale, false, 'player tracking must be unaffected by terrain refreshes');
      assert.deepEqual(
        snapshot.players.map((player) => player.name),
        ['Refresher'],
      );
    });
  },
);

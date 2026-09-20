// Refresh performance on a copy of the real world: no-change cost, single-chunk
// change cost, and a bulk change. Run with:
//   node --experimental-strip-types .tmp-verify/measure-refresh.mjs "/tmp/bds/worlds/Bedrock level"
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MapService } from '../server/map-service.ts';
import { chunkToTile } from '../server/tiles/coords.ts';
import { copyWorld, WorldWriter } from '../test/live-world.ts';

const source = process.argv[2] ?? process.env.WORLD_PATH;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'measure-refresh-'));
const worldPath = path.join(temp, 'world');
await copyWorld(source, worldPath);

const started = performance.now();
const map = await MapService.create({ worldPath, cacheDir: path.join(temp, 'cache') });
console.log(
  `startup: ${Math.round(performance.now() - started)} ms, ${map.info.chunkCount} chunks with data, ` +
    `snapshot ${map.world.snapshot.fileCount} files / ${(map.world.snapshot.byteCount / 1e6).toFixed(1)} MB ` +
    `in ${Math.round(map.world.snapshot.copyMs)} ms`,
);

// Pre-render the tiles covering the world so the caches are warm, like a server
// that has been looked at.
const tiles = map.info.tileBounds;
let prerendered = 0;
const prerenderStarted = performance.now();
for (let y = tiles.minZ; y <= tiles.maxZ; y++) {
  for (let x = tiles.minX; x <= tiles.maxX; x++) {
    const result = await map.tile('overworld', 0, x, y);
    if (!result.empty) prerendered++;
  }
}
console.log(
  `pre-rendered ${prerendered} tiles in ${Math.round(performance.now() - prerenderStarted)} ms, ` +
    `${map.decodedChunks} chunks decoded`,
);

const avg = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const noChange = [];
for (let i = 0; i < 20; i++) noChange.push((await map.refresh()).totalMs);
console.log(
  `no-change refresh: avg ${avg(noChange).toFixed(2)} ms, min ${Math.min(...noChange).toFixed(2)}, ` +
    `max ${Math.max(...noChange).toFixed(2)} (${noChange.length} runs)`,
);

const donors = [];
const bounds = map.info.chunkBounds;
for (let z = bounds.minZ + 2; z <= bounds.maxZ - 2 && donors.length < 40; z++) {
  for (let x = bounds.minX + 2; x <= bounds.maxX - 2 && donors.length < 40; x++) {
    if (map.hasChunkData(x, z)) donors.push({ x, z });
  }
}

const single = [];
for (let i = 0; i < 5; i++) {
  const chunk = donors[i * 3];
  const writer = await WorldWriter.open(worldPath);
  await writer.removeTopSubChunk(chunk);
  await writer.close();
  const stats = await map.refresh();
  single.push(stats);
  console.log(
    `one changed chunk (${chunk.x},${chunk.z}): snapshot ${stats.snapshotMs.toFixed(0)} ms, ` +
      `scan ${stats.scanMs.toFixed(0)} ms, ${stats.chunksScanned} chunks scanned, ` +
      `${stats.chunksDecoded} decoded, ${stats.tilesInvalidated} tiles invalidated, ` +
      `${stats.tilesRegenerated} redrawn, total ${stats.totalMs.toFixed(0)} ms`,
  );
}
console.log(`single-chunk refresh: avg ${avg(single.map((stats) => stats.totalMs)).toFixed(0)} ms`);

// A bulk change: a whole tile's worth of chunks at once, like a player flying
// through unexplored terrain.
const bulk = donors.slice(20, 40);
const writer = await WorldWriter.open(worldPath);
for (const chunk of bulk) await writer.removeTopSubChunk(chunk);
await writer.close();
const bulkStats = await map.refresh();
console.log(
  `${bulk.length} changed chunks: snapshot ${bulkStats.snapshotMs.toFixed(0)} ms, scan ${bulkStats.scanMs.toFixed(0)} ms, ` +
    `${bulkStats.chunksDecoded} decoded, ${bulkStats.tilesInvalidated} tiles invalidated, ` +
    `${bulkStats.tilesRegenerated} redrawn, total ${bulkStats.totalMs.toFixed(0)} ms`,
);

// New chunks in an unmapped area.
const newChunks = [];
for (let i = 0; i < 16; i++) newChunks.push({ x: bounds.maxX + 10 + (i % 4), z: bounds.maxZ + 10 + Math.floor(i / 4) });
const writer2 = await WorldWriter.open(worldPath);
for (const [index, chunk] of newChunks.entries()) await writer2.copyChunk(donors[index], chunk);
await writer2.close();
const newStats = await map.refresh();
console.log(
  `${newChunks.length} new chunks: ${newStats.addedChunks} added, scan ${newStats.scanMs.toFixed(0)} ms, ` +
    `${newStats.tilesInvalidated} tiles invalidated, ${newStats.tilesRegenerated} redrawn, ` +
    `total ${newStats.totalMs.toFixed(0)} ms; tile ${JSON.stringify(chunkToTile(newChunks[0].x, newChunks[0].z))} ` +
    `now ${(await map.tile('overworld', 0, chunkToTile(newChunks[0].x, newChunks[0].z).x, chunkToTile(newChunks[0].x, newChunks[0].z).y)).empty ? 'empty' : 'rendered'}`,
);

await map.close();
await fs.rm(temp, { recursive: true, force: true });

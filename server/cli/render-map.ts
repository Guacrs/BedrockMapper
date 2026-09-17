/**
 * Renders a rectangular range of chunks into map tiles, filling the tile cache
 * so the browser never waits on a cold tile.
 *
 *   WORLD_PATH=/path/to/world npm run render-map
 *   WORLD_PATH=/path/to/world npm run render-map -- --chunk-x=-10..20 --chunk-z=-10..20
 *
 * A range starting with a minus needs the `=` form, otherwise Node's argument
 * parser reads it as another option.
 *
 * Without a range it renders every tile that covers a chunk with block data.
 * Tiles are 16x16 chunks, so a requested range is rounded out to whole tiles.
 */

import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { MapService } from '../map-service.ts';
import { CHUNKS_PER_TILE, chunkToTile, type Bounds } from '../tiles/coords.ts';
import { chunksInTile } from '../tiles/tile-renderer.ts';

const { values } = parseArgs({
  options: {
    world: { type: 'string' },
    'chunk-x': { type: 'string' },
    'chunk-z': { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

/** Parses `-10..20` (also accepts `-10,20` and a single number). */
function parseRange(raw: string, option: string): { from: number; to: number } {
  const parts = raw.split(/\.\.|,/).map((part) => Number(part.trim()));
  const from = parts[0];
  const to = parts.length > 1 ? parts[parts.length - 1] : from;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new Error(`Invalid ${option} value "${raw}", expected "min..max"`);
  }
  return { from: Math.min(from!, to!), to: Math.max(from!, to!) };
}

const config = loadConfig(values.world ? { worldPath: values.world } : {});
const map = await MapService.create({ worldPath: config.worldPath, cacheDir: config.cacheDir });

try {
  const info = map.info;
  console.log(`Rendering ${info.dimension} tiles`);
  console.log(`  world:              ${config.worldPath} (${info.world.version ?? 'unknown version'})`);
  console.log(`  read-only snapshot: ${map.world.snapshot.dbPath}`);
  console.log(`  tile cache:         ${map.tileCache.root}`);
  console.log(`  chunks with data:   ${info.chunkCount}`);

  if (!info.chunkBounds) {
    console.error('\nNo chunks with block data found - nothing to render.');
    process.exitCode = 1;
  } else {
    const requested: Bounds = {
      minX: values['chunk-x'] ? parseRange(values['chunk-x'], '--chunk-x').from : info.chunkBounds.minX,
      maxX: values['chunk-x'] ? parseRange(values['chunk-x'], '--chunk-x').to : info.chunkBounds.maxX,
      minZ: values['chunk-z'] ? parseRange(values['chunk-z'], '--chunk-z').from : info.chunkBounds.minZ,
      maxZ: values['chunk-z'] ? parseRange(values['chunk-z'], '--chunk-z').to : info.chunkBounds.maxZ,
    };
    const from = chunkToTile(requested.minX, requested.minZ);
    const to = chunkToTile(requested.maxX, requested.maxZ);

    console.log(
      `  chunk range:        X ${requested.minX}..${requested.maxX}, Z ${requested.minZ}..${requested.maxZ}`,
    );
    console.log(
      `  tile range:         X ${from.x}..${to.x}, Y ${from.y}..${to.y}` +
        ` (${CHUNKS_PER_TILE}x${CHUNKS_PER_TILE} chunks each)\n`,
    );

    if (values.force) await map.tileCache.clear();

    let rendered = 0;
    let cached = 0;
    let empty = 0;
    const started = Date.now();

    for (let tileY = from.y; tileY <= to.y; tileY++) {
      for (let tileX = from.x; tileX <= to.x; tileX++) {
        const before = Date.now();
        const result = await map.tile(info.dimension, info.nativeZoom, tileX, tileY);
        const withData = chunksInTile(tileX, tileY).filter((chunk) =>
          map.hasChunkData(chunk.x, chunk.z),
        ).length;

        if (result.empty) empty++;
        else if (result.cached) cached++;
        else rendered++;

        const status = result.empty ? 'empty' : result.cached ? 'cached' : 'rendered';
        console.log(
          `  tile ${String(tileX).padStart(4)},${String(tileY).padStart(4)}` +
            ` ${status.padEnd(8)} ${String(withData).padStart(3)}/${CHUNKS_PER_TILE ** 2} chunks` +
            ` ${String(result.bytes.length).padStart(7)} B` +
            ` ${String(Date.now() - before).padStart(5)} ms`,
        );
      }
    }

    const total = rendered + cached + empty;
    console.log(
      `\n${total} tiles in ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
        `${rendered} rendered, ${cached} already cached, ${empty} empty (not written)`,
    );
    console.log(`decoded ${map.decodedChunks} chunks`);
    console.log(`tiles are in ${map.tileCache.root}/${info.dimension}/${info.nativeZoom}/`);
  }
} finally {
  await map.close();
}

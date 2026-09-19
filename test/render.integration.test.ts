/**
 * Integration tests for rendering a real Bedrock chunk.
 *
 *   TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
 *
 * These confirm the renderer draws exactly what the (separately verified)
 * milestone 1 reader decoded - no second block parser is involved.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';
import {
  encodePng,
  pixelAt,
  renderChunkSurface,
  shadeFactor,
  shadeFactorForBlock,
} from '../server/renderer/chunk-image.ts';
import { surfaceBlockColor } from '../server/renderer/colors.ts';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { columnIndex } from '../server/world/keys.ts';
import { NO_SURFACE, NO_BIOME, readChunkSurface, type ChunkSurface } from '../server/world/surface.ts';
import { BedrockWorld } from '../server/world/world.ts';

const worldPath = process.env.TEST_WORLD_PATH ?? process.env.WORLD_PATH;

function shade(channel: number, factor: number): number {
  return Math.min(255, Math.max(0, Math.round(channel * factor)));
}

describe(
  'rendering a real chunk',
  { skip: worldPath ? false : 'set TEST_WORLD_PATH to a BDS world' },
  () => {
    let world: BedrockWorld;
    let cacheDir: string;
    let surface: ChunkSurface;

    before(async () => {
      cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-map-render-'));
      world = await BedrockWorld.open({ worldPath: worldPath!, cacheDir });
      const chunks = await world.listChunks(OVERWORLD);
      // Prefer varied terrain so shading and several colours are exercised.
      let best: ChunkSurface | null = null;
      let bestSpread = -1;
      for (const chunk of chunks.filter((candidate) => candidate.subChunkIndices.length > 4).slice(0, 40)) {
        const candidate = await readChunkSurface(world, OVERWORLD, chunk.x, chunk.z);
        if (!candidate || candidate.resolvedColumns !== 256) continue;
        const heights = [...candidate.heights];
        const spread = Math.max(...heights) - Math.min(...heights);
        if (spread > bestSpread) {
          bestSpread = spread;
          best = candidate;
        }
      }
      assert.ok(best, 'expected at least one fully generated chunk');
      surface = best!;
    });

    after(async () => {
      await world?.close();
      if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
    });

    it('renders from the snapshot, not the live world', () => {
      assert.notEqual(path.resolve(world.snapshot.dbPath), path.resolve(worldPath!, 'db'));
    });

    it('draws every pixel from the block the reader decoded', () => {
      const image = renderChunkSurface(surface);
      assert.equal(image.width, 16);
      assert.equal(image.height, 16);

      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          const column = columnIndex(localX, localZ);
          const block = surface.blocks[column]!;
          const [r, g, b, a] = pixelAt(image, localX, localZ);
          const factor = shadeFactorForBlock(
            block,
            shadeFactor(surface, localX, localZ, surface.heights[column]!),
          );
          const expected = surfaceBlockColor(
            block,
            surface.waterDepths[column]!,
            surface.biomes[column] === NO_BIOME ? null : surface.biomes[column]!,
          );
          assert.equal(a, 255);
          assert.deepEqual(
            [r, g, b],
            expected.map((channel) => shade(channel, factor)),
            `pixel ${localX},${localZ} should come from ${block}`,
          );
        }
      }
    });

    it('keeps colours recognisable for the block they came from', () => {
      const image = renderChunkSurface(surface, { shading: false });
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          const column = columnIndex(localX, localZ);
          const block = surface.blocks[column]!;
          assert.deepEqual(
            pixelAt(image, localX, localZ).slice(0, 3),
            [
              ...surfaceBlockColor(
                block,
                surface.waterDepths[column]!,
                surface.biomes[column] === NO_BIOME ? null : surface.biomes[column]!,
              ),
            ],
          );
        }
      }
    });

    it('renders real elevation differences as brightness differences', () => {
      const heights = [...surface.heights].filter((y) => y !== NO_SURFACE);
      assert.ok(Math.max(...heights) > Math.min(...heights), 'test chunk should not be flat');

      const image = renderChunkSurface(surface);
      const unshaded = renderChunkSurface(surface, { shading: false });
      let differing = 0;
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          const shaded = pixelAt(image, localX, localZ);
          const flat = pixelAt(unshaded, localX, localZ);
          if (shaded[0] !== flat[0] || shaded[1] !== flat[1] || shaded[2] !== flat[2]) differing++;
        }
      }
      assert.ok(differing > 0, 'elevation shading should change some pixels');
    });

    it('survives a PNG round-trip and is deterministic', async () => {
      const image = renderChunkSurface(surface);
      const png = encodePng(image);
      assert.deepEqual(Uint8Array.from(encodePng(renderChunkSurface(surface))), png);

      const file = path.join(cacheDir, 'chunk.png');
      await fs.writeFile(file, png);
      const decoded = decodePng(await fs.readFile(file));
      assert.equal(decoded.width, 16);
      assert.equal(decoded.height, 16);
      assert.deepEqual(Uint8Array.from(decoded.data as Uint8Array), image.data);
    });

    it('leaves the source world untouched while rendering', async () => {
      const sourceDb = path.join(worldPath!, 'db');
      const before = await Promise.all(
        (await fs.readdir(sourceDb)).sort().map(async (name) => {
          const stat = await fs.stat(path.join(sourceDb, name));
          return `${name}:${stat.size}:${stat.mtimeMs}`;
        }),
      );
      renderChunkSurface((await readChunkSurface(world, OVERWORLD, surface.chunkX, surface.chunkZ))!);
      const after = await Promise.all(
        (await fs.readdir(sourceDb)).sort().map(async (name) => {
          const stat = await fs.stat(path.join(sourceDb, name));
          return `${name}:${stat.size}:${stat.mtimeMs}`;
        }),
      );
      assert.deepEqual(after, before);
    });
  },
);

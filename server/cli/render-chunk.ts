/**
 * Milestone 2 tool: renders one real Bedrock chunk as a top-down PNG.
 *
 *   WORLD_PATH=/path/to/world npm run render-chunk
 *   WORLD_PATH=/path/to/world npm run render-chunk -- --chunk 30,10 --scale 24
 *
 * Block data comes from the milestone 1 reader; this tool only picks colours.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { decode as decodePng } from 'fast-png';
import { loadConfig } from '../config.ts';
import {
  encodePng,
  pixelAt,
  renderChunkSurface,
  scaleNearest,
  shadeFactor,
} from '../renderer/chunk-image.ts';
import { blockColor, resolveBlockColor } from '../renderer/colors.ts';
import { shortBlockName } from '../world/blocks.ts';
import { OVERWORLD, dimensionById } from '../world/dimensions.ts';
import { CHUNK_SIZE, chunkToBlock, columnIndex } from '../world/keys.ts';
import { NO_SURFACE, readChunkSurface, type ChunkSurface } from '../world/surface.ts';
import { BedrockWorld } from '../world/world.ts';

const { values } = parseArgs({
  options: {
    world: { type: 'string' },
    dimension: { type: 'string', default: 'overworld' },
    chunk: { type: 'string', default: '0,0' },
    scale: { type: 'string', default: '16' },
    out: { type: 'string', default: './output' },
    columns: { type: 'string', default: '16' },
    'no-shading': { type: 'boolean', default: false },
  },
});

const [chunkX, chunkZ] = (values.chunk ?? '0,0').split(',').map((part) => Number(part.trim()));
if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
  throw new Error(`Invalid --chunk value "${values.chunk}", expected "x,z"`);
}

const config = loadConfig(values.world ? { worldPath: values.world } : {});
const dimension = dimensionById(values.dimension ?? OVERWORLD.id);
const scale = Number(values.scale);
const columnsToPrint = Number(values.columns);
const outDir = path.resolve(values.out ?? './output');
const shading = !values['no-shading'];

function summarise(surface: ChunkSurface): { min: number; max: number; average: number; counts: Map<string, number> } {
  const heights = [...surface.heights].filter((y) => y !== NO_SURFACE);
  const counts = new Map<string, number>();
  for (const block of surface.blocks) {
    if (!block) continue;
    counts.set(block, (counts.get(block) ?? 0) + 1);
  }
  return {
    min: Math.min(...heights),
    max: Math.max(...heights),
    average: heights.reduce((sum, y) => sum + y, 0) / heights.length,
    counts,
  };
}

const world = await BedrockWorld.open({ worldPath: config.worldPath, cacheDir: config.cacheDir });

try {
  console.log(`Rendering chunk (${chunkX}, ${chunkZ}) of the ${dimension.id}`);
  console.log(`  world:              ${world.worldPath} (${world.levelInfo.lastOpenedWithVersion ?? 'unknown version'})`);
  console.log(`  read-only snapshot: ${world.snapshot.dbPath}`);

  const surface = await readChunkSurface(world, dimension, chunkX!, chunkZ!);
  if (!surface) {
    console.error(`\nChunk ${chunkX},${chunkZ} has no block data stored. Pick a generated chunk with:`);
    console.error('  npm run inspect-world -- --list-chunks');
    process.exitCode = 1;
  } else {
    const origin = chunkToBlock(chunkX!, chunkZ!);
    console.log(
      `  block origin:       X ${origin.x}..${origin.x + 15}, Z ${origin.z}..${origin.z + 15}`,
    );
    console.log(`  resolved columns:   ${surface.resolvedColumns}/256\n`);

    let printed = 0;
    for (let localZ = 0; localZ < CHUNK_SIZE && printed < columnsToPrint; localZ++) {
      for (let localX = 0; localX < CHUNK_SIZE && printed < columnsToPrint; localX++) {
        const column = columnIndex(localX, localZ);
        const block = surface.blocks[column];
        console.log(
          `${origin.x + localX},${origin.z + localZ}`.padEnd(12) +
            ` y=${String(surface.heights[column]).padEnd(4)} ${block ?? '(none)'}`,
        );
        printed++;
      }
    }
    if (printed < 256) console.log(`... (${256 - printed} more columns, use --columns 256 to print all)`);

    const stats = summarise(surface);
    console.log(`\nmin surface Y:      ${stats.min}`);
    console.log(`max surface Y:      ${stats.max}`);
    console.log(`average surface Y:  ${stats.average.toFixed(2)}`);
    console.log(`\nsurface block types (${stats.counts.size}):`);
    for (const [block, count] of [...stats.counts.entries()].sort((a, b) => b[1] - a[1])) {
      const resolved = resolveBlockColor(block);
      console.log(
        `  ${String(count).padStart(3)} x ${shortBlockName(block).padEnd(22)} ` +
          `rgb(${resolved.rgb.join(',')}) ${resolved.hex} [${resolved.label}]`,
      );
    }

    const image = renderChunkSurface(surface, { shading });
    await fs.mkdir(outDir, { recursive: true });
    const baseName = `chunk-${chunkX}-${chunkZ}`;
    const pngPath = path.join(outDir, `${baseName}.png`);
    const previewPath = path.join(outDir, `${baseName}-preview.png`);
    await fs.writeFile(pngPath, encodePng(image));
    await fs.writeFile(previewPath, encodePng(scaleNearest(image, scale)));
    console.log(
      `\nwrote ${pngPath} (${image.width}x${image.height}, shading ${shading ? 'on' : 'off'})`,
    );
    console.log(`wrote ${previewPath} (${image.width * scale}x${image.height * scale}, nearest neighbour)`);

    // Validation: read the PNG back off disk and check that every pixel still
    // matches the block the verified milestone 1 reader reported.
    const decoded = decodePng(await fs.readFile(pngPath));
    const decodedImage = {
      width: decoded.width,
      height: decoded.height,
      data: Uint8Array.from(decoded.data as Uint8Array | Uint16Array),
    };
    let mismatches = 0;
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
      for (let localX = 0; localX < CHUNK_SIZE; localX++) {
        const column = columnIndex(localX, localZ);
        const block = surface.blocks[column];
        const [r, g, b, a] = pixelAt(decodedImage, localX, localZ);
        if (!block) {
          if (a !== 0) mismatches++;
          continue;
        }
        const factor = shading ? shadeFactor(surface, localX, localZ, surface.heights[column]!) : 1;
        const [er, eg, eb] = blockColor(block);
        const expected = [er, eg, eb].map((channel) =>
          Math.min(255, Math.max(0, Math.round(channel * factor))),
        );
        if (r !== expected[0] || g !== expected[1] || b !== expected[2] || a !== 255) mismatches++;
      }
    }

    console.log('\nvalidation against the milestone 1 reader:');
    const samples: [number, number][] = [
      [0, 0],
      [15, 0],
      [8, 8],
      [3, 11],
      [15, 15],
    ];
    for (const [localX, localZ] of samples) {
      const column = columnIndex(localX, localZ);
      const block = surface.blocks[column];
      const [r, g, b, a] = pixelAt(decodedImage, localX, localZ);
      console.log(
        `  world ${origin.x + localX},${origin.z + localZ}` +
          ` (local ${localX},${localZ} -> pixel ${localX},${localZ})` +
          ` y=${surface.heights[column]} ${block ?? '(none)'} -> rgba(${r},${g},${b},${a})`,
      );
    }
    console.log(
      `  ${256 - mismatches}/256 pixels match the decoded block data` +
        `${mismatches ? ` - ${mismatches} MISMATCHES` : ''}`,
    );
    if (mismatches) process.exitCode = 1;
  }
} finally {
  await world.close();
}

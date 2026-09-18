/**
 * Milestone 1 debugging tool: opens a real Bedrock world, reads chunks out of
 * the LevelDB, decodes the subchunk block data and prints the highest visible
 * block of each X/Z column.
 *
 *   WORLD_PATH=/path/to/world npm run inspect-world
 *   WORLD_PATH=/path/to/world npm run inspect-world -- --chunk 0,3 --columns 16
 */

import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { shortBlockName } from '../world/blocks.ts';
import { OVERWORLD, dimensionById } from '../world/dimensions.ts';
import { chunkToBlock, columnIndex, CHUNK_SIZE } from '../world/keys.ts';
import { NO_SURFACE, readChunkSurface } from '../world/surface.ts';
import { BedrockWorld, type ChunkSummary } from '../world/world.ts';

const { values } = parseArgs({
  options: {
    world: { type: 'string' },
    dimension: { type: 'string', default: 'overworld' },
    chunk: { type: 'string', multiple: true },
    chunks: { type: 'string', default: '1' },
    columns: { type: 'string', default: '8' },
    'list-chunks': { type: 'boolean', default: false },
  },
});

const config = loadConfig(values.world ? { worldPath: values.world } : {});
const dimension = dimensionById(values.dimension ?? OVERWORLD.id);
const columnsToPrint = Number(values.columns);
const chunksToPrint = Number(values.chunks);

function formatBounds(chunks: ChunkSummary[]): string {
  if (!chunks.length) return 'none';
  const xs = chunks.map((chunk) => chunk.x);
  const zs = chunks.map((chunk) => chunk.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return (
    `chunk X ${minX}..${maxX}, chunk Z ${minZ}..${maxZ} ` +
    `(block X ${minX * CHUNK_SIZE}..${maxX * CHUNK_SIZE + 15}, ` +
    `block Z ${minZ * CHUNK_SIZE}..${maxZ * CHUNK_SIZE + 15})`
  );
}

function parseChunkArg(arg: string): { x: number; z: number } {
  const [x, z] = arg.split(',').map((part) => Number(part.trim()));
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    throw new Error(`Invalid --chunk value "${arg}", expected "x,z"`);
  }
  return { x: x!, z: z! };
}

const world = await BedrockWorld.open({ worldPath: config.worldPath, cacheDir: config.cacheDir });

try {
  const info = world.levelInfo;
  console.log('World');
  console.log(`  path:               ${world.worldPath}`);
  console.log(`  name:               ${info.name || '(unknown)'}`);
  console.log(`  last opened with:   ${info.lastOpenedWithVersion ?? '(unknown)'}`);
  console.log(`  storage version:    ${info.storageVersion ?? '(unknown)'}`);
  console.log(
    `  spawn:              ${info.spawn ? `${info.spawn.x}, ${info.spawn.y}, ${info.spawn.z}` : '(unknown)'}`,
  );
  console.log(
    `  read-only snapshot: ${world.snapshot.dbPath} ` +
      `(${world.snapshot.fileCount} files, ${(world.snapshot.byteCount / 1e6).toFixed(1)} MB, ` +
      `${world.snapshot.copied ? 'copied' : 'reused'})`,
  );

  console.log(`\nDimension: ${dimension.id} (index ${dimension.index}, Y ${dimension.minY}..${dimension.maxY})`);
  const chunks = await world.listChunks(dimension);
  const subChunkTotal = chunks.reduce((sum, chunk) => sum + chunk.subChunkIndices.length, 0);
  console.log(`  stored chunks:      ${chunks.length}`);
  console.log(`  stored subchunks:   ${subChunkTotal}`);
  console.log(`  extent:             ${formatBounds(chunks)}`);
  const versions = new Set(chunks.map((chunk) => chunk.version));
  console.log(`  chunk versions:     ${[...versions].join(', ')}`);

  if (values['list-chunks']) {
    for (const chunk of chunks) {
      console.log(
        `  chunk ${chunk.x},${chunk.z} version=${chunk.version} ` +
          `subchunks=${chunk.subChunkIndices.length} [${chunk.subChunkIndices.join(' ')}]`,
      );
    }
  }

  const requested = values.chunk?.length
    ? values.chunk.map(parseChunkArg)
    : chunks.slice(0, Math.max(1, chunksToPrint)).map((chunk) => ({ x: chunk.x, z: chunk.z }));

  for (const target of requested) {
    console.log(`\n${'='.repeat(60)}\nChunk: ${target.x}, ${target.z}`);
    const { subChunks, skipped } = await world.readChunkSubChunks(dimension, target.x, target.z);
    if (!subChunks.length) {
      console.log('  no subchunk data stored for this chunk');
      continue;
    }

    const formats = new Set(subChunks.map((subChunk) => subChunk.version));
    console.log(
      `  subchunks stored:   ${subChunks.length} ` +
        `(indices ${subChunks.at(-1)!.index}..${subChunks[0]!.index}), ` +
        `SubChunkPrefix format ${[...formats].join('/')}`,
    );
    if (skipped.length) {
      console.log(`  skipped subchunks:  ${skipped.map((s) => `${s.index}(v${s.version})`).join(', ')}`);
    }

    const top = subChunks[0]!;
    console.log(
      `  top subchunk ${top.index}: layers=${top.layers.length} ` +
        `palette=${top.layers[0]?.palette.length ?? 0} ` +
        `[${(top.layers[0]?.palette ?? [])
          .slice(0, 6)
          .map((state) => shortBlockName(state.name))
          .join(', ')}]`,
    );

    const surface = await readChunkSurface(world, dimension, target.x, target.z);
    if (!surface) continue;
    const origin = chunkToBlock(target.x, target.z);
    console.log(
      `  resolved columns:   ${surface.resolvedColumns}/256, ` +
        `surface Y ${Math.min(...surface.heights.filter((y) => y !== NO_SURFACE))}` +
        `..${Math.max(...surface.heights)}`,
    );

    console.log(`\n  highest visible block per column (world X,Z):`);
    let printed = 0;
    for (let z = 0; z < CHUNK_SIZE && printed < columnsToPrint; z++) {
      for (let x = 0; x < CHUNK_SIZE && printed < columnsToPrint; x++) {
        const column = columnIndex(x, z);
        const block = surface.blocks[column];
        console.log(
          `    ${origin.x + x},${origin.z + z} = ${block ? shortBlockName(block) : '(none)'}` +
            ` (y=${surface.heights[column]})`,
        );
        printed++;
      }
    }

    const histogram = new Map<string, number>();
    for (const block of surface.blocks) {
      if (!block) continue;
      const name = shortBlockName(block);
      histogram.set(name, (histogram.get(name) ?? 0) + 1);
    }
    console.log('\n  surface block distribution:');
    for (const [name, count] of [...histogram.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)} x ${name}`);
    }
  }
} finally {
  await world.close();
}

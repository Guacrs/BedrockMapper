/**
 * Reports every surface block in the loaded world and which colour source it used.
 *
 *   WORLD_PATH=/path/to/world npm run block-colors:world
 */

import { loadConfig } from '../config.ts';
import { hashFallbackNames, resolveBlockColor } from '../renderer/block-palette.ts';
import { OVERWORLD, dimensionById } from '../world/dimensions.ts';
import { readChunkSurface } from '../world/surface.ts';
import { BedrockWorld } from '../world/world.ts';

const config = loadConfig();
const dimension = dimensionById(OVERWORLD.id);
const world = await BedrockWorld.open({ worldPath: config.worldPath, cacheDir: config.cacheDir });

try {
  const chunks = await world.listChunks(dimension);
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    if (!chunk.subChunkIndices.length) continue;
    const surface = await readChunkSurface(world, dimension, chunk.x, chunk.z);
    if (!surface) continue;
    for (const block of surface.blocks) {
      if (!block) continue;
      counts.set(block, (counts.get(block) ?? 0) + 1);
    }
  }

  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`world: ${world.levelInfo.name} (${world.levelInfo.lastOpenedWithVersion ?? 'unknown'})`);
  console.log(`surface block types: ${rows.length}`);
  console.log('');
  for (const [name, count] of rows) {
    const resolved = resolveBlockColor(name);
    console.log(
      `${name.padEnd(40)} ${resolved.label.padEnd(36)} ${resolved.hex}  (${count})`,
    );
  }

  const hashed = hashFallbackNames().filter((name) => counts.has(name));
  if (hashed.length) {
    console.log('\nhash fallbacks in this world:');
    for (const name of hashed) console.log(`  ${name}`);
  }
} finally {
  await world.close();
}

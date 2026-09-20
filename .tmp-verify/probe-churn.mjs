/**
 * Are the chunks the refresh keeps calling "changed" on a live BDS server really
 * different to look at? Takes two read-only snapshots of the live world a while
 * apart, diffs the digests, and decodes the changed chunks in both to compare the
 * surface the renderer would draw.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BedrockWorld } from '../server/world/world.ts';
import { OVERWORLD } from '../server/world/dimensions.ts';
import { readChunkSurface } from '../server/world/surface.ts';
import { diffChunkDigests} from '../server/world/chunk-diff.ts';

const worldPath = process.env.WORLD_PATH ?? '/tmp/bds/worlds/Bedrock level';
const gap = Number(process.env.GAP_MS ?? 35000);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'churn-'));

const open = async (name) => BedrockWorld.open({ worldPath, cacheDir: path.join(temp, name) });

const first = await open('a');
const scanA = await first.scan(OVERWORLD);
console.log(`snapshot A: ${scanA.chunks.length} chunks`);

await new Promise((r) => setTimeout(r, gap));

const second = await open('b');
const scanB = await second.scan(OVERWORLD);
const diff = diffChunkDigests(scanA.digests, scanB.digests);
console.log(`after ${gap} ms: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed`);

let sameSurface = 0;
let differentSurface = 0;
for (const { x, z } of diff.changed) {
  const before = await readChunkSurface(first, OVERWORLD, x, z);
  const after = await readChunkSurface(second, OVERWORLD, x, z);
  const identical =
    before && after &&
    before.heights.every((height, i) => height === after.heights[i]) &&
    before.blocks.every((block, i) => block === after.blocks[i]);
  if (identical) sameSurface++;
  else differentSurface++;
}
console.log(`changed chunks whose drawn surface is identical: ${sameSurface}`);
console.log(`changed chunks that really look different:       ${differentSurface}`);

await first.close();
await second.close();
await fs.rm(temp, { recursive: true, force: true });

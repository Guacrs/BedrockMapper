/**
 * Test-environment helper: turns on the Beta APIs experiment in a BDS world's
 * level.dat, which a headless server has no other way to toggle.
 *
 * This touches the *test server's* world, never a world the map reads directly;
 * the map only ever opens its own snapshot copy. Stop BDS before running it.
 *
 *   node .tmp-verify/enable-beta-apis.mjs "/tmp/bds/worlds/Bedrock level"
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import nbt from '../node_modules/prismarine-nbt/nbt.js';

const worldPath = process.argv[2];
if (!worldPath) throw new Error('usage: enable-beta-apis.mjs <world directory>');

const levelDatPath = path.join(worldPath, 'level.dat');
const original = await fs.readFile(levelDatPath);
// level.dat is a little-endian NBT compound behind an 8 byte header: a version
// int and the byte length of the payload.
const header = original.subarray(0, 8);
const { parsed } = await nbt.parse(original.subarray(8), 'little');

const experiments = parsed.value.experiments ?? { type: 'compound', value: {} };
experiments.type = 'compound';
experiments.value.gametest = { type: 'byte', value: 1 };
experiments.value.experiments_ever_used = { type: 'byte', value: 1 };
experiments.value.saved_with_toggled_experiments = { type: 'byte', value: 1 };
parsed.value.experiments = experiments;

const payload = nbt.writeUncompressed(parsed, 'little');
const rewritten = Buffer.alloc(8 + payload.length);
header.copy(rewritten, 0);
rewritten.writeInt32LE(payload.length, 4);
payload.copy(rewritten, 8);

await fs.writeFile(`${levelDatPath}.before-beta-apis`, original);
await fs.writeFile(levelDatPath, rewritten);

const { parsed: check } = await nbt.parse((await fs.readFile(levelDatPath)).subarray(8), 'little');
console.log('experiments now:', JSON.stringify(check.value.experiments.value));
console.log(`wrote ${levelDatPath} (${original.length} -> ${rewritten.length} bytes)`);

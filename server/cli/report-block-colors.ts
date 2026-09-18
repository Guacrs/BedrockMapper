/**
 * Prints how vanilla Bedrock block identifiers resolve to map colours.
 *
 *   npm run block-colors:report
 */

import {
  getBlockColorDatabase,
  resolveBlockColor,
  summarizeDatabase,
} from '../renderer/block-palette.ts';

const db = getBlockColorDatabase();
const summary = summarizeDatabase(db);

console.log(`Bedrock vanilla samples: ${db.version}`);
console.log(`total vanilla blocks:    ${summary.vanilla}`);
console.log(`explicit colours:        ${summary.explicit}  (minecraft:map_color / MapColor table)`);
console.log(`family-rule colours:     ${summary.family}`);
console.log(`fallback/hash colours:   ${summary.hash}`);

const tinted = Object.entries(db.blocks).filter(([, entry]) => entry.tint !== 'none');
console.log(`with Bedrock tint:       ${tinted.length}`);

if (summary.unresolved.length) {
  console.log('\nunresolved identifiers (hash fallback):');
  for (const id of summary.unresolved) console.log(`  ${id}`);
} else {
  console.log('\nno vanilla identifiers need the hash fallback');
}

const samples = [
  'minecraft:grass_block',
  'minecraft:spruce_leaves',
  'minecraft:podzol',
  'minecraft:water',
  'minecraft:sand',
  'minecraft:snow_layer',
  'minecraft:stone',
  'minecraft:oak_planks',
  'minecraft:poppy',
];
console.log('\nexamples:');
for (const id of samples) {
  const resolved = resolveBlockColor(id);
  console.log(`  ${id.padEnd(32)} ${resolved.label.padEnd(36)} ${resolved.hex}`);
}

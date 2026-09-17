/**
 * Block classification for surface detection.
 *
 * Deliberately name-based: the palette in a Bedrock world stores namespaced
 * block names, so no per-version numeric block registry is involved and new
 * blocks from future 1.26.x updates simply fall through as unknown names
 * instead of breaking the reader.
 */

/** Blocks that never count as the visible surface of a column. */
const INVISIBLE_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:barrier',
  'minecraft:invisible_bedrock',
  'minecraft:light_block',
  'minecraft:moving_block',
  'minecraft:structure_void',
]);

/** `minecraft:light_block_0` ... `minecraft:light_block_15` and similar. */
const INVISIBLE_PREFIXES = ['minecraft:light_block_'];

export function isInvisible(blockName: string): boolean {
  if (INVISIBLE_BLOCKS.has(blockName)) return true;
  return INVISIBLE_PREFIXES.some((prefix) => blockName.startsWith(prefix));
}

/** Strips the `minecraft:` namespace for display. */
export function shortBlockName(blockName: string): string {
  return blockName.startsWith('minecraft:') ? blockName.slice('minecraft:'.length) : blockName;
}

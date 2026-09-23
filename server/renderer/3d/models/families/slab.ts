/**
 * Slab family — first partial block model (PR20).
 *
 * Bedrock evidence (`mojang-blocks.json`):
 * - Single slabs: `minecraft:*_slab` with state `minecraft:vertical_half` ∈ {bottom, top}
 * - Double slabs: distinct ids containing `double_slab` or `double_cut_` → full cube
 *
 * Side-face UVs crop the atlas tile vertically (Minecraft convention): bottom
 * slabs sample the lower half of the side texture; top slabs the upper half.
 * Horizontal faces keep the full tile.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, ModelBox } from '../types.ts';

const VERTICAL_HALF = 'minecraft:vertical_half';

/** True for double-slab block ids (full-block geometry). */
export function isDoubleSlabName(name: string): boolean {
  const short = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  return short.includes('double_slab') || short.includes('double_cut_');
}

/**
 * True for single-slab block ids (half-block geometry).
 * Requires `*_slab` and explicitly excludes double-slab ids.
 */
export function isSingleSlabName(name: string): boolean {
  if (isDoubleSlabName(name)) return false;
  const short = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  return short.endsWith('_slab');
}

export type SlabHalf = 'bottom' | 'top';

export function slabHalfFromStates(states: BlockRef['states']): SlabHalf {
  const raw = states[VERTICAL_HALF];
  return raw === 'top' ? 'top' : 'bottom';
}

function slabBox(blockName: string, half: SlabHalf): ModelBox {
  const y0 = half === 'bottom' ? 0 : 0.5;
  const y1 = half === 'bottom' ? 0.5 : 1;
  return Object.freeze({
    min: Object.freeze([0, y0, 0] as const),
    max: Object.freeze([1, y1, 1] as const),
    faces: Object.freeze({
      up: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'up') }),
      down: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'down') }),
      north: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'north') }),
      south: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'south') }),
      east: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'east') }),
      west: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'west') }),
    }),
  });
}

export function slabModel(ref: BlockRef): BlockModel {
  const half = slabHalfFromStates(ref.states);
  const box = slabBox(ref.name, half);
  return Object.freeze({
    key: `slab:${half}:${ref.name}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

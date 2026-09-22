/**
 * Full-cube block model — the only geometry model in the texture phase-1 PR.
 *
 * Future stairs/slabs/fences can add sibling models without touching the atlas.
 */

import {
  appearanceForBlock,
  textureKeyForFace,
  type BlockAppearance,
  type FaceSlot,
  type TextureKey,
} from './appearance.ts';

export type CubeFace = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';

export function faceSlot(face: CubeFace): FaceSlot {
  if (face === 'up') return 'up';
  if (face === 'down') return 'down';
  return 'side';
}

/**
 * Look up the texture key for one face of a full cube.
 * Returns null when the block has no appearance / that face has no texture.
 */
export function fullCubeFaceTexture(blockName: string, face: CubeFace): TextureKey | null {
  return textureKeyForFace(appearanceForBlock(blockName), faceSlot(face));
}

export function fullCubeAppearance(blockName: string): BlockAppearance | null {
  return appearanceForBlock(blockName);
}

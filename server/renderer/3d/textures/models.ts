/**
 * Cube-face texture helpers for model families (PR17 + PR31).
 *
 * Families call `fullCubeFaceTexture(name, face)` — PR31 resolves north/south/
 * east/west when the appearance DB distinguishes them.
 */

import {
  appearanceForBlock,
  textureKeyForCubeFace,
  textureKeyForFace,
  type BlockAppearance,
  type CubeFace as AppearanceCubeFace,
  type FaceSlot,
  type TextureKey,
} from './appearance.ts';

export type CubeFace = AppearanceCubeFace;

/**
 * Map a cube face to the legacy up/down/side slot (cardinals → `side`).
 * Prefer `fullCubeFaceTexture` / `textureKeyForCubeFace` for accurate cardinals.
 */
export function faceSlot(face: CubeFace): FaceSlot {
  if (face === 'up') return 'up';
  if (face === 'down') return 'down';
  return 'side';
}

/**
 * Look up the texture key for one face of a cube.
 * Returns null when the block has no appearance / that face has no texture.
 */
export function fullCubeFaceTexture(blockName: string, face: CubeFace): TextureKey | null {
  return textureKeyForCubeFace(appearanceForBlock(blockName), face);
}

/** @deprecated Prefer fullCubeFaceTexture — kept for slot-only call sites. */
export function fullCubeFaceTextureSlot(blockName: string, face: FaceSlot): TextureKey | null {
  return textureKeyForFace(appearanceForBlock(blockName), face);
}

export function fullCubeAppearance(blockName: string): BlockAppearance | null {
  return appearanceForBlock(blockName);
}

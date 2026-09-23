/**
 * Full-cube model — default for every renderable block that has no special
 * family. Matches the pre-PR20 unit-cube mesher behaviour.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, ModelBox } from '../types.ts';

const UNIT: readonly [number, number, number] = [0, 0, 0];
const UNIT_MAX: readonly [number, number, number] = [1, 1, 1];

export function fullCubeModel(blockName: string): BlockModel {
  const box: ModelBox = Object.freeze({
    min: UNIT,
    max: UNIT_MAX,
    faces: Object.freeze({
      up: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'up') }),
      down: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'down') }),
      north: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'north') }),
      south: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'south') }),
      east: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'east') }),
      west: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'west') }),
    }),
  });
  return Object.freeze({
    key: `full_cube:${blockName}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: true,
  });
}

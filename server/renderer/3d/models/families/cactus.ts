/**
 * Cactus family (PR30) — full-height column inset 1px on each side.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `minecraft:cactus` → `age` (growth only — not geometry).
 * - Classic footprint: [1,0,1]–[15,16,15] in pixels (1/16 inset).
 * - `cactus_flower` is a different (cross-like) id — not this family.
 * - `isFullCube` false — sides do not cull neighbour unit faces.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isCactusName(name: string): boolean {
  return shortId(name) === 'cactus';
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

export function cactusModel(blockName: string): BlockModel {
  const box: ModelBox = Object.freeze({
    min: Object.freeze([PX, 0, PX] as const),
    max: Object.freeze([1 - PX, 1, 1 - PX] as const),
    faces: allFaces(blockName),
  });
  return Object.freeze({
    key: `cactus:${blockName}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

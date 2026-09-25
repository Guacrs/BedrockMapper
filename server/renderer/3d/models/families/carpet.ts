/**
 * Carpet family (PR30) — 1px floor plate.
 *
 * ## Bedrock research
 *
 * - Microsoft vanilla listings: coloured carpets + `carpet` have **no** geometry
 *   states. `moss_carpet` likewise. `pale_moss_carpet` has side tall/short
 *   states — **floor plate only** in PR30; side flaps deferred.
 * - Geometry (Java/Bedrock pixel parity): full XZ, height 1/16 from y=0.
 * - `isFullCube` false — never a connectivity/occlusion solid.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/** Explicit carpet / moss-carpet floor plates — not rugs with side geometry yet. */
export function isCarpetName(name: string): boolean {
  const short = shortId(name);
  if (short === 'carpet' || short === 'moss_carpet' || short === 'pale_moss_carpet') return true;
  return short.endsWith('_carpet');
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

export function carpetModel(blockName: string): BlockModel {
  const box: ModelBox = Object.freeze({
    min: Object.freeze([0, 0, 0] as const),
    max: Object.freeze([1, PX, 1] as const),
    faces: allFaces(blockName),
  });
  return Object.freeze({
    key: `carpet:${blockName}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

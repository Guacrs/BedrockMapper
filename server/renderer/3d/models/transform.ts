/**
 * Axis-aligned box transforms for oriented models (PR21 stairs).
 *
 * Rotations are around the block centre looking down (+Y): positive steps are
 * 90° counter-clockwise in the XZ plane — (x,z) → (1−z, x).
 */

import type { BlockModel, FaceId, ModelBox } from './types.ts';

const FACE_CCW: readonly FaceId[] = ['east', 'south', 'west', 'north'];

function rotateFaceId(face: FaceId, quarterTurns: number): FaceId {
  if (face === 'up' || face === 'down') return face;
  const i = FACE_CCW.indexOf(face);
  return FACE_CCW[(i + ((quarterTurns % 4) + 4) % 4) % 4]!;
}

function rotatePointXZ(
  x: number,
  z: number,
  quarterTurns: number,
): [number, number] {
  let cx = x;
  let cz = z;
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    const nx = 1 - cz;
    const nz = cx;
    cx = nx;
    cz = nz;
  }
  return [cx, cz];
}

function rotateBoxY(box: ModelBox, quarterTurns: number): ModelBox {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return box;

  const corners: [number, number, number][] = [
    [box.min[0], box.min[1], box.min[2]],
    [box.min[0], box.min[1], box.max[2]],
    [box.max[0], box.min[1], box.min[2]],
    [box.max[0], box.min[1], box.max[2]],
    [box.min[0], box.max[1], box.min[2]],
    [box.min[0], box.max[1], box.max[2]],
    [box.max[0], box.max[1], box.min[2]],
    [box.max[0], box.max[1], box.max[2]],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of corners) {
    const [rx, rz] = rotatePointXZ(x, z, turns);
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (rz < minZ) minZ = rz;
    if (rz > maxZ) maxZ = rz;
  }

  const faces: Partial<Record<FaceId, (typeof box.faces)[FaceId]>> = {};
  for (const [face, mat] of Object.entries(box.faces) as [FaceId, (typeof box.faces)[FaceId]][]) {
    if (!mat) continue;
    faces[rotateFaceId(face, turns)] = mat;
  }

  return Object.freeze({
    min: Object.freeze([minX, minY, minZ] as const),
    max: Object.freeze([maxX, maxY, maxZ] as const),
    faces: Object.freeze(faces),
  });
}

function flipBoxY(box: ModelBox): ModelBox {
  const faces: Partial<Record<FaceId, (typeof box.faces)[FaceId]>> = { ...box.faces };
  const up = faces.up;
  const down = faces.down;
  faces.up = down;
  faces.down = up;
  return Object.freeze({
    min: Object.freeze([box.min[0], 1 - box.max[1], box.min[2]] as const),
    max: Object.freeze([box.max[0], 1 - box.min[1], box.max[2]] as const),
    faces: Object.freeze(faces),
  });
}

/** Rotate every box of a model around +Y by `quarterTurns` × 90° CCW. */
export function rotateModelY(model: BlockModel, quarterTurns: number): BlockModel {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return model;
  return Object.freeze({
    key: `${model.key}|rotY=${turns}`,
    renderBoxes: Object.freeze(model.renderBoxes.map((b) => rotateBoxY(b, turns))),
    occlusionBoxes: Object.freeze(model.occlusionBoxes.map((b) => rotateBoxY(b, turns))),
    isFullCube: model.isFullCube,
  });
}

/** Mirror a model through the horizontal mid-plane (upside-down stairs). */
export function flipModelY(model: BlockModel): BlockModel {
  return Object.freeze({
    key: `${model.key}|flipY`,
    renderBoxes: Object.freeze(model.renderBoxes.map(flipBoxY)),
    occlusionBoxes: Object.freeze(model.occlusionBoxes.map(flipBoxY)),
    isFullCube: model.isFullCube,
  });
}

export { rotateFaceId, rotatePointXZ };

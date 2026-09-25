/**
 * Axis-aligned box transforms for oriented models (PR21 stairs).
 *
 * Rotations are around the block centre looking down (+Y): positive steps are
 * 90° counter-clockwise in the XZ plane — (x,z) → (1−z, x).
 *
 * PR33: boxes may also carry an element `rotation` (Minecraft model angles).
 * `rotateModelY` remaps that descriptor so wall-torch lean stays correct.
 */

import type { BlockModel, FaceId, ModelBox, ModelBoxRotation } from './types.ts';

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

/** Direction vector under the same CCW-Y quarter turns (not point-in-cube). */
function rotateAxisY(
  axis: ModelBoxRotation['axis'],
  quarterTurns: number,
): { axis: ModelBoxRotation['axis']; sign: 1 | -1 } {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (axis === 'y') return { axis: 'y', sign: 1 };
  // Must match rotatePointXZ's linear part about the block centre:
  // (dx, dz) → (−dz, dx) per quarter turn.
  let vx = axis === 'x' ? 1 : 0;
  let vz = axis === 'z' ? 1 : 0;
  for (let i = 0; i < turns; i++) {
    const nx = -vz;
    const nz = vx;
    vx = nx;
    vz = nz;
  }
  if (Math.abs(vx) >= Math.abs(vz)) {
    return { axis: 'x', sign: vx >= 0 ? 1 : -1 };
  }
  return { axis: 'z', sign: vz >= 0 ? 1 : -1 };
}

/**
 * Apply a ModelBox element rotation to a local-space point.
 * Exported for mesher + tests.
 */
export function applyModelBoxRotation(
  x: number,
  y: number,
  z: number,
  rotation: ModelBoxRotation | undefined,
): [number, number, number] {
  if (!rotation || rotation.angle === 0) return [x, y, z];
  const [ox, oy, oz] = rotation.origin;
  let px = x - ox;
  let py = y - oy;
  let pz = z - oz;
  const rad = (rotation.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  switch (rotation.axis) {
    case 'x': {
      const ny = py * c - pz * s;
      const nz = py * s + pz * c;
      py = ny;
      pz = nz;
      break;
    }
    case 'y': {
      const nx = px * c + pz * s;
      const nz = -px * s + pz * c;
      px = nx;
      pz = nz;
      break;
    }
    case 'z': {
      const nx = px * c - py * s;
      const ny = px * s + py * c;
      px = nx;
      py = ny;
      break;
    }
  }
  return [px + ox, py + oy, pz + oz];
}

/** Rotate a unit normal by the same element rotation (origin irrelevant). */
export function applyModelBoxRotationToNormal(
  nx: number,
  ny: number,
  nz: number,
  rotation: ModelBoxRotation | undefined,
): [number, number, number] {
  if (!rotation || rotation.angle === 0) return [nx, ny, nz];
  const [rx, ry, rz] = applyModelBoxRotation(nx, ny, nz, {
    origin: [0, 0, 0],
    axis: rotation.axis,
    angle: rotation.angle,
  });
  const len = Math.hypot(rx, ry, rz);
  if (len < 1e-12) return [nx, ny, nz];
  return [rx / len, ry / len, rz / len];
}

function rotateRotationY(
  rotation: ModelBoxRotation | undefined,
  quarterTurns: number,
): ModelBoxRotation | undefined {
  if (!rotation) return undefined;
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return rotation;
  const [ox, oy, oz] = rotation.origin;
  const [rx, rz] = rotatePointXZ(ox, oz, turns);
  const { axis, sign } = rotateAxisY(rotation.axis, turns);
  return Object.freeze({
    origin: Object.freeze([rx, oy, rz] as const),
    axis,
    angle: rotation.angle * sign,
  });
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

  const rotation = rotateRotationY(box.rotation, turns);
  return Object.freeze({
    min: Object.freeze([minX, minY, minZ] as const),
    max: Object.freeze([maxX, maxY, maxZ] as const),
    faces: Object.freeze(faces),
    ...(rotation ? { rotation } : {}),
  });
}

function flipBoxY(box: ModelBox): ModelBox {
  const faces: Partial<Record<FaceId, (typeof box.faces)[FaceId]>> = { ...box.faces };
  const up = faces.up;
  const down = faces.down;
  faces.up = down;
  faces.down = up;
  let rotation = box.rotation;
  if (rotation) {
    // Mirror through y=0.5: origin flips; X/Z angles negate (right-hand).
    const [ox, oy, oz] = rotation.origin;
    const angle =
      rotation.axis === 'y' ? rotation.angle : -rotation.angle;
    rotation = Object.freeze({
      origin: Object.freeze([ox, 1 - oy, oz] as const),
      axis: rotation.axis,
      angle,
    });
  }
  return Object.freeze({
    min: Object.freeze([box.min[0], 1 - box.max[1], box.min[2]] as const),
    max: Object.freeze([box.max[0], 1 - box.min[1], box.max[2]] as const),
    faces: Object.freeze(faces),
    ...(rotation ? { rotation } : {}),
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

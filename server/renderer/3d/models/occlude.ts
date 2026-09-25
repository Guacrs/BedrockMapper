/**
 * Conservative axis-aligned face occlusion (PR20 Option A).
 *
 * A face quad is dropped only when:
 * 1. It lies on the shared unit-cell plane toward the neighbour, and
 * 2. A neighbour occlusion box fully covers it on that plane.
 *
 * Partial coverage keeps the entire face (no holes). Faces that sit inside
 * the cell (slab tops at y=0.5, door/cross/fence/pane sides, …) are never
 * culled by a neighbour in an adjacent cell — even a full cube.
 */

import type { BlockModel, FaceId, ModelBox } from './types.ts';

const EPS = 1e-6;

interface Rect2 {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function opposite(face: FaceId): FaceId {
  switch (face) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}

/**
 * True when `emitBox`'s `face` lies on the unit-cell plane shared with the
 * neighbour in that direction. Interior faces (thin panels, half slabs, …)
 * return false and must not be culled by adjacent cells.
 */
export function faceLiesOnUnitSharedPlane(box: ModelBox, face: FaceId): boolean {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  switch (face) {
    case 'east':
      return Math.abs(x1 - 1) <= EPS;
    case 'west':
      return Math.abs(x0 - 0) <= EPS;
    case 'up':
      return Math.abs(y1 - 1) <= EPS;
    case 'down':
      return Math.abs(y0 - 0) <= EPS;
    case 'south':
      return Math.abs(z1 - 1) <= EPS;
    case 'north':
      return Math.abs(z0 - 0) <= EPS;
  }
}

/**
 * 2D rectangle of a box face on its outward plane, in the two axes spanning
 * that plane (u = first horizontal/vertical span, v = second).
 */
function faceRect(box: ModelBox, face: FaceId): Rect2 | null {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  switch (face) {
    case 'east':
    case 'west':
      return { u0: y0, u1: y1, v0: z0, v1: z1 };
    case 'up':
    case 'down':
      return { u0: x0, u1: x1, v0: z0, v1: z1 };
    case 'north':
    case 'south':
      return { u0: x0, u1: x1, v0: y0, v1: y1 };
  }
}

/** Whether `cover` completely contains `target`. */
function rectCovers(cover: Rect2, target: Rect2): boolean {
  return (
    cover.u0 <= target.u0 + EPS &&
    cover.u1 >= target.u1 - EPS &&
    cover.v0 <= target.v0 + EPS &&
    cover.v1 >= target.v1 - EPS
  );
}

/**
 * True when the neighbour model fully occludes `emitBox`'s `face`.
 * `neighbour` is the model in the adjacent cell toward `face`.
 */
export function isFaceFullyOccluded(
  emitBox: ModelBox,
  face: FaceId,
  neighbour: BlockModel | null | undefined,
): boolean {
  if (!neighbour) return false;

  // Interior faces never meet the neighbour cell's shared plane.
  if (!faceLiesOnUnitSharedPlane(emitBox, face)) return false;

  const target = faceRect(emitBox, face);
  if (!target) return false;

  // Fast path: full-cube neighbour covers the entire unit face plane.
  if (neighbour.isFullCube) {
    return true;
  }

  const back = opposite(face);
  for (const nbox of neighbour.occlusionBoxes) {
    const cover = faceRect(nbox, back);
    if (cover && rectCovers(cover, target)) return true;
  }
  return false;
}

export { opposite as oppositeFace };

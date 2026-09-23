/**
 * Door family (PR24) — thin panel with facing / hinge / open / upper half.
 *
 * Intrinsic BlockRef states only (no ConnectionMask). Geometry reuses
 * `rotateModelY` from the stair transform path.
 *
 * ## Bedrock states (researched)
 *
 * Modern (1.21.60+): `minecraft:cardinal_direction` ∈ {north,south,east,west},
 * `door_hinge_bit`, `open_bit`, `upper_block_bit`.
 *
 * Evidence:
 * - Minecraft Wiki Door/BS — Bedrock table: facing = direction the door's
 *   "inside" faces (= player look when placing). "A door facing east occupies
 *   the west part of its block when closed."
 * - `door_hinge_bit`: false = left hinge, true = right (when looking along
 *   the door's inside facing).
 * - Microsoft vanilla listings: same four states on wooden/iron/copper doors.
 * - Legacy worlds may still store int `direction` (0=south,1=west,2=north,3=east)
 *   instead of `minecraft:cardinal_direction` — accepted as fallback.
 *
 * Thickness: 3/16 block (wiki); Bedrock notes ~0.1825 — we use 3/16.
 *
 * Upper and lower halves use the same panel box in their own cell; textures
 * come from PR17 appearance per block id (upper/lower may share a key today).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 3 / 16; // door thickness

export type DoorFacing = 'east' | 'west' | 'south' | 'north';

export function shortBlockId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/** True for door blocks — excludes trapdoors. */
export function isDoorName(name: string): boolean {
  const short = shortBlockId(name);
  if (short.includes('trapdoor')) return false;
  return short.endsWith('_door') || short === 'door' || short === 'wooden_door';
}

const CARDINALS = new Set(['east', 'west', 'south', 'north']);

/** Map legacy int direction → facing (Microsoft intrinsic list). */
export const DOOR_DIRECTION_TO_FACING: Readonly<Record<number, DoorFacing>> = Object.freeze({
  0: 'south',
  1: 'west',
  2: 'north',
  3: 'east',
});

export function doorFacingFromStates(states: BlockRef['states']): DoorFacing | null {
  const card = states['minecraft:cardinal_direction'];
  if (typeof card === 'string' && CARDINALS.has(card)) return card as DoorFacing;

  const dir = states['direction'];
  if (typeof dir === 'number' && Number.isInteger(dir) && dir >= 0 && dir <= 3) {
    return DOOR_DIRECTION_TO_FACING[dir] ?? null;
  }
  if (typeof dir === 'string' && /^[0-3]$/.test(dir)) {
    return DOOR_DIRECTION_TO_FACING[Number(dir)] ?? null;
  }
  return null;
}

export function doorHingeRight(states: BlockRef['states']): boolean {
  return states['door_hinge_bit'] === true;
}

export function doorIsOpen(states: BlockRef['states']): boolean {
  return states['open_bit'] === true;
}

export function doorIsUpper(states: BlockRef['states']): boolean {
  return states['upper_block_bit'] === true;
}

/** Quarter-turns CCW from the east-facing base model (same table as stairs). */
export function quarterTurnsForDoorFacing(facing: DoorFacing): number {
  switch (facing) {
    case 'east':
      return 0;
    case 'south':
      return 1;
    case 'west':
      return 2;
    case 'north':
      return 3;
  }
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faces: ModelBox['faces'],
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces,
  });
}

/**
 * Base door facing **east** (inside → +X), closed: panel on the west edge.
 * Open swings 90° around the hinge:
 * - left hinge (north when facing east) → panel on north edge
 * - right hinge (south when facing east) → panel on south edge
 */
export function baseEastDoor(
  blockName: string,
  hingeRight: boolean,
  open: boolean,
): BlockModel {
  const faces = allFaces(blockName);
  let panel: ModelBox;
  if (!open) {
    // Closed: west strip (door facing east occupies west part of block).
    panel = box([0, 0, 0], [PX, 1, 1], faces);
  } else if (!hingeRight) {
    // Open, left hinge → north strip
    panel = box([0, 0, 0], [1, 1, PX], faces);
  } else {
    // Open, right hinge → south strip
    panel = box([0, 0, 1 - PX], [1, 1, 1], faces);
  }

  const hinge = hingeRight ? 'right' : 'left';
  const openKey = open ? 'open' : 'closed';
  return Object.freeze({
    key: `door:base_east_${hinge}_${openKey}:${blockName}`,
    renderBoxes: Object.freeze([panel]),
    occlusionBoxes: Object.freeze([panel]),
    isFullCube: false,
  });
}

export type DoorResolveResult =
  | {
      ok: true;
      model: BlockModel;
      facing: DoorFacing;
      hingeRight: boolean;
      open: boolean;
      upper: boolean;
    }
  | { ok: false; reason: string };

export function tryBuildDoor(ref: BlockRef): DoorResolveResult {
  if (!isDoorName(ref.name)) return { ok: false, reason: 'not a door id' };

  const facing = doorFacingFromStates(ref.states);
  if (!facing) return { ok: false, reason: 'missing/invalid facing' };

  const hingeRight = doorHingeRight(ref.states);
  const open = doorIsOpen(ref.states);
  const upper = doorIsUpper(ref.states);

  let model = baseEastDoor(ref.name, hingeRight, open);
  model = rotateModelY(model, quarterTurnsForDoorFacing(facing));
  model = Object.freeze({
    ...model,
    key: `door:${facing}:${hingeRight ? 'right' : 'left'}:${open ? 'open' : 'closed'}:${upper ? 'upper' : 'lower'}:${ref.name}`,
  });

  return { ok: true, model, facing, hingeRight, open, upper };
}

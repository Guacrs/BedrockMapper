/**
 * Button family (PR35) — face-attached thin plate, pressed or unpressed.
 *
 * ## Bedrock research
 *
 * - Microsoft Learn / Wiki Bedrock: `button_pressed_bit` (bool) +
 *   `facing_direction` ∈ {0..5} (int) or string down/up/north/south/west/east
 *   (intrinsic list documents string form for the same state).
 * - Wiki Bedrock facing_direction meaning:
 *     0 = on ceiling facing down
 *     1 = on floor facing up
 *     2..5 = wall facing N/S/W/E
 *   Matches ladder-style "facing" (geometry on that side of the cell), not
 *   torch-style attachment-face naming for wall cases.
 * - Geometry (Java `button` / `button_pressed` parity, used by Bedrock):
 *     floor unpressed: [5,0,6]–[11,2,10] px
 *     floor pressed:   [5,0,6]–[11,1,10] px
 *   Ceiling / wall placements are the same AABB remapped to the attach face.
 *   Bedrock has no separate floor Y-rotation state — footprint stays fixed.
 * - Ids: `*_button`, plus legacy `wooden_button` / `stone_button` /
 *   `polished_blackstone_button`. Wood uses plank textures; stone-family uses
 *   stone / polished_blackstone (appearance DB `all`).
 * - Occlusion: `isFullCube: false`. Geometry is intrinsic from BlockRef —
 *   missing/non-solid support neighbours are **not** handled here (no
 *   attachment-system refactor; same intrinsic policy as torch/ladder).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

/** Unpressed protrusion depth (Java button height 2px). */
const DEPTH_UP = 2 * PX;
/** Pressed protrusion (~1px; Java uses 1.02). */
const DEPTH_DOWN = 1 * PX;

/** Floor footprint: X [5,11], Z [6,10] — 6×4 px plate. */
const FLOOR_X0 = 5 * PX;
const FLOOR_X1 = 11 * PX;
const FLOOR_Z0 = 6 * PX;
const FLOOR_Z1 = 10 * PX;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isButtonName(name: string): boolean {
  const short = shortId(name);
  return (
    short.endsWith('_button') ||
    short === 'button' ||
    short === 'wooden_button' ||
    short === 'stone_button'
  );
}

export function buttonIsPressed(states: BlockRef['states']): boolean {
  const raw = states['button_pressed_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  return false;
}

/**
 * Face the button plate sits on / faces toward (Bedrock facing_direction).
 * null when missing or out of domain — caller falls back to full cube.
 */
export type ButtonFacing = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

const INT_TO_FACING: Readonly<Record<number, ButtonFacing>> = Object.freeze({
  0: 'down',
  1: 'up',
  2: 'north',
  3: 'south',
  4: 'west',
  5: 'east',
});

export function buttonFacingFromStates(states: BlockRef['states']): ButtonFacing | null {
  const raw = states['facing_direction'];
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return INT_TO_FACING[raw] ?? null;
  }
  if (typeof raw === 'string') {
    if (/^[0-5]$/.test(raw)) return INT_TO_FACING[Number(raw)] ?? null;
    if (
      raw === 'down' ||
      raw === 'up' ||
      raw === 'north' ||
      raw === 'south' ||
      raw === 'west' ||
      raw === 'east'
    ) {
      return raw;
    }
  }
  return null;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

function boxForFacing(facing: ButtonFacing, depth: number, faces: ModelBox['faces']): ModelBox {
  // Plate 6×4 on the face plane; depth is protrusion into the cell.
  switch (facing) {
    case 'up':
      // Floor: sit on y=0, footprint XZ as Java template.
      return Object.freeze({
        min: Object.freeze([FLOOR_X0, 0, FLOOR_Z0] as const),
        max: Object.freeze([FLOOR_X1, depth, FLOOR_Z1] as const),
        faces,
      });
    case 'down':
      // Ceiling: sit on y=1, same footprint.
      return Object.freeze({
        min: Object.freeze([FLOOR_X0, 1 - depth, FLOOR_Z0] as const),
        max: Object.freeze([FLOOR_X1, 1, FLOOR_Z1] as const),
        faces,
      });
    case 'north':
      // Plate on north face (z=0); Y uses former Z footprint, X unchanged.
      return Object.freeze({
        min: Object.freeze([FLOOR_X0, FLOOR_Z0, 0] as const),
        max: Object.freeze([FLOOR_X1, FLOOR_Z1, depth] as const),
        faces,
      });
    case 'south':
      return Object.freeze({
        min: Object.freeze([FLOOR_X0, FLOOR_Z0, 1 - depth] as const),
        max: Object.freeze([FLOOR_X1, FLOOR_Z1, 1] as const),
        faces,
      });
    case 'west':
      // Plate on west face (x=0); Y←Z footprint, Z←X footprint.
      return Object.freeze({
        min: Object.freeze([0, FLOOR_Z0, FLOOR_X0] as const),
        max: Object.freeze([depth, FLOOR_Z1, FLOOR_X1] as const),
        faces,
      });
    case 'east':
      return Object.freeze({
        min: Object.freeze([1 - depth, FLOOR_Z0, FLOOR_X0] as const),
        max: Object.freeze([1, FLOOR_Z1, FLOOR_X1] as const),
        faces,
      });
  }
}

export type ButtonResolveResult =
  | { ok: true; model: BlockModel; facing: ButtonFacing; pressed: boolean }
  | { ok: false; reason: string };

export function tryBuildButton(ref: BlockRef): ButtonResolveResult {
  if (!isButtonName(ref.name)) return { ok: false, reason: 'not a button' };
  const facing = buttonFacingFromStates(ref.states);
  if (!facing) return { ok: false, reason: 'missing/invalid facing_direction' };
  const pressed = buttonIsPressed(ref.states);
  const depth = pressed ? DEPTH_DOWN : DEPTH_UP;
  const box = boxForFacing(facing, depth, allFaces(ref.name));
  return {
    ok: true,
    facing,
    pressed,
    model: Object.freeze({
      key: `button:${facing}:${pressed ? 'down' : 'up'}:${ref.name}`,
      renderBoxes: Object.freeze([box]),
      occlusionBoxes: Object.freeze([box]),
      isFullCube: false,
    }),
  };
}

/** Convenience when facing is known valid (tests / callers that already checked). */
export function buttonModel(ref: BlockRef): BlockModel {
  const built = tryBuildButton(ref);
  if (!built.ok) {
    throw new Error(`buttonModel: ${built.reason}`);
  }
  return built.model;
}

/** Exported for tests — Java-parity floor unpressed extents. */
export const BUTTON_FLOOR_UP = Object.freeze({
  min: Object.freeze([FLOOR_X0, 0, FLOOR_Z0] as const),
  max: Object.freeze([FLOOR_X1, DEPTH_UP, FLOOR_Z1] as const),
});
export const BUTTON_FLOOR_DOWN = Object.freeze({
  min: Object.freeze([FLOOR_X0, 0, FLOOR_Z0] as const),
  max: Object.freeze([FLOOR_X1, DEPTH_DOWN, FLOOR_Z1] as const),
});

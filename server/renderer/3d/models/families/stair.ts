/**
 * Stair family (PR21 straight + PR32 corners).
 *
 * ## weirdo_direction → facing (authoritative mapping)
 *
 * Bedrock stores stair facing as int `weirdo_direction` ∈ {0,1,2,3}.
 * `mojang-blocks.json` lists the domain but NOT the semantic labels.
 *
 * | weirdo_direction | Facing | Axis |
 * |------------------|--------|------|
 * | 0 | east  | +X |
 * | 1 | west  | −X |
 * | 2 | south | +Z |
 * | 3 | north | −Z |
 *
 * Evidence: Minecraft Wiki Stairs/BS Bedrock table; cairn-lang-formats;
 * Bedrock `/fill` recipes (0=+X … 3=−Z).
 *
 * ## upside_down_bit
 * Bool — vertical flip via `flipModelY` after horizontal orientation.
 *
 * ## minecraft:corner (PR32)
 *
 * Vanilla stairs expose (mojang-blocks.json + wiki Stairs/BS Bedrock table,
 * Preview 26.50+):
 *
 * | Value         | Shape                                      |
 * |---------------|--------------------------------------------|
 * | `none`        | Straight (default / missing)               |
 * | `inner_left`  | Inside corner, higher step toward left     |
 * | `inner_right` | Inside corner, higher step toward right    |
 * | `outer_left`  | Outside corner, higher step toward left    |
 * | `outer_right` | Outside corner, higher step toward right   |
 *
 * Left/right are relative to looking along `weirdo_direction` facing
 * (Java-parity convention Bedrock adopted with the corner state):
 * facing east → left = north (−Z), right = south (+Z).
 *
 * Geometry strategy: canonical **east + bottom** boxes per shape →
 * `rotateModelY` for facing → optional `flipModelY`. Invalid / unknown
 * corner values fall back to full cube (never silent wrong corners).
 *
 * Sources:
 * - https://minecraft.wiki/w/Stairs/BS (Bedrock `minecraft:corner` values)
 * - mojang-blocks.json `minecraft:corner` enum
 * - Microsoft Learn placement_direction trait (same five corner strings)
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { flipModelY, rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

export type StairFacing = 'east' | 'west' | 'south' | 'north';

export type StairCorner =
  | 'none'
  | 'inner_left'
  | 'inner_right'
  | 'outer_left'
  | 'outer_right';

const SUPPORTED_CORNERS: ReadonlySet<string> = new Set([
  'none',
  'inner_left',
  'inner_right',
  'outer_left',
  'outer_right',
]);

/**
 * Documented Bedrock `weirdo_direction` → world facing.
 * Keep this table as the single source of truth.
 */
export const WEIRDO_DIRECTION_TO_FACING: Readonly<Record<number, StairFacing>> = Object.freeze({
  0: 'east',
  1: 'west',
  2: 'south',
  3: 'north',
});

/** Human-readable dump for diagnostics / tests. */
export function describeWeirdoDirection(): string {
  return Object.entries(WEIRDO_DIRECTION_TO_FACING)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

export function isStairName(name: string): boolean {
  const short = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  return short.endsWith('_stairs') || short === 'stairs';
}

export function weirdoDirectionFromStates(states: BlockRef['states']): number | null {
  const raw = states['weirdo_direction'];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3) return raw;
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'string' && /^[0-3]$/.test(raw)) return Number(raw);
  return null;
}

export function stairFacingFromWeirdo(weirdo: number): StairFacing | null {
  return WEIRDO_DIRECTION_TO_FACING[weirdo] ?? null;
}

/**
 * Parse `minecraft:corner`. Missing → `none` (straight).
 * Unknown string → null (caller falls back to full cube).
 */
export function stairCornerFromStates(states: BlockRef['states']): StairCorner | null {
  const raw = states['minecraft:corner'];
  if (raw === undefined) return 'none';
  if (typeof raw !== 'string') return null;
  if (!SUPPORTED_CORNERS.has(raw)) return null;
  return raw as StairCorner;
}

/** Quarter-turns CCW from the east-facing base model. */
export function quarterTurnsForFacing(facing: StairFacing): number {
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
 * Canonical east + bottom stair boxes for one corner shape.
 *
 * Facing east: left = north (−Z), right = south (+Z).
 *
 * - straight: lower slab + east upper half
 * - outer_*: lower slab + one upper quarter (NE / SE)
 * - inner_*: lower slab + east upper half + west upper quarter (NW / SW)
 */
export function baseEastBottomBoxes(
  corner: StairCorner,
  faces: ModelBox['faces'],
): readonly ModelBox[] {
  const lower = box([0, 0, 0], [1, 0.5, 1], faces);
  switch (corner) {
    case 'none':
      return Object.freeze([lower, box([0.5, 0.5, 0], [1, 1, 1], faces)]);
    case 'outer_left':
      // NE quarter — higher step toward north (left of east facing).
      return Object.freeze([lower, box([0.5, 0.5, 0], [1, 1, 0.5], faces)]);
    case 'outer_right':
      // SE quarter — higher step toward south (right of east facing).
      return Object.freeze([lower, box([0.5, 0.5, 0.5], [1, 1, 1], faces)]);
    case 'inner_left':
      // East half + NW quarter of west half (missing SW).
      return Object.freeze([
        lower,
        box([0.5, 0.5, 0], [1, 1, 1], faces),
        box([0, 0.5, 0], [0.5, 1, 0.5], faces),
      ]);
    case 'inner_right':
      // East half + SW quarter of west half (missing NW).
      return Object.freeze([
        lower,
        box([0.5, 0.5, 0], [1, 1, 1], faces),
        box([0, 0.5, 0.5], [0.5, 1, 1], faces),
      ]);
  }
}

/**
 * Base straight stair facing **east** (+X), bottom (not upside-down).
 * Kept for PR21 call sites / tests.
 */
export function baseEastBottomStair(blockName: string): BlockModel {
  const faces = allFaces(blockName);
  const boxes = baseEastBottomBoxes('none', faces);
  return Object.freeze({
    key: `stair:base_east_bottom:${blockName}`,
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

/** Canonical east-bottom model for any supported corner. */
export function baseEastBottomStairCorner(blockName: string, corner: StairCorner): BlockModel {
  const faces = allFaces(blockName);
  const boxes = baseEastBottomBoxes(corner, faces);
  return Object.freeze({
    key: `stair:base_east_bottom:${corner}:${blockName}`,
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

export type StairResolveResult =
  | {
      ok: true;
      model: BlockModel;
      facing: StairFacing;
      upsideDown: boolean;
      corner: StairCorner;
    }
  | { ok: false; reason: string };

/**
 * Build an oriented stair (straight or corner), or explain why it must fall
 * back to a cube.
 *
 * @deprecated Prefer `tryBuildStair` — alias retained for existing imports.
 */
export function tryBuildStraightStair(ref: BlockRef): StairResolveResult {
  return tryBuildStair(ref);
}

/**
 * Build an oriented stair (straight or corner), or explain why it must fall
 * back to a cube.
 */
export function tryBuildStair(ref: BlockRef): StairResolveResult {
  if (!isStairName(ref.name)) return { ok: false, reason: 'not a stair id' };

  const corner = stairCornerFromStates(ref.states);
  if (corner === null) {
    return { ok: false, reason: `unsupported corner=${String(ref.states['minecraft:corner'])}` };
  }

  const weirdo = weirdoDirectionFromStates(ref.states);
  if (weirdo === null) return { ok: false, reason: 'missing/invalid weirdo_direction' };
  const facing = stairFacingFromWeirdo(weirdo);
  if (!facing) return { ok: false, reason: `unknown weirdo_direction=${weirdo}` };

  const upsideDown = ref.states['upside_down_bit'] === true;
  let model = baseEastBottomStairCorner(ref.name, corner);
  model = rotateModelY(model, quarterTurnsForFacing(facing));
  if (upsideDown) model = flipModelY(model);

  model = Object.freeze({
    ...model,
    key: `stair:${facing}:${upsideDown ? 'top' : 'bottom'}:${corner}:${ref.name}`,
  });

  return { ok: true, model, facing, upsideDown, corner };
}

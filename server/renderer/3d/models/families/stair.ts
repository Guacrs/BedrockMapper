/**
 * Straight stair family (PR21).
 *
 * ## weirdo_direction → facing (authoritative mapping)
 *
 * Bedrock stores stair facing as int `weirdo_direction` ∈ {0,1,2,3}.
 * `mojang-blocks.json` lists the domain but NOT the semantic labels.
 *
 * Mapping used here (full-block / ascending side):
 *
 * | weirdo_direction | Facing | Axis |
 * |------------------|--------|------|
 * | 0 | east  | +X |
 * | 1 | west  | −X |
 * | 2 | south | +Z |
 * | 3 | north | −Z |
 *
 * Evidence (not guessed from Java Edition):
 * 1. Minecraft Wiki Stairs/BS — Bedrock Edition table:
 *    “0: East, 1: West, 2: South, 3: North”
 *    https://minecraft.wiki/w/Stairs/BS
 * 2. Independent Bedrock tooling citing the same wiki listing
 *    (cairn-lang-formats `bedrock_state.rs`, consulted against wiki.bedrock.dev /
 *    minecraft.wiki Stairs/BS).
 * 3. In-game `/fill` recipes from Bedrock players: 0=+X, 1=−X, 2=+Z, 3=−Z.
 *
 * Static Mojang sample JSON in this repo does NOT encode the labels — only 0..3.
 * A diagnostic helper `describeWeirdoDirection()` exports the table for tests.
 *
 * ## Other states
 * - `upside_down_bit` (bool) — vertical flip
 * - `minecraft:corner` — only `none` is rendered as a stair; other values
 *   fall back to a full cube (PR21 does not implement corner shapes)
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { flipModelY, rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

export type StairFacing = 'east' | 'west' | 'south' | 'north';

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
  // Exclude non-stair ids that merely contain the substring.
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

/**
 * Base straight stair facing **east** (+X), bottom (not upside-down):
 * - lower slab: full footprint, Y 0..0.5
 * - upper step: east half X 0.5..1, Y 0.5..1
 */
export function baseEastBottomStair(blockName: string): BlockModel {
  const faces = allFaces(blockName);
  const lower: ModelBox = Object.freeze({
    min: Object.freeze([0, 0, 0] as const),
    max: Object.freeze([1, 0.5, 1] as const),
    faces,
  });
  const upper: ModelBox = Object.freeze({
    min: Object.freeze([0.5, 0.5, 0] as const),
    max: Object.freeze([1, 1, 1] as const),
    faces,
  });
  return Object.freeze({
    key: `stair:base_east_bottom:${blockName}`,
    renderBoxes: Object.freeze([lower, upper]),
    occlusionBoxes: Object.freeze([lower, upper]),
    isFullCube: false,
  });
}

export type StairResolveResult =
  | { ok: true; model: BlockModel; facing: StairFacing; upsideDown: boolean }
  | { ok: false; reason: string };

/**
 * Build an oriented straight stair, or explain why it must fall back to a cube.
 */
export function tryBuildStraightStair(ref: BlockRef): StairResolveResult {
  if (!isStairName(ref.name)) return { ok: false, reason: 'not a stair id' };

  const corner = ref.states['minecraft:corner'];
  if (corner !== undefined && corner !== 'none') {
    return { ok: false, reason: `unsupported corner=${String(corner)}` };
  }

  const weirdo = weirdoDirectionFromStates(ref.states);
  if (weirdo === null) return { ok: false, reason: 'missing/invalid weirdo_direction' };
  const facing = stairFacingFromWeirdo(weirdo);
  if (!facing) return { ok: false, reason: `unknown weirdo_direction=${weirdo}` };

  const upsideDown = ref.states['upside_down_bit'] === true;
  let model = baseEastBottomStair(ref.name);
  model = rotateModelY(model, quarterTurnsForFacing(facing));
  if (upsideDown) model = flipModelY(model);

  // Stable key independent of intermediate base key noise.
  model = Object.freeze({
    ...model,
    key: `stair:${facing}:${upsideDown ? 'top' : 'bottom'}:${ref.name}`,
  });

  return { ok: true, model, facing, upsideDown };
}

/**
 * Hanging sign family (PR41) — board + chains/bracket from Bedrock states.
 *
 * ## Bedrock research (Microsoft listings + Wiki Hanging Sign/BS Bedrock)
 *
 * One id per wood (`*_hanging_sign`) carries **all** placement modes as
 * intrinsic palette states — **not** neighbour-derived:
 *
 *   hanging       bool  — true = ceiling (under block); false = wall bracket
 *   attached_bit  bool  — true = V / up-arrow chains (narrow support);
 *                         false = parallel chains (wide support / wall)
 *   facing_direction 2–5 — orientation for wall and ceiling-parallel modes
 *   ground_sign_direction 0–15 — orientation for ceiling-attached (V) mode
 *
 * Wiki semantics:
 *   - Side of block → wall bracket (`hanging=false`), 4 facings
 *   - Under wide block → parallel chains (`hanging=true`, `attached_bit=false`)
 *   - Under narrow / sneak → V chains (`hanging=true`, `attached_bit=true`), 16 dirs
 *
 * Placement decides the states; once stored in LevelDB they are authoritative.
 * Meshing does **not** inspect neighbours (same intrinsic policy as PR40 signs /
 * PR37 rails). Support configuration is fully represented by `hanging` +
 * `attached_bit`.
 *
 * Text remains Sign block-entity data — **out of scope** (no glyph subsystem).
 *
 * ## Geometry (silhouette AABBs; Java uses entity/block models)
 *
 * Ceiling parallel (south canonical): board [1,0,7]–[15,10,9] + two vertical
 *   chains at x=3..5 and x=11..13 from y=10→16; `rotateModelY` for facing.
 * Ceiling attached (dir=0): same board + two ±30° Z-leaning chains meeting at
 *   top centre; cardinal dirs use `rotateModelY`; other dirs Y-rotate boxes.
 * Wall (north canonical): horizontal bar on high-Z face + short hangers + board.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { rotateModelY } from '../transform.ts';
import type {
  BlockModel,
  BlockRef,
  FaceId,
  ModelBox,
  ModelBoxRotation,
} from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isHangingSignName(name: string): boolean {
  return shortId(name).includes('hanging_sign');
}

export function hangingSignIsHanging(states: BlockRef['states']): boolean {
  const raw = states['hanging'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

export function hangingSignIsAttached(states: BlockRef['states']): boolean {
  const raw = states['attached_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

export type HangingCardinal = 'north' | 'south' | 'west' | 'east';

const FACING: Readonly<Record<number, HangingCardinal>> = Object.freeze({
  2: 'north',
  3: 'south',
  4: 'west',
  5: 'east',
});

export function hangingFacingFromStates(
  states: BlockRef['states'],
): HangingCardinal | null {
  const raw = states['facing_direction'];
  let dir: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) dir = raw;
  else if (typeof raw === 'string') {
    if (/^[0-5]$/.test(raw)) dir = Number(raw);
    else if (
      raw === 'north' ||
      raw === 'south' ||
      raw === 'west' ||
      raw === 'east'
    ) {
      return raw;
    }
  }
  if (dir === null) return null;
  return FACING[dir] ?? null;
}

/** Attached (V) mode: ground_sign_direction 0–15; missing → 0. */
export function hangingGroundDirFromStates(states: BlockRef['states']): number {
  const raw = states['ground_sign_direction'];
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  if (n === null || n < 0 || n > 15) return 0;
  return n;
}

export type HangingSignMode = 'wall' | 'ceiling_parallel' | 'ceiling_attached';

export function hangingSignModeFromStates(states: BlockRef['states']): HangingSignMode {
  if (!hangingSignIsHanging(states)) return 'wall';
  return hangingSignIsAttached(states) ? 'ceiling_attached' : 'ceiling_parallel';
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
  rotation?: ModelBoxRotation,
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces,
    ...(rotation ? { rotation } : {}),
  });
}

/** MC clockwise yaw degrees → our rotateModelY CCW quarter-turns. */
function mcYawToTurns(minecraftYDegrees: 0 | 90 | 180 | 270): number {
  switch (minecraftYDegrees) {
    case 0:
      return 0;
    case 90:
      return 3;
    case 180:
      return 2;
    case 270:
      return 1;
  }
}

function turnsForSouthCanonical(facing: HangingCardinal): number {
  switch (facing) {
    case 'south':
      return mcYawToTurns(0);
    case 'west':
      return mcYawToTurns(90);
    case 'north':
      return mcYawToTurns(180);
    case 'east':
      return mcYawToTurns(270);
  }
}

function turnsForNorthCanonical(facing: HangingCardinal): number {
  switch (facing) {
    case 'north':
      return 0;
    case 'east':
      return mcYawToTurns(90);
    case 'south':
      return mcYawToTurns(180);
    case 'west':
      return mcYawToTurns(270);
  }
}

function withKey(model: BlockModel, key: string): BlockModel {
  return Object.freeze({ ...model, key });
}

/** South-facing ceiling parallel: board + two vertical chains. */
function ceilingParallelSouth(blockName: string): BlockModel {
  const faces = allFaces(blockName);
  const board = box([1 * PX, 0, 7 * PX], [15 * PX, 10 * PX, 9 * PX], faces);
  const chainL = box([3 * PX, 10 * PX, 7 * PX], [5 * PX, 1, 9 * PX], faces);
  const chainR = box([11 * PX, 10 * PX, 7 * PX], [13 * PX, 1, 9 * PX], faces);
  const boxes = Object.freeze([board, chainL, chainR]);
  return Object.freeze({
    key: 'hanging_sign:ceiling_parallel:south:tmp',
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

/**
 * South-facing ceiling attached (V): board + two chains leaning ±30° about Z
 * toward the top-centre attachment point.
 */
function ceilingAttachedSouth(blockName: string): BlockModel {
  const faces = allFaces(blockName);
  const top = Object.freeze([0.5, 1, 0.5] as const);
  const board = box([1 * PX, 0, 7 * PX], [15 * PX, 10 * PX, 9 * PX], faces);
  const chainStem = box([7 * PX, 10 * PX, 7 * PX], [9 * PX, 1, 9 * PX], faces);
  const chainL = Object.freeze({
    ...chainStem,
    rotation: Object.freeze({ origin: top, axis: 'z' as const, angle: 30 }),
  });
  const chainR = Object.freeze({
    ...chainStem,
    rotation: Object.freeze({ origin: top, axis: 'z' as const, angle: -30 }),
  });
  const boxes = Object.freeze([board, chainL, chainR]);
  return Object.freeze({
    key: 'hanging_sign:ceiling_attached:0:tmp',
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

/**
 * Orient attached V model by ground_sign_direction.
 * Cardinals (0/4/8/12): rotateModelY. Other 22.5° steps: shared Y element rotation
 * (Z-lean is dropped — AABB mesher has one rotation slot per box).
 */
function orientAttached(blockName: string, groundDir: number): BlockModel {
  const base = ceilingAttachedSouth(blockName);
  if (groundDir === 0) return base;

  if (groundDir % 4 === 0) {
    const deg = (groundDir * 22.5) as 0 | 90 | 180 | 270;
    return rotateModelY(base, mcYawToTurns(deg));
  }

  const faces = allFaces(blockName);
  const yRot: ModelBoxRotation = Object.freeze({
    origin: Object.freeze([0.5, 0, 0.5] as const),
    axis: 'y',
    angle: -groundDir * 22.5,
  });
  // Parallel-ish inward chains as a V hint when lean can't compose with yaw.
  const board = box([1 * PX, 0, 7 * PX], [15 * PX, 10 * PX, 9 * PX], faces, yRot);
  const chainL = box([5 * PX, 10 * PX, 7 * PX], [7 * PX, 1, 9 * PX], faces, yRot);
  const chainR = box([9 * PX, 10 * PX, 7 * PX], [11 * PX, 1, 9 * PX], faces, yRot);
  const boxes = Object.freeze([board, chainL, chainR]);
  return Object.freeze({
    key: 'hanging_sign:ceiling_attached:tmp',
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

/** North-facing wall: bar on high-Z + short hangers + board. */
function wallNorth(blockName: string): BlockModel {
  const faces = allFaces(blockName);
  const bar = box([1 * PX, 13 * PX, 14 * PX], [15 * PX, 15 * PX, 1], faces);
  const hangL = box([3 * PX, 10 * PX, 14 * PX], [5 * PX, 13 * PX, 1], faces);
  const hangR = box([11 * PX, 10 * PX, 14 * PX], [13 * PX, 13 * PX, 1], faces);
  const board = box([1 * PX, 0, 12 * PX], [15 * PX, 10 * PX, 14 * PX], faces);
  const boxes = Object.freeze([bar, hangL, hangR, board]);
  return Object.freeze({
    key: 'hanging_sign:wall:north:tmp',
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

export type HangingSignResolveResult =
  | { ok: true; mode: HangingSignMode; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildHangingSign(ref: BlockRef): HangingSignResolveResult {
  if (!isHangingSignName(ref.name)) {
    return { ok: false, reason: 'not a hanging sign id' };
  }
  const mode = hangingSignModeFromStates(ref.states);

  if (mode === 'wall') {
    const facing = hangingFacingFromStates(ref.states);
    if (!facing) {
      return { ok: false, reason: 'wall hanging sign missing facing_direction 2–5' };
    }
    const base = wallNorth(ref.name);
    const turns = turnsForNorthCanonical(facing);
    const oriented = turns === 0 ? base : rotateModelY(base, turns);
    return {
      ok: true,
      mode,
      model: withKey(oriented, `hanging_sign:wall:${facing}:${ref.name}`),
    };
  }

  if (mode === 'ceiling_parallel') {
    const facing = hangingFacingFromStates(ref.states) ?? 'south';
    const base = ceilingParallelSouth(ref.name);
    const turns = turnsForSouthCanonical(facing);
    const oriented = turns === 0 ? base : rotateModelY(base, turns);
    return {
      ok: true,
      mode,
      model: withKey(oriented, `hanging_sign:ceiling_parallel:${facing}:${ref.name}`),
    };
  }

  const dir = hangingGroundDirFromStates(ref.states);
  const model = orientAttached(ref.name, dir);
  return {
    ok: true,
    mode,
    model: withKey(model, `hanging_sign:ceiling_attached:${dir}:${ref.name}`),
  };
}

export function hangingSignModel(ref: BlockRef): BlockModel {
  const built = tryBuildHangingSign(ref);
  if (!built.ok) throw new Error(`hangingSignModel: ${built.reason}`);
  return built.model;
}

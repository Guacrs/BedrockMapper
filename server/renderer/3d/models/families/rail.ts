/**
 * Rail family (PR37) — flat / ascending / corner from Bedrock `rail_direction`.
 *
 * ## Bedrock research
 *
 * - Wiki Rail/BS Bedrock + Microsoft aux map:
 *     `rail`            → `rail_direction` 0–9 (corners 6–9)
 *     `golden_rail` /
 *     `detector_rail` /
 *     `activator_rail`  → `rail_direction` 0–5 + `rail_data_bit` (no corners)
 * - `rail_direction` (stored in LevelDB; game updates on place/neighbour change):
 *     0 flat north–south
 *     1 flat east–west
 *     2 ascending east
 *     3 ascending west
 *     4 ascending north
 *     5 ascending south
 *     6–9 corners SE / SW / NW / NE (`rail` only)
 * - `rail_data_bit` = powered / activated — **texture only**, not geometry.
 * - Appearance DB already encodes powered vs unpowered as up vs down slots
 *   (and corner vs straight for normal rail as up=`rail_normal_turned`).
 *
 * ## Architecture
 *
 * ```text
 * BlockRef (intrinsic rail_direction + rail_data_bit)
 *   → RailShape
 *   → ModelBox geometry (shared across powered/unpowered)
 *   → UV from appearance (powered / corner texture pick)
 * ```
 *
 * Stored `rail_direction` is authoritative for meshing — **not** a fence-style
 * ConnectionMask rewrite. `railShapeFromNeighbors` is a narrow missing-state
 * / fixture-verification helper only (flat + simple corners); it does not
 * invent ascending slopes and must not become a generic rail connectivity
 * framework.
 *
 * Geometry parity: Java `rail_flat` / `template_rail_raised_{ne,sw}` /
 * `rail_curved` — zero-thickness plane at y=1/16 (flat) or y=9/16 ±45° X
 * with `rescale` (ascending). Orientations via `rotateModelY` matching
 * Java blockstate Y turns (Minecraft CW ↔ our CCW quarter turns).
 */

import { appearanceForBlock, textureKeyForCubeFace } from '../../textures/appearance.ts';
import { rotateModelY } from '../transform.ts';
import type {
  BlockModel,
  BlockRef,
  FaceId,
  FaceMaterial,
  ModelBox,
  ModelBoxRotation,
} from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

const RAIL_SHORT_IDS: ReadonlySet<string> = new Set([
  'rail',
  'golden_rail',
  'detector_rail',
  'activator_rail',
]);

/** Powered / detector / activator — no corner shapes in Bedrock. */
const POWERED_FAMILY_SHORT_IDS: ReadonlySet<string> = new Set([
  'golden_rail',
  'detector_rail',
  'activator_rail',
]);

export function isRailName(name: string): boolean {
  return RAIL_SHORT_IDS.has(shortId(name));
}

export function railAllowsCorners(name: string): boolean {
  return shortId(name) === 'rail';
}

export type RailShape =
  | 'north_south'
  | 'east_west'
  | 'ascending_east'
  | 'ascending_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'south_east'
  | 'south_west'
  | 'north_west'
  | 'north_east';

const INT_TO_SHAPE: Readonly<Record<number, RailShape>> = Object.freeze({
  0: 'north_south',
  1: 'east_west',
  2: 'ascending_east',
  3: 'ascending_west',
  4: 'ascending_north',
  5: 'ascending_south',
  6: 'south_east',
  7: 'south_west',
  8: 'north_west',
  9: 'north_east',
});

const CORNER_SHAPES: ReadonlySet<RailShape> = new Set([
  'south_east',
  'south_west',
  'north_west',
  'north_east',
]);

export function isCornerRailShape(shape: RailShape): boolean {
  return CORNER_SHAPES.has(shape);
}

export function isAscendingRailShape(shape: RailShape): boolean {
  return shape.startsWith('ascending_');
}

/**
 * Read Bedrock `rail_direction`. Returns null when missing/invalid.
 * Corner values on powered-family rails are treated as invalid (Microsoft
 * aux map remaps 6–7 → direction 0 for those ids — we fall back instead of
 * inventing corners).
 */
export function railShapeFromStates(
  states: BlockRef['states'],
  allowCorners: boolean,
): RailShape | null {
  const raw = states['rail_direction'];
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  if (n === null) return null;
  const shape = INT_TO_SHAPE[n];
  if (!shape) return null;
  if (!allowCorners && isCornerRailShape(shape)) return null;
  return shape;
}

/** Powered / activated visual — texture only. */
export function railIsPowered(states: BlockRef['states']): boolean {
  const raw = states['rail_data_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

/**
 * Narrow neighbour → flat/corner shape helper.
 *
 * Only cardinal rail presence. Does **not** derive ascending (needs above-
 * neighbour slope context the game already baked into `rail_direction`).
 * Missing neighbour volumes → that side false (chunk-boundary safe).
 */
export function railShapeFromNeighbors(
  neighbors: Readonly<{
    north: boolean;
    east: boolean;
    south: boolean;
    west: boolean;
  }>,
  allowCorners: boolean,
): RailShape {
  const { north, east, south, west } = neighbors;
  const count = (north ? 1 : 0) + (east ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0);

  if (allowCorners && count === 2) {
    if (south && east) return 'south_east';
    if (south && west) return 'south_west';
    if (north && west) return 'north_west';
    if (north && east) return 'north_east';
  }

  if (east || west) {
    if (!(north || south)) return 'east_west';
    // Prefer EW when both axes present without a clean corner.
    if (east && west) return 'east_west';
  }
  if (north || south) return 'north_south';
  return 'north_south';
}

/** True when neighbour ref is any rail (for the narrow shape helper). */
export function railConnectsToNeighbour(neighbour: BlockRef | null): boolean {
  if (!neighbour) return false;
  return isRailName(neighbour.name);
}

// --- Geometry (Java parity) -------------------------------------------------

/** Flat / corner plane at y = 1/16 (zero thickness). */
const FLAT_Y = 1 * PX;
/** Raised plane centre at y = 9/16 before ±45° X + rescale. */
const RAISED_Y = 9 * PX;
const RAISED_ORIGIN = Object.freeze([0.5, RAISED_Y, 0.5] as const);

const RAISED_NE_ROTATION: ModelBoxRotation = Object.freeze({
  origin: RAISED_ORIGIN,
  axis: 'x',
  angle: 45,
  rescale: true,
});

const RAISED_SW_ROTATION: ModelBoxRotation = Object.freeze({
  origin: RAISED_ORIGIN,
  axis: 'x',
  angle: -45,
  rescale: true,
});

/**
 * Pick the atlas key for the rail plane.
 * - Normal rail: corner → appearance `up` (turned); else `down` (straight).
 * - Powered family: powered → `up`; unpowered → `down`.
 */
function railTextureKey(
  blockName: string,
  shape: RailShape,
  powered: boolean,
): FaceMaterial['textureKey'] {
  const appearance = appearanceForBlock(blockName);
  const short = shortId(blockName);
  if (POWERED_FAMILY_SHORT_IDS.has(short)) {
    return textureKeyForCubeFace(appearance, powered ? 'up' : 'down');
  }
  // Normal rail — powered bit unused; corners use turned texture.
  return textureKeyForCubeFace(appearance, isCornerRailShape(shape) ? 'up' : 'down');
}

function planeFaces(
  textureKey: FaceMaterial['textureKey'],
): ModelBox['faces'] {
  const mat: FaceMaterial = Object.freeze({ textureKey });
  const faces: Partial<Record<FaceId, FaceMaterial>> = {
    up: mat,
    down: mat,
  };
  return Object.freeze(faces);
}

function planeBox(
  y: number,
  textureKey: FaceMaterial['textureKey'],
  rotation?: ModelBoxRotation,
): ModelBox {
  return Object.freeze({
    min: Object.freeze([0, y, 0] as const),
    max: Object.freeze([1, y, 1] as const),
    faces: planeFaces(textureKey),
    ...(rotation ? { rotation } : {}),
  });
}

function modelFromBox(key: string, box: ModelBox): BlockModel {
  const boxes = Object.freeze([box]);
  return Object.freeze({
    key,
    renderBoxes: boxes,
    occlusionBoxes: boxes,
    isFullCube: false,
  });
}

/**
 * Minecraft blockstate Y is clockwise looking down; our `rotateModelY` is
 * CCW — map CW quarter turns → CCW.
 */
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

function withKey(model: BlockModel, key: string): BlockModel {
  return Object.freeze({ ...model, key });
}

function buildRailGeometry(
  blockName: string,
  shape: RailShape,
  powered: boolean,
): BlockModel {
  const tex = railTextureKey(blockName, shape, powered);
  const poweredTag = POWERED_FAMILY_SHORT_IDS.has(shortId(blockName))
    ? powered
      ? 'on'
      : 'off'
    : 'plain';
  const keyBase = `rail:${shape}:${poweredTag}:${blockName}`;

  switch (shape) {
    case 'north_south':
      return modelFromBox(keyBase, planeBox(FLAT_Y, tex));
    case 'east_west': {
      const base = modelFromBox('rail:tmp', planeBox(FLAT_Y, tex));
      return withKey(rotateModelY(base, mcYawToTurns(90)), keyBase);
    }
    case 'ascending_north': {
      // Java: rail_raised_ne (no Y) — +45° X raises north end.
      return modelFromBox(keyBase, planeBox(RAISED_Y, tex, RAISED_NE_ROTATION));
    }
    case 'ascending_south': {
      // Java: rail_raised_sw (no Y) — −45° X raises south end.
      return modelFromBox(keyBase, planeBox(RAISED_Y, tex, RAISED_SW_ROTATION));
    }
    case 'ascending_east': {
      // Java: rail_raised_ne + y:90
      const base = modelFromBox('rail:tmp', planeBox(RAISED_Y, tex, RAISED_NE_ROTATION));
      return withKey(rotateModelY(base, mcYawToTurns(90)), keyBase);
    }
    case 'ascending_west': {
      // Java: rail_raised_sw + y:90
      const base = modelFromBox('rail:tmp', planeBox(RAISED_Y, tex, RAISED_SW_ROTATION));
      return withKey(rotateModelY(base, mcYawToTurns(90)), keyBase);
    }
    case 'south_east': {
      // Java: rail_corner (no Y)
      return modelFromBox(keyBase, planeBox(FLAT_Y, tex));
    }
    case 'south_west': {
      const base = modelFromBox('rail:tmp', planeBox(FLAT_Y, tex));
      return withKey(rotateModelY(base, mcYawToTurns(90)), keyBase);
    }
    case 'north_west': {
      const base = modelFromBox('rail:tmp', planeBox(FLAT_Y, tex));
      return withKey(rotateModelY(base, mcYawToTurns(180)), keyBase);
    }
    case 'north_east': {
      const base = modelFromBox('rail:tmp', planeBox(FLAT_Y, tex));
      return withKey(rotateModelY(base, mcYawToTurns(270)), keyBase);
    }
  }
}

export type RailResolveResult =
  | { ok: true; shape: RailShape; powered: boolean; model: BlockModel }
  | { ok: false; reason: string };

/**
 * Build rail model from intrinsic BlockRef state.
 * Optional `neighborShape` overrides only when `rail_direction` is absent —
 * never overrides a stored direction (keeps BlockRef authoritative).
 */
export function tryBuildRail(
  ref: BlockRef,
  neighborShape?: RailShape | null,
): RailResolveResult {
  if (!isRailName(ref.name)) {
    return { ok: false, reason: 'not a rail id' };
  }
  const allowCorners = railAllowsCorners(ref.name);
  let shape = railShapeFromStates(ref.states, allowCorners);
  if (!shape) {
    if (neighborShape != null) {
      if (!allowCorners && isCornerRailShape(neighborShape)) {
        return { ok: false, reason: 'corner shape not allowed for powered-family rail' };
      }
      shape = neighborShape;
    } else if (statesMissingDirection(ref.states)) {
      // Bedrock default when unset is 0 (north_south).
      shape = 'north_south';
    } else {
      return { ok: false, reason: 'missing/invalid rail_direction' };
    }
  }
  const powered = railIsPowered(ref.states);
  const model = buildRailGeometry(ref.name, shape, powered);
  return { ok: true, shape, powered, model };
}

function statesMissingDirection(states: BlockRef['states']): boolean {
  return states['rail_direction'] === undefined;
}

export function railModel(ref: BlockRef): BlockModel {
  const built = tryBuildRail(ref);
  if (!built.ok) throw new Error(`railModel: ${built.reason}`);
  return built.model;
}

/** Exported for tests. */
export const RAIL_FLAT_Y = FLAT_Y;
export const RAIL_RAISED_Y = RAISED_Y;

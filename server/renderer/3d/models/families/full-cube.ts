/**
 * Full-cube model — default for every renderable block that has no special
 * family. Matches the pre-PR20 unit-cube mesher behaviour.
 *
 * PR31: per-cardinal textures from the appearance DB, plus optional orientation
 * from `minecraft:cardinal_direction` / `facing_direction` / `pillar_axis`.
 * Authored fronts vary by block (furnace→south, lit_furnace→east, observer→north);
 * we detect the unique front face and rotate materials to match state facing.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const UNIT: readonly [number, number, number] = [0, 0, 0];
const UNIT_MAX: readonly [number, number, number] = [1, 1, 1];

const CARDINALS: readonly FaceId[] = ['north', 'south', 'east', 'west'];

function baseCube(blockName: string): BlockModel {
  const box: ModelBox = Object.freeze({
    min: UNIT,
    max: UNIT_MAX,
    faces: Object.freeze({
      up: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'up') }),
      down: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'down') }),
      north: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'north') }),
      south: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'south') }),
      east: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'east') }),
      west: Object.freeze({ textureKey: fullCubeFaceTexture(blockName, 'west') }),
    }),
  });
  return Object.freeze({
    key: `full_cube:${blockName}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: true,
  });
}

function isCardinalString(value: unknown): value is FaceId {
  return value === 'north' || value === 'south' || value === 'east' || value === 'west';
}

/** facing_direction 0..5: 0=down 1=up 2=north 3=south 4=west 5=east. */
function cardinalFromFacingDirection(raw: unknown): FaceId | null {
  let dir: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) dir = raw;
  else if (typeof raw === 'string' && /^[0-5]$/.test(raw)) dir = Number(raw);
  if (dir === null) return null;
  switch (dir) {
    case 2:
      return 'north';
    case 3:
      return 'south';
    case 4:
      return 'west';
    case 5:
      return 'east';
    default:
      return null;
  }
}

function horizontalFacing(states: BlockRef['states']): FaceId | null {
  const card = states['minecraft:cardinal_direction'];
  if (isCardinalString(card)) return card;
  const fromFacing = cardinalFromFacingDirection(states['facing_direction']);
  if (fromFacing) return fromFacing;
  const dir = states['direction'];
  if (isCardinalString(dir)) return dir;
  return null;
}

/**
 * Infer which cardinal holds the authored "front" in blocks.json.
 * Vanilla usually puts fronts on south; lit_furnace uses east; observer north.
 */
function authoredFrontCardinal(box: ModelBox): FaceId {
  const keys: Partial<Record<FaceId, string | null>> = {};
  for (const f of CARDINALS) {
    keys[f] = box.faces[f]?.textureKey ?? null;
  }
  const values = CARDINALS.map((f) => keys[f]).filter((k): k is string => k != null);
  if (values.length === 0) return 'south';

  const freq = new Map<string, number>();
  for (const k of values) freq.set(k, (freq.get(k) ?? 0) + 1);
  let majority = values[0]!;
  let best = 0;
  for (const [k, n] of freq) {
    if (n > best) {
      best = n;
      majority = k;
    }
  }

  const uniques = CARDINALS.filter((f) => keys[f] != null && keys[f] !== majority);
  if (uniques.length === 1) return uniques[0]!;
  for (const pref of ['south', 'north', 'east', 'west'] as const) {
    if (uniques.includes(pref)) return pref;
  }
  return 'south';
}

/** CCW quarter-turns so material on `from` moves onto `to` (see transform.ts). */
function turnsMovingFace(from: FaceId, to: FaceId): number {
  const order: FaceId[] = ['east', 'south', 'west', 'north'];
  const iFrom = order.indexOf(from);
  const iTo = order.indexOf(to);
  if (iFrom < 0 || iTo < 0) return 0;
  return (iTo - iFrom + 4) % 4;
}

/**
 * Remap end-cap textures for `pillar_axis` ∈ {x,z}.
 * Appearance authors y-up logs: up/down = top, sides = bark.
 * Axis x → ends on east/west; axis z → ends on north/south.
 */
function applyPillarAxis(model: BlockModel, axis: string): BlockModel {
  if (axis !== 'x' && axis !== 'z') return model;
  const box = model.renderBoxes[0]!;
  const top = box.faces.up;
  const sideMat =
    box.faces.north?.textureKey !== top?.textureKey
      ? box.faces.north
      : box.faces.east?.textureKey !== top?.textureKey
        ? box.faces.east
        : box.faces.south ?? box.faces.west ?? box.faces.north;

  const faces: Partial<Record<FaceId, NonNullable<(typeof box.faces)[FaceId]>>> = {
    ...box.faces,
  };
  if (axis === 'x') {
    if (top) {
      faces.east = top;
      faces.west = top;
    }
    if (sideMat) {
      faces.north = sideMat;
      faces.south = sideMat;
      faces.up = sideMat;
      faces.down = sideMat;
    }
  } else {
    if (top) {
      faces.north = top;
      faces.south = top;
    }
    if (sideMat) {
      faces.east = sideMat;
      faces.west = sideMat;
      faces.up = sideMat;
      faces.down = sideMat;
    }
  }

  const remapped: ModelBox = Object.freeze({
    min: box.min,
    max: box.max,
    faces: Object.freeze(faces),
  });
  return Object.freeze({
    key: `${model.key}|pillar=${axis}`,
    renderBoxes: Object.freeze([remapped]),
    occlusionBoxes: Object.freeze([remapped]),
    isFullCube: true,
  });
}

/** Stable orientation suffix for model cache keys. */
export function fullCubeOrientationKey(states: BlockRef['states']): string {
  const axis = states['pillar_axis'];
  if (axis === 'x' || axis === 'y' || axis === 'z') return `pillar=${axis}`;
  const facing = horizontalFacing(states);
  if (facing) return `face=${facing}`;
  return 'default';
}

/**
 * Full cube from block id only (no state orientation). Used by tests and
 * families that only need a solid neighbour stand-in.
 */
export function fullCubeModel(blockName: string): BlockModel {
  return baseCube(blockName);
}

/**
 * Full cube for a palette entry — applies pillar_axis / facing remapping.
 */
export function fullCubeModelForRef(ref: BlockRef): BlockModel {
  let model = baseCube(ref.name);
  const axis = ref.states['pillar_axis'];
  if (typeof axis === 'string' && (axis === 'x' || axis === 'z')) {
    return applyPillarAxis(model, axis);
  }

  const facing = horizontalFacing(ref.states);
  if (facing) {
    const box = model.renderBoxes[0]!;
    const authored = authoredFrontCardinal(box);
    const turns = turnsMovingFace(authored, facing);
    if (turns !== 0) {
      model = rotateModelY(model, turns);
    } else {
      model = Object.freeze({
        ...model,
        key: `${model.key}|${fullCubeOrientationKey(ref.states)}`,
      });
    }
  }
  return model;
}

/** True when any cardinal appearance differs (used by tests / coverage). */
export function hasDistinctCardinalTextures(blockName: string): boolean {
  const keys = CARDINALS.map((f) => fullCubeFaceTexture(blockName, f));
  return keys.some((k) => k !== keys[0] && k != null && keys[0] != null);
}

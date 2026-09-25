/**
 * Lever family (PR36) — attach-face base + angled handle.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `minecraft:lever` → `lever_direction`, `open_bit`.
 * - **Not** button `facing_direction` — dedicated enum (Wiki Lever/BS Bedrock):
 *     0 `down_east_west`  — ceiling, points east when off
 *     1 `east`            — wall facing east
 *     2 `west`            — wall facing west
 *     3 `south`           — wall facing south
 *     4 `north`           — wall facing north
 *     5 `up_north_south`  — floor, points south when off
 *     6 `up_east_west`    — floor, points east when off
 *     7 `down_north_south`— ceiling, points south when off
 *   LevelDB may store the string form or legacy int 0–7.
 * - `open_bit` true = activated / powered (same state *name* as doors;
 *   meaning differs).
 * - Geometry: Java `lever` / `lever_on` parity — cobblestone base plate +
 *   lever-texture handle with ±45° element rotation. Floor powered uses −45°
 *   (Java `lever.json`); unpowered +45° (`lever_on.json`). Wiki: floor/ceiling
 *   off → north or west; on → south or east. Wall: down=on, up=off.
 * - Intrinsic only — no support-neighbour attachment framework.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { flipModelY, rotateModelY } from '../transform.ts';
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

export function isLeverName(name: string): boolean {
  return shortId(name) === 'lever';
}

/** Activated / powered. */
export function leverIsOpen(states: BlockRef['states']): boolean {
  const raw = states['open_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  return false;
}

export type LeverDirection =
  | 'down_east_west'
  | 'east'
  | 'west'
  | 'south'
  | 'north'
  | 'up_north_south'
  | 'up_east_west'
  | 'down_north_south';

const INT_TO_DIR: Readonly<Record<number, LeverDirection>> = Object.freeze({
  0: 'down_east_west',
  1: 'east',
  2: 'west',
  3: 'south',
  4: 'north',
  5: 'up_north_south',
  6: 'up_east_west',
  7: 'down_north_south',
});

const STRING_DIRS: ReadonlySet<string> = new Set([
  'down_east_west',
  'east',
  'west',
  'south',
  'north',
  'up_north_south',
  'up_east_west',
  'down_north_south',
]);

export function leverDirectionFromStates(
  states: BlockRef['states'],
): LeverDirection | null {
  const raw = states['lever_direction'];
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return INT_TO_DIR[raw] ?? null;
  }
  if (typeof raw === 'string') {
    if (/^[0-7]$/.test(raw)) return INT_TO_DIR[Number(raw)] ?? null;
    if (STRING_DIRS.has(raw)) return raw as LeverDirection;
  }
  return null;
}

const HANDLE_TILE_SIDE = Object.freeze([7 / 16, 6 / 16, 9 / 16, 16 / 16] as const);
const HANDLE_TILE_CAP = Object.freeze([7 / 16, 6 / 16, 9 / 16, 8 / 16] as const);

function facesFrom(
  blockName: string,
  faceIds: readonly FaceId[],
  tileUv?: FaceMaterial['tileUv'],
): ModelBox['faces'] {
  const out: Partial<Record<FaceId, FaceMaterial>> = {};
  for (const id of faceIds) {
    out[id] = Object.freeze({
      textureKey: fullCubeFaceTexture(blockName, id),
      ...(tileUv ? { tileUv } : {}),
    });
  }
  return Object.freeze(out);
}

function allFaces(blockName: string): ModelBox['faces'] {
  return facesFrom(blockName, ['up', 'down', 'north', 'south', 'east', 'west']);
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

/**
 * Canonical floor lever: `up_north_south`.
 * Base on y=0; handle swings about X (tips south when off / open_bit false).
 */
function canonicalFloorUpNorthSouth(open: boolean): BlockModel {
  const base = box(
    [5 * PX, 0, 4 * PX],
    [11 * PX, 3 * PX, 12 * PX],
    allFaces('minecraft:cobblestone'),
  );
  const angle = open ? -45 : 45;
  const handleSides = facesFrom(
    'minecraft:lever',
    ['north', 'south', 'east', 'west'],
    HANDLE_TILE_SIDE,
  );
  const handleCap = facesFrom('minecraft:lever', ['up'], HANDLE_TILE_CAP);
  const handle = box(
    [7 * PX, 1 * PX, 7 * PX],
    [9 * PX, 11 * PX, 9 * PX],
    Object.freeze({ ...handleSides, ...handleCap }),
    Object.freeze({
      origin: Object.freeze([0.5, 1 * PX, 0.5] as const),
      axis: 'x',
      angle,
    }),
  );
  return Object.freeze({
    key: `lever:up_north_south:${open ? 'on' : 'off'}`,
    renderBoxes: Object.freeze([base, handle]),
    occlusionBoxes: Object.freeze([base]),
    isFullCube: false,
  });
}

/**
 * Canonical wall lever attached to **west** face (facing west).
 * Base plate on x=0; handle protrudes +X; swings about Z (tips down when on).
 */
function canonicalWallWest(open: boolean): BlockModel {
  const base = box(
    [0, 4 * PX, 5 * PX],
    [3 * PX, 12 * PX, 11 * PX],
    allFaces('minecraft:cobblestone'),
  );
  // Wall: down = on (open), up = off.
  const angle = open ? 45 : -45;
  const handleSides = facesFrom(
    'minecraft:lever',
    ['north', 'south', 'up', 'down'],
    HANDLE_TILE_SIDE,
  );
  const handleTip = facesFrom('minecraft:lever', ['east'], HANDLE_TILE_CAP);
  const handle = box(
    [1 * PX, 7 * PX, 7 * PX],
    [11 * PX, 9 * PX, 9 * PX],
    Object.freeze({ ...handleSides, ...handleTip }),
    Object.freeze({
      origin: Object.freeze([1 * PX, 0.5, 0.5] as const),
      axis: 'z',
      angle,
    }),
  );
  return Object.freeze({
    key: `lever:wall:west:${open ? 'on' : 'off'}`,
    renderBoxes: Object.freeze([base, handle]),
    occlusionBoxes: Object.freeze([base]),
    isFullCube: false,
  });
}

/** Quarter-turns from canonical west wall → target wall facing. */
function wallTurns(dir: 'west' | 'north' | 'east' | 'south'): number {
  switch (dir) {
    case 'west':
      return 0;
    case 'north':
      return 1;
    case 'east':
      return 2;
    case 'south':
      return 3;
  }
}

export type LeverResolveResult =
  | { ok: true; model: BlockModel; direction: LeverDirection; open: boolean }
  | { ok: false; reason: string };

export function tryBuildLever(ref: BlockRef): LeverResolveResult {
  if (!isLeverName(ref.name)) return { ok: false, reason: 'not a lever' };
  const direction = leverDirectionFromStates(ref.states);
  if (!direction) return { ok: false, reason: 'missing/invalid lever_direction' };
  const open = leverIsOpen(ref.states);

  let model: BlockModel;
  switch (direction) {
    case 'up_north_south': {
      model = canonicalFloorUpNorthSouth(open);
      break;
    }
    case 'up_east_west': {
      const base = canonicalFloorUpNorthSouth(open);
      model = Object.freeze({
        ...rotateModelY(base, 1),
        key: `lever:up_east_west:${open ? 'on' : 'off'}`,
      });
      break;
    }
    case 'down_north_south': {
      const base = canonicalFloorUpNorthSouth(open);
      model = Object.freeze({
        ...flipModelY(base),
        key: `lever:down_north_south:${open ? 'on' : 'off'}`,
      });
      break;
    }
    case 'down_east_west': {
      const base = rotateModelY(canonicalFloorUpNorthSouth(open), 1);
      model = Object.freeze({
        ...flipModelY(base),
        key: `lever:down_east_west:${open ? 'on' : 'off'}`,
      });
      break;
    }
    case 'west':
    case 'north':
    case 'east':
    case 'south': {
      const canonical = canonicalWallWest(open);
      const turns = wallTurns(direction);
      const oriented = rotateModelY(canonical, turns);
      model = Object.freeze({
        ...oriented,
        key: `lever:wall:${direction}:${open ? 'on' : 'off'}`,
      });
      break;
    }
  }

  return { ok: true, direction, open, model };
}

export function leverModel(ref: BlockRef): BlockModel {
  const built = tryBuildLever(ref);
  if (!built.ok) throw new Error(`leverModel: ${built.reason}`);
  return built.model;
}

/** Exported for tests. */
export const LEVER_FLOOR_BASE = Object.freeze({
  min: Object.freeze([5 * PX, 0, 4 * PX] as const),
  max: Object.freeze([11 * PX, 3 * PX, 12 * PX] as const),
});

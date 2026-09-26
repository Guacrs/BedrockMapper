/**
 * Standing / wall sign family (PR40) — thin board (+ post for standing).
 *
 * ## Bedrock research (Microsoft listings + Wiki Sign/BS Bedrock)
 *
 * Standing and wall are **separate block ids**, not one id with a mode bit:
 *   - `minecraft:standing_sign` / `*_standing_sign` → `ground_sign_direction` 0–15
 *   - `minecraft:wall_sign` / `*_wall_sign` → `facing_direction` 2–5 (0/1 unused)
 *
 * `ground_sign_direction` is the **only** orientation state for standing signs
 * (22.5° steps; 0=south … 8=north …). There is **no** separate “text-facing”
 * block state — sign text lives in the Sign block entity / `BlockSignComponent`,
 * not in palette states. Model rotation **is** the board orientation.
 *
 * Wall `facing_direction` matches ladder/button semantics: the direction the
 * board faces (attachment is the opposite side). 2=N 3=S 4=W 5=E.
 *
 * Bedrock has no `waterlogged` sign block state (layers). Wood variant = id.
 *
 * **Hanging signs are out of scope** (PR41) — different states
 * (`attached_bit`, `hanging`, dual facing/ground) and support geometry.
 *
 * ## Geometry
 *
 * Classic plank-board AABBs (Java still uses an entity renderer for signs;
 * these match the long-standing collision silhouette used by Bedrock clients):
 *   Standing (south / dir=0): post [7,0,7]–[9,8,9], board [0,8,7]–[16,14,9]
 *     then Y-rotate by −dir×22.5° (Minecraft clockwise → our CCW convention)
 *   Wall north-facing: board [0,4.5,14]–[16,12.5,16]; other facings remap.
 *
 * Appearance DB maps signs to plank `all` textures — no dedicated sign atlas
 * tile in this repo (entity sign.png is text-bearing, not meshed here).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
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

export type SignKind = 'standing' | 'wall';

/**
 * Floor / wall signs only — not hanging signs.
 * Matches Bedrock ids: `standing_sign`, `wall_sign`, `*_standing_sign`, `*_wall_sign`.
 */
export function isSignName(name: string): boolean {
  const short = shortId(name);
  if (short.includes('hanging_sign')) return false;
  return (
    short === 'standing_sign' ||
    short === 'wall_sign' ||
    short.endsWith('_standing_sign') ||
    short.endsWith('_wall_sign')
  );
}

export function signKindFromName(name: string): SignKind | null {
  if (!isSignName(name)) return null;
  const short = shortId(name);
  if (short === 'wall_sign' || short.endsWith('_wall_sign')) return 'wall';
  return 'standing';
}

/**
 * Standing: Bedrock `ground_sign_direction` 0–15 (default 0 = south).
 * Invalid / missing → 0.
 */
export function groundSignDirectionFromStates(states: BlockRef['states']): number {
  const raw = states['ground_sign_direction'];
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  if (n === null || n < 0 || n > 15) return 0;
  return n;
}

export type WallSignFacing = 'north' | 'south' | 'west' | 'east';

const WALL_FACING: Readonly<Record<number, WallSignFacing>> = Object.freeze({
  2: 'north',
  3: 'south',
  4: 'west',
  5: 'east',
});

/**
 * Wall: Bedrock `facing_direction` 2–5. null when missing / 0–1 / invalid
 * (caller falls back to full cube).
 */
export function wallSignFacingFromStates(
  states: BlockRef['states'],
): WallSignFacing | null {
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
  return WALL_FACING[dir] ?? null;
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

/** Minecraft clockwise yaw (degrees) → our ModelBoxRotation Y angle (CCW +). */
function standingYawAngle(dir: number): number {
  return -dir * 22.5;
}

const STANDING_ORIGIN = Object.freeze([0.5, 0, 0.5] as const);

function standingBoxes(blockName: string, dir: number): ModelBox[] {
  const faces = allFaces(blockName);
  const angle = standingYawAngle(dir);
  const rotation: ModelBoxRotation | undefined =
    angle === 0
      ? undefined
      : Object.freeze({
          origin: STANDING_ORIGIN,
          axis: 'y' as const,
          angle,
        });
  // South-facing canonical (dir=0): board thickness along Z, front toward +Z.
  const post = box([7 * PX, 0, 7 * PX], [9 * PX, 8 * PX, 9 * PX], faces, rotation);
  const board = box([0, 8 * PX, 7 * PX], [1, 14 * PX, 9 * PX], faces, rotation);
  return [post, board];
}

function wallBoard(blockName: string, facing: WallSignFacing): ModelBox {
  const faces = allFaces(blockName);
  const y0 = 4.5 * PX;
  const y1 = 12.5 * PX;
  const depth = 2 * PX;
  switch (facing) {
    case 'north':
      // Faces −Z; attached to block on +Z → board at high Z.
      return box([0, y0, 1 - depth], [1, y1, 1], faces);
    case 'south':
      return box([0, y0, 0], [1, y1, depth], faces);
    case 'west':
      return box([1 - depth, y0, 0], [1, y1, 1], faces);
    case 'east':
      return box([0, y0, 0], [depth, y1, 1], faces);
  }
}

export type SignResolveResult =
  | { ok: true; kind: SignKind; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildSign(ref: BlockRef): SignResolveResult {
  const kind = signKindFromName(ref.name);
  if (!kind) return { ok: false, reason: 'not a standing/wall sign id' };

  if (kind === 'standing') {
    const dir = groundSignDirectionFromStates(ref.states);
    const boxes = Object.freeze(standingBoxes(ref.name, dir));
    return {
      ok: true,
      kind,
      model: Object.freeze({
        key: `sign:standing:${dir}:${ref.name}`,
        renderBoxes: boxes,
        occlusionBoxes: boxes,
        isFullCube: false,
      }),
    };
  }

  const facing = wallSignFacingFromStates(ref.states);
  if (!facing) {
    return { ok: false, reason: 'wall sign missing facing_direction 2–5' };
  }
  const board = wallBoard(ref.name, facing);
  const boxes = Object.freeze([board]);
  return {
    ok: true,
    kind,
    model: Object.freeze({
      key: `sign:wall:${facing}:${ref.name}`,
      renderBoxes: boxes,
      occlusionBoxes: boxes,
      isFullCube: false,
    }),
  };
}

export function signModel(ref: BlockRef): BlockModel {
  const built = tryBuildSign(ref);
  if (!built.ok) throw new Error(`signModel: ${built.reason}`);
  return built.model;
}

/** Exported for tests — standing south (dir=0) board extents. */
export const SIGN_STANDING_BOARD_SOUTH = Object.freeze({
  min: Object.freeze([0, 8 * PX, 7 * PX] as const),
  max: Object.freeze([1, 14 * PX, 9 * PX] as const),
});

/** Exported for tests — wall north-facing board extents. */
export const SIGN_WALL_BOARD_NORTH = Object.freeze({
  min: Object.freeze([0, 4.5 * PX, 14 * PX] as const),
  max: Object.freeze([1, 12.5 * PX, 1] as const),
});

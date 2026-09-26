/**
 * Campfire family (PR44) — log pile + optional fire planes; cardinal facing.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `campfire` / `soul_campfire` → `extinguished` (bool) +
 *   `minecraft:cardinal_direction` ∈ {north,south,east,west}.
 * - Wiki (Bedrock ≥1.20.30): cardinal_direction replaced legacy int `direction`
 *   (0=S,1=W,2=N,3=E). Java `lit` is the inverse of Bedrock `extinguished`.
 * - Java `signal_fire` / `waterlogged` are **not** on Bedrock palettes —
 *   deferred (hay-bale signal and waterlogging are not geometry states here).
 * - Orientation is **intrinsic** — no neighbour probe.
 * - Geometry: Java `template_campfire` / `campfire_off` parity — four outer
 *   logs + centre floor strip; lit adds two crossed fire planes (45° Y,
 *   `rescale`) from y=1→17 px. Collision height 7/16 (wiki).
 * - Textures (atlas): `campfire_log`, `campfire_log_lit`, `campfire` (fire
 *   sprite); soul uses `soul_campfire_log_lit` + `soul_campfire`. Unlit uses
 *   log only on every face.
 * - Lighting: when lit (`!extinguished`), PR33 emissive (15 / soul 10).
 *   Extinguished → emission 0. No smoke particles, animated flame, or
 *   BlockLight/SkyLight in this PR.
 */

import { rotateModelY } from '../transform.ts';
import type {
  BlockModel,
  BlockRef,
  FaceId,
  FaceMaterial,
  ModelBox,
  ModelBoxRotation,
} from '../types.ts';
import type { TextureKey } from '../../textures/appearance.ts';

const PX = 1 / 16;

export type CampfireFacing = 'north' | 'south' | 'east' | 'west';

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isCampfireName(name: string): boolean {
  const short = shortId(name);
  return short === 'campfire' || short === 'soul_campfire';
}

export function isSoulCampfireName(name: string): boolean {
  return shortId(name) === 'soul_campfire';
}

/**
 * True when the campfire is lit (emitting). Bedrock stores the inverse as
 * `extinguished`. Missing/invalid → lit (wiki default extinguished=false).
 */
export function campfireIsLit(states: BlockRef['states']): boolean {
  const raw = states['extinguished'];
  if (raw === true || raw === 1) return false;
  if (raw === false || raw === 0) return true;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return false;
    if (raw === 'false' || raw === '0') return true;
  }
  return true;
}

const CARDINALS = new Set(['north', 'south', 'east', 'west']);

/** Legacy direction 0=S,1=W,2=N,3=E (Microsoft intrinsic list). */
const DIR_TO_FACING: Readonly<Record<number, CampfireFacing>> = Object.freeze({
  0: 'south',
  1: 'west',
  2: 'north',
  3: 'east',
});

export function campfireFacingFromStates(states: BlockRef['states']): CampfireFacing | null {
  const card = states['minecraft:cardinal_direction'];
  if (typeof card === 'string' && CARDINALS.has(card)) return card as CampfireFacing;

  const dir = states['direction'];
  if (typeof dir === 'number' && Number.isInteger(dir) && dir >= 0 && dir <= 3) {
    return DIR_TO_FACING[dir] ?? null;
  }
  if (typeof dir === 'string' && /^[0-3]$/.test(dir)) {
    return DIR_TO_FACING[Number(dir)] ?? null;
  }
  return null;
}

/**
 * Minecraft blockstate Y is clockwise; our `rotateModelY` is CCW.
 * Java campfire blockstates: south=y0, west=y90, north=y180, east=y270.
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

export function quarterTurnsForCampfireFacing(facing: CampfireFacing): number {
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

type Tex = TextureKey;

function texturesFor(blockName: string): { log: Tex; litLog: Tex; fire: Tex } {
  if (isSoulCampfireName(blockName)) {
    return {
      log: 'blocks/campfire_log',
      litLog: 'blocks/soul_campfire_log_lit',
      fire: 'blocks/soul_campfire',
    };
  }
  return {
    log: 'blocks/campfire_log',
    litLog: 'blocks/campfire_log_lit',
    fire: 'blocks/campfire',
  };
}

function mat(key: Tex): FaceMaterial {
  return Object.freeze({ textureKey: key });
}

function faces(
  map: Partial<Record<FaceId, Tex>>,
): ModelBox['faces'] {
  const out: Partial<Record<FaceId, FaceMaterial>> = {};
  for (const id of Object.keys(map) as FaceId[]) {
    const k = map[id];
    if (k) out[id] = mat(k);
  }
  return Object.freeze(out);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faceMats: ModelBox['faces'],
  rotation?: ModelBoxRotation,
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces: faceMats,
    ...(rotation ? { rotation } : {}),
  });
}

const FIRE_ROTATION: ModelBoxRotation = Object.freeze({
  origin: Object.freeze([0.5, 0.5, 0.5] as const),
  axis: 'y',
  angle: 45,
  rescale: true,
});

/**
 * South-facing base (Java template). `lit` selects lit_log faces + fire planes.
 */
function baseCampfire(blockName: string, lit: boolean): BlockModel {
  const t = texturesFor(blockName);
  const log = lit ? t.litLog : t.log;
  const plain = t.log;
  // When lit, inner faces use lit_log; outer/cull faces stay plain log (Java).
  const L = lit ? log : plain;

  // Log A: [1,0,0]–[5,4,16]
  const logA = box(
    [1 * PX, 0, 0],
    [5 * PX, 4 * PX, 1],
    faces({
      north: plain,
      east: L,
      south: plain,
      west: plain,
      up: plain,
      down: plain,
    }),
  );
  // Log B: [0,3,11]–[16,7,15]
  const logB = box(
    [0, 3 * PX, 11 * PX],
    [1, 7 * PX, 15 * PX],
    faces({
      north: L,
      east: plain,
      south: L,
      west: plain,
      up: plain,
      down: L,
    }),
  );
  // Log C: [11,0,0]–[15,4,16]
  const logC = box(
    [11 * PX, 0, 0],
    [15 * PX, 4 * PX, 1],
    faces({
      north: plain,
      east: plain,
      south: plain,
      west: L,
      up: plain,
      down: plain,
    }),
  );
  // Log D: [0,3,1]–[16,7,5]
  const logD = box(
    [0, 3 * PX, 1 * PX],
    [1, 7 * PX, 5 * PX],
    faces({
      north: L,
      east: plain,
      south: L,
      west: plain,
      up: plain,
      down: L,
    }),
  );
  // Floor strip: [5,0,0]–[11,1,16]
  const floor = box(
    [5 * PX, 0, 0],
    [11 * PX, 1 * PX, 1],
    faces({
      north: plain,
      south: plain,
      up: L,
      down: plain,
    }),
  );

  const logs = Object.freeze([logA, logB, logC, logD, floor]);
  // Occlusion: combined footprint up to 7/16 (wiki collision height).
  const shaft = box([0, 0, 0], [1, 7 * PX, 1], Object.freeze({}));

  if (!lit) {
    return Object.freeze({
      key: `campfire:south:unlit:${blockName}`,
      renderBoxes: logs,
      occlusionBoxes: Object.freeze([shaft]),
      isFullCube: false,
    });
  }

  // Fire planes — 1px thick stand-ins for Java zero-thickness; rescale for 45°.
  const fireNs = box(
    [0.8 * PX, 1 * PX, 7.5 * PX],
    [15.2 * PX, 17 * PX, 8.5 * PX],
    faces({ north: t.fire, south: t.fire }),
    FIRE_ROTATION,
  );
  const fireEw = box(
    [7.5 * PX, 1 * PX, 0.8 * PX],
    [8.5 * PX, 17 * PX, 15.2 * PX],
    faces({ east: t.fire, west: t.fire }),
    FIRE_ROTATION,
  );

  return Object.freeze({
    key: `campfire:south:lit:${blockName}`,
    renderBoxes: Object.freeze([...logs, fireNs, fireEw]),
    occlusionBoxes: Object.freeze([shaft]),
    isFullCube: false,
  });
}

export function campfireModel(
  ref: BlockRef,
  facing: CampfireFacing,
  lit: boolean = campfireIsLit(ref.states),
): BlockModel {
  const base = baseCampfire(ref.name, lit);
  const turns = quarterTurnsForCampfireFacing(facing);
  if (turns === 0) {
    return Object.freeze({
      ...base,
      key: `campfire:${facing}:${lit ? 'lit' : 'unlit'}:${ref.name}`,
    });
  }
  const oriented = rotateModelY(base, turns);
  return Object.freeze({
    ...oriented,
    key: `campfire:${facing}:${lit ? 'lit' : 'unlit'}:${ref.name}`,
  });
}

export type TryBuildCampfire =
  | { ok: true; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildCampfire(ref: BlockRef): TryBuildCampfire {
  if (!isCampfireName(ref.name)) {
    return { ok: false, reason: 'not a campfire id' };
  }
  const facing = campfireFacingFromStates(ref.states);
  if (!facing) {
    return { ok: false, reason: 'missing minecraft:cardinal_direction / direction' };
  }
  return { ok: true, model: campfireModel(ref, facing) };
}

/** Exported for tests — log pile height (block space). */
export const CAMPFIRE_LOG_HEIGHT = 7 * PX;

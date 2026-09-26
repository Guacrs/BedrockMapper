/**
 * Candle family (PR39) — 1–4 wax sticks + optional wick flame from Bedrock state.
 *
 * ## Bedrock research
 *
 * - Microsoft intrinsic list + Wiki BS Bedrock:
 *     `candles` int 0–3  → visual count 1–4 (“number of *extra* candles”)
 *     `lit`     bool     → lit/unlit
 * - Bedrock has **no** `waterlogged` block state for candles (layers system).
 *   Waterlogged candles are unlit in gameplay; we mesh from stored `lit` only.
 * - Colour variants are separate ids (`minecraft:red_candle`, …) sharing
 *   geometry; appearance DB `all` → `blocks/candles/<color>_candle`.
 * - Candle cakes (`*_candle_cake`) are **out of scope** for PR39 (cake + one
 *   candle — separate family later).
 *
 * ## Geometry (Java template_*_candle(s) parity)
 *
 * One model family, multiple boxes from `candles` count — not four separate
 * model files. Each stick is a 2×H×2 px AABB; lit adds a 1px wick as crossed
 * zero-thickness planes (±45° Y) with UV crop from the same candle atlas tile
 * (Java embeds the flame in the candle texture — no separate flame system).
 *
 * Heights (px): 1-candle H=6; 2-candle H=5+6; 3-candle H=3+5+6; 4-candle
 * H=3+5+5+6 — matching Java templates.
 *
 * ## Lighting
 *
 * When `lit=true`, route through PR33 emissive mesh. Emission scales with
 * candle count (Bedrock light levels 3/6/9/12). Unlit → terrain layer only.
 * Atlas currently ships unlit candle tiles; lit look is wax UV + emissive glow
 * (no new particle/flame abstraction).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
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

/** Floor candles only — not `*_candle_cake`. */
export function isCandleName(name: string): boolean {
  const short = shortId(name);
  if (short.endsWith('_candle_cake') || short === 'candle_cake') return false;
  return short === 'candle' || short.endsWith('_candle');
}

/**
 * Bedrock `candles` 0–3 → stick count 1–4.
 * Missing/invalid → 1 (Bedrock default 0).
 */
export function candleCountFromStates(states: BlockRef['states']): 1 | 2 | 3 | 4 {
  const raw = states['candles'];
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
  else if (typeof raw === 'string' && /^\d+$/.test(raw)) n = Number(raw);
  if (n === null || n < 0 || n > 3) return 1;
  return (n + 1) as 1 | 2 | 3 | 4;
}

export function candleIsLit(states: BlockRef['states']): boolean {
  const raw = states['lit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

/** Bedrock light level when lit: 3 × count. */
export function candleLightLevel(count: 1 | 2 | 3 | 4): number {
  return 3 * count;
}

type Stick = {
  readonly x0: number;
  readonly z0: number;
  readonly h: number;
};

/** Java template layouts (min corner in px, height in px). Footprint 2×2. */
const LAYOUTS: Readonly<Record<1 | 2 | 3 | 4, readonly Stick[]>> = Object.freeze({
  1: Object.freeze([{ x0: 7, z0: 7, h: 6 }]),
  2: Object.freeze([
    { x0: 5, z0: 7, h: 5 },
    { x0: 9, z0: 6, h: 6 },
  ]),
  3: Object.freeze([
    { x0: 7, z0: 9, h: 3 },
    { x0: 5, z0: 7, h: 5 },
    { x0: 8, z0: 6, h: 6 },
  ]),
  4: Object.freeze([
    { x0: 6, z0: 8, h: 3 },
    { x0: 9, z0: 8, h: 5 },
    { x0: 5, z0: 5, h: 5 },
    { x0: 8, z0: 5, h: 6 },
  ]),
});

/** Side UV [0,8]–[2,14] for H=6; shorter sticks crop the bottom of that range. */
function sideTileUv(hPx: number): FaceMaterial['tileUv'] {
  const v0 = 8 / 16;
  const v1 = (8 + hPx) / 16;
  return Object.freeze([0, v0, 2 / 16, v1] as const);
}

const UP_UV = Object.freeze([0, 6 / 16, 2 / 16, 8 / 16] as const);
const DOWN_UV = Object.freeze([0, 14 / 16, 2 / 16, 16 / 16] as const);
const FLAME_UV = Object.freeze([0, 5 / 16, 1 / 16, 6 / 16] as const);

function face(
  blockName: string,
  faceId: FaceId,
  tileUv?: FaceMaterial['tileUv'],
): FaceMaterial {
  return Object.freeze({
    textureKey: fullCubeFaceTexture(blockName, faceId),
    ...(tileUv ? { tileUv } : {}),
  });
}

function stickBox(blockName: string, stick: Stick): ModelBox {
  const x0 = stick.x0 * PX;
  const z0 = stick.z0 * PX;
  const h = stick.h * PX;
  const sideUv = sideTileUv(stick.h);
  return Object.freeze({
    min: Object.freeze([x0, 0, z0] as const),
    max: Object.freeze([x0 + 2 * PX, h, z0 + 2 * PX] as const),
    faces: Object.freeze({
      north: face(blockName, 'north', sideUv),
      south: face(blockName, 'south', sideUv),
      east: face(blockName, 'east', sideUv),
      west: face(blockName, 'west', sideUv),
      up: face(blockName, 'up', UP_UV),
      down: face(blockName, 'down', DOWN_UV),
    } as const),
  });
}

/**
 * Wick flame: 1×1×1 px cross at stick top, ±45° about Y (AABB mesher needs
 * positive thickness — same 1px convention as cross/lantern hangers).
 * Only N/S faces textured; flame UV is the 1px crop from the candle tile.
 * No separate flame/particle system — reuses the candle atlas tile + PR33 glow.
 */
function flameBoxes(blockName: string, stick: Stick): ModelBox[] {
  const cx = (stick.x0 + 1) * PX;
  const cz = (stick.z0 + 1) * PX;
  const y0 = stick.h * PX;
  const y1 = (stick.h + 1) * PX;
  const half = 0.5 * PX;
  const origin = Object.freeze([cx, y0, cz] as const);
  const mat = face(blockName, 'north', FLAME_UV);
  const faces = Object.freeze({
    north: mat,
    south: mat,
  } as const);

  const base: Omit<ModelBox, 'rotation'> = {
    min: Object.freeze([cx - half, y0, cz - half] as const),
    max: Object.freeze([cx + half, y1, cz + half] as const),
    faces,
  };

  const plus: ModelBoxRotation = Object.freeze({
    origin,
    axis: 'y',
    angle: 45,
  });
  const minus: ModelBoxRotation = Object.freeze({
    origin,
    axis: 'y',
    angle: -45,
  });

  return [
    Object.freeze({ ...base, rotation: plus }),
    Object.freeze({ ...base, rotation: minus }),
  ];
}

export type CandleResolveResult =
  | { ok: true; count: 1 | 2 | 3 | 4; lit: boolean; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildCandle(ref: BlockRef): CandleResolveResult {
  if (!isCandleName(ref.name)) {
    return { ok: false, reason: 'not a candle id' };
  }
  const count = candleCountFromStates(ref.states);
  const lit = candleIsLit(ref.states);
  const sticks = LAYOUTS[count];
  const boxes: ModelBox[] = [];
  for (const stick of sticks) {
    boxes.push(stickBox(ref.name, stick));
    if (lit) boxes.push(...flameBoxes(ref.name, stick));
  }
  const frozen = Object.freeze(boxes);
  const model: BlockModel = Object.freeze({
    key: `candle:${count}:${lit ? 'lit' : 'unlit'}:${ref.name}`,
    renderBoxes: frozen,
    occlusionBoxes: Object.freeze(sticks.map((s) => stickBox(ref.name, s))),
    isFullCube: false,
  });
  return { ok: true, count, lit, model };
}

export function candleModel(ref: BlockRef): BlockModel {
  const built = tryBuildCandle(ref);
  if (!built.ok) throw new Error(`candleModel: ${built.reason}`);
  return built.model;
}

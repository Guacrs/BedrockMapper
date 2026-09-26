/**
 * Block emission metadata for PR33 (rendered lighting / emissive materials).
 *
 * This is **not** Minecraft light propagation. It only describes whether a
 * block should *look* self-lit in Three.js. Nearby illumination from
 * BlockLight / SkyLight is a later milestone (after model coverage).
 *
 * Values are researched from Bedrock block behaviour / wiki light levels
 * (0–15), normalized to 0..1 for materials. Prefer Bedrock ids that exist in
 * LevelDB palettes; state-dependent lit variants use distinct ids where
 * Bedrock splits them (`lit_redstone_lamp`, `lit_furnace`, …). Candles keep
 * one id and use the `lit` + `candles` states (PR39).
 */

import {
  candleCountFromStates,
  candleIsLit,
  candleLightLevel,
  isCandleName,
} from '../models/families/candle.ts';
import type { BlockRef } from '../models/types.ts';

export interface BlockLighting {
  /** 0..1 self-glow strength (derived from Minecraft light level / 15). */
  readonly emission: number;
  /** Optional RGB tint for the glow (0..1). Defaults to white. */
  readonly lightColor?: readonly [number, number, number];
}

type BlockStates = BlockRef['states'];

function level(n: number): number {
  return Math.min(1, Math.max(0, n / 15));
}

function rgb(hex: number): readonly [number, number, number] {
  return Object.freeze([
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ] as const);
}

const CANDLE_GLOW = rgb(0xffd28a);

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/**
 * Static emitters — whole-block glow. Extend carefully with Bedrock evidence;
 * do not invent plausible glow for decorative blocks.
 */
const EMITTERS: ReadonlyMap<string, BlockLighting> = new Map([
  // Torches (geometry from PR30; glow is PR33)
  ['torch', Object.freeze({ emission: level(14), lightColor: rgb(0xffd28a) })],
  ['soul_torch', Object.freeze({ emission: level(10), lightColor: rgb(0x6fe0ff) })],
  ['redstone_torch', Object.freeze({ emission: level(7), lightColor: rgb(0xff4a4a) })],
  ['unlit_redstone_torch', Object.freeze({ emission: 0, lightColor: rgb(0xff4a4a) })],
  ['copper_torch', Object.freeze({ emission: level(14), lightColor: rgb(0xffd28a) })],
  ['colored_torch_blue', Object.freeze({ emission: level(14), lightColor: rgb(0x6fa8ff) })],
  ['colored_torch_green', Object.freeze({ emission: level(14), lightColor: rgb(0x6fff8a) })],
  ['colored_torch_purple', Object.freeze({ emission: level(14), lightColor: rgb(0xc06fff) })],
  ['colored_torch_red', Object.freeze({ emission: level(14), lightColor: rgb(0xff6f6f) })],

  // Full-cube emitters
  ['glowstone', Object.freeze({ emission: level(15), lightColor: rgb(0xffe9a0) })],
  ['sea_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xc8fff8) })],
  ['shroomlight', Object.freeze({ emission: level(15), lightColor: rgb(0xffb070) })],
  ['jack_o_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffa040) })],
  ['lit_pumpkin', Object.freeze({ emission: level(15), lightColor: rgb(0xffa040) })],
  ['magma', Object.freeze({ emission: level(3), lightColor: rgb(0xff6030) })],
  ['magma_block', Object.freeze({ emission: level(3), lightColor: rgb(0xff6030) })],

  // Fluids / nether
  ['lava', Object.freeze({ emission: level(15), lightColor: rgb(0xff6a20) })],
  ['flowing_lava', Object.freeze({ emission: level(15), lightColor: rgb(0xff6a20) })],

  // Froglights
  ['ochre_froglight', Object.freeze({ emission: level(15), lightColor: rgb(0xffe08a) })],
  ['pearlescent_froglight', Object.freeze({ emission: level(15), lightColor: rgb(0xf0d0ff) })],
  ['verdant_froglight', Object.freeze({ emission: level(15), lightColor: rgb(0xb0ffb0) })],

  // End / beacon / conduit
  ['end_rod', Object.freeze({ emission: level(14), lightColor: rgb(0xfff0ff) })],
  ['beacon', Object.freeze({ emission: level(15), lightColor: rgb(0xa0ffff) })],
  ['conduit', Object.freeze({ emission: level(15), lightColor: rgb(0x70e0ff) })],

  // Campfires / lanterns — lantern *geometry* is PR34; emission levels here (PR33)
  ['lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['soul_lantern', Object.freeze({ emission: level(10), lightColor: rgb(0x6fe0ff) })],
  // Copper lanterns share Bedrock light level 15 with iron lanterns
  ['copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['exposed_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['weathered_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['oxidized_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['waxed_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['waxed_exposed_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['waxed_weathered_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['waxed_oxidized_copper_lantern', Object.freeze({ emission: level(15), lightColor: rgb(0xffd28a) })],
  ['campfire', Object.freeze({ emission: level(15), lightColor: rgb(0xffa040) })],
  ['soul_campfire', Object.freeze({ emission: level(10), lightColor: rgb(0x6fe0ff) })],

  // Lit machine variants (Bedrock often uses a separate lit_* id)
  ['lit_redstone_lamp', Object.freeze({ emission: level(15), lightColor: rgb(0xfff0c0) })],
  ['lit_furnace', Object.freeze({ emission: level(13), lightColor: rgb(0xff8030) })],
  ['lit_blast_furnace', Object.freeze({ emission: level(13), lightColor: rgb(0xff8030) })],
  ['lit_smoker', Object.freeze({ emission: level(13), lightColor: rgb(0xff8030) })],
]);

/**
 * State-aware candle emission (Bedrock light = 3 × stick count when lit).
 * Unlit / missing lit → emission 0 (known dark, not unknown).
 */
function candleLighting(states: BlockStates | undefined): BlockLighting {
  if (!states || !candleIsLit(states)) {
    return Object.freeze({ emission: 0, lightColor: CANDLE_GLOW });
  }
  const count = candleCountFromStates(states);
  return Object.freeze({
    emission: level(candleLightLevel(count)),
    lightColor: CANDLE_GLOW,
  });
}

/**
 * Return lighting for a palette block name, or null when non-emissive.
 * Emission 0 entries (e.g. unlit redstone torch, unlit candle) still return
 * a record so callers can distinguish “known dark” from “unknown”.
 *
 * Pass `states` for blocks whose emission depends on intrinsic state (candles).
 */
export function blockLightingFor(
  blockName: string,
  states?: BlockStates,
): BlockLighting | null {
  if (isCandleName(blockName)) return candleLighting(states);
  const short = shortId(blockName);
  const hit = EMITTERS.get(short);
  if (!hit) return null;
  return hit;
}

/** True when the block should be routed to the emissive mesh layer. */
export function isEmissiveBlock(blockName: string, states?: BlockStates): boolean {
  const lit = blockLightingFor(blockName, states);
  return lit != null && lit.emission > 0;
}

/** Exported for tests / coverage — do not mutate. */
export function emissiveBlockIds(): readonly string[] {
  return Object.freeze(
    [...EMITTERS.entries()]
      .filter(([, lit]) => lit.emission > 0)
      .map(([id]) => id)
      .sort(),
  );
}

/**
 * Model-family coverage inventory (PR27 + PR30 extensions).
 *
 * Classifies block ids into A–K report buckets. Distinguishes
 * **explicit model implementation** from **safe full-cube fallback** and
 * **known-future / research**.
 *
 * Canonical ownership:
 *
 * ```text
 * coverage.ts → families/* (`is*Name`)
 * ```
 */

import { isInvisible } from '../../../world/blocks.ts';
import { isButtonName } from './families/button.ts';
import { isCactusName } from './families/cactus.ts';
import { isCarpetName } from './families/carpet.ts';
import { isCrossName } from './families/cross.ts';
import { isDoorName } from './families/door.ts';
import { isFenceGateName, isFenceName, shortBlockId } from './families/fence.ts';
import { isLadderName } from './families/ladder.ts';
import { isLanternName } from './families/lantern.ts';
import { isLeverName } from './families/lever.ts';
import { isPaneName } from './families/pane.ts';
import { isPressurePlateName } from './families/pressure-plate.ts';
import { isRailName } from './families/rail.ts';
import { isDoubleSlabName, isSingleSlabName } from './families/slab.ts';
import { isSnowLayerName } from './families/snow-layer.ts';
import { isStairName } from './families/stair.ts';
import { isTorchName } from './families/torch.ts';
import { isTrapdoorName } from './families/trapdoor.ts';
import { isWallName } from './families/wall.ts';

/** Report categories from the Phase 3 audit brief (+ PR30 additions). */
export type ModelFamilyId =
  | 'full_cube' // A
  | 'slab' // B
  | 'stair' // C
  | 'fence' // D
  | 'pane' // E
  | 'door' // F
  | 'trapdoor' // G
  | 'cross' // H
  | 'wall' // I
  | 'carpet' // PR30
  | 'pressure_plate' // PR30
  | 'snow_layer' // PR30
  | 'ladder' // PR30
  | 'torch' // PR30
  | 'cactus' // PR30
  | 'lantern' // PR34
  | 'button' // PR35
  | 'lever' // PR36
  | 'rail' // PR37
  | 'fallback' // J — safe full-cube used as stand-in
  | 'future'; // K — researched as needing custom geo later

export type ImplementationKind =
  | 'explicit'
  | 'safe_full_cube_fallback'
  | 'unknown_research';

export interface ModelCoverageEntry {
  readonly name: string;
  readonly family: ModelFamilyId;
  readonly implementation: ImplementationKind;
  readonly note?: string;
}

/** Blocks known to need custom geometry beyond current families. */
const FUTURE_SHORT_IDS: ReadonlySet<string> = new Set([
  'tall_grass',
  'large_fern',
  'sunflower',
  'lilac',
  'peony',
  'rose_bush',
  'sweet_berry_bush',
  'pink_petals',
  'wildflowers',
  'bamboo',
  'kelp',
  'seagrass',
  'vine',
  'weeping_vines',
  'twisting_vines',
  'cave_vines',
  'cave_vines_body_with_berries',
  'cave_vines_head_with_berries',
  'hanging_roots',
  'pitcher_plant',
  'pitcher_crop',
  'lectern',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'hopper',
  'bell',
  'chain',
  'lightning_rod',
  'end_rod',
  'scaffolding',
  'pointed_dripstone',
  'amethyst_cluster',
  'small_amethyst_bud',
  'medium_amethyst_bud',
  'large_amethyst_bud',
  'coral_fan',
  'brain_coral_fan',
  'bubble_coral_fan',
  'fire_coral_fan',
  'horn_coral_fan',
  'tube_coral_fan',
  // Still research / complex — not PR30
  'bed',
  'chest',
  'trapped_chest',
  'ender_chest',
  'tripwire_hook',
  'cactus_flower',
  // PR38 audit — high-frequency non-cubes still on full-cube mesh
  'campfire',
  'soul_campfire',
  'candle',
  'brewing_stand',
  'enchanting_table',
  'grindstone',
  'composter',
  'barrel',
  'cauldron',
  'flower_pot',
  'decorated_pot',
  'chiseled_bookshelf',
  'daylight_detector',
  'daylight_detector_inverted',
  'redstone_wire',
  'unpowered_repeater',
  'powered_repeater',
  'unpowered_comparator',
  'powered_comparator',
  'piston',
  'sticky_piston',
  'waterlily',
  'lily_pad',
  'cake',
  'conduit',
  'frame',
  'glow_frame',
  'end_portal_frame',
  'bamboo_sapling',
  'turtle_egg',
  'sniffer_egg',
  'frog_spawn',
  'heavy_core',
  'vault',
  'crafter',
  'trial_spawner',
  'spawner',
  'mob_spawner',
]);

function looksLikeCoralWallFan(short: string): boolean {
  return short.includes('coral_wall_fan') || short.endsWith('_wall_fan');
}

function looksLikeSign(short: string): boolean {
  return (
    short.includes('wall_sign') ||
    short.includes('standing_sign') ||
    short.includes('hanging_sign') ||
    short === 'wall_sign' ||
    short === 'standing_sign' ||
    (short.endsWith('_sign') && !short.includes('hanging'))
  );
}

function looksLikeCandle(short: string): boolean {
  return short === 'candle' || short.endsWith('_candle') || short.includes('candle_cake');
}

function looksLikeShulkerOrBedOrBanner(short: string): boolean {
  return (
    short === 'shulker_box' ||
    short.endsWith('_shulker_box') ||
    short === 'bed' ||
    short.endsWith('_bed') ||
    short.includes('banner') ||
    short.includes('skull') ||
    short.endsWith('_head') ||
    short.endsWith('_wall_head') ||
    short.startsWith('potted_')
  );
}

/**
 * Classify one block id for the coverage inventory.
 * Order matches resolver priority for explicit families.
 */
export function classifyBlockModelCoverage(name: string): ModelCoverageEntry | null {
  if (!name || isInvisible(name)) return null;
  const short = shortBlockId(name);

  if (isWallName(name)) {
    return { name, family: 'wall', implementation: 'explicit' };
  }
  if (isFenceName(name)) {
    return { name, family: 'fence', implementation: 'explicit' };
  }
  if (isFenceGateName(name)) {
    return {
      name,
      family: 'fallback',
      implementation: 'safe_full_cube_fallback',
      note: 'fence gates: attach target only; no dedicated gate model yet',
    };
  }
  if (isPaneName(name)) {
    return { name, family: 'pane', implementation: 'explicit' };
  }
  if (isDoorName(name)) {
    return { name, family: 'door', implementation: 'explicit' };
  }
  if (isTrapdoorName(name)) {
    return { name, family: 'trapdoor', implementation: 'explicit' };
  }
  if (isSingleSlabName(name)) {
    return { name, family: 'slab', implementation: 'explicit' };
  }
  if (isDoubleSlabName(name)) {
    return {
      name,
      family: 'full_cube',
      implementation: 'explicit',
      note: 'double slab → intentional full cube',
    };
  }
  if (isStairName(name)) {
    return {
      name,
      family: 'stair',
      implementation: 'explicit',
      note: 'straight + minecraft:corner shapes (PR32); invalid corner → full-cube fallback',
    };
  }
  if (isCrossName(name)) {
    return { name, family: 'cross', implementation: 'explicit' };
  }
  if (isCarpetName(name)) {
    return {
      name,
      family: 'carpet',
      implementation: 'explicit',
      note: short === 'pale_moss_carpet' ? 'floor plate only; side flaps deferred' : undefined,
    };
  }
  if (isPressurePlateName(name)) {
    return { name, family: 'pressure_plate', implementation: 'explicit' };
  }
  if (isSnowLayerName(name)) {
    return { name, family: 'snow_layer', implementation: 'explicit' };
  }
  if (isLadderName(name)) {
    return { name, family: 'ladder', implementation: 'explicit' };
  }
  if (isTorchName(name)) {
    return { name, family: 'torch', implementation: 'explicit' };
  }
  if (isLanternName(name)) {
    return { name, family: 'lantern', implementation: 'explicit' };
  }
  if (isButtonName(name)) {
    return { name, family: 'button', implementation: 'explicit' };
  }
  if (isLeverName(name)) {
    return { name, family: 'lever', implementation: 'explicit' };
  }
  if (isRailName(name)) {
    return {
      name,
      family: 'rail',
      implementation: 'explicit',
      note: short === 'rail'
        ? 'stored rail_direction authoritative; corners 6–9'
        : 'rail_direction 0–5 + rail_data_bit texture; no corners',
    };
  }
  if (isCactusName(name)) {
    return { name, family: 'cactus', implementation: 'explicit' };
  }
  if (
    FUTURE_SHORT_IDS.has(short) ||
    looksLikeCoralWallFan(short) ||
    looksLikeSign(short) ||
    looksLikeCandle(short) ||
    looksLikeShulkerOrBedOrBanner(short) ||
    short.includes('copper_chest') ||
    short.endsWith('_chain') ||
    short.endsWith('_cauldron') ||
    short.endsWith('_lightning_rod') ||
    short.includes('piston_arm') ||
    short.includes('pistonArm') ||
    short.includes('hanging_moss') ||
    short === 'pale_hanging_moss'
  ) {
    return {
      name,
      family: 'future',
      implementation: 'unknown_research',
      note: 'custom geometry / research required',
    };
  }

  return { name, family: 'full_cube', implementation: 'explicit' };
}

export interface CoverageSummary {
  readonly byFamily: Readonly<Record<ModelFamilyId, number>>;
  readonly byImplementation: Readonly<Record<ImplementationKind, number>>;
  readonly total: number;
}

export function summarizeCoverage(entries: readonly ModelCoverageEntry[]): CoverageSummary {
  const byFamily = {
    full_cube: 0,
    slab: 0,
    stair: 0,
    fence: 0,
    pane: 0,
    door: 0,
    trapdoor: 0,
    cross: 0,
    wall: 0,
    carpet: 0,
    pressure_plate: 0,
    snow_layer: 0,
    ladder: 0,
    torch: 0,
    cactus: 0,
    lantern: 0,
    button: 0,
    lever: 0,
    rail: 0,
    fallback: 0,
    future: 0,
  } satisfies Record<ModelFamilyId, number>;
  const byImplementation = {
    explicit: 0,
    safe_full_cube_fallback: 0,
    unknown_research: 0,
  } satisfies Record<ImplementationKind, number>;
  for (const e of entries) {
    byFamily[e.family]++;
    byImplementation[e.implementation]++;
  }
  return { byFamily, byImplementation, total: entries.length };
}

/**
 * Model-family coverage inventory (Phase 3 audit).
 *
 * Classifies block ids into the A–K report buckets. Distinguishes
 * **explicit model implementation** from **safe full-cube fallback** and
 * **known-future / research**.
 *
 * Canonical ownership after PR25/PR26 in beta:
 *
 * ```text
 * coverage.ts → families/cross.ts (`isCrossName`)
 *             → families/wall.ts  (`isWallName`)
 *             → fence / pane / door / …
 * ```
 */

import { isInvisible } from '../../../world/blocks.ts';
import { isCrossName } from './families/cross.ts';
import { isDoorName } from './families/door.ts';
import { isFenceGateName, isFenceName, shortBlockId } from './families/fence.ts';
import { isPaneName } from './families/pane.ts';
import { isDoubleSlabName, isSingleSlabName } from './families/slab.ts';
import { isStairName } from './families/stair.ts';
import { isTrapdoorName } from './families/trapdoor.ts';
import { isWallName } from './families/wall.ts';

/** Report categories from the Phase 3 audit brief. */
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
  'lantern',
  'soul_lantern',
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
]);

function looksLikeCoralWallFan(short: string): boolean {
  return short.includes('coral_wall_fan') || short.endsWith('_wall_fan');
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
    return { name, family: 'stair', implementation: 'explicit' };
  }
  if (isCrossName(name)) {
    return { name, family: 'cross', implementation: 'explicit' };
  }
  if (FUTURE_SHORT_IDS.has(short) || looksLikeCoralWallFan(short) || short.includes('wall_sign')) {
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

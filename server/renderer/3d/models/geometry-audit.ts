/**
 * PR38 — geometry correctness audit on top of family coverage.
 *
 * `coverage.ts` answers "which family owns this id?".
 * This module answers the roadmap question:
 *
 *   Which blocks currently render as full cubes even though Bedrock
 *   geometry is not a full cube?
 *
 * Catalog sources (union):
 *   - data/textures/block-appearance.json
 *   - data/block-colors.json
 *
 * Buckets:
 *   explicit_ok              — dedicated model family already meshes correctly
 *   intentional_full_cube    — true cube / intentional cube (stone, double slab, …)
 *   intentional_fallback     — J: safe full-cube stand-in (e.g. fence gates)
 *   known_incorrect          — K / researched: definitely non-cube, still cube mesh
 *   suspected_incorrect      — strong name/heuristic evidence, not yet researched
 *
 * Priority (for known_incorrect + suspected_incorrect only) drives PR sequencing.
 */

import { readFileSync } from 'node:fs';
import { isInvisible } from '../../../world/blocks.ts';
import { shortBlockId } from './families/fence.ts';
import {
  classifyBlockModelCoverage,
  type ImplementationKind,
  type ModelCoverageEntry,
  type ModelFamilyId,
} from './coverage.ts';

export { shortBlockId };

export type GeometryAuditBucket =
  | 'explicit_ok'
  | 'intentional_full_cube'
  | 'intentional_fallback'
  | 'known_incorrect'
  | 'suspected_incorrect';

/** Suggested implementation order for remaining non-cube work. */
export type GeometryAuditPriority = 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'none';

export type GeometryAuditCategory =
  | 'sign'
  | 'hanging_sign'
  | 'chain'
  | 'candle'
  | 'campfire'
  | 'chest'
  | 'shulker'
  | 'bed'
  | 'anvil'
  | 'bell'
  | 'grindstone'
  | 'brewing_stand'
  | 'enchanting_table'
  | 'lectern'
  | 'hopper'
  | 'cauldron'
  | 'composter'
  | 'barrel'
  | 'chiseled_bookshelf'
  | 'decorated_pot'
  | 'flower_pot'
  | 'banner'
  | 'skull'
  | 'tripwire_hook'
  | 'redstone_wire'
  | 'repeater_comparator'
  | 'daylight_detector'
  | 'piston'
  | 'rail_adjacent'
  | 'vine_hanging'
  | 'double_plant'
  | 'bamboo_plant'
  | 'coral_fan'
  | 'amethyst'
  | 'dripstone'
  | 'rod'
  | 'scaffolding'
  | 'lily_pad'
  | 'cake'
  | 'egg'
  | 'fence_gate'
  | 'other_researched'
  | 'heuristic_other'
  | 'na';

export interface GeometryAuditEntry {
  readonly name: string;
  readonly shortId: string;
  readonly coverageFamily: ModelFamilyId;
  readonly coverageImplementation: ImplementationKind;
  readonly bucket: GeometryAuditBucket;
  readonly category: GeometryAuditCategory;
  readonly priority: GeometryAuditPriority;
  readonly note?: string;
}

interface ResearchRule {
  readonly category: GeometryAuditCategory;
  readonly priority: GeometryAuditPriority;
  readonly match: (short: string) => boolean;
  readonly note?: string;
}

/**
 * Evidence-backed non-cube ids / patterns that still use full-cube mesh.
 * Order matters: first match wins.
 */
const KNOWN_INCORRECT_RULES: readonly ResearchRule[] = [
  {
    category: 'fence_gate',
    priority: 'p1',
    match: (s) => s === 'fence_gate' || s.endsWith('_fence_gate'),
    note: 'attach target only today; dedicated gate model still open',
  },
  {
    category: 'hanging_sign',
    priority: 'p0',
    match: (s) => s.includes('hanging_sign'),
  },
  {
    category: 'sign',
    priority: 'p0',
    match: (s) =>
      s.includes('wall_sign') ||
      s.includes('standing_sign') ||
      s === 'wall_sign' ||
      s === 'standing_sign' ||
      (s.endsWith('_sign') && !s.includes('hanging')),
  },
  {
    category: 'chain',
    priority: 'p0',
    match: (s) => s === 'chain' || s.endsWith('_chain'),
  },
  {
    category: 'candle',
    priority: 'p0',
    match: (s) => s === 'candle' || s.endsWith('_candle') || s.includes('candle_cake'),
  },
  {
    category: 'campfire',
    priority: 'p0',
    match: (s) => s === 'campfire' || s === 'soul_campfire',
  },
  {
    category: 'chest',
    priority: 'p0',
    match: (s) =>
      s === 'chest' ||
      s === 'trapped_chest' ||
      s === 'ender_chest' ||
      s.includes('copper_chest'),
  },
  {
    category: 'shulker',
    priority: 'p2',
    match: (s) => s === 'shulker_box' || s.endsWith('_shulker_box'),
  },
  {
    category: 'bed',
    priority: 'p2',
    match: (s) => s === 'bed' || s.endsWith('_bed'),
  },
  {
    category: 'anvil',
    priority: 'p2',
    match: (s) => s === 'anvil' || s.endsWith('_anvil'),
  },
  {
    category: 'bell',
    priority: 'p2',
    match: (s) => s === 'bell',
  },
  {
    category: 'grindstone',
    priority: 'p2',
    match: (s) => s === 'grindstone',
  },
  {
    category: 'brewing_stand',
    priority: 'p2',
    match: (s) => s === 'brewing_stand',
  },
  {
    category: 'enchanting_table',
    priority: 'p2',
    match: (s) => s === 'enchanting_table',
  },
  {
    category: 'lectern',
    priority: 'p2',
    match: (s) => s === 'lectern',
  },
  {
    category: 'hopper',
    priority: 'p2',
    match: (s) => s === 'hopper',
  },
  {
    category: 'cauldron',
    priority: 'p2',
    match: (s) => s === 'cauldron' || s.endsWith('_cauldron'),
  },
  {
    category: 'composter',
    priority: 'p2',
    match: (s) => s === 'composter',
  },
  {
    category: 'barrel',
    priority: 'p2',
    match: (s) => s === 'barrel',
  },
  {
    category: 'chiseled_bookshelf',
    priority: 'p2',
    match: (s) => s === 'chiseled_bookshelf',
  },
  {
    category: 'decorated_pot',
    priority: 'p2',
    match: (s) => s === 'decorated_pot',
  },
  {
    category: 'flower_pot',
    priority: 'p1',
    match: (s) => s === 'flower_pot' || s.startsWith('potted_'),
  },
  {
    category: 'banner',
    priority: 'p1',
    match: (s) => s.includes('banner'),
  },
  {
    category: 'skull',
    priority: 'p3',
    match: (s) => s.includes('skull') || s.endsWith('_head') || s.endsWith('_wall_head'),
  },
  {
    category: 'tripwire_hook',
    priority: 'p1',
    match: (s) => s === 'tripwire_hook',
  },
  {
    category: 'redstone_wire',
    priority: 'p1',
    match: (s) => s === 'redstone_wire' || s === 'trip_wire' || s === 'tripwire',
  },
  {
    category: 'repeater_comparator',
    priority: 'p1',
    match: (s) => s.includes('repeater') || s.includes('comparator'),
  },
  {
    category: 'daylight_detector',
    priority: 'p1',
    match: (s) => s.startsWith('daylight_detector'),
  },
  {
    category: 'piston',
    priority: 'p1',
    match: (s) =>
      s === 'piston' ||
      s === 'sticky_piston' ||
      s.includes('piston_arm') ||
      s.includes('pistonArm') ||
      s === 'moving_block' ||
      s === 'movingBlock',
  },
  {
    category: 'vine_hanging',
    priority: 'p3',
    match: (s) =>
      s === 'vine' ||
      s.includes('weeping_vines') ||
      s.includes('twisting_vines') ||
      s.includes('cave_vines') ||
      s === 'hanging_roots' ||
      s === 'pale_hanging_moss' ||
      s.includes('hanging_moss'),
  },
  {
    category: 'double_plant',
    priority: 'p3',
    match: (s) =>
      s === 'tall_grass' ||
      s === 'large_fern' ||
      s === 'sunflower' ||
      s === 'lilac' ||
      s === 'peony' ||
      s === 'rose_bush' ||
      s === 'pitcher_plant' ||
      s === 'pitcher_crop' ||
      s === 'sweet_berry_bush' ||
      s === 'pink_petals' ||
      s === 'wildflowers' ||
      s === 'cactus_flower' ||
      s === 'seagrass' ||
      s === 'kelp' ||
      s.includes('kelp'),
  },
  {
    category: 'bamboo_plant',
    priority: 'p3',
    match: (s) => s === 'bamboo' || s === 'bamboo_sapling',
  },
  {
    category: 'coral_fan',
    priority: 'p3',
    match: (s) => s.includes('coral_fan') || s.includes('coral_wall_fan') || s.endsWith('_wall_fan'),
  },
  {
    category: 'amethyst',
    priority: 'p3',
    match: (s) => s.includes('amethyst_bud') || s === 'amethyst_cluster',
  },
  {
    category: 'dripstone',
    priority: 'p3',
    match: (s) => s === 'pointed_dripstone',
  },
  {
    category: 'rod',
    priority: 'p2',
    match: (s) => s === 'end_rod' || s === 'lightning_rod' || s.endsWith('_lightning_rod'),
  },
  {
    category: 'scaffolding',
    priority: 'p2',
    match: (s) => s === 'scaffolding',
  },
  {
    category: 'lily_pad',
    priority: 'p1',
    match: (s) => s === 'waterlily' || s === 'lily_pad',
  },
  {
    category: 'cake',
    priority: 'p3',
    match: (s) => s === 'cake' || s.endsWith('_cake'),
  },
  {
    category: 'egg',
    priority: 'p4',
    match: (s) =>
      s === 'turtle_egg' ||
      s === 'sniffer_egg' ||
      s === 'frog_spawn' ||
      s === 'frogspawn',
  },
  {
    category: 'other_researched',
    priority: 'p4',
    match: (s) =>
      s === 'conduit' ||
      s === 'heavy_core' ||
      s === 'dried_ghast' ||
      s === 'vault' ||
      s === 'crafter' ||
      s === 'trial_spawner' ||
      s.includes('copper_golem') ||
      s === 'spawner' ||
      s === 'mob_spawner' ||
      s === 'frame' ||
      s === 'glow_frame' ||
      s === 'end_portal_frame',
  },
];

/**
 * Name patterns that strongly suggest non-cube geometry when an id slipped
 * past the researched list. Conservative — avoid flagging planks/logs.
 */
const SUSPECT_RULES: readonly ResearchRule[] = [
  {
    category: 'heuristic_other',
    priority: 'p4',
    match: (s) => s.includes('shelf') && !s.includes('bookshelf'),
    note: 'shelf-like id — confirm Bedrock collision/render shape',
  },
  {
    category: 'heuristic_other',
    priority: 'p4',
    match: (s) => s.includes('statue') || s.includes('pottery'),
    note: 'decorative non-cube candidate',
  },
  {
    category: 'heuristic_other',
    priority: 'p4',
    match: (s) => s.endsWith('_bulb') && s.includes('copper'),
    note: 'copper bulb — verify if unit cube or special geo',
  },
];

function matchRule(short: string, rules: readonly ResearchRule[]): ResearchRule | null {
  for (const rule of rules) {
    if (rule.match(short)) return rule;
  }
  return null;
}

/**
 * Classify one block for the geometry audit.
 * Returns null for invisible / non-rendered ids.
 */
export function classifyGeometryAudit(name: string): GeometryAuditEntry | null {
  const coverage = classifyBlockModelCoverage(name);
  if (!coverage) return null;
  const short = shortBlockId(name);

  if (coverage.implementation === 'explicit' && coverage.family !== 'full_cube') {
    return {
      name,
      shortId: short,
      coverageFamily: coverage.family,
      coverageImplementation: coverage.implementation,
      bucket: 'explicit_ok',
      category: 'na',
      priority: 'none',
    };
  }

  if (coverage.family === 'fallback' || coverage.implementation === 'safe_full_cube_fallback') {
    const gate = matchRule(short, KNOWN_INCORRECT_RULES);
    return {
      name,
      shortId: short,
      coverageFamily: coverage.family,
      coverageImplementation: coverage.implementation,
      bucket: 'intentional_fallback',
      category: gate?.category ?? 'fence_gate',
      priority: gate?.priority ?? 'p1',
      note: coverage.note ?? gate?.note,
    };
  }

  // Researched future / unknown_research — known incorrect cubes.
  if (coverage.family === 'future' || coverage.implementation === 'unknown_research') {
    const rule = matchRule(short, KNOWN_INCORRECT_RULES);
    return {
      name,
      shortId: short,
      coverageFamily: coverage.family,
      coverageImplementation: coverage.implementation,
      bucket: 'known_incorrect',
      category: rule?.category ?? 'other_researched',
      priority: rule?.priority ?? 'p4',
      note: coverage.note ?? rule?.note,
    };
  }

  // Explicit full_cube (including double slabs) or unclassified → cube path.
  if (coverage.family === 'full_cube') {
    if (coverage.note?.includes('double slab')) {
      return {
        name,
        shortId: short,
        coverageFamily: coverage.family,
        coverageImplementation: coverage.implementation,
        bucket: 'intentional_full_cube',
        category: 'na',
        priority: 'none',
        note: coverage.note,
      };
    }

    const known = matchRule(short, KNOWN_INCORRECT_RULES);
    if (known) {
      return {
        name,
        shortId: short,
        coverageFamily: coverage.family,
        coverageImplementation: coverage.implementation,
        bucket: 'known_incorrect',
        category: known.category,
        priority: known.priority,
        note: known.note ?? 'renders as full cube; Bedrock geometry is non-cube',
      };
    }

    const suspect = matchRule(short, SUSPECT_RULES);
    if (suspect) {
      return {
        name,
        shortId: short,
        coverageFamily: coverage.family,
        coverageImplementation: coverage.implementation,
        bucket: 'suspected_incorrect',
        category: suspect.category,
        priority: suspect.priority,
        note: suspect.note,
      };
    }

    return {
      name,
      shortId: short,
      coverageFamily: coverage.family,
      coverageImplementation: coverage.implementation,
      bucket: 'intentional_full_cube',
      category: 'na',
      priority: 'none',
      note: coverage.note,
    };
  }

  // Other explicit families already handled; remaining → treat as ok/research.
  return {
    name,
    shortId: short,
    coverageFamily: coverage.family,
    coverageImplementation: coverage.implementation,
    bucket: 'explicit_ok',
    category: 'na',
    priority: 'none',
    note: coverage.note,
  };
}

export interface GeometryAuditSummary {
  readonly total: number;
  readonly byBucket: Readonly<Record<GeometryAuditBucket, number>>;
  readonly byPriority: Readonly<Record<GeometryAuditPriority, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly incorrectTotal: number;
}

export function summarizeGeometryAudit(entries: readonly GeometryAuditEntry[]): GeometryAuditSummary {
  const byBucket: Record<GeometryAuditBucket, number> = {
    explicit_ok: 0,
    intentional_full_cube: 0,
    intentional_fallback: 0,
    known_incorrect: 0,
    suspected_incorrect: 0,
  };
  const byPriority: Record<GeometryAuditPriority, number> = {
    p0: 0,
    p1: 0,
    p2: 0,
    p3: 0,
    p4: 0,
    none: 0,
  };
  const byCategory: Record<string, number> = {};
  for (const e of entries) {
    byBucket[e.bucket]++;
    byPriority[e.priority]++;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  }
  return {
    total: entries.length,
    byBucket,
    byPriority,
    byCategory,
    incorrectTotal: byBucket.known_incorrect + byBucket.suspected_incorrect,
  };
}

/** Union of appearance + block-colors catalog ids. */
export function loadCatalogBlockNames(
  appearancePath = 'data/textures/block-appearance.json',
  colorsPath = 'data/block-colors.json',
): string[] {
  const names = new Set<string>();
  for (const file of [appearancePath, colorsPath]) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      blocks?: Record<string, unknown>;
    } & Record<string, unknown>;
    const blocks = raw.blocks ?? raw;
    for (const key of Object.keys(blocks)) {
      if (!key.startsWith('minecraft:')) continue;
      if (isInvisible(key)) continue;
      names.add(key);
    }
  }
  return [...names].sort();
}

export function auditCatalog(names?: readonly string[]): GeometryAuditEntry[] {
  const list = names ?? loadCatalogBlockNames();
  const out: GeometryAuditEntry[] = [];
  for (const name of list) {
    const e = classifyGeometryAudit(name);
    if (e) out.push(e);
  }
  return out;
}

/** Incorrect + fallback rows sorted by priority then category then name. */
export function roadmapEntries(entries: readonly GeometryAuditEntry[]): GeometryAuditEntry[] {
  const rank: Record<GeometryAuditPriority, number> = {
    p0: 0,
    p1: 1,
    p2: 2,
    p3: 3,
    p4: 4,
    none: 9,
  };
  return entries
    .filter(
      (e) =>
        e.bucket === 'known_incorrect' ||
        e.bucket === 'suspected_incorrect' ||
        e.bucket === 'intentional_fallback',
    )
    .slice()
    .sort((a, b) => {
      const pr = rank[a.priority] - rank[b.priority];
      if (pr !== 0) return pr;
      const c = a.category.localeCompare(b.category);
      if (c !== 0) return c;
      return a.name.localeCompare(b.name);
    });
}

export function groupRoadmapByCategory(
  entries: readonly GeometryAuditEntry[],
): { category: GeometryAuditCategory; priority: GeometryAuditPriority; count: number; samples: string[] }[] {
  const map = new Map<
    string,
    { category: GeometryAuditCategory; priority: GeometryAuditPriority; names: string[] }
  >();
  for (const e of roadmapEntries(entries)) {
    const key = `${e.priority}:${e.category}`;
    let g = map.get(key);
    if (!g) {
      g = { category: e.category, priority: e.priority, names: [] };
      map.set(key, g);
    }
    g.names.push(e.name);
  }
  return [...map.values()]
    .map((g) => ({
      category: g.category,
      priority: g.priority,
      count: g.names.length,
      samples: g.names.slice(0, 8),
    }))
    .sort((a, b) => {
      const rank: Record<GeometryAuditPriority, number> = {
        p0: 0,
        p1: 1,
        p2: 2,
        p3: 3,
        p4: 4,
        none: 9,
      };
      return rank[a.priority] - rank[b.priority] || b.count - a.count;
    });
}

/** Keep coverage types usable from audit callers. */
export type { ModelCoverageEntry, ModelFamilyId, ImplementationKind };

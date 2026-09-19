/**
 * Resolves a Bedrock block name to a map colour.
 *
 * Lookup order:
 *   1. name aliases (Java ↔ Bedrock id differences, renames)
 *   2. generated vanilla `minecraft:map_color` entries (data/block-colors.json)
 *   3. family-name fallbacks (*_leaves, *_log, deepslate*, *brick*, …)
 *   4. deterministic hash, so an unknown future block still paints
 *
 * Tint categories are stored with the colour and multiplied by a plains-like
 * default. Biome-specific map tints can replace those defaults later without
 * changing the database — biome ids live in Data3D and are not decoded yet.
 * Height shading and water-depth darkening are applied by the renderer after
 * this.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWater } from '../world/blocks.ts';
import { biomeTintRgb } from './biome-tints.ts';

export type Rgb = readonly [number, number, number];

export const TINT_METHODS = [
  'none',
  'grass',
  'water',
  'default_foliage',
  'birch_foliage',
  'evergreen_foliage',
  'dry_foliage',
] as const;

export type TintMethod = (typeof TINT_METHODS)[number];

export type ColorSource = 'map-color' | 'family' | 'hash';

export interface BlockColorEntry {
  color: string;
  tint: TintMethod;
}

export interface BlockColorDatabase {
  version: string;
  source: string;
  vanillaCount: number;
  vanillaIdentifiers: string[];
  neutralTints: Record<Exclude<TintMethod, 'none'>, string>;
  blocks: Record<string, BlockColorEntry>;
}

export interface ResolvedBlockColor {
  rgb: Rgb;
  hex: string;
  tint: TintMethod;
  source: ColorSource;
  /** e.g. "map-color + evergreen tint" */
  label: string;
  base: Rgb;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE = path.resolve(here, '../../data/block-colors.json');

const FALLBACK_TINTS: Record<Exclude<TintMethod, 'none'>, Rgb> = {
  grass: [146, 188, 88],
  water: [68, 175, 245],
  default_foliage: [119, 171, 47],
  birch_foliage: [128, 167, 85],
  evergreen_foliage: [97, 153, 97],
  dry_foliage: [163, 117, 70],
};

/** Official MapColor RGB used when a family rule has no database representative. */
const FAMILY_BASE: Record<string, { color: Rgb; tint: TintMethod }> = {
  leaves: { color: [255, 255, 255], tint: 'default_foliage' },
  log: { color: [143, 119, 72], tint: 'none' },
  planks: { color: [143, 119, 72], tint: 'none' },
  concrete: { color: [199, 199, 199], tint: 'none' },
  terracotta: { color: [216, 127, 51], tint: 'none' },
  wool: { color: [199, 199, 199], tint: 'none' },
  sandstone: { color: [247, 233, 163], tint: 'none' },
  ore: { color: [112, 112, 112], tint: 'none' },
  deepslate: { color: [100, 100, 100], tint: 'none' },
  brick: { color: [153, 51, 51], tint: 'none' },
  ice: { color: [160, 160, 255], tint: 'none' },
  gravel: { color: [112, 112, 112], tint: 'none' },
  path: { color: [151, 109, 77], tint: 'none' },
  crop: { color: [0, 124, 0], tint: 'none' },
  copper: { color: [216, 127, 51], tint: 'none' },
  glass: { color: [199, 199, 199], tint: 'none' },
};

/**
 * Bedrock / Java name differences that would otherwise fall to hash.
 * Keys and values are full `minecraft:` ids.
 */
const BLOCK_ALIASES: Record<string, string> = {
  'minecraft:dirt_path': 'minecraft:grass_path',
  'minecraft:bricks': 'minecraft:brick_block',
  'minecraft:nether_bricks': 'minecraft:nether_brick',
  'minecraft:red_nether_bricks': 'minecraft:red_nether_brick',
};

/** Deep-ocean target used when blending water by column depth. */
const DEEP_WATER: Rgb = [30, 78, 140];

let database: BlockColorDatabase | null = null;
const resolved = new Map<string, ResolvedBlockColor>();
const hashFallbacks = new Set<string>();

export function databasePath(): string {
  return process.env.BLOCK_COLORS_PATH ?? DEFAULT_DATABASE;
}

export function loadBlockColorDatabase(file = databasePath()): BlockColorDatabase {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as BlockColorDatabase;
  if (!parsed?.blocks || typeof parsed.blocks !== 'object') {
    throw new Error(`block colour database at ${file} is missing a "blocks" object`);
  }
  database = parsed;
  resolved.clear();
  return parsed;
}

export function getBlockColorDatabase(): BlockColorDatabase {
  return database ?? loadBlockColorDatabase();
}

export function parseHexColor(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`invalid colour "${hex}", expected #RRGGBB`);
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function multiplyRgb(base: Rgb, tint: Rgb): Rgb {
  return [
    Math.round((base[0] * tint[0]) / 255),
    Math.round((base[1] * tint[1]) / 255),
    Math.round((base[2] * tint[2]) / 255),
  ];
}

export function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  return [
    Math.round(from[0] + (to[0] - from[0]) * clamped),
    Math.round(from[1] + (to[1] - from[1]) * clamped),
    Math.round(from[2] + (to[2] - from[2]) * clamped),
  ];
}

/**
 * Darkens water slightly with column depth. Shallow water stays close to the
 * plains-like map tint; deeper columns lean toward a darker blue. No extra
 * world reads — depth comes from the surface scan.
 */
export function deepenWater(rgb: Rgb, depth: number): Rgb {
  if (depth <= 1) return rgb;
  const t = (Math.min(depth, 16) - 1) / 15;
  return lerpRgb(rgb, DEEP_WATER, t * 0.65);
}

/** Final pixel colour for a surface block, including optional water depth and biome tint. */
export function surfaceBlockColor(
  blockName: string,
  waterDepth = 0,
  biomeId: number | null = null,
): Rgb {
  const resolved = resolveBlockColor(blockName);
  let rgb = resolved.rgb;
  if (biomeId != null && resolved.tint !== 'none') {
    const biomeTint = biomeTintRgb(biomeId, resolved.tint);
    if (biomeTint) rgb = multiplyRgb(resolved.base, biomeTint);
  }
  return isWater(blockName) && waterDepth > 1 ? deepenWater(rgb, waterDepth) : rgb;
}

export function isTintMethod(value: string): value is TintMethod {
  return (TINT_METHODS as readonly string[]).includes(value);
}

export function normalizeBlockName(blockName: string): string {
  return blockName.startsWith('minecraft:') ? blockName : `minecraft:${blockName}`;
}

/** Resolves known Bedrock/Java renames before the database lookup. */
export function aliasBlockName(blockName: string): string {
  const id = normalizeBlockName(blockName);
  return BLOCK_ALIASES[id] ?? id;
}

function tintRgb(db: BlockColorDatabase, tint: TintMethod): Rgb | null {
  if (tint === 'none') return null;
  const hex = db.neutralTints?.[tint];
  return hex ? parseHexColor(hex) : FALLBACK_TINTS[tint];
}

function finish(base: Rgb, tint: TintMethod, source: ColorSource, db: BlockColorDatabase): ResolvedBlockColor {
  const tintColor = tintRgb(db, tint);
  const rgb = tintColor ? multiplyRgb(base, tintColor) : base;
  const tintLabel =
    tint === 'none' ? source : source === 'hash' ? 'hash fallback' : `${source} + ${tint.replaceAll('_', ' ')} tint`;
  return {
    rgb,
    hex: rgbToHex(rgb),
    tint,
    source,
    label: tint === 'none' && source === 'hash' ? 'hash fallback' : tintLabel,
    base,
  };
}

/**
 * Family fallbacks. Only used when the generated database has no exact entry.
 * Representatives prefer an official map colour already in the database.
 */
export function familyFallback(blockName: string): { color: Rgb; tint: TintMethod } | null {
  const name = normalizeBlockName(blockName);
  const db = getBlockColorDatabase();
  const pick = (id: string, fallback: { color: Rgb; tint: TintMethod }) => {
    const entry = db.blocks[id];
    if (!entry) return fallback;
    return { color: parseHexColor(entry.color), tint: entry.tint };
  };

  if (name.endsWith('_leaves') || name.endsWith('_leaves_flowered')) {
    return pick('minecraft:oak_leaves', FAMILY_BASE.leaves!);
  }
  if (name.endsWith('_log') || name.endsWith('_wood') || name.startsWith('minecraft:stripped_')) {
    return pick('minecraft:oak_log', FAMILY_BASE.log!);
  }
  if (name.endsWith('_planks')) {
    return pick('minecraft:oak_planks', FAMILY_BASE.planks!);
  }
  if (name.endsWith('_concrete') || name.includes('_concrete_')) {
    return pick('minecraft:white_concrete', FAMILY_BASE.concrete!);
  }
  if (name.endsWith('_terracotta') || name.includes('terracotta')) {
    return pick('minecraft:terracotta', FAMILY_BASE.terracotta!);
  }
  if (name.endsWith('_wool') || name.includes('_wool_')) {
    return pick('minecraft:white_wool', FAMILY_BASE.wool!);
  }
  if (name.includes('sandstone')) {
    return pick('minecraft:sandstone', FAMILY_BASE.sandstone!);
  }
  if (name.endsWith('_path') || name.includes('_path')) {
    return pick('minecraft:grass_path', FAMILY_BASE.path!);
  }
  if (name.includes('deepslate')) {
    return pick('minecraft:deepslate', FAMILY_BASE.deepslate!);
  }
  if (name.includes('ice')) {
    return pick('minecraft:ice', FAMILY_BASE.ice!);
  }
  if (name.endsWith('_gravel') || name.endsWith(':gravel') || name.includes('_gravel')) {
    return pick('minecraft:gravel', FAMILY_BASE.gravel!);
  }
  // Clay bricks (not stone_bricks / deepslate_bricks — those are exact DB hits).
  if (name.includes('brick')) {
    return pick('minecraft:brick_block', FAMILY_BASE.brick!);
  }
  if (name.endsWith('_ore') || name.includes('_ore')) {
    return pick('minecraft:stone', FAMILY_BASE.ore!);
  }
  if (name.includes('copper')) {
    return pick('minecraft:copper_block', FAMILY_BASE.copper!);
  }
  if (name.includes('glass')) {
    return pick('minecraft:glass', FAMILY_BASE.glass!);
  }
  if (
    name.endsWith('_crop') ||
    name.endsWith(':wheat') ||
    name.endsWith(':carrots') ||
    name.endsWith(':potatoes') ||
    name.endsWith(':beetroot') ||
    name.includes('_stem')
  ) {
    return pick('minecraft:wheat', FAMILY_BASE.crop!);
  }
  return null;
}

/**
 * Stable pseudo-random colour for unknown blocks (FNV-1a over the name).
 * Saturation and lightness are fixed so fallback colours stay readable.
 */
export function hashFallbackColor(blockName: string): Rgb {
  let hash = 0x811c9dc5;
  for (let i = 0; i < blockName.length; i++) {
    hash ^= blockName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hslToRgb((hash % 360) / 360, 0.35, 0.5);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h * 6;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function resolveBlockColor(blockName: string): ResolvedBlockColor {
  const cached = resolved.get(blockName);
  if (cached) return cached;

  const db = getBlockColorDatabase();
  const id = aliasBlockName(blockName);
  const exact = db.blocks[id] ?? db.blocks[blockName] ?? db.blocks[normalizeBlockName(blockName)];
  let value: ResolvedBlockColor;
  if (exact) {
    value = finish(parseHexColor(exact.color), exact.tint, 'map-color', db);
  } else {
    const family = familyFallback(id);
    if (family) {
      value = finish(family.color, family.tint, 'family', db);
    } else {
      hashFallbacks.add(id);
      value = finish(hashFallbackColor(id), 'none', 'hash', db);
    }
  }
  resolved.set(blockName, value);
  if (blockName !== id) resolved.set(id, value);
  return value;
}

/** Colour for a block name after optional default tint. Never throws. */
export function blockColor(blockName: string): Rgb {
  return resolveBlockColor(blockName).rgb;
}

/** True when the colour did not come from the hash fallback. */
export function hasKnownColor(blockName: string): boolean {
  return resolveBlockColor(blockName).source !== 'hash';
}

export function describeBlockColor(blockName: string): string {
  return resolveBlockColor(blockName).label;
}

export function hashFallbackNames(): string[] {
  return [...hashFallbacks].sort();
}

export function resetBlockColorCache(): void {
  resolved.clear();
  hashFallbacks.clear();
}

export function summarizeDatabase(db = getBlockColorDatabase()): {
  vanilla: number;
  explicit: number;
  family: number;
  hash: number;
  unresolved: string[];
} {
  let explicit = 0;
  let family = 0;
  let hash = 0;
  const unresolved: string[] = [];
  for (const id of db.vanillaIdentifiers) {
    const resolvedColor = resolveBlockColor(id);
    if (resolvedColor.source === 'map-color') explicit++;
    else if (resolvedColor.source === 'family') family++;
    else {
      hash++;
      unresolved.push(id);
    }
  }
  return {
    vanilla: db.vanillaIdentifiers.length,
    explicit,
    family,
    hash,
    unresolved,
  };
}

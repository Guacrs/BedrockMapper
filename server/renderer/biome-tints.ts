/**
 * Per-biome map tint colours (grass / foliage / water / dry foliage).
 *
 * Sourced from Mojang bedrock-samples client biomes where they set an explicit
 * colour, otherwise sampled from the classic grass/foliage colormaps using the
 * biome's climate. Numeric biome IDs match `mcbe-leveldb`'s int map.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHexColor, type Rgb, type TintMethod } from './block-palette.ts';

export interface BiomeTintEntry {
  id: number | null;
  grass: string;
  foliage: string;
  dry_foliage: string;
  water: string;
  temperature?: number;
  downfall?: number;
}

export interface BiomeTintDatabase {
  version: string;
  source: string;
  defaults: {
    grass: string;
    foliage: string;
    birch_foliage: string;
    evergreen_foliage: string;
    dry_foliage: string;
    water: string;
  };
  biomes: Record<string, BiomeTintEntry>;
  byId: Record<string, string>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE = path.resolve(here, '../../data/biome-tints.json');

let database: BiomeTintDatabase | null = null;
const rgbCache = new Map<string, Rgb>();

export function biomeTintDatabasePath(): string {
  return process.env.BIOME_TINTS_PATH ?? DEFAULT_DATABASE;
}

export function loadBiomeTintDatabase(file = biomeTintDatabasePath()): BiomeTintDatabase {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as BiomeTintDatabase;
  if (!parsed?.biomes || !parsed.byId) {
    throw new Error(`biome tint database at ${file} is missing biomes/byId`);
  }
  database = parsed;
  rgbCache.clear();
  return parsed;
}

export function getBiomeTintDatabase(): BiomeTintDatabase {
  return database ?? loadBiomeTintDatabase();
}

function hexRgb(hex: string): Rgb {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  const rgb = parseHexColor(hex);
  rgbCache.set(hex, rgb);
  return rgb;
}

export function biomeEntry(biomeId: number | null | undefined): BiomeTintEntry | null {
  if (biomeId == null) return null;
  const db = getBiomeTintDatabase();
  const name = db.byId[String(biomeId)];
  if (!name) return null;
  return db.biomes[name] ?? null;
}

export function biomeNameFromId(biomeId: number | null | undefined): string | null {
  if (biomeId == null) return null;
  return getBiomeTintDatabase().byId[String(biomeId)] ?? null;
}

/**
 * Tint RGB for a block's tint_method in a given biome.
 *
 * Birch and evergreen foliage stay on their fixed defaults (vanilla behaviour).
 * Missing biomes fall back to the database defaults (plains-like).
 */
export function biomeTintRgb(biomeId: number | null | undefined, method: TintMethod): Rgb | null {
  if (method === 'none') return null;
  const db = getBiomeTintDatabase();
  const entry = biomeEntry(biomeId);

  switch (method) {
    case 'birch_foliage':
      return hexRgb(db.defaults.birch_foliage);
    case 'evergreen_foliage':
      return hexRgb(db.defaults.evergreen_foliage);
    case 'grass':
      return hexRgb(entry?.grass ?? db.defaults.grass);
    case 'default_foliage':
      return hexRgb(entry?.foliage ?? db.defaults.foliage);
    case 'dry_foliage':
      return hexRgb(entry?.dry_foliage ?? db.defaults.dry_foliage);
    case 'water':
      return hexRgb(entry?.water ?? db.defaults.water);
    default:
      return null;
  }
}

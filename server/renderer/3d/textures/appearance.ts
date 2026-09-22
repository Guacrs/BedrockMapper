/**
 * Normalized per-block texture appearance for full-cube meshing.
 *
 * Built offline from Bedrock resource_pack/blocks.json + terrain_texture.json.
 * Runtime never parses Mojang's raw pack format.
 */

import fs from 'node:fs';
import { BLOCK_APPEARANCE_PATH } from './paths.ts';

/** Texture key relative to the blocks folder, e.g. `blocks/stone`. */
export type TextureKey = string;

export interface BlockAppearance {
  all?: TextureKey;
  up?: TextureKey;
  down?: TextureKey;
  side?: TextureKey;
}

export type FaceSlot = 'up' | 'down' | 'side';

export interface BlockAppearanceDatabase {
  version: string;
  source: string;
  blockCount: number;
  blocks: Record<string, BlockAppearance>;
}

let cached: BlockAppearanceDatabase | null | undefined;

/** Load generated appearance DB, or null when textures have not been built. */
export function loadBlockAppearanceDatabase(): BlockAppearanceDatabase | null {
  if (cached !== undefined) return cached;
  try {
    if (!fs.existsSync(BLOCK_APPEARANCE_PATH)) {
      cached = null;
      return cached;
    }
    cached = JSON.parse(fs.readFileSync(BLOCK_APPEARANCE_PATH, 'utf8')) as BlockAppearanceDatabase;
    return cached;
  } catch {
    cached = null;
    return cached;
  }
}

/** Test helper — clear memoised DB. */
export function resetBlockAppearanceCache(): void {
  cached = undefined;
}

export function appearanceForBlock(blockName: string): BlockAppearance | null {
  const db = loadBlockAppearanceDatabase();
  if (!db) return null;
  return db.blocks[blockName] ?? null;
}

/**
 * Resolve which texture key to use for a cube face slot.
 * Preference: specific face → `all` → null (caller falls back to vertex colour).
 */
export function textureKeyForFace(appearance: BlockAppearance | null, face: FaceSlot): TextureKey | null {
  if (!appearance) return null;
  if (face === 'up') return appearance.up ?? appearance.all ?? null;
  if (face === 'down') return appearance.down ?? appearance.all ?? null;
  return appearance.side ?? appearance.all ?? null;
}

/** Collect every texture key referenced by an appearance (deterministic order). */
export function appearanceTextureKeys(appearance: BlockAppearance): TextureKey[] {
  const keys = new Set<TextureKey>();
  if (appearance.all) keys.add(appearance.all);
  if (appearance.up) keys.add(appearance.up);
  if (appearance.down) keys.add(appearance.down);
  if (appearance.side) keys.add(appearance.side);
  return [...keys].sort();
}

/**
 * Chest family (PR42) — single closed inset AABB + facing.
 *
 * ## Bedrock research
 *
 * - Microsoft vanilla listings: `minecraft:chest`, `trapped_chest`,
 *   `ender_chest`, and all copper chest oxidization/waxed ids expose only
 *   `minecraft:cardinal_direction` ∈ {north,south,east,west}.
 * - Wiki (Bedrock): since 1.20.40 Preview, chests use `minecraft:cardinal_direction`
 *   (latch facing) instead of int `facing_direction`. Java's `type`
 *   left/right/single is **not** on Bedrock palettes — double halves are
 *   neighbour/block-entity pairing, not an intrinsic state. Deferred.
 * - Collision / visual footprint (wiki + entity model closed): inset 1px on
 *   XZ, height 14px → [1,0,1]–[15,14,15]. Inventory textures (`chest_front` /
 *   `_side` / `_top`, copper `*_inventory_*`) are authored for that single box;
 *   no separate latch mesh (latch is painted on the front tile).
 * - Appearance maps south → front. Base model is south-facing; other facings
 *   use `rotateModelY`. Legacy int `facing_direction` 2–5 accepted as fallback
 *   for pre-1.20.40 worlds.
 * - `isFullCube: false` — never cull neighbour unit faces.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

export type ChestFacing = 'north' | 'south' | 'east' | 'west';

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

const EXACT_CHESTS: ReadonlySet<string> = new Set([
  'chest',
  'trapped_chest',
  'ender_chest',
]);

/**
 * True for chest / trapped / ender / copper chest variants.
 * Excludes non-chest ids that merely contain the substring.
 */
export function isChestName(name: string): boolean {
  const short = shortId(name);
  if (EXACT_CHESTS.has(short)) return true;
  // copper_chest, exposed_copper_chest, waxed_oxidized_copper_chest, …
  return short.endsWith('_chest') && short.includes('copper');
}

const CARDINALS = new Set<string>(['north', 'south', 'east', 'west']);

/** Legacy int facing_direction (0=down,1=up,2=N,3=S,4=W,5=E) → horizontal. */
function facingFromFacingDirection(raw: unknown): ChestFacing | null {
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
  else if (typeof raw === 'string' && /^[0-5]$/.test(raw)) n = Number(raw);
  if (n === null) return null;
  switch (n) {
    case 2:
      return 'north';
    case 3:
      return 'south';
    case 4:
      return 'west';
    case 5:
      return 'east';
    default:
      return null;
  }
}

/**
 * Latch / front facing from palette states.
 * Prefers modern `minecraft:cardinal_direction`; falls back to legacy
 * `facing_direction` for pre-1.20.40 worlds.
 */
export function chestFacingFromStates(states: BlockRef['states']): ChestFacing | null {
  const card = states['minecraft:cardinal_direction'];
  if (typeof card === 'string' && CARDINALS.has(card)) return card as ChestFacing;
  return facingFromFacingDirection(states['facing_direction']);
}

/** CCW quarter-turns so the authored south front moves onto `facing`. */
export function quarterTurnsForChestFacing(facing: ChestFacing): number {
  // FACE_CCW order in transform: east, south, west, north — same as full-cube.
  switch (facing) {
    case 'south':
      return 0;
    case 'west':
      return 1;
    case 'north':
      return 2;
    case 'east':
      return 3;
  }
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> =
    {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

/** Closed single-chest body — south front in local space. */
function baseChestModel(blockName: string): BlockModel {
  const box: ModelBox = Object.freeze({
    min: Object.freeze([1 * PX, 0, 1 * PX] as const),
    max: Object.freeze([15 * PX, 14 * PX, 15 * PX] as const),
    faces: allFaces(blockName),
  });
  return Object.freeze({
    key: `chest:south:${blockName}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

export function chestModel(ref: BlockRef, facing: ChestFacing): BlockModel {
  const base = baseChestModel(ref.name);
  const turns = quarterTurnsForChestFacing(facing);
  if (turns === 0) {
    return Object.freeze({
      ...base,
      key: `chest:${facing}:${ref.name}`,
    });
  }
  const oriented = rotateModelY(base, turns);
  return Object.freeze({
    ...oriented,
    key: `chest:${facing}:${ref.name}`,
  });
}

export type TryBuildChest =
  | { ok: true; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildChest(ref: BlockRef): TryBuildChest {
  if (!isChestName(ref.name)) {
    return { ok: false, reason: 'not a chest id' };
  }
  const facing = chestFacingFromStates(ref.states);
  if (!facing) {
    return { ok: false, reason: 'missing minecraft:cardinal_direction / facing_direction' };
  }
  return { ok: true, model: chestModel(ref, facing) };
}

/** Exported for tests — closed single-chest extents (pixels → block space). */
export const CHEST_BODY = Object.freeze({
  min: Object.freeze([1 * PX, 0, 1 * PX] as const),
  max: Object.freeze([15 * PX, 14 * PX, 15 * PX] as const),
});

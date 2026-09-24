/**
 * Wall family (PR26) — center post + N/E/S/W arms from contextual shape.
 *
 * ## Architecture
 *
 * `BlockRef` stays intrinsic. Horizontal attach uses `ConnectionMask` (boolean
 * N/E/S/W). Post presence and arm height (short vs tall) are additional
 * contextual bits computed at mesh time — never written onto BlockRef.
 *
 * Stored Bedrock states `wall_connection_type_*` / `wall_post_bit` are
 * **ignored** for geometry (same rationale as fence `connection_*`: older
 * worlds often store empty/`{}`; client derives from neighbours).
 *
 * ## Bedrock research (not Java-copied blindly)
 *
 * Evidence:
 * 1. Minecraft Wiki Wall — Bedrock states `wall_connection_type_{n,e,s,w}` ∈
 *    {none, short, tall} + `wall_post_bit`. Horizontal attach: walls, solid
 *    full faces, glass panes / iron bars, fence gates, trapdoors (BE 1.16.20).
 *    Walls do **not** connect horizontally to fences (MC-179830 WAI).
 * 2. Microsoft Learn intrinsic states list — same connection/post fields on
 *    cobblestone_wall, blackstone_wall, deepslate_*_wall, etc.
 * 3. Post rule (wiki): center post unless exactly two opposite sides **or**
 *    all four sides are connected — unless an above block forces a post.
 * 4. Tall vs short (wiki): side rises when a block above covers that arm’s
 *    top strip. **Frozen approximation:** a single `tall` flag for all arms
 *    when any non-air block sits above the wall cell. Bedrock’s real model is
 *    per-direction `none|short|tall` on `wall_connection_type_*` — deferred.
 * 5. Geometry (Java template / Bedrock parity, pixel space):
 *      post  [4,0,4]–[12,16,12]   (Y max = 1.0 block = 16px, not 1px)
 *      short arm height 14; tall arm height 16; arm thickness 6 (5–11)
 *
 * Fence connectivity ≠ wall connectivity — dedicated `wallConnectsTo`.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import {
  connectionMaskFromFlags,
  connectionMaskKey,
  type ConnectionMask,
} from '../connection.ts';
import { isFenceGateName, isFenceName, shortBlockId } from './fence.ts';
import { isTrapdoorName } from './trapdoor.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

/** Local pane check — avoid importing pane.ts (circular with isWallName). */
function neighbourIsPane(name: string): boolean {
  const short = shortBlockId(name);
  return short === 'iron_bars' || short.includes('glass_pane');
}

/** Arm height in blocks: short = 14/16, tall = 16/16. */
const ARM_SHORT = 14 * PX;
const ARM_TALL = 1;

/**
 * Plant / cross ids that must never receive wall arms.
 * Mirrors the PR25 cross allowlist for connection refuse — and for coverage
 * inventory (geometry lives on PR25; this branch may still full-cube-fallback).
 */
export const CROSS_PLANT_SHORT_IDS: ReadonlySet<string> = new Set([
  'short_grass',
  'tallgrass',
  'fern',
  'deadbush',
  'oak_sapling',
  'spruce_sapling',
  'birch_sapling',
  'jungle_sapling',
  'acacia_sapling',
  'dark_oak_sapling',
  'cherry_sapling',
  'pale_oak_sapling',
  'bamboo_sapling',
  'sapling',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'torchflower',
  'yellow_flower',
  'red_flower',
  'brown_mushroom',
  'red_mushroom',
  'crimson_fungus',
  'warped_fungus',
  'crimson_roots',
  'warped_roots',
  'nether_sprouts',
]);

const WALL_NONCONNECT_PLANTS = CROSS_PLANT_SHORT_IDS;

/** True when the id is in the PR25 cross/plant allowlist (connection refuse). */
export function isCrossPlantName(name: string): boolean {
  return CROSS_PLANT_SHORT_IDS.has(shortBlockId(name));
}
export interface WallShape {
  readonly mask: ConnectionMask;
  /** Center post (`wall_post_bit` equivalent). */
  readonly post: boolean;
  /** When true, all arms use tall height (approximation of per-side tall). */
  readonly tall: boolean;
}

/** True for stone-style wall blocks — not wall signs / coral fans / banners. */
export function isWallName(name: string): boolean {
  const short = shortBlockId(name);
  if (
    short.includes('wall_sign') ||
    short.endsWith('_wall_banner') ||
    short === 'wall_banner' ||
    short === 'wall_sign' ||
    short.includes('coral_wall_fan') ||
    short.includes('wall_fan')
  ) {
    return false;
  }
  return short.endsWith('_wall');
}

/**
 * Wall attach classifier (≠ fence, ≠ pane, ≠ isSolidAt).
 *
 * ```
 * neighbour
 *   ├── null / air                         → no
 *   ├── wall                               → yes  (all stone wall variants)
 *   ├── fence                              → no   (wiki / MC-179830)
 *   ├── fence gate                         → yes
 *   ├── glass pane / iron bars             → yes  (BE 1.16+)
 *   ├── trapdoor                           → yes  (BE 1.16.20)
 *   ├── plant / cross allowlist            → no
 *   ├── model.isFullCube                   → yes  (stone, glass block, …)
 *   └── anything else                      → no   (slab, stair, door, …)
 * ```
 */
export function wallConnectsTo(
  _selfName: string,
  neighbour: BlockRef | null,
  neighbourIsFullCube: boolean,
): boolean {
  if (!neighbour) return false;
  if (isWallName(neighbour.name)) return true;
  if (isFenceName(neighbour.name)) return false;
  if (isFenceGateName(neighbour.name)) return true;
  if (neighbourIsPane(neighbour.name)) return true;
  if (isTrapdoorName(neighbour.name)) return true;
  if (WALL_NONCONNECT_PLANTS.has(shortBlockId(neighbour.name))) return false;
  return neighbourIsFullCube;
}

/**
 * Derive `wall_post_bit` from the cardinal mask + whether anything is above.
 *
 * Wiki: post unless exactly two opposite connections **or** all four sides —
 * except an above cover forces a post.
 */
export function wallPostFromMask(mask: ConnectionMask, hasAbove: boolean): boolean {
  if (hasAbove) return true;
  const { north, east, south, west } = mask;
  const count =
    (north ? 1 : 0) + (east ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0);
  if (count === 4) return false;
  if (count === 2 && ((north && south && !east && !west) || (east && west && !north && !south))) {
    return false;
  }
  return true;
}

export function wallShapeFromMask(mask: ConnectionMask, hasAbove: boolean): WallShape {
  return Object.freeze({
    mask,
    post: wallPostFromMask(mask, hasAbove),
    tall: hasAbove,
  });
}

export function wallShapeKey(shape: WallShape): string {
  return `${connectionMaskKey(shape.mask)}:p${shape.post ? 1 : 0}:t${shape.tall ? 1 : 0}`;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faces: ModelBox['faces'],
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces,
  });
}

/**
 * Wall model in block space:
 * - Optional post [4,0,4]–[12,16,12]
 * - Arms: 6px wide (5–11), from center line to block edge; height short|tall
 */
export function wallModel(blockName: string, shape: WallShape): BlockModel {
  const faces = allFaces(blockName);
  const boxes: ModelBox[] = [];
  const armH = shape.tall ? ARM_TALL : ARM_SHORT;
  const { mask } = shape;

  if (shape.post) {
    boxes.push(box([4 * PX, 0, 4 * PX], [12 * PX, 1, 12 * PX], faces));
  }

  // Arms meet the post face at 8/16 (center). When post is absent, opposite
  // arms still meet at the midplane so straight runs form a continuous bar.
  if (mask.north) {
    boxes.push(box([5 * PX, 0, 0], [11 * PX, armH, 8 * PX], faces));
  }
  if (mask.south) {
    boxes.push(box([5 * PX, 0, 8 * PX], [11 * PX, armH, 1], faces));
  }
  if (mask.west) {
    boxes.push(box([0, 0, 5 * PX], [8 * PX, armH, 11 * PX], faces));
  }
  if (mask.east) {
    boxes.push(box([8 * PX, 0, 5 * PX], [1, armH, 11 * PX], faces));
  }

  // Isolated wall with post forced false shouldn't happen (postFromMask → true
  // at count 0); still emit a post so the cell is never empty.
  if (boxes.length === 0) {
    boxes.push(box([4 * PX, 0, 4 * PX], [12 * PX, 1, 12 * PX], faces));
  }

  return Object.freeze({
    key: `wall:${wallShapeKey(shape)}:${blockName}`,
    renderBoxes: Object.freeze(boxes),
    occlusionBoxes: Object.freeze(boxes),
    isFullCube: false,
  });
}

export function isolatedWallModel(blockName: string): BlockModel {
  return wallModel(
    blockName,
    wallShapeFromMask(connectionMaskFromFlags(false, false, false, false), false),
  );
}

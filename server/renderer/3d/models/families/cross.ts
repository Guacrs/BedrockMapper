/**
 * Cross / plant family (PR25) — two intersecting vertical planes.
 *
 * ## Bedrock research
 *
 * 1. Microsoft Learn `minecraft:geometry` documents the built-in identifier
 *    `minecraft:geometry.cross` (alongside `full_block`). Vanilla plant blocks
 *    use this engine geometry — it is **not** shipped as a parseable
 *    `.geo.json` cube list in resource-pack samples.
 * 2. Classic Java/Bedrock cross footprint (pixel space, block origin):
 *      plane A: [0.8, 0, 8]–[15.2, 16, 8]   → north/south faces
 *      plane B: [8, 0, 0.8]–[8, 16, 15.2]   → east/west faces
 *    Our AABB mesher needs positive thickness → 1px centred on 8/16.
 * 3. Cross plants are **not** full cubes: they must not cull neighbour unit
 *    faces, and must not participate in fence/pane ConnectionMask attach.
 * 4. No neighbour-derived state — geometry is intrinsic (unlike fences/panes).
 * 5. Double-tall plants (`tall_grass`, `large_fern`, sunflower, …), vines,
 *    berry bushes, bamboo stalks, and flat floor flowers (`pink_petals`) use
 *    different geometry and stay on the full-cube fallback until researched.
 *
 * Membership is an **explicit allowlist** of short block ids — never a
 * heuristic “looks thin” classifier.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/** Pixel inset matching vanilla cross from/to 0.8 … 15.2. */
const INSET = 0.8 * PX;
const PLANE_LO = 7.5 * PX;
const PLANE_HI = 8.5 * PX;

/**
 * Explicit Bedrock ids that render with `minecraft:geometry.cross`.
 * Keep deliberately limited; extend only with researched evidence.
 */
const CROSS_SHORT_IDS: ReadonlySet<string> = new Set([
  // Grass / fern / dead bush (single-cell)
  'short_grass',
  'tallgrass', // legacy Bedrock short-grass id (texture = tallgrass)
  'fern',
  'deadbush',
  // Saplings
  'oak_sapling',
  'spruce_sapling',
  'birch_sapling',
  'jungle_sapling',
  'acacia_sapling',
  'dark_oak_sapling',
  'cherry_sapling',
  'pale_oak_sapling',
  'bamboo_sapling',
  'sapling', // legacy → oak appearance
  // Overworld flowers
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
  'yellow_flower', // legacy dandelion
  'red_flower', // legacy poppy-family alias in appearance DB
  // Mushrooms / nether sprouts & roots / fungi
  'brown_mushroom',
  'red_mushroom',
  'crimson_fungus',
  'warped_fungus',
  'crimson_roots',
  'warped_roots',
  'nether_sprouts',
]);

/** True when this block id uses the crossed-plane plant model. */
export function isCrossName(name: string): boolean {
  return CROSS_SHORT_IDS.has(shortId(name));
}

/** Exported for coverage / audit tests — do not mutate. */
export function crossFamilyShortIds(): readonly string[] {
  return Object.freeze([...CROSS_SHORT_IDS].sort());
}

function planeFaces(
  blockName: string,
  faceIds: readonly FaceId[],
): ModelBox['faces'] {
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> =
    {};
  for (const id of faceIds) {
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
 * Two intersecting vertical planes in block space [0,1]³.
 *
 * - Plane A (X-span at Z≈8/16): north + south faces only
 * - Plane B (Z-span at X≈8/16): east + west faces only
 *
 * `isFullCube` is always false. Occlusion boxes match render boxes so Option A
 * never treats a cross as covering a neighbour unit face.
 */
export function crossModel(blockName: string): BlockModel {
  const ns = planeFaces(blockName, ['north', 'south']);
  const ew = planeFaces(blockName, ['east', 'west']);

  const planeA = box([INSET, 0, PLANE_LO], [1 - INSET, 1, PLANE_HI], ns);
  const planeB = box([PLANE_LO, 0, INSET], [PLANE_HI, 1, 1 - INSET], ew);

  return Object.freeze({
    key: `cross:${blockName}`,
    renderBoxes: Object.freeze([planeA, planeB]),
    occlusionBoxes: Object.freeze([planeA, planeB]),
    isFullCube: false,
  });
}

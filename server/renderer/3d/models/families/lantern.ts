/**
 * Lantern family (PR34) — floor vs hanging AABB body + 45° hangers.
 *
 * ## Bedrock research
 *
 * - Microsoft Learn block-state listings: `hanging` (bool) — “Describes if a
 *   lantern block is hanging or not”. Intrinsic list also documents
 *   `hanging_bit` for the same meaning; LevelDB worlds may carry either.
 * - Minecraft Wiki (Bedrock): `hanging` metadata bit 0x1, default false.
 * - Ids: `lantern`, `soul_lantern`, copper lantern variants
 *   (`copper_lantern`, `exposed_copper_lantern`, … including waxed). Not
 *   `sea_lantern` / `jack_o_lantern` (full cubes).
 * - Geometry: Java-parity `template_lantern` / `template_hanging_lantern`
 *   (Bedrock renders the same footprint). Floor body [5,0,5]–[11,7,11] +
 *   cap [6,7,6]–[10,9,10]; hanging body/cap shifted +1px with longer hangers.
 * - Hangers: two zero-thickness planes at 45° about Y in Java; we use 1px
 *   centred thickness (same AABB convention as `cross.ts` / floor torch) so
 *   the mesher can emit faces, plus `ModelBox.rotation` angle 45°.
 * - No neighbourhood connectivity; `isFullCube: false` so lanterns never
 *   cull neighbour unit faces.
 * - **Emission is not defined here** — PR33 `block-lighting.ts` already
 *   catalogs lantern / soul_lantern light levels. This PR only supplies
 *   correct geometry so that emissive mesh matches the lantern silhouette.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type {
  BlockModel,
  BlockRef,
  FaceId,
  FaceMaterial,
  ModelBox,
  ModelBoxRotation,
} from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/** Explicit non-lantern ids that end with `_lantern`. */
const NOT_LANTERN: ReadonlySet<string> = new Set(['sea_lantern', 'jack_o_lantern']);

export function isLanternName(name: string): boolean {
  const short = shortId(name);
  if (NOT_LANTERN.has(short)) return false;
  return short === 'lantern' || short === 'soul_lantern' || short.endsWith('_lantern');
}

/**
 * True when the lantern hangs from a ceiling support.
 * Accepts modern `hanging` and legacy/intrinsic `hanging_bit`.
 */
export function lanternIsHanging(states: BlockRef['states']): boolean {
  if (states['hanging'] === true || states['hanging'] === 1) return true;
  if (states['hanging_bit'] === true || states['hanging_bit'] === 1) return true;
  return false;
}

const HANGER_ROTATION: ModelBoxRotation = Object.freeze({
  origin: Object.freeze([0.5, 0.5, 0.5] as const),
  axis: 'y',
  angle: 45,
});

/** Java template_lantern UV (pixels / 16). */
const UV = {
  bodySide: Object.freeze([0 / 16, 2 / 16, 6 / 16, 9 / 16] as const),
  bodyCap: Object.freeze([0 / 16, 9 / 16, 6 / 16, 15 / 16] as const),
  topSide: Object.freeze([1 / 16, 0 / 16, 5 / 16, 2 / 16] as const),
  topCap: Object.freeze([1 / 16, 10 / 16, 5 / 16, 14 / 16] as const),
  hangerFloorNs: Object.freeze([11 / 16, 1 / 16, 14 / 16, 3 / 16] as const),
  hangerFloorEw: Object.freeze([11 / 16, 10 / 16, 14 / 16, 12 / 16] as const),
  hangerHangNs: Object.freeze([11 / 16, 1 / 16, 14 / 16, 5 / 16] as const),
  hangerHangEw: Object.freeze([11 / 16, 6 / 16, 14 / 16, 12 / 16] as const),
} as const;

function faces(
  blockName: string,
  faceIds: readonly FaceId[],
  tileUv: FaceMaterial['tileUv'],
): ModelBox['faces'] {
  const out: Partial<Record<FaceId, FaceMaterial>> = {};
  for (const id of faceIds) {
    out[id] = Object.freeze({
      textureKey: fullCubeFaceTexture(blockName, id),
      ...(tileUv ? { tileUv } : {}),
    });
  }
  return Object.freeze(out);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faceMats: ModelBox['faces'],
  rotation?: ModelBoxRotation,
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces: faceMats,
    ...(rotation ? { rotation } : {}),
  });
}

/**
 * Floor lantern: body on the floor, short hangers above the cap.
 * Occlusion uses body+cap only (hangers are decorative thin planes).
 */
function floorLantern(blockName: string): BlockModel {
  const bodySides = faces(blockName, ['north', 'south', 'east', 'west'], UV.bodySide);
  const bodyCaps = faces(blockName, ['up', 'down'], UV.bodyCap);
  const body = box(
    [5 * PX, 0, 5 * PX],
    [11 * PX, 7 * PX, 11 * PX],
    Object.freeze({ ...bodySides, ...bodyCaps }),
  );
  // Cap sides use the top strip; up uses the inset square on the sprite.
  const capSides = faces(blockName, ['north', 'south', 'east', 'west'], UV.topSide);
  const capUp = faces(blockName, ['up'], UV.topCap);
  const cap = box(
    [6 * PX, 7 * PX, 6 * PX],
    [10 * PX, 9 * PX, 10 * PX],
    Object.freeze({ ...capSides, ...capUp }),
  );

  const hangerNs = box(
    [6.5 * PX, 9 * PX, 7.5 * PX],
    [9.5 * PX, 11 * PX, 8.5 * PX],
    faces(blockName, ['north', 'south'], UV.hangerFloorNs),
    HANGER_ROTATION,
  );
  const hangerEw = box(
    [7.5 * PX, 9 * PX, 6.5 * PX],
    [8.5 * PX, 11 * PX, 9.5 * PX],
    faces(blockName, ['east', 'west'], UV.hangerFloorEw),
    HANGER_ROTATION,
  );

  return Object.freeze({
    key: `lantern:floor:${blockName}`,
    renderBoxes: Object.freeze([body, cap, hangerNs, hangerEw]),
    occlusionBoxes: Object.freeze([body, cap]),
    isFullCube: false,
  });
}

/**
 * Hanging lantern: body raised 1px, longer hangers reaching the ceiling.
 */
function hangingLantern(blockName: string): BlockModel {
  const bodySides = faces(blockName, ['north', 'south', 'east', 'west'], UV.bodySide);
  const bodyCaps = faces(blockName, ['up', 'down'], UV.bodyCap);
  const body = box(
    [5 * PX, 1 * PX, 5 * PX],
    [11 * PX, 8 * PX, 11 * PX],
    Object.freeze({ ...bodySides, ...bodyCaps }),
  );

  const capSides = faces(blockName, ['north', 'south', 'east', 'west'], UV.topSide);
  const capCaps = faces(blockName, ['up', 'down'], UV.topCap);
  const cap = box(
    [6 * PX, 8 * PX, 6 * PX],
    [10 * PX, 10 * PX, 10 * PX],
    Object.freeze({ ...capSides, ...capCaps }),
  );

  // Java hanging hangers: NS 11→15, EW 10→16 (asymmetric by design).
  const hangerNs = box(
    [6.5 * PX, 11 * PX, 7.5 * PX],
    [9.5 * PX, 15 * PX, 8.5 * PX],
    faces(blockName, ['north', 'south'], UV.hangerHangNs),
    HANGER_ROTATION,
  );
  const hangerEw = box(
    [7.5 * PX, 10 * PX, 6.5 * PX],
    [8.5 * PX, 16 * PX, 9.5 * PX],
    faces(blockName, ['east', 'west'], UV.hangerHangEw),
    HANGER_ROTATION,
  );

  return Object.freeze({
    key: `lantern:hanging:${blockName}`,
    renderBoxes: Object.freeze([body, cap, hangerNs, hangerEw]),
    occlusionBoxes: Object.freeze([body, cap]),
    isFullCube: false,
  });
}

export function lanternModel(ref: BlockRef): BlockModel {
  return lanternIsHanging(ref.states) ? hangingLantern(ref.name) : floorLantern(ref.name);
}

/** Exported for tests — Java-parity body extents (floor, pixels). */
export const LANTERN_FLOOR_BODY = Object.freeze({
  min: Object.freeze([5 * PX, 0, 5 * PX] as const),
  max: Object.freeze([11 * PX, 7 * PX, 11 * PX] as const),
});
export const LANTERN_HANGING_BODY = Object.freeze({
  min: Object.freeze([5 * PX, 1 * PX, 5 * PX] as const),
  max: Object.freeze([11 * PX, 8 * PX, 11 * PX] as const),
});

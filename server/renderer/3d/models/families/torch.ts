/**
 * Torch family (PR30 / PR33) — floor cross + cantilevered wall torch.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `torch`, `soul_torch`, `redstone_torch`,
 *   `unlit_redstone_torch`, `copper_torch`, colored torches →
 *   `torch_facing_direction` ∈ {unknown, west, east, north, south, top}.
 * - Microsoft: state "**Determines the block that a torch is attached to** in
 *   relation to its position" — so `west` means support is west of the torch
 *   cell → torch sits on the cell's west face (x=0). Flame points opposite.
 * - `top` / `unknown` → upright (standing on floor).
 * - Floor geometry: two thin vertical planes (same footprint idea as
 *   `minecraft:geometry.cross`, height 10/16). Face textures follow the
 *   cross-plant pattern (PR25): only broad plane faces get the torch sprite.
 * - Wall geometry (PR33): canonical west-attached stick matched to the
 *   vanilla wall-torch element (2×10×2 px, −22.5° about Z), then
 *   `rotateModelY` for the four attachment directions. Not an axis-aligned
 *   stub. Bedrock state semantics unchanged; lean uses rotated-cuboid form
 *   (Java 1.8+; Bedrock uses a related cantilevered/skewed wall torch).
 * - **No emissive / light emission here** — that is PR33 lighting catalog.
 * - Lanterns / chains stay in coverage category K (not this family).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import { rotateModelY } from '../transform.ts';
import type {
  BlockModel,
  BlockRef,
  FaceId,
  FaceMaterial,
  ModelBox,
  ModelBoxRotation,
} from '../types.ts';

const PX = 1 / 16;
const INSET = 0.8 * PX;
const PLANE_LO = 7.5 * PX;
const PLANE_HI = 8.5 * PX;
const FLOOR_H = 10 * PX;

/** Vanilla wall-torch stick (pixels → block), west-attached lean. */
const WALL_STICK_MIN = Object.freeze([-1 * PX, 3.5 * PX, 7 * PX] as const);
const WALL_STICK_MAX = Object.freeze([1 * PX, 13.5 * PX, 9 * PX] as const);
const WALL_ROTATION: ModelBoxRotation = Object.freeze({
  origin: Object.freeze([0, 3.5 * PX, 8 * PX] as const),
  axis: 'z',
  angle: -22.5,
});
/** Torch sprite crop on vertical faces (Java template_torch_wall UV /16). */
const WALL_TILE_UV = Object.freeze([7 / 16, 6 / 16, 9 / 16, 16 / 16] as const);

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

const TORCH_SHORT_IDS: ReadonlySet<string> = new Set([
  'torch',
  'soul_torch',
  'redstone_torch',
  'unlit_redstone_torch',
  'copper_torch',
  'colored_torch_blue',
  'colored_torch_green',
  'colored_torch_purple',
  'colored_torch_red',
]);

export function isTorchName(name: string): boolean {
  return TORCH_SHORT_IDS.has(shortId(name));
}

export type TorchFacing = 'top' | 'north' | 'south' | 'west' | 'east';

export function torchFacingFromStates(states: BlockRef['states']): TorchFacing {
  const raw = states['torch_facing_direction'];
  if (raw === 'north' || raw === 'south' || raw === 'west' || raw === 'east' || raw === 'top') {
    return raw;
  }
  // `unknown` and missing → upright floor torch (common default).
  return 'top';
}

/**
 * Texture only the listed faces — same helper pattern as `cross.ts`.
 * Thin AABB edge faces must stay untextured so the torch sprite is not
 * stamped onto 1px strips.
 */
function planeFaces(
  blockName: string,
  faceIds: readonly FaceId[],
  tileUv?: FaceMaterial['tileUv'],
): ModelBox['faces'] {
  const faces: Partial<Record<FaceId, FaceMaterial>> = {};
  for (const id of faceIds) {
    faces[id] = Object.freeze({
      textureKey: fullCubeFaceTexture(blockName, id),
      ...(tileUv ? { tileUv } : {}),
    });
  }
  return Object.freeze(faces);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faces: ModelBox['faces'],
  rotation?: ModelBoxRotation,
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces,
    ...(rotation ? { rotation } : {}),
  });
}

/**
 * Floor torch: two intersecting planes at height 10/16.
 *
 * - Plane A (X-span at Z≈8/16): north + south only
 * - Plane B (Z-span at X≈8/16): east + west only
 */
function floorTorchBoxes(blockName: string): ModelBox[] {
  const ns = planeFaces(blockName, ['north', 'south']);
  const ew = planeFaces(blockName, ['east', 'west']);
  return [
    box([INSET, 0, PLANE_LO], [1 - INSET, FLOOR_H, PLANE_HI], ns),
    box([PLANE_LO, 0, INSET], [PLANE_HI, FLOOR_H, 1 - INSET], ew),
  ];
}

/**
 * Canonical wall torch: attached to **west** face, body leans toward +X
 * (opposite the attachment). Vertical faces only — no up/down caps.
 */
function canonicalWestWallTorch(blockName: string): BlockModel {
  const sides = planeFaces(
    blockName,
    ['north', 'south', 'east', 'west'],
    WALL_TILE_UV,
  );
  const stick = box(WALL_STICK_MIN, WALL_STICK_MAX, sides, WALL_ROTATION);
  return Object.freeze({
    key: `torch:wall:west:${blockName}`,
    renderBoxes: Object.freeze([stick]),
    // Occlusion uses the unrotated AABB (conservative); lean is visual-only.
    occlusionBoxes: Object.freeze([
      box(WALL_STICK_MIN, WALL_STICK_MAX, sides),
    ]),
    isFullCube: false,
  });
}

/**
 * Quarter-turns for `rotateModelY` from canonical west attachment.
 * Matches rotatePointXZ face cycle: west → north → east → south.
 *
 * Bedrock attachment → points opposite → Java wall_torch Y:
 * west→east (y0), north→south (y90), east→west (y180), south→north (y270).
 */
function wallTurnsForAttachment(facing: Exclude<TorchFacing, 'top'>): number {
  switch (facing) {
    case 'west':
      return 0;
    case 'north':
      return 1;
    case 'east':
      return 2;
    case 'south':
      return 3;
  }
}

export function torchModel(ref: BlockRef): BlockModel {
  const facing = torchFacingFromStates(ref.states);
  if (facing === 'top') {
    const boxes = floorTorchBoxes(ref.name);
    return Object.freeze({
      key: `torch:top:${ref.name}`,
      renderBoxes: Object.freeze(boxes),
      occlusionBoxes: Object.freeze(boxes),
      isFullCube: false,
    });
  }
  const canonical = canonicalWestWallTorch(ref.name);
  const turns = wallTurnsForAttachment(facing);
  const oriented = rotateModelY(canonical, turns);
  return Object.freeze({
    ...oriented,
    key: `torch:wall:${facing}:${ref.name}`,
  });
}

/** Exported for tests — canonical lean angle / stick extents. */
export const TORCH_WALL_LEAN_DEG = WALL_ROTATION.angle;
export const TORCH_WALL_STICK_MIN = WALL_STICK_MIN;
export const TORCH_WALL_STICK_MAX = WALL_STICK_MAX;

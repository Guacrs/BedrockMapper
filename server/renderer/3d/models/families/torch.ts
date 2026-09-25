/**
 * Torch family (PR30) — floor cross + wall stubs from `torch_facing_direction`.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `torch`, `soul_torch`, `redstone_torch`,
 *   `unlit_redstone_torch`, `copper_torch`, colored torches →
 *   `torch_facing_direction` ∈ {unknown, west, east, north, south, top}.
 * - Microsoft: state "**Determines the block that a torch is attached to** in
 *   relation to its position" — so `west` means support is west of the torch
 *   cell → stub sits on the cell's west face (x=0). Flame points opposite.
 * - `top` / `unknown` → upright (standing on floor).
 * - Floor geometry: two thin vertical planes (same footprint idea as
 *   `minecraft:geometry.cross`, height 10/16 for the stick). Face textures
 *   follow the cross-plant pattern (PR25): only the broad plane faces get
 *   the torch sprite — never the 1px edge faces (PR33 fix).
 * - Wall geometry: thin stick protruding inward from the attachment face;
 *   only the broad side faces of the stub are textured.
 * - **No emissive / light emission here** — that is PR33.
 * - Lanterns / chains stay in coverage category K (not this family).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;
const INSET = 0.8 * PX;
const PLANE_LO = 7.5 * PX;
const PLANE_HI = 8.5 * PX;
const FLOOR_H = 10 * PX;
const WALL_LEN = 10 * PX;
const WALL_THICK = 2 * PX;

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
 * Wall stub: thin stick on the attachment face. Only the broad side faces
 * receive the torch sprite (same idea as floor planes — no texture on the
 * thin AABB edges / ends / top / bottom).
 *
 * - Attached east/west → thin in Z → north + south
 * - Attached north/south → thin in X → east + west
 */
function wallTorchBox(
  blockName: string,
  facing: Exclude<TorchFacing, 'top'>,
): ModelBox {
  const mid = 0.5 - WALL_THICK / 2;
  const midH = WALL_THICK;
  const ns = planeFaces(blockName, ['north', 'south']);
  const ew = planeFaces(blockName, ['east', 'west']);
  switch (facing) {
    case 'east':
      // Attached toward +X support → stub from east face inward.
      return box([1 - WALL_LEN, mid, mid], [1, mid + midH + 6 * PX, mid + WALL_THICK], ns);
    case 'west':
      return box([0, mid, mid], [WALL_LEN, mid + midH + 6 * PX, mid + WALL_THICK], ns);
    case 'south':
      return box([mid, mid, 1 - WALL_LEN], [mid + WALL_THICK, mid + midH + 6 * PX, 1], ew);
    case 'north':
      return box([mid, mid, 0], [mid + WALL_THICK, mid + midH + 6 * PX, WALL_LEN], ew);
  }
}

export function torchModel(ref: BlockRef): BlockModel {
  const facing = torchFacingFromStates(ref.states);
  const boxes =
    facing === 'top'
      ? floorTorchBoxes(ref.name)
      : [wallTorchBox(ref.name, facing)];
  return Object.freeze({
    key: `torch:${facing}:${ref.name}`,
    renderBoxes: Object.freeze(boxes),
    occlusionBoxes: Object.freeze(boxes),
    isFullCube: false,
  });
}

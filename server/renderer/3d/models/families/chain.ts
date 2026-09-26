/**
 * Chain family (PR43) — crossed 3px planes + pillar_axis orientation.
 *
 * ## Bedrock research
 *
 * - Microsoft vanilla listings: `iron_chain`, `copper_chain`, oxidization /
 *   waxed copper chain variants → only `pillar_axis` ∈ {x, y, z}.
 * - Legacy id `minecraft:chain` still appears in appearance DBs / older worlds
 *   (renamed to iron_chain in 1.21.x). Supported as an alias.
 * - Wiki (Bedrock): `pillar_axis` — y vertical, x east–west, z north–south.
 *   Default y. Orientation is **intrinsic** (placement writes the axis into
 *   LevelDB); no neighbour / ConnectionMask resolver.
 * - Collision: 3px wide shaft centred on the length axis (faces 3/32 from
 *   centre → [6.5,0,6.5]–[9.5,16,9.5] for vertical). Does not align to the
 *   integer pixel grid.
 * - Visual (Java `chain.json` parity, Bedrock same footprint): two zero-
 *   thickness crossed planes spanning 6.5–9.5 with 45° rotation about the
 *   length axis. We use 1px centred thickness (same AABB convention as
 *   `cross.ts` / lantern hangers) so the mesher can emit faces.
 * - Textures: appearance maps up/down → `*chain1`, side → `*chain2`. Broad
 *   plane faces use the side slot. `iron_chain` aliases `minecraft:chain`
 *   textures when the appearance DB lacks a dedicated entry.
 * - Copper / waxed / oxidization variants share this geometry.
 * - `waterlogged` (Java) is not a Bedrock palette geometry concern — deferred.
 * - `isFullCube: false` — never cull neighbour unit faces.
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
/** Half-pixel extents: 6.5/16 … 9.5/16 (3px centred on 8/16). */
const LO = 6.5 * PX;
const HI = 9.5 * PX;
const PLANE_LO = 7.5 * PX;
const PLANE_HI = 8.5 * PX;

export type ChainAxis = 'x' | 'y' | 'z';

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/**
 * True for chain / iron_chain / copper chain oxidization+waxed variants.
 * Excludes `chain_command_block`.
 */
export function isChainName(name: string): boolean {
  const short = shortId(name);
  if (short === 'chain' || short === 'iron_chain') return true;
  if (short === 'chain_command_block') return false;
  return short.endsWith('_chain') && short.includes('copper');
}

/**
 * Length axis from palette. Defaults to `y` when missing/invalid (wiki default).
 */
export function chainAxisFromStates(states: BlockRef['states']): ChainAxis {
  const raw = states['pillar_axis'];
  if (raw === 'x' || raw === 'y' || raw === 'z') return raw;
  return 'y';
}

/** Appearance lookup aliases — iron_chain → legacy chain textures. */
function appearanceName(blockName: string): string {
  const short = shortId(blockName);
  if (short === 'iron_chain') return 'minecraft:chain';
  return blockName.startsWith('minecraft:') ? blockName : `minecraft:${short}`;
}

function faceMat(blockName: string, face: FaceId): FaceMaterial {
  return Object.freeze({
    textureKey: fullCubeFaceTexture(appearanceName(blockName), face),
  });
}

function faces(blockName: string, faceIds: readonly FaceId[]): ModelBox['faces'] {
  const out: Partial<Record<FaceId, FaceMaterial>> = {};
  for (const id of faceIds) out[id] = faceMat(blockName, id);
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

function rot(axis: 'x' | 'y' | 'z'): ModelBoxRotation {
  return Object.freeze({
    origin: Object.freeze([0.5, 0.5, 0.5] as const),
    axis,
    angle: 45,
  });
}

/**
 * Vertical chain (pillar_axis=y): crossed planes + 45° about Y.
 * Occlusion uses the 3px collision shaft (no 45° spin).
 */
function chainAlongY(blockName: string): BlockModel {
  const ns = faces(blockName, ['north', 'south']);
  const ew = faces(blockName, ['east', 'west']);
  const r = rot('y');
  // Plane A: X-span at Z≈8 — north/south faces
  const planeA = box([LO, 0, PLANE_LO], [HI, 1, PLANE_HI], ns, r);
  // Plane B: Z-span at X≈8 — east/west faces
  const planeB = box([PLANE_LO, 0, LO], [PLANE_HI, 1, HI], ew, r);
  const shaft = box([LO, 0, LO], [HI, 1, HI], Object.freeze({}));
  return Object.freeze({
    key: `chain:y:${blockName}`,
    renderBoxes: Object.freeze([planeA, planeB]),
    occlusionBoxes: Object.freeze([shaft]),
    isFullCube: false,
  });
}

/** East–west chain (pillar_axis=x): length along X, 45° about X. */
function chainAlongX(blockName: string): BlockModel {
  const ns = faces(blockName, ['north', 'south']);
  const ud = faces(blockName, ['up', 'down']);
  const r = rot('x');
  // Plane A: Y-span at Z≈8 — north/south
  const planeA = box([0, LO, PLANE_LO], [1, HI, PLANE_HI], ns, r);
  // Plane B: Z-span at Y≈8 — up/down
  const planeB = box([0, PLANE_LO, LO], [1, PLANE_HI, HI], ud, r);
  const shaft = box([0, LO, LO], [1, HI, HI], Object.freeze({}));
  return Object.freeze({
    key: `chain:x:${blockName}`,
    renderBoxes: Object.freeze([planeA, planeB]),
    occlusionBoxes: Object.freeze([shaft]),
    isFullCube: false,
  });
}

/** North–south chain (pillar_axis=z): length along Z, 45° about Z. */
function chainAlongZ(blockName: string): BlockModel {
  const ew = faces(blockName, ['east', 'west']);
  const ud = faces(blockName, ['up', 'down']);
  const r = rot('z');
  // Plane A: X-span at Y≈8 — up/down
  const planeA = box([LO, PLANE_LO, 0], [HI, PLANE_HI, 1], ud, r);
  // Plane B: Y-span at X≈8 — east/west
  const planeB = box([PLANE_LO, LO, 0], [PLANE_HI, HI, 1], ew, r);
  const shaft = box([LO, LO, 0], [HI, HI, 1], Object.freeze({}));
  return Object.freeze({
    key: `chain:z:${blockName}`,
    renderBoxes: Object.freeze([planeA, planeB]),
    occlusionBoxes: Object.freeze([shaft]),
    isFullCube: false,
  });
}

export function chainModel(ref: BlockRef, axis: ChainAxis = chainAxisFromStates(ref.states)): BlockModel {
  switch (axis) {
    case 'x':
      return chainAlongX(ref.name);
    case 'z':
      return chainAlongZ(ref.name);
    case 'y':
    default:
      return chainAlongY(ref.name);
  }
}

export type TryBuildChain =
  | { ok: true; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildChain(ref: BlockRef): TryBuildChain {
  if (!isChainName(ref.name)) {
    return { ok: false, reason: 'not a chain id' };
  }
  return { ok: true, model: chainModel(ref) };
}

/** Exported for tests — vertical collision shaft (block space). */
export const CHAIN_SHAFT_Y = Object.freeze({
  min: Object.freeze([LO, 0, LO] as const),
  max: Object.freeze([HI, 1, HI] as const),
});

/** Exported for tests — vertical plane A extents before 45° spin. */
export const CHAIN_PLANE_A_Y = Object.freeze({
  min: Object.freeze([LO, 0, PLANE_LO] as const),
  max: Object.freeze([HI, 1, PLANE_HI] as const),
});

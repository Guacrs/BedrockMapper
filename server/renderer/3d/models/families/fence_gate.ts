/**
 * Fence gate family (PR45) — intrinsic facing / open / in_wall geometry.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `*_fence_gate` / `fence_gate` → `in_wall_bit`,
 *   `minecraft:cardinal_direction`, `open_bit`.
 * - Since 1.21.60, `minecraft:cardinal_direction` replaced int `direction`
 *   (0=S,1=W,2=N,3=E). Both accepted. Orientation is **intrinsic** — do **not**
 *   reuse fence `ConnectionMask` / neighbour rails.
 * - `open_bit` swings the gate doors; posts stay fixed.
 * - `in_wall_bit` **does** change geometry: entire gate lowered 3px so it sits
 *   flush with walls (wiki / Java `template_fence_gate_wall*`).
 * - Geometry: Java `template_fence_gate` / `_open` / `_wall` / `_wall_open`
 *   parity — 2 hinge posts + 2 inner verticals + 4 horizontal bars.
 * - Wood / bamboo / nether variants share geometry; textures via appearance
 *   (`oak_fence_gate` aliases legacy `fence_gate` → planks_oak).
 *
 * **Not** a fence with a gate-shaped texture — dedicated family + resolver.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { TextureKey } from '../../textures/appearance.ts';
import { appearanceForBlock } from '../../textures/appearance.ts';
import { rotateModelY } from '../transform.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';
import { isFenceGateName, shortBlockId } from './fence.ts';

const PX = 1 / 16;

export type FenceGateFacing = 'north' | 'south' | 'east' | 'west';

export { isFenceGateName };

const CARDINALS = new Set(['north', 'south', 'east', 'west']);

/** Legacy direction 0=S,1=W,2=N,3=E. */
const DIR_TO_FACING: Readonly<Record<number, FenceGateFacing>> = Object.freeze({
  0: 'south',
  1: 'west',
  2: 'north',
  3: 'east',
});

export function fenceGateFacingFromStates(
  states: BlockRef['states'],
): FenceGateFacing | null {
  const card = states['minecraft:cardinal_direction'];
  if (typeof card === 'string' && CARDINALS.has(card)) return card as FenceGateFacing;

  const dir = states['direction'];
  if (typeof dir === 'number' && Number.isInteger(dir) && dir >= 0 && dir <= 3) {
    return DIR_TO_FACING[dir] ?? null;
  }
  if (typeof dir === 'string' && /^[0-3]$/.test(dir)) {
    return DIR_TO_FACING[Number(dir)] ?? null;
  }
  return null;
}

export function fenceGateIsOpen(states: BlockRef['states']): boolean {
  const raw = states['open_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

export function fenceGateInWall(states: BlockRef['states']): boolean {
  const raw = states['in_wall_bit'];
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return false;
}

/**
 * Minecraft blockstate Y is clockwise; our `rotateModelY` is CCW.
 * Java fence_gate: south=y0, west=y90, north=y180, east=y270.
 */
function mcYawToTurns(minecraftYDegrees: 0 | 90 | 180 | 270): number {
  switch (minecraftYDegrees) {
    case 0:
      return 0;
    case 90:
      return 3;
    case 180:
      return 2;
    case 270:
      return 1;
  }
}

export function quarterTurnsForFenceGateFacing(facing: FenceGateFacing): number {
  switch (facing) {
    case 'south':
      return mcYawToTurns(0);
    case 'west':
      return mcYawToTurns(90);
    case 'north':
      return mcYawToTurns(180);
    case 'east':
      return mcYawToTurns(270);
  }
}

/** Appearance aliases — oak modern id → legacy `fence_gate`. */
function appearanceAliases(blockName: string): string[] {
  const short = shortBlockId(blockName);
  const out = [blockName, `minecraft:${short}`];
  if (short === 'oak_fence_gate') out.push('minecraft:fence_gate');
  if (short === 'fence_gate') out.push('minecraft:oak_fence_gate');
  return out;
}

function textureFor(blockName: string, face: FaceId): TextureKey | null {
  for (const id of appearanceAliases(blockName)) {
    const key = fullCubeFaceTexture(id, face);
    if (key) return key;
    // Fall through if appearance exists but face missing (shouldn't happen).
    if (appearanceForBlock(id)) {
      const app = appearanceForBlock(id)!;
      return app.all ?? app.side ?? app.up ?? null;
    }
  }
  return null;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: TextureKey | null }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: textureFor(blockName, id) });
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

type PxBox = readonly [number, number, number, number, number, number]; // x0,y0,z0,x1,y1,z1 in pixels

/**
 * South-facing templates (Java). Closed: barrier along X at z=7–9.
 * Open: posts stay; doors swing toward +Z (south).
 * Wall: same topology with all Y −3.
 */
function templateBoxes(open: boolean, inWall: boolean): readonly PxBox[] {
  const dy = inWall ? -3 : 0;
  const posts: PxBox[] = [
    [0, 5 + dy, 7, 2, 16 + dy, 9], // left post
    [14, 5 + dy, 7, 16, 16 + dy, 9], // right post
  ];
  if (!open) {
    return Object.freeze([
      ...posts,
      [6, 6 + dy, 7, 8, 15 + dy, 9], // left inner vertical
      [8, 6 + dy, 7, 10, 15 + dy, 9], // right inner vertical
      [2, 6 + dy, 7, 6, 9 + dy, 9], // left lower bar
      [2, 12 + dy, 7, 6, 15 + dy, 9], // left upper bar
      [10, 6 + dy, 7, 14, 9 + dy, 9], // right lower bar
      [10, 12 + dy, 7, 14, 15 + dy, 9], // right upper bar
    ]);
  }
  return Object.freeze([
    ...posts,
    [0, 6 + dy, 13, 2, 15 + dy, 15], // left inner (swung)
    [14, 6 + dy, 13, 16, 15 + dy, 15], // right inner (swung)
    [0, 6 + dy, 9, 2, 9 + dy, 13], // left lower bar
    [0, 12 + dy, 9, 2, 15 + dy, 13], // left upper bar
    [14, 6 + dy, 9, 16, 9 + dy, 13], // right lower bar
    [14, 12 + dy, 9, 16, 15 + dy, 13], // right upper bar
  ]);
}

function baseFenceGate(
  blockName: string,
  open: boolean,
  inWall: boolean,
): BlockModel {
  const faces = allFaces(blockName);
  const renderBoxes = Object.freeze(
    templateBoxes(open, inWall).map(([x0, y0, z0, x1, y1, z1]) =>
      box([x0 * PX, y0 * PX, z0 * PX], [x1 * PX, y1 * PX, z1 * PX], faces),
    ),
  );
  // Occlusion: closed → thin E-W slab through posts; open → posts only.
  // Matches collision footprint closely enough for neighbour face culling.
  const dy = inWall ? -3 : 0;
  const occ: ModelBox[] = [
    box([0, (5 + dy) * PX, 7 * PX], [2 * PX, (16 + dy) * PX, 9 * PX], Object.freeze({})),
    box([14 * PX, (5 + dy) * PX, 7 * PX], [1, (16 + dy) * PX, 9 * PX], Object.freeze({})),
  ];
  if (!open) {
    occ.push(
      box([2 * PX, (6 + dy) * PX, 7 * PX], [14 * PX, (15 + dy) * PX, 9 * PX], Object.freeze({})),
    );
  }
  const openTag = open ? 'open' : 'closed';
  const wallTag = inWall ? 'wall' : 'normal';
  return Object.freeze({
    key: `fence_gate:south:${openTag}:${wallTag}:${blockName}`,
    renderBoxes,
    occlusionBoxes: Object.freeze(occ),
    isFullCube: false,
  });
}

export function fenceGateModel(
  ref: BlockRef,
  facing: FenceGateFacing,
  open: boolean = fenceGateIsOpen(ref.states),
  inWall: boolean = fenceGateInWall(ref.states),
): BlockModel {
  const base = baseFenceGate(ref.name, open, inWall);
  const openTag = open ? 'open' : 'closed';
  const wallTag = inWall ? 'wall' : 'normal';
  const key = `fence_gate:${facing}:${openTag}:${wallTag}:${ref.name}`;
  const turns = quarterTurnsForFenceGateFacing(facing);
  if (turns === 0) {
    return Object.freeze({ ...base, key });
  }
  const oriented = rotateModelY(base, turns);
  return Object.freeze({ ...oriented, key });
}

export type TryBuildFenceGate =
  | { ok: true; model: BlockModel }
  | { ok: false; reason: string };

export function tryBuildFenceGate(ref: BlockRef): TryBuildFenceGate {
  if (!isFenceGateName(ref.name)) {
    return { ok: false, reason: 'not a fence gate id' };
  }
  const facing = fenceGateFacingFromStates(ref.states);
  if (!facing) {
    return { ok: false, reason: 'missing minecraft:cardinal_direction / direction' };
  }
  return { ok: true, model: fenceGateModel(ref, facing) };
}

/** Closed normal (non-wall) post top Y in block space — for tests. */
export const FENCE_GATE_POST_TOP = 16 * PX;
/** Wall variant post top (lowered 3px). */
export const FENCE_GATE_WALL_POST_TOP = 13 * PX;
/** Closed normal barrier min Y (lower bars / inner). */
export const FENCE_GATE_CLOSED_MIN_Y = 5 * PX;
/** Wall variant min Y. */
export const FENCE_GATE_WALL_MIN_Y = 2 * PX;

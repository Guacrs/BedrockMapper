/**
 * Trapdoor family (PR24) — flat plate or open vertical flap.
 *
 * Intrinsic BlockRef states only. No ConnectionMask.
 *
 * ## Bedrock states (researched)
 *
 * - `direction` ∈ {0,1,2,3}: 0=south, 1=west, 2=north, 3=east
 *   (Microsoft Intrinsic Block States List)
 * - `open_bit` (bool)
 * - `upside_down_bit` (bool) — closed: top vs bottom plate; open: hinge on
 *   top vs bottom of the vertical flap (we place the flap on the facing
 *   wall either way — geometry matches closed-side thickness on that face)
 *
 * Thickness: 3/16 (same as doors / Java trapdoor models).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 3 / 16;

export type TrapdoorFacing = 'south' | 'west' | 'north' | 'east';

export const TRAPDOOR_DIRECTION_TO_FACING: Readonly<Record<number, TrapdoorFacing>> = Object.freeze({
  0: 'south',
  1: 'west',
  2: 'north',
  3: 'east',
});

export function shortTrapdoorId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isTrapdoorName(name: string): boolean {
  const short = shortTrapdoorId(name);
  return short.endsWith('_trapdoor') || short === 'trapdoor';
}

export function trapdoorFacingFromStates(states: BlockRef['states']): TrapdoorFacing | null {
  const dir = states['direction'];
  if (typeof dir === 'number' && Number.isInteger(dir) && dir >= 0 && dir <= 3) {
    return TRAPDOOR_DIRECTION_TO_FACING[dir] ?? null;
  }
  if (typeof dir === 'string' && /^[0-3]$/.test(dir)) {
    return TRAPDOOR_DIRECTION_TO_FACING[Number(dir)] ?? null;
  }
  // Some packs may already use strings — accept cardinals if present.
  const card = states['minecraft:cardinal_direction'];
  if (card === 'south' || card === 'west' || card === 'north' || card === 'east') {
    return card;
  }
  return null;
}

export function trapdoorIsOpen(states: BlockRef['states']): boolean {
  return states['open_bit'] === true;
}

export function trapdoorIsTop(states: BlockRef['states']): boolean {
  return states['upside_down_bit'] === true;
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
 * Build trapdoor geometry.
 *
 * Closed bottom → floor plate; closed top → ceiling plate.
 * Open → vertical flap flush with the facing side of the block.
 */
export function trapdoorModel(blockName: string, facing: TrapdoorFacing, open: boolean, top: boolean): BlockModel {
  const faces = allFaces(blockName);
  let panel: ModelBox;

  if (!open) {
    panel = top
      ? box([0, 1 - PX, 0], [1, 1, 1], faces)
      : box([0, 0, 0], [1, PX, 1], faces);
  } else {
    switch (facing) {
      case 'south':
        panel = box([0, 0, 1 - PX], [1, 1, 1], faces);
        break;
      case 'north':
        panel = box([0, 0, 0], [1, 1, PX], faces);
        break;
      case 'east':
        panel = box([1 - PX, 0, 0], [1, 1, 1], faces);
        break;
      case 'west':
        panel = box([0, 0, 0], [PX, 1, 1], faces);
        break;
    }
  }

  return Object.freeze({
    key: `trapdoor:${facing}:${open ? 'open' : 'closed'}:${top ? 'top' : 'bottom'}:${blockName}`,
    renderBoxes: Object.freeze([panel]),
    occlusionBoxes: Object.freeze([panel]),
    isFullCube: false,
  });
}

export type TrapdoorResolveResult =
  | {
      ok: true;
      model: BlockModel;
      facing: TrapdoorFacing;
      open: boolean;
      top: boolean;
    }
  | { ok: false; reason: string };

export function tryBuildTrapdoor(ref: BlockRef): TrapdoorResolveResult {
  if (!isTrapdoorName(ref.name)) return { ok: false, reason: 'not a trapdoor id' };

  const facing = trapdoorFacingFromStates(ref.states);
  if (!facing) return { ok: false, reason: 'missing/invalid direction' };

  const open = trapdoorIsOpen(ref.states);
  const top = trapdoorIsTop(ref.states);
  const model = trapdoorModel(ref.name, facing, open, top);
  return { ok: true, model, facing, open, top };
}

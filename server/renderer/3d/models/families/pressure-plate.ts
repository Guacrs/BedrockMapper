/**
 * Pressure-plate family (PR30) — thin floor plate, pressed or unpressed.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: all `*_pressure_plate` (+ wooden/stone/weighted) use
 *   int state `redstone_signal` (0–15). Wooden/stone: 0 = up, ≥1 = pressed.
 *   Weighted plates use the same field as power level — any >0 is pressed.
 * - Geometry (wiki pixel sizes): unpressed height 1/16; pressed ½ px = 1/32.
 *   Plate inset 1px from each edge (14×14 footprint).
 * - `isFullCube` false.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;
const INSET = PX;
const HEIGHT_UP = PX;
const HEIGHT_DOWN = 0.5 * PX;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isPressurePlateName(name: string): boolean {
  const short = shortId(name);
  return short.endsWith('_pressure_plate') || short === 'pressure_plate';
}

/** Pressed when Bedrock `redstone_signal` is a positive number. */
export function pressurePlateIsPressed(states: BlockRef['states']): boolean {
  const raw = states['redstone_signal'];
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string' && raw !== '' && raw !== '0') {
    const n = Number(raw);
    return Number.isFinite(n) ? n > 0 : false;
  }
  return false;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

export function pressurePlateModel(ref: BlockRef): BlockModel {
  const pressed = pressurePlateIsPressed(ref.states);
  const h = pressed ? HEIGHT_DOWN : HEIGHT_UP;
  const box: ModelBox = Object.freeze({
    min: Object.freeze([INSET, 0, INSET] as const),
    max: Object.freeze([1 - INSET, h, 1 - INSET] as const),
    faces: allFaces(ref.name),
  });
  return Object.freeze({
    key: `pressure_plate:${pressed ? 'down' : 'up'}:${ref.name}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

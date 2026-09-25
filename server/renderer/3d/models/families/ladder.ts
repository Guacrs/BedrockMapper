/**
 * Ladder family (PR30) — thin wall panel from `facing_direction`.
 *
 * ## Bedrock research
 *
 * - Microsoft listings: `minecraft:ladder` → `facing_direction` int 0–5
 *   (0=down, 1=up, 2=north, 3=south, 4=west, 5=east). Ladders use 2–5.
 * - Wiki: facing = direction the ladder faces (= opposite the support wall).
 *   North-facing ladder sits against a block to its south → panel at low Z.
 * - Thickness: 3/16 (common Bedrock/Java ladder depth).
 * - Unsupported facing (0/1/missing) → full-cube fallback (visible).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const DEPTH = 3 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isLadderName(name: string): boolean {
  return shortId(name) === 'ladder';
}

export type LadderFacing = 'north' | 'south' | 'west' | 'east';

const FACING_FROM_DIR: Readonly<Record<number, LadderFacing>> = Object.freeze({
  2: 'north',
  3: 'south',
  4: 'west',
  5: 'east',
});

export function ladderFacingFromStates(states: BlockRef['states']): LadderFacing | null {
  const raw = states['facing_direction'];
  let dir: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) dir = raw;
  else if (typeof raw === 'string' && /^[0-5]$/.test(raw)) dir = Number(raw);
  if (dir === null) return null;
  return FACING_FROM_DIR[dir] ?? null;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

function panelForFacing(facing: LadderFacing, faces: ModelBox['faces']): ModelBox {
  switch (facing) {
    case 'north':
      return Object.freeze({
        min: Object.freeze([0, 0, 0] as const),
        max: Object.freeze([1, 1, DEPTH] as const),
        faces,
      });
    case 'south':
      return Object.freeze({
        min: Object.freeze([0, 0, 1 - DEPTH] as const),
        max: Object.freeze([1, 1, 1] as const),
        faces,
      });
    case 'west':
      return Object.freeze({
        min: Object.freeze([0, 0, 0] as const),
        max: Object.freeze([DEPTH, 1, 1] as const),
        faces,
      });
    case 'east':
      return Object.freeze({
        min: Object.freeze([1 - DEPTH, 0, 0] as const),
        max: Object.freeze([1, 1, 1] as const),
        faces,
      });
  }
}

export type LadderResolveResult =
  | { ok: true; model: BlockModel; facing: LadderFacing }
  | { ok: false; reason: string };

export function tryBuildLadder(ref: BlockRef): LadderResolveResult {
  if (!isLadderName(ref.name)) return { ok: false, reason: 'not a ladder' };
  const facing = ladderFacingFromStates(ref.states);
  if (!facing) return { ok: false, reason: 'missing/invalid facing_direction' };
  const box = panelForFacing(facing, allFaces(ref.name));
  return {
    ok: true,
    facing,
    model: Object.freeze({
      key: `ladder:${facing}:${ref.name}`,
      renderBoxes: Object.freeze([box]),
      occlusionBoxes: Object.freeze([box]),
      isFullCube: false,
    }),
  };
}

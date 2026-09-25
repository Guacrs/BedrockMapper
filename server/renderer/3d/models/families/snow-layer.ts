/**
 * Snow-layer family (PR30) — stacked top-snow using Bedrock `height`.
 *
 * ## Bedrock research
 *
 * - Microsoft state list: `height` ∈ 0..7 = layers *in addition to* the bottom
 *   layer → visual layers = height + 1 (1..8). Each layer is 2px tall.
 * - `covered_bit` (plant cover) ignored for geometry in PR30.
 * - Id: `minecraft:snow_layer` (not `minecraft:snow`, which is the full block).
 * - When height=7 → full block height; still `isFullCube: false` so we do not
 *   pretend snow layers are solid cubes for connectivity (conservative).
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

function shortId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

export function isSnowLayerName(name: string): boolean {
  const short = shortId(name);
  return short === 'snow_layer' || short === 'snow_layer_block';
}

/**
 * Bedrock `height` 0..7 → layer count 1..8. Missing/invalid → 1 layer.
 */
export function snowLayerCount(states: BlockRef['states']): number {
  const raw = states['height'];
  let h: number | null = null;
  if (typeof raw === 'number' && Number.isInteger(raw)) h = raw;
  else if (typeof raw === 'string' && /^[0-7]$/.test(raw)) h = Number(raw);
  if (h === null || h < 0 || h > 7) return 1;
  return h + 1;
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

export function snowLayerModel(ref: BlockRef): BlockModel {
  const layers = snowLayerCount(ref.states);
  const y1 = layers * 2 * PX;
  const box: ModelBox = Object.freeze({
    min: Object.freeze([0, 0, 0] as const),
    max: Object.freeze([1, y1, 1] as const),
    faces: allFaces(ref.name),
  });
  return Object.freeze({
    key: `snow_layer:h${layers}:${ref.name}`,
    renderBoxes: Object.freeze([box]),
    occlusionBoxes: Object.freeze([box]),
    isFullCube: false,
  });
}

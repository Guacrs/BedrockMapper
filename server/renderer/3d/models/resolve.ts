/**
 * BlockRef → BlockModel resolver with process-lifetime caches.
 *
 * No filesystem / JSON work here — textures come from the already-loaded PR17
 * appearance DB via family builders.
 */

import { isInvisible } from '../../../world/blocks.ts';
import { fullCubeModel } from './families/full-cube.ts';
import { isDoubleSlabName, isSingleSlabName, slabModel } from './families/slab.ts';
import type { BlockModel, BlockRef } from './types.ts';
import { EMPTY_BLOCK_REF } from './types.ts';

const modelCache = new Map<string, BlockModel>();

function cacheKey(ref: BlockRef): string {
  if (isSingleSlabName(ref.name)) {
    const half = ref.states['minecraft:vertical_half'] === 'top' ? 'top' : 'bottom';
    return `slab:${half}:${ref.name}`;
  }
  return `full_cube:${ref.name}`;
}

/** Resolve an immutable model for a palette entry (cached). */
export function resolveBlockModel(ref: BlockRef): BlockModel | null {
  if (!ref.name || isInvisible(ref.name)) return null;

  const key = cacheKey(ref);
  const hit = modelCache.get(key);
  if (hit) return hit;

  let model: BlockModel;
  if (isSingleSlabName(ref.name)) {
    model = slabModel(ref);
  } else if (isDoubleSlabName(ref.name)) {
    // Distinct vanilla ids render as full cubes (states ignored for geometry).
    model = fullCubeModel(ref.name);
  } else {
    // Unsupported partials (stairs, fences, …) stay full cubes — conservative.
    model = fullCubeModel(ref.name);
  }

  modelCache.set(key, model);
  return model;
}

/** Test helper — drop process caches. */
export function resetBlockModelCache(): void {
  modelCache.clear();
}

export function blockRefKey(ref: BlockRef): string {
  const parts = Object.keys(ref.states)
    .sort()
    .map((k) => `${k}=${String(ref.states[k])}`);
  return parts.length ? `${ref.name}|${parts.join(',')}` : ref.name;
}

export { EMPTY_BLOCK_REF };

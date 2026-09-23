/**
 * BlockRef → BlockModel resolver with process-lifetime caches.
 *
 * No filesystem / JSON work here — textures come from the already-loaded PR17
 * appearance DB via family builders.
 *
 * Contextual families (fences): pass a `ConnectionMask` computed from
 * neighbours. Intrinsic `BlockRef` states alone must never encode N/E/S/W
 * geometry for those families.
 */

import { isInvisible } from '../../../world/blocks.ts';
import { connectionMaskKey, type ConnectionMask } from './connection.ts';
import { fenceModel, isFenceGateName, isFenceName } from './families/fence.ts';
import { fullCubeModel } from './families/full-cube.ts';
import { isDoubleSlabName, isSingleSlabName, slabModel } from './families/slab.ts';
import { isStairName, tryBuildStraightStair } from './families/stair.ts';
import type { BlockModel, BlockRef } from './types.ts';
import { EMPTY_BLOCK_REF } from './types.ts';

const modelCache = new Map<string, BlockModel>();

function cacheKey(ref: BlockRef, connection?: ConnectionMask): string {
  if (isFenceName(ref.name)) {
    // Mask is required for correct geometry; missing → isolated post.
    const maskKey = connection ? connectionMaskKey(connection) : 'n0e0s0w0';
    return `fence:${maskKey}:${ref.name}`;
  }
  if (isSingleSlabName(ref.name)) {
    const half = ref.states['minecraft:vertical_half'] === 'top' ? 'top' : 'bottom';
    return `slab:${half}:${ref.name}`;
  }
  if (isStairName(ref.name)) {
    const corner = ref.states['minecraft:corner'];
    if (corner !== undefined && corner !== 'none') {
      return `full_cube:fallback_corner:${ref.name}`;
    }
    const weirdo = ref.states['weirdo_direction'];
    const up = ref.states['upside_down_bit'] === true ? 'top' : 'bottom';
    return `stair:${String(weirdo)}:${up}:${ref.name}`;
  }
  return `full_cube:${ref.name}`;
}

/**
 * Resolve an immutable model for a palette entry (cached).
 *
 * For fences, pass `connection` from neighbour lookup. Omitting it yields an
 * isolated post (safe fallback; mesher should always supply the mask).
 */
export function resolveBlockModel(
  ref: BlockRef,
  connection?: ConnectionMask,
): BlockModel | null {
  if (!ref.name || isInvisible(ref.name)) return null;

  const key = cacheKey(ref, connection);
  const hit = modelCache.get(key);
  if (hit) return hit;

  let model: BlockModel;
  if (isFenceName(ref.name)) {
    const mask = connection ?? {
      north: false,
      east: false,
      south: false,
      west: false,
    };
    model = fenceModel(ref.name, mask);
  } else if (isSingleSlabName(ref.name)) {
    model = slabModel(ref);
  } else if (isDoubleSlabName(ref.name)) {
    model = fullCubeModel(ref.name);
  } else if (isStairName(ref.name)) {
    const built = tryBuildStraightStair(ref);
    model = built.ok ? built.model : fullCubeModel(ref.name);
  } else {
    // Unsupported partials (panes, doors, …) stay full cubes — conservative.
    model = fullCubeModel(ref.name);
  }

  modelCache.set(key, model);
  return model;
}

/**
 * True when a neighbour cell counts as a solid full cube for fence rails.
 * Fences and gates are never full cubes here (handled by family rules).
 */
export function neighbourIsFullCubeForFence(ref: BlockRef | null): boolean {
  if (!ref) return false;
  if (isFenceName(ref.name) || isFenceGateName(ref.name)) return false;
  const model = resolveBlockModel(ref);
  return model?.isFullCube === true;
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

/**
 * Block-model types for the experimental 3D mesher (PR20).
 *
 * Geometry is axis-aligned boxes in local block space (0..1). Materials point
 * at PR17 atlas texture keys — this module does not own appearance data.
 */

import type { CubeFace } from '../textures/models.ts';
import type { TextureKey } from '../textures/appearance.ts';

/** Palette / NBT state values after bigint → number normalization. */
export type BlockStateValue = string | number | boolean;

/**
 * Immutable identity of one palette entry. Shared by every voxel that indexes
 * that palette slot — do not allocate per voxel.
 */
export interface BlockRef {
  readonly name: string;
  readonly states: Readonly<Record<string, BlockStateValue>>;
}

export type FaceId = CubeFace;

export interface FaceMaterial {
  /** PR17 atlas frame key, or null → vertex colour only. */
  readonly textureKey: TextureKey | null;
}

/**
 * Axis-aligned box in local block coordinates (origin = block min corner).
 * Face materials are keyed by outward normals in local space.
 */
export interface ModelBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly faces: Readonly<Partial<Record<FaceId, FaceMaterial>>>;
}

/** Immutable render + occlusion model (pre-orientation; slabs need none). */
export interface BlockModel {
  /** Stable cache key, e.g. `full_cube:minecraft:stone` or `slab:bottom`. */
  readonly key: string;
  readonly renderBoxes: readonly ModelBox[];
  readonly occlusionBoxes: readonly ModelBox[];
  /** True when occlusionBoxes cover the unit cube — enables O(1) cull. */
  readonly isFullCube: boolean;
}

export const EMPTY_BLOCK_REF: BlockRef = Object.freeze({
  name: 'minecraft:air',
  states: Object.freeze({}),
});

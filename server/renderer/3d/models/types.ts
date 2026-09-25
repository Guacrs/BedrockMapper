/**
 * Block-model types for the experimental 3D mesher (PR20).
 *
 * Geometry is boxes in local block space (0..1), optionally with a single
 * axis rotation applied at mesh emit time (PR33 wall torch). Materials point
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
  /**
   * Optional UV within the atlas tile (0..1). When set, the face stretches
   * this sub-rect instead of using unit-cell world mapping. Used by wall
   * torches to crop the stick/flame from the torch sprite (Java/Bedrock UV).
   */
  readonly tileUv?: readonly [u0: number, v0: number, u1: number, v1: number];
}

/**
 * Optional rotation applied to the AABB at mesh emit time (Minecraft model
 * element rotation). Angles are degrees; axis is local before parent Y turns.
 */
export interface ModelBoxRotation {
  readonly origin: readonly [number, number, number];
  readonly axis: 'x' | 'y' | 'z';
  readonly angle: number;
  /**
   * Minecraft model-element `rescale`: scale the two axes perpendicular to
   * `axis` by √2 about the origin before rotating. Used by ±45° raised rails
   * so the plane spans a full block after rotation.
   */
  readonly rescale?: boolean;
}

/**
 * Box in local block coordinates (origin = block min corner).
 * Face materials are keyed by outward normals in local (pre-rotation) space.
 * When `rotation` is set, vertices/normals are rotated at emit time.
 */
export interface ModelBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly faces: Readonly<Partial<Record<FaceId, FaceMaterial>>>;
  readonly rotation?: ModelBoxRotation;
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

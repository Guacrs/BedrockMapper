/**
 * Dimension metadata.
 *
 * Only the Overworld is implemented for the MVP, but every module takes a
 * `Dimension` so the Nether and the End can be switched on later without
 * touching the key/chunk/render layers.
 */

export type DimensionId = 'overworld' | 'nether' | 'end';

export interface Dimension {
  readonly id: DimensionId;
  /** Value written into the chunk key. Omitted from the key when 0. */
  readonly index: 0 | 1 | 2;
  /** Lowest buildable Y. */
  readonly minY: number;
  /** Highest buildable Y (inclusive). */
  readonly maxY: number;
}

export const OVERWORLD: Dimension = {
  id: 'overworld',
  index: 0,
  // Caves & Cliffs height range, unchanged through the 1.26 series.
  minY: -64,
  maxY: 319,
};

export const NETHER: Dimension = { id: 'nether', index: 1, minY: 0, maxY: 127 };
export const END: Dimension = { id: 'end', index: 2, minY: 0, maxY: 255 };

export const DIMENSIONS: Record<DimensionId, Dimension> = {
  overworld: OVERWORLD,
  nether: NETHER,
  end: END,
};

/** Dimensions the map server currently renders. */
export const SUPPORTED_DIMENSIONS: readonly Dimension[] = [OVERWORLD];

export function dimensionById(id: string): Dimension {
  const dimension = DIMENSIONS[id as DimensionId];
  if (!dimension) throw new Error(`Unknown dimension: ${id}`);
  return dimension;
}

/** Lowest subchunk index (each subchunk is 16 blocks tall). */
export function minSubChunkIndex(dimension: Dimension): number {
  return Math.floor(dimension.minY / 16);
}

/** Highest subchunk index, inclusive. */
export function maxSubChunkIndex(dimension: Dimension): number {
  return Math.floor(dimension.maxY / 16);
}

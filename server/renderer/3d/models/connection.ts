/**
 * Contextual neighbour-connection mask (PR22).
 *
 * Hard architectural rule: neighbour-derived geometry must NOT live on
 * `BlockRef`. `BlockRef` holds intrinsic Bedrock palette identity
 * (block id + authored states). Connection masks are computed at mesh time
 * from `VoxelNeighborhood` and only then combined with a family builder.
 *
 * Pipeline:
 *   BlockRef → ConnectionMask → BlockModel → voxel mesher
 *
 * Panes / walls (later PRs) reuse this type; do not fold N/E/S/W bits into
 * BlockRef cache keys.
 */

/** Cardinal connections in Minecraft block space (Z+ = south). */
export interface ConnectionMask {
  readonly north: boolean;
  readonly east: boolean;
  readonly south: boolean;
  readonly west: boolean;
}

export const EMPTY_CONNECTION_MASK: ConnectionMask = Object.freeze({
  north: false,
  east: false,
  south: false,
  west: false,
});

/** Compact cache / debug key, e.g. `n1e0s1w0`. */
export function connectionMaskKey(mask: ConnectionMask): string {
  return `n${mask.north ? 1 : 0}e${mask.east ? 1 : 0}s${mask.south ? 1 : 0}w${mask.west ? 1 : 0}`;
}

export function connectionMaskFromFlags(
  north: boolean,
  east: boolean,
  south: boolean,
  west: boolean,
): ConnectionMask {
  return Object.freeze({ north, east, south, west });
}

/** Bit count of set connections (0..4). */
export function connectionCount(mask: ConnectionMask): number {
  return (
    (mask.north ? 1 : 0) + (mask.east ? 1 : 0) + (mask.south ? 1 : 0) + (mask.west ? 1 : 0)
  );
}

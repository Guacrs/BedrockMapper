/**
 * Contextual neighbour connectivity for connected-model families (PR22–23).
 *
 * Keeps BlockRef intrinsic. Families supply their own `connectsTo` classifier;
 * this module only gathers N/E/S/W neighbours and builds a ConnectionMask.
 */

import { blockRefAtWorld, type VoxelNeighborhood } from '../chunk-blocks.ts';
import {
  connectionMaskFromFlags,
  type ConnectionMask,
} from './connection.ts';
import { fenceConnectsTo, isFenceName } from './families/fence.ts';
import { isPaneName, paneConnectsTo } from './families/pane.ts';
import { neighbourIsFullCubeForConnection } from './resolve.ts';
import type { BlockRef } from './types.ts';

/** True when geometry depends on a neighbour ConnectionMask. */
export function isContextualConnectedName(name: string): boolean {
  return isFenceName(name) || isPaneName(name);
}

export type ConnectsToFn = (
  selfName: string,
  neighbour: BlockRef | null,
  neighbourIsFullCube: boolean,
) => boolean;

export function connectsToForBlock(selfName: string): ConnectsToFn {
  if (isFenceName(selfName)) return fenceConnectsTo;
  if (isPaneName(selfName)) return paneConnectsTo;
  return () => false;
}

/**
 * Cardinal ConnectionMask at a world cell for a contextual family.
 * Missing neighbour volumes → no connection on that side.
 */
export function connectionMaskAtWorld(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
  selfName: string,
): ConnectionMask {
  const connectsTo = connectsToForBlock(selfName);
  const north = blockRefAtWorld(neighborhood, worldX, worldY, worldZ - 1);
  const east = blockRefAtWorld(neighborhood, worldX + 1, worldY, worldZ);
  const south = blockRefAtWorld(neighborhood, worldX, worldY, worldZ + 1);
  const west = blockRefAtWorld(neighborhood, worldX - 1, worldY, worldZ);

  const full = {
    north: neighbourIsFullCubeForConnection(north),
    east: neighbourIsFullCubeForConnection(east),
    south: neighbourIsFullCubeForConnection(south),
    west: neighbourIsFullCubeForConnection(west),
  };

  return connectionMaskFromFlags(
    connectsTo(selfName, north, full.north),
    connectsTo(selfName, east, full.east),
    connectsTo(selfName, south, full.south),
    connectsTo(selfName, west, full.west),
  );
}

/**
 * BlockRef → BlockModel resolver with process-lifetime caches.
 *
 * No filesystem / JSON work here — textures come from the already-loaded PR17
 * appearance DB via family builders.
 *
 * Contextual families (fences/panes/walls): pass a `ConnectionMask` computed
 * from neighbours. Walls also pass `WallShape` (post + tall). Intrinsic
 * `BlockRef` states alone must never encode N/E/S/W geometry for those families.
 *
 * Cross/plant models are intrinsic (no ConnectionMask) — two thin planes,
 * always `isFullCube: false`.
 */

import { isInvisible } from '../../../world/blocks.ts';
import { connectionMaskKey, type ConnectionMask } from './connection.ts';
import { buttonFacingFromStates, buttonIsPressed, isButtonName, tryBuildButton } from './families/button.ts';
import { cactusModel, isCactusName } from './families/cactus.ts';
import { carpetModel, isCarpetName } from './families/carpet.ts';
import { crossModel, isCrossName } from './families/cross.ts';
import { isDoorName, tryBuildDoor } from './families/door.ts';
import { fenceModel, isFenceGateName, isFenceName } from './families/fence.ts';
import { fullCubeModel, fullCubeModelForRef, fullCubeOrientationKey } from './families/full-cube.ts';
import { isLadderName, tryBuildLadder } from './families/ladder.ts';
import { isLanternName, lanternIsHanging, lanternModel } from './families/lantern.ts';
import { isPaneName, paneModel } from './families/pane.ts';
import { isPressurePlateName, pressurePlateIsPressed, pressurePlateModel } from './families/pressure-plate.ts';
import { isDoubleSlabName, isSingleSlabName, slabModel } from './families/slab.ts';
import { isSnowLayerName, snowLayerModel } from './families/snow-layer.ts';
import { isStairName, tryBuildStraightStair } from './families/stair.ts';
import { isTorchName, torchFacingFromStates, torchModel } from './families/torch.ts';
import { isTrapdoorName, tryBuildTrapdoor } from './families/trapdoor.ts';
import {
  isWallName,
  wallModel,
  wallShapeFromMask,
  wallShapeKey,
  type WallShape,
} from './families/wall.ts';
import type { BlockModel, BlockRef } from './types.ts';
import { EMPTY_BLOCK_REF } from './types.ts';

const modelCache = new Map<string, BlockModel>();

function cacheKey(
  ref: BlockRef,
  connection?: ConnectionMask,
  wallShape?: WallShape,
): string {
  if (isWallName(ref.name)) {
    const shape =
      wallShape ??
      wallShapeFromMask(
        connection ?? { north: false, east: false, south: false, west: false },
        false,
      );
    return `wall:${wallShapeKey(shape)}:${ref.name}`;
  }
  if (isFenceName(ref.name)) {
    const maskKey = connection ? connectionMaskKey(connection) : 'n0e0s0w0';
    return `fence:${maskKey}:${ref.name}`;
  }
  if (isPaneName(ref.name)) {
    const maskKey = connection ? connectionMaskKey(connection) : 'n0e0s0w0';
    return `pane:${maskKey}:${ref.name}`;
  }
  if (isCrossName(ref.name)) {
    return `cross:${ref.name}`;
  }
  if (isCarpetName(ref.name)) {
    return `carpet:${ref.name}`;
  }
  if (isPressurePlateName(ref.name)) {
    return `pressure_plate:${pressurePlateIsPressed(ref.states) ? 'down' : 'up'}:${ref.name}`;
  }
  if (isSnowLayerName(ref.name)) {
    return `snow_layer:${String(ref.states['height'] ?? 0)}:${ref.name}`;
  }
  if (isLadderName(ref.name)) {
    return `ladder:${String(ref.states['facing_direction'] ?? '?')}:${ref.name}`;
  }
  if (isTorchName(ref.name)) {
    return `torch:${torchFacingFromStates(ref.states)}:${ref.name}`;
  }
  if (isLanternName(ref.name)) {
    return `lantern:${lanternIsHanging(ref.states) ? 'hanging' : 'floor'}:${ref.name}`;
  }
  if (isButtonName(ref.name)) {
    const facing = buttonFacingFromStates(ref.states) ?? '?';
    const pressed = buttonIsPressed(ref.states) ? 'down' : 'up';
    return `button:${facing}:${pressed}:${ref.name}`;
  }
  if (isCactusName(ref.name)) {
    return `cactus:${ref.name}`;
  }
  if (isDoorName(ref.name)) {
    const facing = String(ref.states['minecraft:cardinal_direction'] ?? ref.states['direction'] ?? '?');
    const hinge = ref.states['door_hinge_bit'] === true ? 'R' : 'L';
    const open = ref.states['open_bit'] === true ? 'O' : 'C';
    const half = ref.states['upper_block_bit'] === true ? 'U' : 'L';
    return `door:${facing}:${hinge}:${open}:${half}:${ref.name}`;
  }
  if (isTrapdoorName(ref.name)) {
    const dir = String(ref.states['direction'] ?? ref.states['minecraft:cardinal_direction'] ?? '?');
    const open = ref.states['open_bit'] === true ? 'O' : 'C';
    const top = ref.states['upside_down_bit'] === true ? 'T' : 'B';
    return `trapdoor:${dir}:${open}:${top}:${ref.name}`;
  }
  if (isSingleSlabName(ref.name)) {
    const half = ref.states['minecraft:vertical_half'] === 'top' ? 'top' : 'bottom';
    return `slab:${half}:${ref.name}`;
  }
  if (isStairName(ref.name)) {
    const corner = ref.states['minecraft:corner'];
    const cornerKey =
      corner === undefined || corner === 'none' ? 'none' : String(corner);
    const weirdo = ref.states['weirdo_direction'];
    const up = ref.states['upside_down_bit'] === true ? 'top' : 'bottom';
    // Unknown corners still resolve via tryBuildStair → full-cube fallback;
    // cache key must include the raw corner so retries stay distinct.
    if (
      corner !== undefined &&
      corner !== 'none' &&
      corner !== 'inner_left' &&
      corner !== 'inner_right' &&
      corner !== 'outer_left' &&
      corner !== 'outer_right'
    ) {
      return `full_cube:fallback_corner:${cornerKey}:${ref.name}`;
    }
    return `stair:${String(weirdo)}:${up}:${cornerKey}:${ref.name}`;
  }
  return `full_cube:${fullCubeOrientationKey(ref.states)}:${ref.name}`;
}

/**
 * Resolve an immutable model for a palette entry (cached).
 *
 * For fences/panes/walls, pass `connection` from neighbour lookup. Walls should
 * also pass `wallShape` (post + tall); omitting it yields an isolated short post.
 */
export function resolveBlockModel(
  ref: BlockRef,
  connection?: ConnectionMask,
  wallShape?: WallShape,
): BlockModel | null {
  if (!ref.name || isInvisible(ref.name)) return null;

  const key = cacheKey(ref, connection, wallShape);
  const hit = modelCache.get(key);
  if (hit) return hit;

  let model: BlockModel;
  if (isWallName(ref.name)) {
    const shape =
      wallShape ??
      wallShapeFromMask(
        connection ?? { north: false, east: false, south: false, west: false },
        false,
      );
    model = wallModel(ref.name, shape);
  } else if (isFenceName(ref.name)) {
    const mask = connection ?? {
      north: false,
      east: false,
      south: false,
      west: false,
    };
    model = fenceModel(ref.name, mask);
  } else if (isPaneName(ref.name)) {
    const mask = connection ?? {
      north: false,
      east: false,
      south: false,
      west: false,
    };
    model = paneModel(ref.name, mask);
  } else if (isCrossName(ref.name)) {
    model = crossModel(ref.name);
  } else if (isCarpetName(ref.name)) {
    model = carpetModel(ref.name);
  } else if (isPressurePlateName(ref.name)) {
    model = pressurePlateModel(ref);
  } else if (isSnowLayerName(ref.name)) {
    model = snowLayerModel(ref);
  } else if (isLadderName(ref.name)) {
    const built = tryBuildLadder(ref);
    model = built.ok ? built.model : fullCubeModel(ref.name);
  } else if (isTorchName(ref.name)) {
    model = torchModel(ref);
  } else if (isLanternName(ref.name)) {
    model = lanternModel(ref);
  } else if (isButtonName(ref.name)) {
    const built = tryBuildButton(ref);
    model = built.ok ? built.model : fullCubeModel(ref.name);
  } else if (isCactusName(ref.name)) {
    model = cactusModel(ref.name);
  } else if (isDoorName(ref.name)) {
    const built = tryBuildDoor(ref);
    model = built.ok ? built.model : fullCubeModelForRef(ref);
  } else if (isTrapdoorName(ref.name)) {
    const built = tryBuildTrapdoor(ref);
    model = built.ok ? built.model : fullCubeModelForRef(ref);
  } else if (isSingleSlabName(ref.name)) {
    model = slabModel(ref);
  } else if (isDoubleSlabName(ref.name)) {
    model = fullCubeModelForRef(ref);
  } else if (isStairName(ref.name)) {
    const built = tryBuildStraightStair(ref);
    model = built.ok ? built.model : fullCubeModelForRef(ref);
  } else {
    // Unsupported partials stay full cubes — conservative.
    // PR31: oriented cubes use facing / pillar_axis for material remap.
    model = fullCubeModelForRef(ref);
  }

  modelCache.set(key, model);
  return model;
}

/**
 * True when a neighbour cell counts as a solid full cube for connected-model
 * attach (fences / panes / walls). Thin / hinged / connected families never
 * count as solid attach via this helper — family classifiers handle peers.
 */
export function neighbourIsFullCubeForConnection(ref: BlockRef | null): boolean {
  if (!ref) return false;
  if (
    isFenceName(ref.name) ||
    isFenceGateName(ref.name) ||
    isPaneName(ref.name) ||
    isWallName(ref.name) ||
    isCrossName(ref.name) ||
    isDoorName(ref.name) ||
    isTrapdoorName(ref.name) ||
    isCarpetName(ref.name) ||
    isPressurePlateName(ref.name) ||
    isSnowLayerName(ref.name) ||
    isLadderName(ref.name) ||
    isTorchName(ref.name) ||
    isLanternName(ref.name) ||
    isButtonName(ref.name) ||
    isCactusName(ref.name)
  ) {
    return false;
  }
  const model = resolveBlockModel(ref);
  return model?.isFullCube === true;
}

/** @deprecated Use neighbourIsFullCubeForConnection */
export const neighbourIsFullCubeForFence = neighbourIsFullCubeForConnection;

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

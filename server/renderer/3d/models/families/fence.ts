/**
 * Fence family (PR22) — post + N/E/S/W rails from a contextual ConnectionMask.
 *
 * ## Architecture (hard requirement)
 *
 * `BlockRef` = fence block id (+ any intrinsic states; connection_* in NBT is
 * ignored for geometry). Neighbour-derived rails live only in `ConnectionMask`,
 * computed at mesh time via `VoxelNeighborhood`.
 *
 * ## Bedrock connection research (do not copy Java blindly)
 *
 * Evidence:
 * 1. Minecraft Wiki Fence — Bedrock block states `minecraft:connection_{n,e,s,w}`
 *    exist on recent/preview builds but were added/removed/re-added across
 *    26.40 / 26.50 previews. Older worlds often store `{}` with no connection
 *    bits, so meshing MUST infer from neighbours (same as client connection
 *    trait behaviour).
 * 2. Microsoft Learn `minecraft:connection` trait — states update when this
 *    block or neighbours change; they encode cardinal adjacency, not intrinsic
 *    placement facing.
 * 3. Wiki usage (Bedrock + Java parity for vanilla fences):
 *    - Connect to adjacent **solid** (full-cube) blocks
 *    - Wooden fences connect to other **wooden** fences (all `*_fence` except
 *      `nether_brick_fence`)
 *    - Nether brick fences connect to other nether brick fences, **not** to
 *      wooden fences
 *    - Both connect to **fence gates** (nether brick fences connect to wooden
 *      gates; wooden fences do not need a matching wood type)
 * 4. Bedrock Wiki custom fences — render geometry uses post
 *    `[-2,0,-2]+[4,16,4]` and per-direction rail pairs at Y 6–9 and 12–15
 *    (pixel space, origin at block centre XZ). Matches Java 6–10 post and
 *    7–9 rail thickness in 1/16ths.
 * 5. Repo `behavior_pack/shapes` fence collision is **post only** — rails are
 *    render-only / separate collision permutations; we mesh post+rails.
 *
 * Stored `minecraft:connection_*` on the palette entry are intentionally
 * ignored so the model stays neighbour-driven and cacheable by mask.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import {
  connectionMaskFromFlags,
  connectionMaskKey,
  type ConnectionMask,
} from '../connection.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

/** Local wall check — avoid importing wall.ts (circular with fenceConnectsTo). */
function neighbourIsWall(name: string): boolean {
  const short = shortBlockId(name);
  if (
    short.includes('wall_sign') ||
    short.endsWith('_wall_banner') ||
    short === 'wall_banner' ||
    short === 'wall_sign' ||
    short.includes('coral_wall_fan') ||
    short.includes('wall_fan')
  ) {
    return false;
  }
  return short.endsWith('_wall');
}

export type FenceFamily = 'wooden' | 'nether_brick';

export function shortBlockId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

/** True for fence posts (`oak_fence`, `nether_brick_fence`, …) — not gates. */
export function isFenceName(name: string): boolean {
  const short = shortBlockId(name);
  if (short.endsWith('_fence_gate') || short === 'fence_gate') return false;
  return short.endsWith('_fence') || short === 'fence';
}

/** True for fence gates (openable). */
export function isFenceGateName(name: string): boolean {
  const short = shortBlockId(name);
  return short.endsWith('_fence_gate') || short === 'fence_gate';
}

export function fenceFamily(name: string): FenceFamily | null {
  if (!isFenceName(name)) return null;
  return shortBlockId(name) === 'nether_brick_fence' ? 'nether_brick' : 'wooden';
}

/**
 * Whether `self` fence should form a rail toward `neighbour`.
 *
 * Decision tree (connectivity ≠ occlusion):
 *
 * ```
 * neighbour
 *   ├── null / air              → no
 *   ├── compatible fence family → yes   (wooden↔wooden, nether↔nether)
 *   ├── incompatible fence      → no    (wooden↛nether), even if "solid"
 *   ├── fence gate              → yes   (both families; wood type ignored)
 *   ├── model.isFullCube        → yes   (stone, dirt, … — Bedrock solid attach)
 *   └── anything else           → no    (slab, stair, pane, …)
 * ```
 *
 * Deliberately does **not** call `isSolidAt` / `isRenderableCube`. Those answer
 * "is there something to draw / cull against", not "should a fence rail attach".
 * A full cube may occlude a rail end face while connectivity still uses this
 * explicit classifier; a slab is renderable but never a fence attach target.
 *
 * `neighbourIsFullCube` must come from the neighbour's **intrinsic** model
 * (`isFullCube`), never from a contextual fence/pane mask.
 */
export function fenceConnectsTo(
  selfName: string,
  neighbour: BlockRef | null,
  neighbourIsFullCube: boolean,
): boolean {
  if (!neighbour) return false;
  if (isFenceName(neighbour.name)) {
    const selfFam = fenceFamily(selfName);
    const otherFam = fenceFamily(neighbour.name);
    return selfFam != null && otherFam != null && selfFam === otherFam;
  }
  if (isFenceGateName(neighbour.name)) return true;
  // Fences attach to walls (Bedrock/Java parity) even though walls are not full cubes.
  if (neighbourIsWall(neighbour.name)) return true;
  // Only after fence/gate checks — never treat fences as full-cube attach targets.
  return neighbourIsFullCube;
}

/**
 * Build N/E/S/W mask from four neighbour refs + full-cube flags.
 * Order matches Minecraft cardinals used by the mesher.
 */
export function connectionMaskFromNeighbours(
  selfName: string,
  neighbours: {
    north: BlockRef | null;
    east: BlockRef | null;
    south: BlockRef | null;
    west: BlockRef | null;
  },
  fullCube: {
    north: boolean;
    east: boolean;
    south: boolean;
    west: boolean;
  },
): ConnectionMask {
  return connectionMaskFromFlags(
    fenceConnectsTo(selfName, neighbours.north, fullCube.north),
    fenceConnectsTo(selfName, neighbours.east, fullCube.east),
    fenceConnectsTo(selfName, neighbours.south, fullCube.south),
    fenceConnectsTo(selfName, neighbours.west, fullCube.west),
  );
}

function allFaces(blockName: string): ModelBox['faces'] {
  const ids: FaceId[] = ['up', 'down', 'north', 'south', 'east', 'west'];
  const faces: Partial<Record<FaceId, { textureKey: ReturnType<typeof fullCubeFaceTexture> }>> = {};
  for (const id of ids) {
    faces[id] = Object.freeze({ textureKey: fullCubeFaceTexture(blockName, id) });
  }
  return Object.freeze(faces);
}

function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  faces: ModelBox['faces'],
): ModelBox {
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    faces,
  });
}

/**
 * Pixel-space Bedrock fence (origin at block min corner, units = blocks):
 * - Post: [6,0,6]–[10,16,10]
 * - Rails: 2px thick, from post face to block edge; Y bands 6–9 and 12–15
 */
export function fenceModel(blockName: string, mask: ConnectionMask): BlockModel {
  const faces = allFaces(blockName);
  const boxes: ModelBox[] = [
    box([6 * PX, 0, 6 * PX], [10 * PX, 1, 10 * PX], faces),
  ];

  const railYs: readonly (readonly [number, number])[] = [
    [6 * PX, 9 * PX],
    [12 * PX, 15 * PX],
  ];

  for (const [y0, y1] of railYs) {
    if (mask.north) {
      boxes.push(box([7 * PX, y0, 0], [9 * PX, y1, 6 * PX], faces));
    }
    if (mask.south) {
      boxes.push(box([7 * PX, y0, 10 * PX], [9 * PX, y1, 1], faces));
    }
    if (mask.west) {
      boxes.push(box([0, y0, 7 * PX], [6 * PX, y1, 9 * PX], faces));
    }
    if (mask.east) {
      boxes.push(box([10 * PX, y0, 7 * PX], [1, y1, 9 * PX], faces));
    }
  }

  const key = `fence:${connectionMaskKey(mask)}:${blockName}`;
  return Object.freeze({
    key,
    renderBoxes: Object.freeze(boxes),
    occlusionBoxes: Object.freeze(boxes),
    isFullCube: false,
  });
}

/** Convenience: isolated post-only model. */
export function isolatedFenceModel(blockName: string): BlockModel {
  return fenceModel(blockName, connectionMaskFromFlags(false, false, false, false));
}

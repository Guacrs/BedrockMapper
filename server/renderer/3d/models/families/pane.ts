/**
 * Pane / iron-bar family (PR23) — thin center post + N/E/S/W arms.
 *
 * Reuses `ConnectionMask` from PR22. Separate family from fences: different
 * attach rules and thin geometry that must never report `isFullCube`.
 *
 * ## Bedrock connection research
 *
 * 1. Minecraft Wiki Glass Pane / Iron Bars — Bedrock states
 *    `minecraft:connection_{n,e,s,w}` (same neighbour-derived pattern as fences;
 *    infer at mesh time; ignore stored bits).
 * 2. Unconnected footprint is a 2×2-pixel post (7–9 /16), not a + cross
 *    (Bedrock 1.2+ / JE 1.9 parity).
 * 3. Panes and iron bars connect to each other and to full cubes / glass
 *    blocks. They do **not** connect to fences (Bedrock `connection_rule`
 *    `only_fences` on custom fences exists specifically so panes/bars skip
 *    fence neighbours; vanilla fences similarly do not accept pane arms).
 * 4. Stained / hard glass panes share the glass-pane connection group
 *    (`*glass_pane*` ids + `iron_bars`).
 * 5. Geometry: center post always; each connection adds a full-height 2px arm
 *    from the post face to the block edge (Java/Bedrock multipart equivalent).
 *
 * Occlusion stays Option A on thin boxes — panes must not cull neighbour
 * unit faces as if they were solid cubes.
 */

import { fullCubeFaceTexture } from '../../textures/models.ts';
import {
  connectionMaskFromFlags,
  connectionMaskKey,
  type ConnectionMask,
} from '../connection.ts';
import { isFenceName, shortBlockId } from './fence.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from '../types.ts';

const PX = 1 / 16;

/** Glass panes (incl. stained/hard) and iron bars. */
export function isPaneName(name: string): boolean {
  const short = shortBlockId(name);
  if (short === 'iron_bars') return true;
  // glass_pane, *_stained_glass_pane, hard_glass_pane, hard_*_stained_glass_pane
  return short.includes('glass_pane');
}

export function isIronBarsName(name: string): boolean {
  return shortBlockId(name) === 'iron_bars';
}

/**
 * Pane/bars attach classifier (≠ fence rules, ≠ isSolidAt).
 *
 * ```
 * neighbour
 *   ├── null / air                    → no
 *   ├── fence                         → no   (panes skip fences)
 *   ├── glass pane / iron bars        → yes
 *   ├── model.isFullCube              → yes  (glass block, stone, …)
 *   └── anything else                 → no   (slab, stair, fence gate, …)
 * ```
 */
export function paneConnectsTo(
  _selfName: string,
  neighbour: BlockRef | null,
  neighbourIsFullCube: boolean,
): boolean {
  if (!neighbour) return false;
  if (isFenceName(neighbour.name)) return false;
  if (isPaneName(neighbour.name)) return true;
  return neighbourIsFullCube;
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
 * Thin pane model in block space:
 * - Post: [7,0,7]–[9,16,9]
 * - Arms: 2px thick, full height, post face → block edge
 */
export function paneModel(blockName: string, mask: ConnectionMask): BlockModel {
  const faces = allFaces(blockName);
  const boxes: ModelBox[] = [
    box([7 * PX, 0, 7 * PX], [9 * PX, 1, 9 * PX], faces),
  ];

  if (mask.north) {
    boxes.push(box([7 * PX, 0, 0], [9 * PX, 1, 7 * PX], faces));
  }
  if (mask.south) {
    boxes.push(box([7 * PX, 0, 9 * PX], [9 * PX, 1, 1], faces));
  }
  if (mask.west) {
    boxes.push(box([0, 0, 7 * PX], [7 * PX, 1, 9 * PX], faces));
  }
  if (mask.east) {
    boxes.push(box([9 * PX, 0, 7 * PX], [1, 1, 9 * PX], faces));
  }

  return Object.freeze({
    key: `pane:${connectionMaskKey(mask)}:${blockName}`,
    renderBoxes: Object.freeze(boxes),
    occlusionBoxes: Object.freeze(boxes),
    isFullCube: false,
  });
}

export function isolatedPaneModel(blockName: string): BlockModel {
  return paneModel(blockName, connectionMaskFromFlags(false, false, false, false));
}

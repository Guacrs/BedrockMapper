/**
 * Experimental voxel mesh for one Minecraft chunk.
 *
 * PR20–26: palette BlockRefs resolve to box models (full cube, slab, stair,
 * fence, pane, wall, …). Contextual families use ConnectionMask from
 * VoxelNeighborhood — neighbour arms/rails are never stored on BlockRef.
 * Exposed faces are culled with conservative box occlusion (Option A). UVs
 * come from the PR17 atlas.
 *
 * Coordinates: Minecraft X east, Y up, Z south (same as Three.js mapping).
 */

import { blockColor, resolveBlockColor } from '../colors.ts';
import { CHUNK_SIZE } from '../../world/keys.ts';
import {
  blockAtWorld,
  blockRefAtWorld,
  type VoxelNeighborhood,
} from './chunk-blocks.ts';
import { blockLightingFor, isEmissiveBlock } from './lighting/block-lighting.ts';
import { emptyMeshBuffers, type MeshBuffers, type MeshChunk } from './mesh-types.ts';
import type { ConnectionMask } from './models/connection.ts';
import {
  connectionMaskAtWorld,
  isContextualConnectedName,
  wallShapeAtWorld,
} from './models/contextual.ts';
import { isWallName, wallShapeKey } from './models/families/wall.ts';
import { isFaceFullyOccluded } from './models/occlude.ts';
import { resolveBlockModel } from './models/resolve.ts';
import {
  applyModelBoxRotation,
  applyModelBoxRotationToNormal,
} from './models/transform.ts';
import type { BlockModel, BlockRef, FaceId, FaceMaterial, ModelBox } from './models/types.ts';
import { loadAtlasMetadata, type AtlasUvRect, uvRectForKey } from './textures/atlas.ts';
import type { CubeFace } from './textures/models.ts';
import { isOverlayCompositedTextureKey } from './textures/overlay.ts';

interface FaceDef {
  id: FaceId;
  dx: number;
  dy: number;
  dz: number;
  nx: number;
  ny: number;
  nz: number;
  /**
   * Four corners in CCW order on the unit square of this face, as (a,b) in
   * face-local parameters: for east/west → (y,z); up/down → (x,z); n/s → (x,y).
   * Mapped onto each ModelBox at emit time.
   */
  corners: readonly (readonly [number, number])[];
}

const FACES: readonly FaceDef[] = [
  {
    id: 'up',
    dx: 0,
    dy: 1,
    dz: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    corners: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
  {
    id: 'down',
    dx: 0,
    dy: -1,
    dz: 0,
    nx: 0,
    ny: -1,
    nz: 0,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  {
    id: 'south',
    dx: 0,
    dy: 0,
    dz: 1,
    nx: 0,
    ny: 0,
    nz: 1,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  {
    id: 'north',
    dx: 0,
    dy: 0,
    dz: -1,
    nx: 0,
    ny: 0,
    nz: -1,
    corners: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
  {
    id: 'east',
    dx: 1,
    dy: 0,
    dz: 0,
    nx: 1,
    ny: 0,
    nz: 0,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  {
    id: 'west',
    dx: -1,
    dy: 0,
    dz: 0,
    nx: -1,
    ny: 0,
    nz: 0,
    corners: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  },
];

function cornerWorld(
  box: ModelBox,
  face: FaceId,
  a: number,
  b: number,
): [number, number, number] {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  let local: [number, number, number];
  switch (face) {
    case 'up':
      local = [x0 + a * (x1 - x0), y1, z0 + b * (z1 - z0)];
      break;
    case 'down':
      local = [x0 + a * (x1 - x0), y0, z0 + b * (z1 - z0)];
      break;
    case 'south':
      local = [x0 + a * (x1 - x0), y0 + b * (y1 - y0), z1];
      break;
    case 'north':
      local = [x0 + a * (x1 - x0), y0 + b * (y1 - y0), z0];
      break;
    case 'east':
      local = [x1, y0 + a * (y1 - y0), z0 + b * (z1 - z0)];
      break;
    case 'west':
      local = [x0, y0 + a * (y1 - y0), z0 + b * (z1 - z0)];
      break;
  }
  return applyModelBoxRotation(local[0], local[1], local[2], box.rotation);
}

/**
 * UV corners for a box face using **unit-cell** texture density.
 *
 * Each corner samples the atlas tile at the face's local (x,y,z) within the
 * block (0..1), matching Minecraft's partial-block mapping: a half-height side
 * uses half the tile vertically; a half-width stair riser uses half horizontally.
 * Stretching a full tile onto a small face is avoided.
 */
export function faceCornerUvsForBox(
  rect: AtlasUvRect,
  face: CubeFace,
  box: ModelBox,
): readonly (readonly [number, number])[] {
  const { u0, v0, u1, v1 } = rect;
  const top = v0;
  const bot = v1;
  const uAt = (t: number) => u0 + t * (u1 - u0);
  // Atlas v increases downward; block y=1 → top of texture (v0).
  const vAt = (y: number) => top + (1 - y) * (bot - top);

  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;

  switch (face) {
    case 'up':
      // corners (x,z): (x0,z0),(x0,z1),(x1,z1),(x1,z0) — z→V like faceCornerUvs
      return [
        [uAt(x0), top + z0 * (bot - top)],
        [uAt(x0), top + z1 * (bot - top)],
        [uAt(x1), top + z1 * (bot - top)],
        [uAt(x1), top + z0 * (bot - top)],
      ];
    case 'down':
      return [
        [uAt(x0), top + (1 - z0) * (bot - top)],
        [uAt(x1), top + (1 - z0) * (bot - top)],
        [uAt(x1), top + (1 - z1) * (bot - top)],
        [uAt(x0), top + (1 - z1) * (bot - top)],
      ];
    case 'south':
      return [
        [uAt(x0), vAt(y0)],
        [uAt(x1), vAt(y0)],
        [uAt(x1), vAt(y1)],
        [uAt(x0), vAt(y1)],
      ];
    case 'north':
      return [
        [uAt(x1), vAt(y0)],
        [uAt(x1), vAt(y1)],
        [uAt(x0), vAt(y1)],
        [uAt(x0), vAt(y0)],
      ];
    case 'east':
      // Match prior east winding: (y,z) order with U←z, V←y
      return [
        [uAt(z0), vAt(y0)],
        [uAt(z0), vAt(y1)],
        [uAt(z1), vAt(y1)],
        [uAt(z1), vAt(y0)],
      ];
    case 'west':
      return [
        [uAt(z1), vAt(y0)],
        [uAt(z0), vAt(y0)],
        [uAt(z0), vAt(y1)],
        [uAt(z1), vAt(y1)],
      ];
  }
}

/**
 * Map FaceDef corner params (a,b) onto a sub-rect of the atlas tile.
 * Order matches `face.corners` / `cornerWorld` winding.
 */
export function faceCornerUvsFromTile(
  rect: AtlasUvRect,
  tileUv: readonly [number, number, number, number],
  corners: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  const [tu0, tv0, tu1, tv1] = tileUv;
  const uSpan = rect.u1 - rect.u0;
  const vSpan = rect.v1 - rect.v0;
  return corners.map(([a, b]) => {
    const tu = tu0 + a * (tu1 - tu0);
    // b=0 → base (tv1), b=1 → tip/flame (tv0) — matches unit-cell vAt.
    const tv = tv0 + (1 - b) * (tv1 - tv0);
    return [rect.u0 + tu * uSpan, rect.v0 + tv * vSpan] as const;
  });
}

function cornerUvsForFace(
  rect: AtlasUvRect | null,
  face: FaceDef,
  box: ModelBox,
  material: FaceMaterial,
): readonly (readonly [number, number])[] {
  if (!rect) {
    return [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ] as const;
  }
  if (material.tileUv) {
    return faceCornerUvsFromTile(rect, material.tileUv, face.corners);
  }
  return faceCornerUvsForBox(rect, face.id, box);
}
function vertexRgb(
  blockName: string,
  hasTexture: boolean,
  textureKey: string | null,
): [number, number, number] {
  const resolved = resolveBlockColor(blockName);
  if (
    hasTexture &&
    (resolved.tint === 'none' || (textureKey != null && isOverlayCompositedTextureKey(textureKey)))
  ) {
    return [1, 1, 1];
  }
  const [cr, cg, cb] = hasTexture ? resolved.rgb : blockColor(blockName);
  return [cr / 255, cg / 255, cb / 255];
}

/**
 * Vertex colours for the emissive mesh layer.
 * Uses researched lightColor, scaled by emission so weak emitters (magma)
 * read dimmer than glowstone without a custom shader.
 */
function emissiveVertexRgb(blockName: string): [number, number, number] {
  const lit = blockLightingFor(blockName);
  if (!lit || lit.emission <= 0) return [1, 1, 1];
  const [lr, lg, lb] = lit.lightColor ?? ([1, 1, 1] as const);
  // Keep a floor so low-emission blocks still tint; scale up to full at emission=1.
  const scale = 0.35 + 0.65 * lit.emission;
  return [lr * scale, lg * scale, lb * scale];
}

function emitFace(
  target: MeshBuffers,
  worldX: number,
  worldY: number,
  worldZ: number,
  box: ModelBox,
  face: FaceDef,
  r: number,
  g: number,
  b: number,
  cornerUvs: readonly (readonly [number, number])[],
): void {
  const base = target.positions.length / 3;
  const [nnx, nny, nnz] = applyModelBoxRotationToNormal(
    face.nx,
    face.ny,
    face.nz,
    box.rotation,
  );
  for (let i = 0; i < 4; i++) {
    const [a, bParam] = face.corners[i]!;
    const [lx2, ly2, lz2] = cornerWorld(box, face.id, a, bParam);
    const [u, v] = cornerUvs[i]!;
    target.positions.push(worldX + lx2, worldY + ly2, worldZ + lz2);
    target.normals.push(nnx, nny, nnz);
    target.colors.push(r, g, b);
    target.uvs.push(u, v);
  }
  target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Resolve the model at a world cell. Intrinsic models are cached by BlockRef
 * identity (palette-stable). Contextual connected models (fence/pane) are
 * cached by name+mask because the same palette entry can differ per cell.
 */
function modelAtWorld(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
  intrinsicCache: Map<BlockRef, BlockModel | null>,
  contextualCache: Map<string, BlockModel | null>,
): BlockModel | null {
  const ref = blockRefAtWorld(neighborhood, worldX, worldY, worldZ);
  if (!ref) return null;

  if (isContextualConnectedName(ref.name)) {
    if (isWallName(ref.name)) {
      const shape = wallShapeAtWorld(neighborhood, worldX, worldY, worldZ, ref.name);
      const key = `${ref.name}|${wallShapeKey(shape)}`;
      let model = contextualCache.get(key);
      if (model === undefined) {
        model = resolveBlockModel(ref, shape.mask, shape);
        contextualCache.set(key, model);
      }
      return model;
    }
    const mask = connectionMaskAtWorld(neighborhood, worldX, worldY, worldZ, ref.name);
    const key = `${ref.name}|${mask.north ? 1 : 0}${mask.east ? 1 : 0}${mask.south ? 1 : 0}${mask.west ? 1 : 0}`;
    let model = contextualCache.get(key);
    if (model === undefined) {
      model = resolveBlockModel(ref, mask);
      contextualCache.set(key, model);
    }
    return model;
  }

  let model = intrinsicCache.get(ref);
  if (model === undefined) {
    model = resolveBlockModel(ref);
    intrinsicCache.set(ref, model);
  }
  return model;
}

/** @deprecated Prefer connectionMaskAtWorld — kept for PR22 fence tests. */
export function fenceConnectionMaskAt(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
  selfName: string,
): ConnectionMask {
  return connectionMaskAtWorld(neighborhood, worldX, worldY, worldZ, selfName);
}

function neighbourModel(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
  face: FaceDef,
  intrinsicCache: Map<BlockRef, BlockModel | null>,
  contextualCache: Map<string, BlockModel | null>,
): BlockModel | null {
  return modelAtWorld(
    neighborhood,
    worldX + face.dx,
    worldY + face.dy,
    worldZ + face.dz,
    intrinsicCache,
    contextualCache,
  );
}

/**
 * Build an indexed box-face mesh for one chunk. Empty when there is nothing
 * solid to draw.
 *
 * PR33: faces of emissive blocks (`isEmissiveBlock`) go into `mesh.emissive`
 * so the viewer can apply a separate emissive material. Occlusion is unchanged.
 */
export function buildVoxelMesh(chunkX: number, chunkZ: number, neighborhood: VoxelNeighborhood): MeshChunk {
  const terrain = emptyMeshBuffers();
  const emissive = emptyMeshBuffers();

  const self = neighborhood.self;
  if (!self) {
    return { chunkX, chunkZ, ...terrain };
  }

  const atlas = loadAtlasMetadata();
  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;
  const intrinsicCache = new Map<BlockRef, BlockModel | null>();
  const contextualCache = new Map<string, BlockModel | null>();

  for (const subIndex of self.subchunkIndices) {
    const baseY = subIndex * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const worldY = baseY + ly;
          const ref = self.getLocalRef(lx, worldY, lz);
          if (!ref) continue;

          const worldX = originX + lx;
          const worldZ = originZ + lz;
          const model = modelAtWorld(
            neighborhood,
            worldX,
            worldY,
            worldZ,
            intrinsicCache,
            contextualCache,
          );
          if (!model) continue;

          const selfLit = isEmissiveBlock(ref.name);
          const target = selfLit ? emissive : terrain;

          for (const box of model.renderBoxes) {
            for (const face of FACES) {
              if (!box.faces[face.id]) continue;

              const neighbour = neighbourModel(
                neighborhood,
                worldX,
                worldY,
                worldZ,
                face,
                intrinsicCache,
                contextualCache,
              );
              if (isFaceFullyOccluded(box, face.id, neighbour)) continue;

              const textureKey = box.faces[face.id]!.textureKey;
              const material = box.faces[face.id]!;
              const rect =
                atlas && textureKey ? uvRectForKey(atlas, textureKey) : null;
              const hasTexture = rect != null;
              const [r, g, b] = selfLit
                ? emissiveVertexRgb(ref.name)
                : vertexRgb(ref.name, hasTexture, textureKey);
              const cornerUvs = cornerUvsForFace(rect, face, box, material);

              emitFace(target, worldX, worldY, worldZ, box, face, r, g, b, cornerUvs);
            }
          }
        }
      }
    }
  }

  const mesh: MeshChunk = {
    chunkX,
    chunkZ,
    positions: terrain.positions,
    normals: terrain.normals,
    colors: terrain.colors,
    uvs: terrain.uvs,
    indices: terrain.indices,
  };
  if (emissive.positions.length > 0) {
    mesh.emissive = emissive;
  }
  return mesh;
}

/** Exported for tests — terrain face count (emissive layer excluded). */
export function countFaces(mesh: MeshChunk): number {
  return mesh.indices.length / 6;
}

/** Exported for tests — emissive-layer face count. */
export function countEmissiveFaces(mesh: MeshChunk): number {
  return mesh.emissive ? mesh.emissive.indices.length / 6 : 0;
}

export { FACES as VOXEL_FACES, blockAtWorld, blockRefAtWorld };

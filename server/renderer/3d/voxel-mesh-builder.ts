/**
 * Experimental voxel mesh for one Minecraft chunk.
 *
 * PR20: palette BlockRefs resolve to box models (full cube + slab). Exposed
 * faces are culled with conservative box occlusion (Option A — never drop a
 * face that is only partially covered). UVs come from the PR17 atlas.
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
import { type MeshChunk } from './mesh-types.ts';
import { isFaceFullyOccluded } from './models/occlude.ts';
import { resolveBlockModel } from './models/resolve.ts';
import type { BlockModel, BlockRef, FaceId, ModelBox } from './models/types.ts';
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
  switch (face) {
    case 'up':
      return [x0 + a * (x1 - x0), y1, z0 + b * (z1 - z0)];
    case 'down':
      return [x0 + a * (x1 - x0), y0, z0 + b * (z1 - z0)];
    case 'south':
      return [x0 + a * (x1 - x0), y0 + b * (y1 - y0), z1];
    case 'north':
      return [x0 + a * (x1 - x0), y0 + b * (y1 - y0), z0];
    case 'east':
      return [x1, y0 + a * (y1 - y0), z0 + b * (z1 - z0)];
    case 'west':
      return [x0, y0 + a * (y1 - y0), z0 + b * (z1 - z0)];
  }
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

function neighbourModel(
  neighborhood: VoxelNeighborhood,
  worldX: number,
  worldY: number,
  worldZ: number,
  face: FaceDef,
  cache: Map<BlockRef, BlockModel | null>,
): BlockModel | null {
  const ref = blockRefAtWorld(
    neighborhood,
    worldX + face.dx,
    worldY + face.dy,
    worldZ + face.dz,
  );
  if (!ref) return null;
  let model = cache.get(ref);
  if (model === undefined) {
    model = resolveBlockModel(ref);
    cache.set(ref, model);
  }
  return model;
}

/**
 * Build an indexed box-face mesh for one chunk. Empty when there is nothing
 * solid to draw.
 */
export function buildVoxelMesh(chunkX: number, chunkZ: number, neighborhood: VoxelNeighborhood): MeshChunk {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const self = neighborhood.self;
  if (!self) {
    return { chunkX, chunkZ, positions, normals, colors, uvs, indices };
  }

  const atlas = loadAtlasMetadata();
  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;
  const modelCache = new Map<BlockRef, BlockModel | null>();

  for (const subIndex of self.subchunkIndices) {
    const baseY = subIndex * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const worldY = baseY + ly;
          const ref = self.getLocalRef(lx, worldY, lz);
          if (!ref) continue;

          let model = modelCache.get(ref);
          if (model === undefined) {
            model = resolveBlockModel(ref);
            modelCache.set(ref, model);
          }
          if (!model) continue;

          const worldX = originX + lx;
          const worldZ = originZ + lz;

          for (const box of model.renderBoxes) {
            for (const face of FACES) {
              if (!box.faces[face.id]) continue;

              const neighbour = neighbourModel(
                neighborhood,
                worldX,
                worldY,
                worldZ,
                face,
                modelCache,
              );
              if (isFaceFullyOccluded(box, face.id, neighbour)) continue;

              const textureKey = box.faces[face.id]!.textureKey;
              const rect =
                atlas && textureKey ? uvRectForKey(atlas, textureKey) : null;
              const hasTexture = rect != null;
              const [r, g, b] = vertexRgb(ref.name, hasTexture, textureKey);
              const cornerUvs = rect
                ? faceCornerUvsForBox(rect, face.id, box)
                : ([
                    [0, 0],
                    [0, 0],
                    [0, 0],
                    [0, 0],
                  ] as const);

              const base = positions.length / 3;
              for (let i = 0; i < 4; i++) {
                const [a, bParam] = face.corners[i]!;
                const [lx2, ly2, lz2] = cornerWorld(box, face.id, a, bParam);
                const [u, v] = cornerUvs[i]!;
                positions.push(worldX + lx2, worldY + ly2, worldZ + lz2);
                normals.push(face.nx, face.ny, face.nz);
                colors.push(r, g, b);
                uvs.push(u, v);
              }
              indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
          }
        }
      }
    }
  }

  return { chunkX, chunkZ, positions, normals, colors, uvs, indices };
}

/** Exported for tests — face count helpers. */
export function countFaces(mesh: MeshChunk): number {
  return mesh.indices.length / 6;
}

export { FACES as VOXEL_FACES, blockAtWorld, blockRefAtWorld };

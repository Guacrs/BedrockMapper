/**
 * Experimental voxel / full-cube mesh for one Minecraft chunk.
 *
 * Emits only exposed faces of renderable cubes (see `isRenderableCube`).
 * Internal faces between solid neighbours are culled. Chunk-boundary faces
 * consult west/east/north/south neighbour volumes — missing neighbours are
 * treated as air. No greedy meshing or special block models yet.
 *
 * Appearance (atlas UVs) comes from the optional texture pipeline; unknown
 * blocks keep the existing vertex-colour fallback.
 *
 * Coordinates: Minecraft X east, Y up, Z south (same as Three.js mapping).
 */

import { blockColor, resolveBlockColor } from '../colors.ts';
import { isRenderableCube } from '../../world/blocks.ts';
import { CHUNK_SIZE } from '../../world/keys.ts';
import {
  blockAtWorld,
  isSolidAt,
  type VoxelNeighborhood,
} from './chunk-blocks.ts';
import { type MeshChunk } from './mesh-types.ts';
import { faceCornerUvs, loadAtlasMetadata, uvRectForKey } from './textures/atlas.ts';
import { fullCubeFaceTexture, type CubeFace } from './textures/models.ts';
import { isOverlayCompositedTextureKey } from './textures/overlay.ts';

interface FaceDef {
  id: CubeFace;
  /** Neighbour offset checked for occlusion. */
  dx: number;
  dy: number;
  dz: number;
  nx: number;
  ny: number;
  nz: number;
  /** Four corners in CCW order when viewed from outside (unit cube). */
  corners: readonly (readonly [number, number, number])[];
}

/**
 * Unit-cube faces. Normals are assigned explicitly so winding mistakes are
 * obvious in tests; corners are ordered for front-facing triangulation.
 */
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
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
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
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
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
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
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
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
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
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
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
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
];

function vertexRgb(
  blockName: string,
  hasTexture: boolean,
  textureKey: string | null,
): [number, number, number] {
  const resolved = resolveBlockColor(blockName);
  // Overlay-composited atlas frames already bake tint into opaque pixels
  // (dirt stays dirt; mask pixels carry overlay_color). Do not multiply again.
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
 * Build an indexed cube-face mesh for one chunk. Empty when there is nothing
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

  for (const subIndex of self.subchunkIndices) {
    const baseY = subIndex * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const worldY = baseY + ly;
          const name = self.getLocal(lx, worldY, lz);
          if (!isRenderableCube(name)) continue;

          const worldX = originX + lx;
          const worldZ = originZ + lz;

          for (const face of FACES) {
            if (
              isSolidAt(
                neighborhood,
                worldX + face.dx,
                worldY + face.dy,
                worldZ + face.dz,
              )
            ) {
              continue;
            }

            const textureKey = fullCubeFaceTexture(name!, face.id);
            const rect =
              atlas && textureKey ? uvRectForKey(atlas, textureKey) : null;
            const hasTexture = rect != null;
            const [r, g, b] = vertexRgb(name!, hasTexture, textureKey);
            const cornerUvs = rect
              ? faceCornerUvs(rect, face.id)
              : ([
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ] as const);

            const base = positions.length / 3;
            for (let i = 0; i < 4; i++) {
              const [cx, cy, cz] = face.corners[i]!;
              const [u, v] = cornerUvs[i]!;
              positions.push(worldX + cx, worldY + cy, worldZ + cz);
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

  return { chunkX, chunkZ, positions, normals, colors, uvs, indices };
}

/** Exported for tests — face count helpers. */
export function countFaces(mesh: MeshChunk): number {
  return mesh.indices.length / 6;
}

export { FACES as VOXEL_FACES, blockAtWorld };

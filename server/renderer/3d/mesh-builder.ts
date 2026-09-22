/**
 * Builds a connected heightmap mesh for one Minecraft chunk from ChunkSurface
 * data (the same surfaces the 2D tile renderer uses).
 *
 * Layout: 17×17 vertices covering the 16×16 block cells of the chunk. The
 * eastern and southern edges sample neighbour surfaces so adjacent chunks share
 * matching boundary heights (no cracks). Vertex colours come from
 * `surfaceBlockColor` — biome tint and water depth included, 2D slope shading
 * left out so Three.js lighting can shade via normals.
 */

import { surfaceBlockColor, type Rgb } from '../colors.ts';
import { columnIndex } from '../../world/keys.ts';
import { NO_BIOME, NO_SURFACE, type ChunkSurface } from '../../world/surface.ts';
import { type MeshChunk } from './mesh-types.ts';

const GRID = 16;
const VERTS = GRID + 1; // 17

interface ColumnSample {
  y: number;
  color: Rgb;
}

function sampleColumn(surface: ChunkSurface | null, localX: number, localZ: number): ColumnSample | null {
  if (!surface) return null;
  if (localX < 0 || localX > 15 || localZ < 0 || localZ > 15) return null;
  const column = columnIndex(localX, localZ);
  const y = surface.heights[column]!;
  if (y === NO_SURFACE) return null;
  const block = surface.blocks[column];
  if (!block) return null;
  const depth = surface.waterDepths?.[column] ?? 0;
  const biome = surface.biomes?.[column];
  const biomeId = biome === undefined || biome === NO_BIOME ? null : biome;
  return { y, color: surfaceBlockColor(block, depth, biomeId) };
}

/**
 * Vertex (lx, lz) with lx/lz in 0..16. Interior samples this chunk; the +16
 * edges sample the east / south / south-east neighbour.
 */
function sampleVertex(
  lx: number,
  lz: number,
  self: ChunkSurface | null,
  east: ChunkSurface | null,
  south: ChunkSurface | null,
  southEast: ChunkSurface | null,
): ColumnSample | null {
  if (lx < GRID && lz < GRID) return sampleColumn(self, lx, lz);
  if (lx === GRID && lz < GRID) return sampleColumn(east, 0, lz);
  if (lx < GRID && lz === GRID) return sampleColumn(south, lx, 0);
  return sampleColumn(southEast, 0, 0);
}

function cross(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

export interface NeighbourSurfaces {
  self: ChunkSurface | null;
  east: ChunkSurface | null;
  south: ChunkSurface | null;
  southEast: ChunkSurface | null;
}

/**
 * Build an indexed terrain mesh for one chunk. Empty when there is no visible
 * surface to triangulate.
 */
export function buildTerrainMesh(
  chunkX: number,
  chunkZ: number,
  neighbours: NeighbourSurfaces,
): MeshChunk {
  const originX = chunkX * GRID;
  const originZ = chunkZ * GRID;
  const { self, east, south, southEast } = neighbours;

  const samples: (ColumnSample | null)[] = new Array(VERTS * VERTS);
  for (let lz = 0; lz < VERTS; lz++) {
    for (let lx = 0; lx < VERTS; lx++) {
      samples[lz * VERTS + lx] = sampleVertex(lx, lz, self, east, south, southEast);
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const vertexIndex = new Int32Array(VERTS * VERTS).fill(-1);

  for (let lz = 0; lz < VERTS; lz++) {
    for (let lx = 0; lx < VERTS; lx++) {
      const sample = samples[lz * VERTS + lx];
      if (!sample) continue;
      vertexIndex[lz * VERTS + lx] = positions.length / 3;
      positions.push(originX + lx, sample.y, originZ + lz);
      colors.push(sample.color[0] / 255, sample.color[1] / 255, sample.color[2] / 255);
    }
  }

  const indices: number[] = [];
  const normalsAccum = new Float64Array((positions.length / 3) * 3);

  const addTri = (a: number, b: number, c: number) => {
    indices.push(a, b, c);
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const bx = positions[b * 3]!;
    const by = positions[b * 3 + 1]!;
    const bz = positions[b * 3 + 2]!;
    const cx = positions[c * 3]!;
    const cy = positions[c * 3 + 1]!;
    const cz = positions[c * 3 + 2]!;
    const [nx, ny, nz] = cross(bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az);
    for (const vi of [a, b, c]) {
      normalsAccum[vi * 3]! += nx;
      normalsAccum[vi * 3 + 1]! += ny;
      normalsAccum[vi * 3 + 2]! += nz;
    }
  };

  for (let lz = 0; lz < GRID; lz++) {
    for (let lx = 0; lx < GRID; lx++) {
      const i00 = vertexIndex[lz * VERTS + lx]!;
      const i10 = vertexIndex[lz * VERTS + lx + 1]!;
      const i01 = vertexIndex[(lz + 1) * VERTS + lx]!;
      const i11 = vertexIndex[(lz + 1) * VERTS + lx + 1]!;
      if (i00 < 0 || i10 < 0 || i01 < 0 || i11 < 0) continue;
      // Two triangles; winding so the upward face is front-facing when Y is up.
      addTri(i00, i01, i10);
      addTri(i10, i01, i11);
    }
  }

  const normals: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) {
    const [nx, ny, nz] = normalize(
      normalsAccum[i * 3]!,
      normalsAccum[i * 3 + 1]!,
      normalsAccum[i * 3 + 2]!,
    );
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }

  // Legacy heightmap path — unused by /api/mesh; still satisfies MeshChunk.uvs.
  const uvs = new Array((positions.length / 3) * 2).fill(0);
  return { chunkX, chunkZ, positions, normals, colors, uvs, indices };
}

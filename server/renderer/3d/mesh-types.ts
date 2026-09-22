/**
 * Compact terrain mesh for one Minecraft chunk.
 *
 * Coordinates are Minecraft block space (X east, Y up, Z south). Arrays are
 * flat and transferable: positions/normals/colors are length divisible by 3;
 * indices by 3. A later binary/ArrayBuffer transport can reuse the same layout.
 */

export interface MeshChunk {
  chunkX: number;
  chunkZ: number;
  /** xyz xyz … world-block coordinates */
  positions: number[];
  /** nx ny nz … unit normals */
  normals: number[];
  /** r g b … 0..1 vertex colours from the 2D surface colour pipeline */
  colors: number[];
  /** triangle indices into the vertex arrays */
  indices: number[];
}

export function meshChunkKey(dimension: string, chunkX: number, chunkZ: number): string {
  return `${dimension}:${chunkX}:${chunkZ}`;
}

/** Geometry invariants used by tests and the HTTP layer. */
export function assertMeshInvariants(mesh: MeshChunk): void {
  const { positions, normals, colors, indices } = mesh;
  if (positions.length % 3 !== 0) throw new Error('positions length must be divisible by 3');
  if (normals.length !== positions.length) throw new Error('normals length must match positions');
  if (colors.length !== positions.length) throw new Error('colors length must match positions');
  if (indices.length % 3 !== 0) throw new Error('indices length must be divisible by 3');
  const vertexCount = positions.length / 3;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`index ${index} out of range for ${vertexCount} vertices`);
    }
  }
}

export function isEmptyMesh(mesh: MeshChunk): boolean {
  return mesh.positions.length === 0 || mesh.indices.length === 0;
}

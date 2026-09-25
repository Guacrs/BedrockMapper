/**
 * Compact terrain mesh for one Minecraft chunk.
 *
 * Coordinates are Minecraft block space (X east, Y up, Z south). Arrays are
 * flat and transferable: positions/normals/colors are length divisible by 3;
 * uvs by 2; indices by 3. A later binary/ArrayBuffer transport can reuse the
 * same layout.
 *
 * PR33: optional `emissive` sibling carries self-lit faces (torches, glowstone,
 * …) so the viewer can use a separate emissive material without baking glow
 * into vertex colours of the terrain layer.
 */

export interface MeshBuffers {
  /** xyz xyz … world-block coordinates */
  positions: number[];
  /** nx ny nz … unit normals */
  normals: number[];
  /**
   * r g b … 0..1 vertex colours.
   * Terrain: map tint / white. Emissive: glow tint (lightColor).
   */
  colors: number[];
  /** u v … atlas UVs (one pair per vertex). Zeroes when no texture is mapped. */
  uvs: number[];
  /** triangle indices into the vertex arrays */
  indices: number[];
}

export interface MeshChunk extends MeshBuffers {
  chunkX: number;
  chunkZ: number;
  /**
   * Self-lit faces for emitters. Omitted or empty when the chunk has none.
   * Same coordinate / array conventions as the terrain buffers.
   */
  emissive?: MeshBuffers;
}

export function emptyMeshBuffers(): MeshBuffers {
  return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
}

export function meshChunkKey(dimension: string, chunkX: number, chunkZ: number): string {
  return `${dimension}:${chunkX}:${chunkZ}`;
}

function assertBufferInvariants(buffers: MeshBuffers, label: string): void {
  const { positions, normals, colors, uvs, indices } = buffers;
  if (positions.length % 3 !== 0) throw new Error(`${label} positions length must be divisible by 3`);
  if (normals.length !== positions.length) throw new Error(`${label} normals length must match positions`);
  if (colors.length !== positions.length) throw new Error(`${label} colors length must match positions`);
  if (uvs.length !== (positions.length / 3) * 2) {
    throw new Error(`${label} uvs length must be vertexCount × 2`);
  }
  if (indices.length % 3 !== 0) throw new Error(`${label} indices length must be divisible by 3`);
  const vertexCount = positions.length / 3;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`${label} index ${index} out of range for ${vertexCount} vertices`);
    }
  }
  for (const uv of uvs) {
    if (!Number.isFinite(uv) || uv < 0 || uv > 1) {
      throw new Error(`${label} uv component ${uv} out of range`);
    }
  }
}

/** Geometry invariants used by tests and the HTTP layer. */
export function assertMeshInvariants(mesh: MeshChunk): void {
  assertBufferInvariants(mesh, 'terrain');
  if (mesh.emissive && mesh.emissive.positions.length > 0) {
    assertBufferInvariants(mesh.emissive, 'emissive');
  }
}

export function isEmptyMesh(mesh: MeshChunk): boolean {
  const terrainEmpty = mesh.positions.length === 0 || mesh.indices.length === 0;
  const emissiveEmpty =
    !mesh.emissive || mesh.emissive.positions.length === 0 || mesh.emissive.indices.length === 0;
  return terrainEmpty && emissiveEmpty;
}

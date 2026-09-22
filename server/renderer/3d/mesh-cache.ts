/**
 * In-memory mesh cache keyed by dimension + chunk coordinates.
 *
 * Invalidated when the world refresh reports that a chunk (or a neighbour that
 * affects its exposed faces) changed. No disk persistence yet.
 */

import { meshChunkKey, type MeshChunk } from './mesh-types.ts';

/**
 * Chunks whose voxel meshes can change when `(chunkX, chunkZ)` changes:
 * the chunk itself plus the four face-adjacent neighbours (they cull against
 * this chunk's border blocks).
 */
export const VOXEL_MESH_INVALIDATION_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export class MeshCache {
  #entries = new Map<string, MeshChunk>();
  #hits = 0;
  #misses = 0;

  get(dimension: string, chunkX: number, chunkZ: number): MeshChunk | undefined {
    const hit = this.#entries.get(meshChunkKey(dimension, chunkX, chunkZ));
    if (hit) this.#hits++;
    else this.#misses++;
    return hit;
  }

  set(dimension: string, chunkX: number, chunkZ: number, mesh: MeshChunk): void {
    this.#entries.set(meshChunkKey(dimension, chunkX, chunkZ), mesh);
  }

  delete(dimension: string, chunkX: number, chunkZ: number): boolean {
    return this.#entries.delete(meshChunkKey(dimension, chunkX, chunkZ));
  }

  /**
   * Drop the mesh for a changed chunk and every neighbour mesh whose boundary
   * face visibility may depend on it.
   */
  invalidateAround(dimension: string, chunkX: number, chunkZ: number): number {
    let removed = 0;
    for (const [dx, dz] of VOXEL_MESH_INVALIDATION_OFFSETS) {
      if (this.delete(dimension, chunkX + dx, chunkZ + dz)) removed++;
    }
    return removed;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  get stats(): { size: number; hits: number; misses: number } {
    return { size: this.#entries.size, hits: this.#hits, misses: this.#misses };
  }
}

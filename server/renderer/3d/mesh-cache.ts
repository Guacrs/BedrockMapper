/**
 * In-memory mesh cache keyed by dimension + chunk coordinates.
 *
 * Invalidated when the world refresh reports that a chunk (or a neighbour that
 * affects its exposed faces) changed. Bounded with FIFO eviction so exploring
 * a large world cannot grow the Node heap without limit.
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

/** Default cap on retained chunk meshes (one mesh can be large). */
export const DEFAULT_MESH_CACHE_LIMIT = 512;

export class MeshCache {
  #entries = new Map<string, MeshChunk>();
  #hits = 0;
  #misses = 0;
  #limit: number;

  constructor(limit: number = DEFAULT_MESH_CACHE_LIMIT) {
    this.#limit = Math.max(1, limit);
  }

  get(dimension: string, chunkX: number, chunkZ: number): MeshChunk | undefined {
    const key = meshChunkKey(dimension, chunkX, chunkZ);
    const hit = this.#entries.get(key);
    if (hit) {
      // Refresh insertion order so recently used entries survive FIFO eviction.
      this.#entries.delete(key);
      this.#entries.set(key, hit);
      this.#hits++;
    } else {
      this.#misses++;
    }
    return hit;
  }

  set(dimension: string, chunkX: number, chunkZ: number, mesh: MeshChunk): void {
    const key = meshChunkKey(dimension, chunkX, chunkZ);
    if (this.#entries.has(key)) this.#entries.delete(key);
    while (this.#entries.size >= this.#limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, mesh);
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

  get limit(): number {
    return this.#limit;
  }

  get stats(): { size: number; hits: number; misses: number; limit: number } {
    return { size: this.#entries.size, hits: this.#hits, misses: this.#misses, limit: this.#limit };
  }
}

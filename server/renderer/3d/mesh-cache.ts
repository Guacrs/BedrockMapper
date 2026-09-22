/**
 * In-memory mesh cache keyed by dimension + chunk coordinates.
 *
 * Invalidated when the world refresh reports that a chunk (or a neighbour that
 * contributed edge heights) changed. No disk persistence in this first PR.
 */

import { meshChunkKey, type MeshChunk } from './mesh-types.ts';

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
   * Drop the mesh for a changed chunk and every neighbour mesh that may have
   * sampled its heights for the shared eastern/southern edge.
   */
  invalidateAround(dimension: string, chunkX: number, chunkZ: number): number {
    let removed = 0;
    for (const [dx, dz] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1],
    ] as const) {
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

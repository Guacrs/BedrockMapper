/**
 * Test double for a Bedrock server writing to its world.
 *
 * The refresh tests need a world that changes underneath the map, which the real
 * BDS world must never be used for: it is opened read-only, through snapshots.
 * So these helpers copy a world and then write to the *copy* with LevelDB
 * directly, which is exactly what BDS does to its own directory.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDB } from '@8crafter/leveldb-zlib';
import { maxSubChunkIndex, minSubChunkIndex, OVERWORLD, type Dimension } from '../server/world/dimensions.ts';
import { ChunkTag, chunkKey, subChunkKey, type ChunkPos } from '../server/world/keys.ts';

/** Copies a world directory, e.g. to get a world that may be modified. */
export async function copyWorld(source: string, target: string): Promise<void> {
  await fs.cp(source, target, { recursive: true });
}

/** SHA-256 over every file of a LevelDB directory, to prove it was not touched. */
export async function hashDatabase(dbPath: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for (const name of (await fs.readdir(dbPath)).sort()) {
    hash.update(name);
    hash.update(await fs.readFile(path.join(dbPath, name)));
  }
  return hash.digest('hex');
}

export class WorldWriter {
  #db: LevelDB;
  #dimension: Dimension;

  private constructor(db: LevelDB, dimension: Dimension) {
    this.#db = db;
    this.#dimension = dimension;
  }

  static async open(worldPath: string, dimension: Dimension = OVERWORLD): Promise<WorldWriter> {
    const db = new LevelDB(path.join(worldPath, 'db'), { createIfMissing: false });
    await db.open();
    return new WorldWriter(db, dimension);
  }

  /** Subchunk indices the chunk stores, top-most last. */
  async subChunkIndices(chunk: ChunkPos): Promise<number[]> {
    const found: number[] = [];
    for (let index = minSubChunkIndex(this.#dimension); index <= maxSubChunkIndex(this.#dimension); index++) {
      const value = await this.#db.get(subChunkKey(this.#dimension, chunk.x, chunk.z, index));
      if (value?.length) found.push(index);
    }
    return found;
  }

  /**
   * Copies one chunk's block data to another chunk position, which is how these
   * tests create a "newly generated" chunk that really decodes.
   */
  async copyChunk(from: ChunkPos, to: ChunkPos): Promise<number> {
    const indices = await this.subChunkIndices(from);
    for (const index of indices) {
      const value = await this.#db.get(subChunkKey(this.#dimension, from.x, from.z, index));
      if (value) await this.#db.put(subChunkKey(this.#dimension, to.x, to.z, index), value);
    }
    for (const tag of [ChunkTag.ChunkVersion, ChunkTag.Data3D, ChunkTag.FinalizedState]) {
      const value = await this.#db.get(chunkKey(this.#dimension, from.x, from.z, tag));
      if (value) await this.#db.put(chunkKey(this.#dimension, to.x, to.z, tag), value);
    }
    return indices.length;
  }

  /** Removes a chunk's top-most subchunk, which changes its visible surface. */
  async removeTopSubChunk(chunk: ChunkPos): Promise<number | null> {
    const indices = await this.subChunkIndices(chunk);
    const top = indices.at(-1);
    if (top === undefined) return null;
    await this.#db.delete(subChunkKey(this.#dimension, chunk.x, chunk.z, top));
    return top;
  }

  /** Removes every subchunk of a chunk, as if its block data disappeared. */
  async removeAllSubChunks(chunk: ChunkPos): Promise<number> {
    const indices = await this.subChunkIndices(chunk);
    for (const index of indices) {
      await this.#db.delete(subChunkKey(this.#dimension, chunk.x, chunk.z, index));
    }
    return indices.length;
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}

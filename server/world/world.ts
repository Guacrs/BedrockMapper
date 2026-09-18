/**
 * Read-only reader for an official Bedrock Dedicated Server world.
 *
 * Everything goes through a snapshot copy of the server's LevelDB, so the live
 * world is never opened (see snapshot.ts). Only one instance may be open per
 * snapshot path at a time - the LevelDB binding refuses a second open.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDB } from '@8crafter/leveldb-zlib';
import nbt from 'prismarine-nbt';
import {
  maxSubChunkIndex,
  minSubChunkIndex,
  type Dimension,
  type DimensionId,
} from './dimensions.ts';
import { ChunkTag, chunkKey, parseChunkKey, subChunkKey, type ChunkPos } from './keys.ts';
import { snapshotWorld, type SnapshotResult, type SourceState } from './snapshot.ts';
import { decodeSubChunk, LegacySubChunkError, type SubChunk } from './subchunk.ts';

export interface LevelInfo {
  /** World name from levelname.txt / level.dat. */
  name: string;
  /** Version the world was last opened with, e.g. "1.26.51.1". */
  lastOpenedWithVersion: string | null;
  storageVersion: number | null;
  spawn: { x: number; y: number; z: number } | null;
}

export interface ChunkSummary extends ChunkPos {
  /** Chunk format version from the ChunkVersion record. */
  version: number | null;
  subChunkIndices: number[];
}

export interface OpenWorldOptions {
  worldPath: string;
  cacheDir: string;
  /** A snapshot the caller already created, instead of taking a fresh one. */
  snapshot?: SnapshotResult;
  /** Source state the caller already read, to avoid stat-ing the world twice. */
  state?: SourceState;
}

/** One pass over the key space: which chunks exist and what their blocks are. */
export interface WorldScan {
  chunks: ChunkSummary[];
  /** Per chunk digest of the block data, `null` for chunks without any. */
  digests: Map<string, string>;
  subChunkRecords: number;
  subChunkBytes: number;
  scanMs: number;
}

function readVersionList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter((part): part is number => typeof part === 'number');
  return parts.length ? parts.join('.') : null;
}

async function readLevelInfo(worldPath: string): Promise<LevelInfo> {
  const levelName = await fs
    .readFile(path.join(worldPath, 'levelname.txt'), 'utf8')
    .then((text) => text.trim())
    .catch(() => '');

  // level.dat is little-endian NBT behind an 8-byte header
  // (int32 storage version, int32 payload length).
  const raw = await fs.readFile(path.join(worldPath, 'level.dat')).catch(() => null);
  if (!raw || raw.length < 8) {
    return { name: levelName, lastOpenedWithVersion: null, storageVersion: null, spawn: null };
  }

  const storageVersion = raw.readInt32LE(0);
  const { parsed } = await nbt.parse(raw.subarray(8), 'little');
  const level = nbt.simplify(parsed) as Record<string, unknown>;
  const spawnX = level.SpawnX;
  const spawnY = level.SpawnY;
  const spawnZ = level.SpawnZ;

  return {
    name: levelName || (typeof level.LevelName === 'string' ? level.LevelName : ''),
    lastOpenedWithVersion: readVersionList(level.lastOpenedWithVersion),
    storageVersion,
    spawn:
      typeof spawnX === 'number' && typeof spawnY === 'number' && typeof spawnZ === 'number'
        ? { x: spawnX, y: spawnY, z: spawnZ }
        : null,
  };
}

/** Bytes of a chunk digest; a truncated SHA-1 is ample for change detection. */
const DIGEST_BYTES = 16;

/**
 * Folds one subchunk record into its chunk's digest.
 *
 * The subchunk index is hashed together with the payload, and the per-record
 * hashes are combined with XOR, so the result does not depend on the order the
 * iterator happened to visit the records in, but does change when a subchunk
 * moves, changes, appears or disappears.
 */
function mixRecord(
  accumulators: Map<string, Buffer>,
  chunkId: string,
  subChunkIndex: number,
  value: Buffer,
): void {
  const record = createHash('sha1')
    .update(Buffer.from([subChunkIndex & 0xff]))
    .update(value)
    .digest();
  let accumulator = accumulators.get(chunkId);
  if (!accumulator) {
    accumulator = Buffer.alloc(DIGEST_BYTES);
    accumulators.set(chunkId, accumulator);
  }
  for (let i = 0; i < DIGEST_BYTES; i++) accumulator[i]! ^= record[i]!;
}

export class BedrockWorld {
  #db: LevelDB;
  #chunkCache = new Map<DimensionId, ChunkSummary[]>();
  readonly worldPath: string;
  readonly levelInfo: LevelInfo;
  readonly snapshot: SnapshotResult;

  private constructor(
    db: LevelDB,
    worldPath: string,
    levelInfo: LevelInfo,
    snapshot: SnapshotResult,
  ) {
    this.#db = db;
    this.worldPath = worldPath;
    this.levelInfo = levelInfo;
    this.snapshot = snapshot;
  }

  static async open(options: OpenWorldOptions): Promise<BedrockWorld> {
    const { worldPath, cacheDir } = options;
    const levelInfo = await readLevelInfo(worldPath);
    const snapshot =
      options.snapshot ?? (await snapshotWorld(worldPath, cacheDir, { state: options.state }));
    const db = new LevelDB(snapshot.dbPath, { createIfMissing: false });
    await db.open();
    return new BedrockWorld(db, worldPath, levelInfo, snapshot);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  /**
   * Walks the key space once, collecting every stored chunk of a dimension and
   * a digest of its block data.
   *
   * A chunk is "stored" when it has a ChunkVersion record; the subchunk indices
   * found alongside it tell the renderer which vertical slices exist. The digest
   * covers the raw `SubChunkPrefix` payloads - the bytes the renderer decodes -
   * so comparing two scans of two snapshots says exactly which chunks gained,
   * lost or changed block data, without decoding anything.
   */
  async scan(dimension: Dimension): Promise<WorldScan> {
    const startedAt = performance.now();
    const chunks = new Map<string, ChunkSummary>();
    const accumulators = new Map<string, Buffer>();
    let subChunkRecords = 0;
    let subChunkBytes = 0;

    const iterator = this.#db.getIterator({ keys: true, values: true });
    try {
      let entry: unknown[] | null;
      while ((entry = await iterator.next())) {
        const key = entry[1] as Buffer | undefined;
        if (!Buffer.isBuffer(key)) continue;
        const parsed = parseChunkKey(key);
        if (!parsed || parsed.dimensionIndex !== dimension.index) continue;
        if (
          parsed.tag !== ChunkTag.ChunkVersion &&
          parsed.tag !== ChunkTag.LegacyChunkVersion &&
          parsed.tag !== ChunkTag.SubChunkPrefix
        ) {
          continue;
        }

        const value = entry[0] as Buffer | undefined;
        const id = `${parsed.x},${parsed.z}`;
        let summary = chunks.get(id);
        if (!summary) {
          summary = { x: parsed.x, z: parsed.z, version: null, subChunkIndices: [] };
          chunks.set(id, summary);
        }

        if (parsed.tag === ChunkTag.SubChunkPrefix && parsed.subChunkIndex !== undefined) {
          summary.subChunkIndices.push(parsed.subChunkIndex);
          if (Buffer.isBuffer(value)) {
            subChunkRecords++;
            subChunkBytes += value.length;
            mixRecord(accumulators, id, parsed.subChunkIndex, value);
          }
        } else if (Buffer.isBuffer(value) && value.length && summary.version === null) {
          summary.version = value.readUInt8(0);
        }
      }
    } finally {
      await iterator.end();
    }

    const list = [...chunks.values()];
    for (const summary of list) summary.subChunkIndices.sort((a, b) => a - b);
    list.sort((a, b) => a.z - b.z || a.x - b.x);

    const digests = new Map<string, string>();
    for (const [id, accumulator] of accumulators) digests.set(id, accumulator.toString('hex'));

    return {
      chunks: list,
      digests,
      subChunkRecords,
      subChunkBytes,
      scanMs: performance.now() - startedAt,
    };
  }

  /**
   * Lists every stored chunk of a dimension, memoised per world instance.
   */
  async listChunks(dimension: Dimension): Promise<ChunkSummary[]> {
    const cached = this.#chunkCache.get(dimension.id);
    if (cached) return cached;
    const { chunks } = await this.scan(dimension);
    this.#chunkCache.set(dimension.id, chunks);
    return chunks;
  }

  async readChunkVersion(dimension: Dimension, x: number, z: number): Promise<number | null> {
    for (const tag of [ChunkTag.ChunkVersion, ChunkTag.LegacyChunkVersion]) {
      const value = await this.#db.get(chunkKey(dimension, x, z, tag));
      if (value?.length) return value.readUInt8(0);
    }
    return null;
  }

  /** True when the chunk exists in the database. */
  async hasChunk(dimension: Dimension, x: number, z: number): Promise<boolean> {
    return (await this.readChunkVersion(dimension, x, z)) !== null;
  }

  async readSubChunk(
    dimension: Dimension,
    x: number,
    z: number,
    index: number,
  ): Promise<SubChunk | null> {
    const value = await this.#db.get(subChunkKey(dimension, x, z, index));
    if (!value?.length) return null;
    return decodeSubChunk(value, index);
  }

  /**
   * Reads every subchunk of a chunk, ordered from the top of the world down.
   *
   * Subchunks in a legacy (pre-palette) format are skipped and reported in
   * `skipped` rather than being guessed at.
   */
  async readChunkSubChunks(
    dimension: Dimension,
    x: number,
    z: number,
  ): Promise<{ subChunks: SubChunk[]; skipped: { index: number; version: number }[] }> {
    const subChunks: SubChunk[] = [];
    const skipped: { index: number; version: number }[] = [];
    for (let index = maxSubChunkIndex(dimension); index >= minSubChunkIndex(dimension); index--) {
      try {
        const subChunk = await this.readSubChunk(dimension, x, z, index);
        if (subChunk) subChunks.push(subChunk);
      } catch (error) {
        if (error instanceof LegacySubChunkError) skipped.push({ index, version: error.version });
        else throw error;
      }
    }
    return { subChunks, skipped };
  }
}

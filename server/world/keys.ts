/**
 * Bedrock LevelDB chunk keys and world/chunk coordinate conversions.
 *
 * A chunk key is:
 *   int32 LE chunk X
 *   int32 LE chunk Z
 *   int32 LE dimension index  (omitted entirely for the Overworld)
 *   uint8  record tag
 *   int8   subchunk index     (only for the SubChunkPrefix tag)
 *
 * so keys are 9, 10, 13 or 14 bytes long.
 */

import type { Dimension } from './dimensions.ts';

/** Record tags used by this project (`LevelChunkTag` in the Bedrock source). */
export const ChunkTag = {
  Data3D: 0x2b,
  ChunkVersion: 0x2c,
  Data2D: 0x2d,
  Data2DLegacy: 0x2e,
  SubChunkPrefix: 0x2f,
  LegacyTerrain: 0x30,
  BlockEntity: 0x31,
  FinalizedState: 0x36,
  LegacyChunkVersion: 0x76,
} as const;

export type ChunkTagValue = (typeof ChunkTag)[keyof typeof ChunkTag];

export const CHUNK_SIZE = 16;
export const SUBCHUNK_SIZE = 16;
export const BLOCKS_PER_SUBCHUNK = 4096;

export interface ChunkPos {
  x: number;
  z: number;
}

export interface ParsedChunkKey extends ChunkPos {
  dimensionIndex: number;
  tag: number;
  /** Present only for SubChunkPrefix records. Signed: -4 is the y=-64 subchunk. */
  subChunkIndex?: number;
}

function keyLength(dimensionIndex: number, hasSubChunk: boolean): number {
  return (dimensionIndex === 0 ? 9 : 13) + (hasSubChunk ? 1 : 0);
}

export function chunkKey(dimension: Dimension, x: number, z: number, tag: number): Buffer {
  const key = Buffer.allocUnsafe(keyLength(dimension.index, false));
  key.writeInt32LE(x, 0);
  key.writeInt32LE(z, 4);
  if (dimension.index === 0) {
    key.writeUInt8(tag, 8);
  } else {
    key.writeInt32LE(dimension.index, 8);
    key.writeUInt8(tag, 12);
  }
  return key;
}

export function subChunkKey(
  dimension: Dimension,
  x: number,
  z: number,
  subChunkIndex: number,
): Buffer {
  const key = Buffer.allocUnsafe(keyLength(dimension.index, true));
  key.writeInt32LE(x, 0);
  key.writeInt32LE(z, 4);
  const tagOffset = dimension.index === 0 ? 8 : 12;
  if (dimension.index !== 0) key.writeInt32LE(dimension.index, 8);
  key.writeUInt8(ChunkTag.SubChunkPrefix, tagOffset);
  key.writeInt8(subChunkIndex, tagOffset + 1);
  return key;
}

/**
 * Decodes a chunk key, or returns null when the key is not a chunk record
 * (the database also holds `level.dat`-style globals, actors, villages, ...).
 */
export function parseChunkKey(key: Buffer): ParsedChunkKey | null {
  const withDimension = key.length === 13 || key.length === 14;
  const withoutDimension = key.length === 9 || key.length === 10;
  if (!withDimension && !withoutDimension) return null;

  const tagOffset = withDimension ? 12 : 8;
  const tag = key.readUInt8(tagOffset);
  const hasSubChunkIndex = key.length === 10 || key.length === 14;
  // Only SubChunkPrefix records carry a trailing subchunk index; anything else
  // of this length is a different kind of key that happens to be 10/14 bytes.
  if (hasSubChunkIndex !== (tag === ChunkTag.SubChunkPrefix)) return null;

  const dimensionIndex = withDimension ? key.readInt32LE(8) : 0;
  if (dimensionIndex < 0 || dimensionIndex > 2) return null;

  return {
    x: key.readInt32LE(0),
    z: key.readInt32LE(4),
    dimensionIndex,
    tag,
    ...(hasSubChunkIndex ? { subChunkIndex: key.readInt8(tagOffset + 1) } : {}),
  };
}

/** World block X/Z -> containing chunk X/Z. */
export function blockToChunk(blockX: number, blockZ: number): ChunkPos {
  return { x: Math.floor(blockX / CHUNK_SIZE), z: Math.floor(blockZ / CHUNK_SIZE) };
}

/** Chunk X/Z -> world block X/Z of its north-west corner. */
export function chunkToBlock(chunkX: number, chunkZ: number): { x: number; z: number } {
  return { x: chunkX * CHUNK_SIZE, z: chunkZ * CHUNK_SIZE };
}

/** World block X/Z -> 0..15 offset inside its chunk (correct for negatives). */
export function blockOffsetInChunk(blockX: number, blockZ: number): { x: number; z: number } {
  return {
    x: ((blockX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    z: ((blockZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
  };
}

/** World Y -> subchunk index. */
export function blockYToSubChunkIndex(y: number): number {
  return Math.floor(y / SUBCHUNK_SIZE);
}

/**
 * Index of a block inside a subchunk's 4096-entry storage.
 * Bedrock packs blocks in x -> z -> y order, Y varying fastest.
 */
export function blockIndex(x: number, y: number, z: number): number {
  return (x << 8) | (z << 4) | y;
}

/** Index of a column inside a 16x16 per-chunk array. */
export function columnIndex(x: number, z: number): number {
  return (x << 4) | z;
}

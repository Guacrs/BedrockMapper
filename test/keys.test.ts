import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { END, NETHER, OVERWORLD, maxSubChunkIndex, minSubChunkIndex } from '../server/world/dimensions.ts';
import {
  ChunkTag,
  blockIndex,
  blockOffsetInChunk,
  blockToChunk,
  blockYToSubChunkIndex,
  chunkKey,
  chunkToBlock,
  columnIndex,
  parseChunkKey,
  subChunkKey,
} from '../server/world/keys.ts';

describe('chunk keys', () => {
  it('encodes an Overworld key without a dimension field', () => {
    const key = chunkKey(OVERWORLD, 3, -7, ChunkTag.ChunkVersion);
    assert.equal(key.length, 9);
    assert.equal(key.readInt32LE(0), 3);
    assert.equal(key.readInt32LE(4), -7);
    assert.equal(key.readUInt8(8), ChunkTag.ChunkVersion);
  });

  it('encodes other dimensions with a dimension field', () => {
    for (const dimension of [NETHER, END]) {
      const key = chunkKey(dimension, 1, 2, ChunkTag.Data3D);
      assert.equal(key.length, 13);
      assert.equal(key.readInt32LE(8), dimension.index);
      assert.equal(key.readUInt8(12), ChunkTag.Data3D);
    }
  });

  it('encodes signed subchunk indices', () => {
    const key = subChunkKey(OVERWORLD, 0, 0, -4);
    assert.equal(key.length, 10);
    assert.equal(key.readUInt8(8), ChunkTag.SubChunkPrefix);
    assert.equal(key.readInt8(9), -4);
    // The low subchunks of a 1.18+ world are stored as 0xFC..0xFF.
    assert.equal(key.readUInt8(9), 0xfc);
  });

  it('round-trips through parseChunkKey', () => {
    for (const dimension of [OVERWORLD, NETHER, END]) {
      for (const [x, z] of [
        [0, 0],
        [-1, -1],
        [50, -20],
        [-2_000_000, 2_000_000],
      ] as const) {
        const version = parseChunkKey(chunkKey(dimension, x, z, ChunkTag.ChunkVersion));
        assert.deepEqual(version, {
          x,
          z,
          dimensionIndex: dimension.index,
          tag: ChunkTag.ChunkVersion,
        });

        for (const index of [-4, 0, 19]) {
          const sub = parseChunkKey(subChunkKey(dimension, x, z, index));
          assert.deepEqual(sub, {
            x,
            z,
            dimensionIndex: dimension.index,
            tag: ChunkTag.SubChunkPrefix,
            subChunkIndex: index,
          });
        }
      }
    }
  });

  it('rejects keys that are not chunk records', () => {
    assert.equal(parseChunkKey(Buffer.from('AutonomousEntities')), null);
    assert.equal(parseChunkKey(Buffer.alloc(0)), null);
    // 10 bytes but not a SubChunkPrefix tag.
    const notSubChunk = Buffer.alloc(10);
    notSubChunk.writeUInt8(ChunkTag.Data3D, 8);
    assert.equal(parseChunkKey(notSubChunk), null);
    // 9 bytes with a SubChunkPrefix tag is missing its index.
    const missingIndex = Buffer.alloc(9);
    missingIndex.writeUInt8(ChunkTag.SubChunkPrefix, 8);
    assert.equal(parseChunkKey(missingIndex), null);
  });
});

describe('coordinate conversion', () => {
  it('maps block X/Z to chunk X/Z across the origin', () => {
    assert.deepEqual(blockToChunk(0, 0), { x: 0, z: 0 });
    assert.deepEqual(blockToChunk(15, 15), { x: 0, z: 0 });
    assert.deepEqual(blockToChunk(16, -1), { x: 1, z: -1 });
    assert.deepEqual(blockToChunk(-16, -17), { x: -1, z: -2 });
  });

  it('maps chunk X/Z back to the north-west block corner', () => {
    assert.deepEqual(chunkToBlock(0, 0), { x: 0, z: 0 });
    assert.deepEqual(chunkToBlock(-1, 2), { x: -16, z: 32 });
  });

  it('keeps in-chunk offsets in 0..15 for negative coordinates', () => {
    assert.deepEqual(blockOffsetInChunk(0, 0), { x: 0, z: 0 });
    assert.deepEqual(blockOffsetInChunk(-1, -16), { x: 15, z: 0 });
    assert.deepEqual(blockOffsetInChunk(-17, 33), { x: 15, z: 1 });
  });

  it('round-trips block -> chunk + offset -> block', () => {
    for (const [x, z] of [
      [0, 0],
      [-1, -1],
      [815, 335],
      [-16, 160],
      [-1234, 5678],
    ] as const) {
      const chunk = blockToChunk(x, z);
      const offset = blockOffsetInChunk(x, z);
      const origin = chunkToBlock(chunk.x, chunk.z);
      assert.equal(origin.x + offset.x, x);
      assert.equal(origin.z + offset.z, z);
    }
  });

  it('maps Y to subchunk indices, including below zero', () => {
    assert.equal(blockYToSubChunkIndex(0), 0);
    assert.equal(blockYToSubChunkIndex(15), 0);
    assert.equal(blockYToSubChunkIndex(16), 1);
    assert.equal(blockYToSubChunkIndex(-1), -1);
    assert.equal(blockYToSubChunkIndex(-64), -4);
    assert.equal(minSubChunkIndex(OVERWORLD), -4);
    assert.equal(maxSubChunkIndex(OVERWORLD), 19);
  });

  it('indexes subchunk storage in x -> z -> y order', () => {
    assert.equal(blockIndex(0, 0, 0), 0);
    assert.equal(blockIndex(0, 1, 0), 1);
    assert.equal(blockIndex(0, 0, 1), 16);
    assert.equal(blockIndex(1, 0, 0), 256);
    assert.equal(blockIndex(15, 15, 15), 4095);

    const seen = new Set<number>();
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) seen.add(blockIndex(x, y, z));
      }
    }
    assert.equal(seen.size, 4096);
  });

  it('indexes columns uniquely', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) seen.add(columnIndex(x, z));
    assert.equal(seen.size, 256);
    assert.equal(columnIndex(0, 0), 0);
    assert.equal(columnIndex(15, 15), 255);
  });
});

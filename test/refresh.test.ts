import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeRefresh, terrainPollInterval } from '../server/index.ts';
import type { RefreshStats } from '../server/map-service.ts';
import { chunkToTile, tilesAffectedByChunk } from '../server/tiles/coords.ts';
import { chunkId, diffChunkDigests, parseChunkId } from '../server/world/chunk-diff.ts';
import { boundsEqual, tileUrl, worldSummary } from '../web/terrain.js';

function digests(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

function stats(overrides: Partial<RefreshStats> = {}): RefreshStats {
  return {
    at: '2026-09-17T21:00:00.000Z',
    sourceChanged: true,
    snapshotCopied: true,
    snapshotMs: 12,
    scanMs: 30,
    chunksScanned: 1047,
    addedChunks: 0,
    changedChunks: 0,
    removedChunks: 0,
    chunksDecoded: 0,
    tilesInvalidated: 0,
    tilesRegenerated: 0,
    tilesChanged: 0,
    totalMs: 60,
    version: 1,
    error: null,
    ...overrides,
  };
}

describe('chunk ids', () => {
  it('round-trips negative coordinates', () => {
    for (const [x, z] of [[0, 0], [-1, 10], [18, -1], [-48, -3]] as const) {
      assert.deepEqual(parseChunkId(chunkId(x, z)), { x, z });
    }
  });
});

describe('changed chunk detection', () => {
  it('reports nothing for two identical scans', () => {
    const before = digests({ '0,0': 'a', '1,0': 'b' });
    const diff = diffChunkDigests(before, digests({ '0,0': 'a', '1,0': 'b' }));
    assert.deepEqual(diff, { added: [], changed: [], removed: [], all: [] });
  });

  it('separates new, changed and vanished block data', () => {
    const diff = diffChunkDigests(
      digests({ '0,0': 'a', '1,0': 'b', '-1,-1': 'c' }),
      digests({ '0,0': 'a', '1,0': 'CHANGED', '2,5': 'new' }),
    );
    assert.deepEqual(diff.added, [{ x: 2, z: 5 }]);
    assert.deepEqual(diff.changed, [{ x: 1, z: 0 }]);
    assert.deepEqual(diff.removed, [{ x: -1, z: -1 }]);
    assert.equal(diff.all.length, 3);
  });

  it('treats a chunk that gained block data as new', () => {
    // A chunk stored without any subchunk has no digest at all, so the first
    // subchunk to arrive looks exactly like a newly generated chunk.
    const diff = diffChunkDigests(digests({}), digests({ '7,7': 'a' }));
    assert.deepEqual(diff.added, [{ x: 7, z: 7 }]);
  });
});

describe('tiles affected by a chunk', () => {
  it('is just the chunk\'s own tile in the middle of a tile', () => {
    assert.deepEqual(tilesAffectedByChunk(5, 5), [{ x: 0, y: 0 }]);
    assert.deepEqual(tilesAffectedByChunk(-5, -5), [{ x: -1, y: -1 }]);
  });

  it('includes the tile east of a chunk on the eastern edge', () => {
    // Chunk 15 is the last chunk of tile 0; the first column of tile 1 shades
    // against it.
    assert.deepEqual(tilesAffectedByChunk(15, 5), [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('includes the tile south of a chunk on the southern edge', () => {
    assert.deepEqual(tilesAffectedByChunk(5, 15), [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('includes both neighbours at a tile corner, but not the diagonal', () => {
    // Shading looks north and west only, so the tile diagonally opposite never
    // reads this chunk.
    assert.deepEqual(tilesAffectedByChunk(15, 15), [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    assert.deepEqual(tilesAffectedByChunk(-1, -1), [
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ]);
  });

  it('always contains the tile the chunk is drawn into', () => {
    for (const [x, z] of [[0, 0], [15, 0], [16, 31], [-1, 10], [-16, -16], [50, 21]] as const) {
      const own = chunkToTile(x, z);
      assert.ok(
        tilesAffectedByChunk(x, z).some((tile) => tile.x === own.x && tile.y === own.y),
        `chunk ${x},${z} should invalidate its own tile`,
      );
    }
  });
});

describe('terrain poll interval', () => {
  it('is half the refresh interval, within sane limits', () => {
    assert.equal(terrainPollInterval(30000), 15000);
    assert.equal(terrainPollInterval(1000), 2000);
    assert.equal(terrainPollInterval(600000), 30000);
  });

  it('is zero when automatic refreshing is switched off', () => {
    assert.equal(terrainPollInterval(0), 0);
  });
});

describe('refresh log line', () => {
  it('says nothing when the world did not change', () => {
    assert.equal(describeRefresh(stats({ sourceChanged: false })), null);
  });

  it('reports a changed world with no changed chunk separately', () => {
    const line = describeRefresh(stats({ sourceChanged: true }))!;
    assert.match(line, /no chunk did/);
  });

  it('summarises chunk and tile counts', () => {
    const line = describeRefresh(
      stats({
        addedChunks: 4,
        changedChunks: 2,
        tilesInvalidated: 3,
        tilesRegenerated: 3,
        tilesChanged: 2,
        version: 7,
      }),
    )!;
    assert.match(line, /6 chunks \(4 new, 2 changed, 0 gone\)/);
    assert.match(line, /3 tiles invalidated, 3 redrawn, 2 of them different/);
    assert.match(line, /map version 7/);
  });

  it('reports a failure as a failure', () => {
    const line = describeRefresh(stats({ error: 'snapshot failed, keeping the previous one: boom' }))!;
    assert.match(line, /^terrain refresh failed/);
  });
});

describe('browser terrain layer helpers', () => {
  it('puts the map version in the tile URL', () => {
    assert.equal(tileUrl('overworld', 1), '/tiles/overworld/{z}/{x}/{y}.png?v=1');
    assert.equal(tileUrl('overworld', 42), '/tiles/overworld/{z}/{x}/{y}.png?v=42');
  });

  it('compares bounds, including the null cases', () => {
    const bounds = { minX: -48, maxX: 815, minZ: -48, maxZ: 351 };
    assert.ok(boundsEqual(bounds, { ...bounds }));
    assert.ok(boundsEqual(null, null));
    assert.ok(!boundsEqual(bounds, { ...bounds, maxX: 1071 }));
    assert.ok(!boundsEqual(bounds, null));
    assert.ok(!boundsEqual(null, bounds));
  });

  it('summarises the world for the status bar', () => {
    assert.equal(
      worldSummary(
        { name: 'Bedrock level', version: '1.26.51.1.0' },
        { chunkCount: 1047, blockBounds: { minX: -48, maxX: 815, minZ: -48, maxZ: 351 } },
      ),
      'Bedrock level (1.26.51.1.0) - 1047 chunks - X -48..815, Z -48..351',
    );
    assert.equal(worldSummary({ name: '', version: null }, { chunkCount: 0, blockBounds: null }), 'world - 0 chunks');
  });
});

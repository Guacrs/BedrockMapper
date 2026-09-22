/**
 * Chunk streamer retry cooldown — missing chunks must be re-requested later,
 * not permanently blacklisted.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHUNK_ERROR_RETRY_MS,
  CHUNK_UNAVAILABLE_RETRY_MS,
  ChunkStreamer,
} from '../web/viewer3d/chunk-streamer.js';

describe('ChunkStreamer retry cooldown', () => {
  it('retries a 404/empty chunk after the unavailable cooldown', async () => {
    let now = 1_000_000;
    /** @type {number[]} */
    const attempts = [];
    const streamer = new ChunkStreamer({
      now: () => now,
      viewDistance: 0,
      unloadDistance: 1,
      unavailableRetryMs: 1_000,
      errorRetryMs: 500,
      loadChunk: async (cx, cz) => {
        attempts.push(now);
        assert.equal(cx, 0);
        assert.equal(cz, 0);
        // First pass: unavailable; later: loaded.
        return attempts.length >= 2 ? true : false;
      },
      unloadChunk: () => {},
    });

    await streamer.update({ x: 0, y: 64, z: 0 });
    assert.equal(attempts.length, 1);
    assert.equal(streamer.loadedChunks.has('0,0'), false);

    // Still inside cooldown — no second request.
    now += 500;
    await streamer.update({ x: 0, y: 64, z: 0 });
    assert.equal(attempts.length, 1);

    // After cooldown, retry and load.
    now += 600;
    await streamer.update({ x: 0, y: 64, z: 0 });
    assert.equal(attempts.length, 2);
    assert.equal(streamer.loadedChunks.has('0,0'), true);

    streamer.dispose();
  });

  it('retries after a thrown load error using the error cooldown', async () => {
    let now = 5_000_000;
    let attempts = 0;
    const streamer = new ChunkStreamer({
      now: () => now,
      viewDistance: 0,
      unloadDistance: 1,
      unavailableRetryMs: CHUNK_UNAVAILABLE_RETRY_MS,
      errorRetryMs: 200,
      loadChunk: async () => {
        attempts++;
        if (attempts === 1) throw new Error('network down');
        return true;
      },
      unloadChunk: () => {},
    });

    await streamer.update({ x: 8, y: 64, z: 8 });
    assert.equal(attempts, 1);
    assert.equal(streamer.loadedChunks.size, 0);

    now += 100;
    await streamer.update({ x: 8, y: 64, z: 8 });
    assert.equal(attempts, 1);

    now += 150;
    await streamer.update({ x: 8, y: 64, z: 8 });
    assert.equal(attempts, 2);
    assert.equal(streamer.loadedChunks.has('0,0'), true);

    assert.ok(CHUNK_ERROR_RETRY_MS > 0);

    streamer.dispose();
  });
});

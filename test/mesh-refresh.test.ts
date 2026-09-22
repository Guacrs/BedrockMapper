/**
 * Live-refresh guards for the experimental 3D viewer:
 * - mesh-epoch rejects in-flight responses after meshVersion bumps
 * - ChunkStreamer must not mark a chunk loaded when load returns "stale"
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChunkStreamer } from '../web/viewer3d/chunk-streamer.js';
import { isMeshResponseCurrent } from '../web/viewer3d/mesh-epoch.js';

describe('mesh response epoch', () => {
  it('accepts a response from the current epoch', () => {
    assert.equal(isMeshResponseCurrent(3, 3, false), true);
  });

  it('rejects a response after meshVersion / epoch advances', () => {
    assert.equal(isMeshResponseCurrent(3, 4, false), false);
  });

  it('rejects a response when the viewer is disposed', () => {
    assert.equal(isMeshResponseCurrent(3, 3, true), false);
  });
});

describe('ChunkStreamer stale load handling', () => {
  it('does not mark a chunk loaded when loadChunk returns stale', async () => {
    /** @type {(value: unknown) => void} */
    let resolveLoad;
    const streamer = new ChunkStreamer({
      viewDistance: 0,
      unloadDistance: 1,
      loadChunk: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      unloadChunk: () => {},
    });

    const pending = streamer.update({ x: 0, y: 64, z: 0 });
    // Simulate meshVersion bump mid-flight: forget bookkeeping, then the old
    // fetch resolves as stale (viewer epoch mismatch).
    streamer.forgetLoaded();
    resolveLoad!('stale');
    await pending;

    assert.equal(streamer.loadedChunks.has('0,0'), false);
    assert.equal(streamer.loadingChunks.size, 0);

    streamer.dispose();
  });

  it('reloads after a stale result once forgetLoaded allows another update', async () => {
    let attempts = 0;
    /** @type {(value: unknown) => void} */
    let resolveFirst;
    const streamer = new ChunkStreamer({
      viewDistance: 0,
      unloadDistance: 1,
      loadChunk: () => {
        attempts++;
        if (attempts === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(true);
      },
      unloadChunk: () => {},
    });

    const first = streamer.update({ x: 0, y: 64, z: 0 });
    streamer.forgetLoaded();
    resolveFirst!('stale');
    await first;
    assert.equal(streamer.loadedChunks.size, 0);

    await streamer.update({ x: 0, y: 64, z: 0 });
    assert.equal(attempts, 2);
    assert.equal(streamer.loadedChunks.has('0,0'), true);

    streamer.dispose();
  });
});

/**
 * Camera-centred chunk streaming for the experimental 3D terrain viewer.
 *
 * Loads meshes inside VIEW_DISTANCE_CHUNKS and unloads outside UNLOAD_DISTANCE
 * so load/unload does not thrash at the boundary. Duplicate requests are
 * coalesced via loadingChunks.
 *
 * Missing or failed chunks use a short retry cooldown rather than a permanent
 * blacklist, so newly generated world chunks and transient HTTP errors can
 * appear on a later pass.
 */

import { blockToChunk, chunkKey } from './coords3d.js';

/** How many chunks away from the camera to keep loaded (radius). */
export const VIEW_DISTANCE_CHUNKS = 4;

/** Unload only beyond this radius (must be > VIEW_DISTANCE_CHUNKS). */
export const UNLOAD_DISTANCE_CHUNKS = 6;

/** Debounce camera-driven streaming updates (ms). */
export const STREAM_UPDATE_MS = 200;

/** Wait before re-requesting a chunk that returned 204 / empty mesh. */
export const CHUNK_UNAVAILABLE_RETRY_MS = 10_000;

/** Wait before re-requesting a chunk after a network / HTTP error. */
export const CHUNK_ERROR_RETRY_MS = 5_000;

/**
 * @param {number} centerChunkX
 * @param {number} centerChunkZ
 * @param {number} radius
 * @returns {{ chunkX: number, chunkZ: number }[]}
 */
export function chunksInRadius(centerChunkX, centerChunkZ, radius) {
  const list = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      list.push({ chunkX: centerChunkX + dx, chunkZ: centerChunkZ + dz });
    }
  }
  return list;
}

/**
 * @param {{ x: number, y: number, z: number }} position Minecraft/Three position
 * @returns {{ chunkX: number, chunkZ: number }}
 */
export function chunkAtPosition(position) {
  return blockToChunk(position.x, position.z);
}

/**
 * Manages which chunk meshes are in the scene.
 */
export class ChunkStreamer {
  /**
   * @param {{
   *   loadChunk: (chunkX: number, chunkZ: number) => Promise<unknown>,
   *   unloadChunk: (chunkX: number, chunkZ: number) => void,
   *   viewDistance?: number,
   *   unloadDistance?: number,
   *   unavailableRetryMs?: number,
   *   errorRetryMs?: number,
   *   now?: () => number,
   * }} options
   */
  constructor(options) {
    this._loadChunk = options.loadChunk;
    this._unloadChunk = options.unloadChunk;
    this._viewDistance = options.viewDistance ?? VIEW_DISTANCE_CHUNKS;
    this._unloadDistance = options.unloadDistance ?? UNLOAD_DISTANCE_CHUNKS;
    this._unavailableRetryMs = options.unavailableRetryMs ?? CHUNK_UNAVAILABLE_RETRY_MS;
    this._errorRetryMs = options.errorRetryMs ?? CHUNK_ERROR_RETRY_MS;
    this._now = options.now ?? (() => Date.now());
    /** @type {Set<string>} */
    this.loadedChunks = new Set();
    /** @type {Map<string, Promise<unknown>>} */
    this.loadingChunks = new Map();
    /** @type {Map<string, number>} chunk key -> earliest next attempt (epoch ms) */
    this._retryAfter = new Map();
    this._timer = 0;
    this._lastCenter = null;
  }

  /**
   * @param {{ x: number, y: number, z: number }} focusPosition
   */
  scheduleUpdate(focusPosition) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = window.setTimeout(() => {
      this._timer = 0;
      void this.update(focusPosition);
    }, STREAM_UPDATE_MS);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  _isCoolingDown(key) {
    const until = this._retryAfter.get(key);
    if (until === undefined) return false;
    if (until > this._now()) return true;
    this._retryAfter.delete(key);
    return false;
  }

  /**
   * @param {string} key
   * @param {number} delayMs
   */
  _scheduleRetry(key, delayMs) {
    this._retryAfter.set(key, this._now() + delayMs);
  }

  /**
   * @param {{ x: number, y: number, z: number }} focusPosition
   */
  async update(focusPosition) {
    const { chunkX, chunkZ } = chunkAtPosition(focusPosition);
    this._lastCenter = { chunkX, chunkZ };

    const wanted = new Set(
      chunksInRadius(chunkX, chunkZ, this._viewDistance).map((c) => chunkKey(c.chunkX, c.chunkZ)),
    );

    for (const key of [...this.loadedChunks]) {
      const [cx, cz] = key.split(',').map(Number);
      const dist = Math.max(Math.abs(cx - chunkX), Math.abs(cz - chunkZ));
      if (dist > this._unloadDistance) {
        this._unloadChunk(cx, cz);
        this.loadedChunks.delete(key);
      }
    }

    // Drop cooldown entries for chunks that are no longer in view.
    for (const key of [...this._retryAfter.keys()]) {
      if (!wanted.has(key)) this._retryAfter.delete(key);
    }

    const loads = [];
    for (const key of wanted) {
      if (this.loadedChunks.has(key) || this.loadingChunks.has(key) || this._isCoolingDown(key)) {
        continue;
      }
      const [cx, cz] = key.split(',').map(Number);
      const work = this._loadChunk(cx, cz)
        .then((result) => {
          if (result === 'stale') return result;
          if (result !== false) {
            this.loadedChunks.add(key);
            this._retryAfter.delete(key);
            return result;
          }
          // 204 / empty mesh — try again later (chunk may appear after a save).
          this._scheduleRetry(key, this._unavailableRetryMs);
          return false;
        })
        .catch((error) => {
          console.warn('[3d] chunk load failed', key, error);
          this._scheduleRetry(key, this._errorRetryMs);
          return false;
        })
        .finally(() => {
          this.loadingChunks.delete(key);
        });
      this.loadingChunks.set(key, work);
      loads.push(work);
    }
    await Promise.all(loads);
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    for (const key of [...this.loadedChunks]) {
      const [cx, cz] = key.split(',').map(Number);
      this._unloadChunk(cx, cz);
    }
    this.loadedChunks.clear();
    this.loadingChunks.clear();
    this._retryAfter.clear();
  }

  /**
   * Forget which chunks are considered loaded so the next `update()` will
   * request them again. Does not unload Three.js objects — the viewer does that.
   */
  forgetLoaded() {
    this.loadedChunks.clear();
    this._retryAfter.clear();
  }
}

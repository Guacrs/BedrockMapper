/**
 * Terrain tiles that keep up with a running server.
 *
 * The map server bumps a version number whenever chunks change. That version is
 * a query parameter on every tile URL, so changing it is all it takes to make
 * the browser (and any cache in between) fetch the redrawn tiles - no page
 * reload, no WebSocket, and unchanged tiles keep being served from cache while
 * the map is idle.
 */

import { blockToLatLng } from './coords.js';

/**
 * @typedef {object} Bounds
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 */

/**
 * @typedef {object} MapState
 * @property {number} version
 * @property {string | null} terrainUpdatedAt
 * @property {number} chunkCount
 * @property {Bounds | null} chunkBounds
 * @property {Bounds | null} blockBounds
 */

/**
 * @param {string} dimension
 * @param {number} version
 * @returns {string}
 */
export function tileUrl(dimension, version) {
  return `/tiles/${dimension}/{z}/{x}/{y}.png?v=${version}`;
}

/**
 * @param {Bounds | null | undefined} a
 * @param {Bounds | null | undefined} b
 * @returns {boolean}
 */
export function boundsEqual(a, b) {
  if (!a || !b) return !a && !b;
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}

/**
 * The world line in the status bar: name, version, chunk count and extent.
 *
 * @param {{ name?: string, version?: string | null }} world
 * @param {{ chunkCount?: number, blockBounds?: Bounds | null }} state
 * @returns {string}
 */
export function worldSummary(world, state) {
  const version = world.version ? ` (${world.version})` : '';
  const bounds = state.blockBounds;
  const extent = bounds ? ` - X ${bounds.minX}..${bounds.maxX}, Z ${bounds.minZ}..${bounds.maxZ}` : '';
  return `${world.name || 'world'}${version} - ${state.chunkCount ?? 0} chunks${extent}`;
}

/**
 * The Leaflet tile layer plus the version bookkeeping.
 *
 * `update()` is given whatever GET /api/map/state last returned and only touches
 * Leaflet when the version actually moved, so polling an idle server costs one
 * small request and nothing else.
 */
export class TerrainLayer {
  #map;
  #dimension;
  #layer;
  #version;
  #blockBounds;

  /**
   * @param {any} map Leaflet map
   * @param {any} info GET /api/map/info
   */
  constructor(map, info) {
    this.#map = map;
    this.#dimension = info.dimension;
    this.#version = info.version ?? 1;
    this.#blockBounds = info.blockBounds ?? null;
    const bounds = this.#latLngBounds();
    this.#layer = L.tileLayer(tileUrl(this.#dimension, this.#version), {
      tileSize: info.tileSize,
      // The server renders one zoom level; Leaflet scales it for the others.
      minNativeZoom: info.nativeZoom,
      maxNativeZoom: info.nativeZoom,
      noWrap: true,
      keepBuffer: 2,
      ...(bounds ? { bounds } : {}),
    }).addTo(map);
  }

  get version() {
    return this.#version;
  }

  get layer() {
    return this.#layer;
  }

  get latLngBounds() {
    return this.#latLngBounds();
  }

  #latLngBounds() {
    const bounds = this.#blockBounds;
    if (!bounds) return null;
    // Bounds are inclusive block coordinates; the layer needs the outer corner.
    return L.latLngBounds(
      blockToLatLng(bounds.minX, bounds.minZ),
      blockToLatLng(bounds.maxX + 1, bounds.maxZ + 1),
    );
  }

  /**
   * @param {MapState} state GET /api/map/state
   * @returns {boolean} true when the tiles were reloaded
   */
  update(state) {
    if (!state || state.version === this.#version) return false;
    this.#version = state.version;

    // A new area of the world can extend the map, so the layer's bounds have to
    // grow before Leaflet decides which tiles are worth requesting.
    if (!boundsEqual(this.#blockBounds, state.blockBounds)) {
      this.#blockBounds = state.blockBounds ?? null;
      const bounds = this.#latLngBounds();
      if (bounds) this.#layer.options.bounds = bounds;
    }

    this.#layer.setUrl(tileUrl(this.#dimension, this.#version));
    return true;
  }
}

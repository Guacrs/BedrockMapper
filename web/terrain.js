/**
 * Terrain tiles that keep up with a running server.
 *
 * The map server bumps a version number whenever chunks change. That version is
 * a query parameter on every tile URL, so changing it is all it takes to make
 * the browser (and any cache in between) fetch the redrawn tiles - no page
 * reload, no WebSocket, and unchanged tiles keep being served from cache while
 * the map is idle.
 *
 * While the user is panning or zooming, Leaflet keeps the tiles already on
 * screen (scaled / soft while zooming) and only fetches fresh ones after the
 * view settles - the same idea as BlueMap showing lower detail until you stop
 * on an area.
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
 * Leaflet options for the terrain layer.
 *
 * The server only renders native zoom 0. Leaflet still has to be allowed to
 * stay on the map at every zoom the map itself offers: GridLayer's default
 * `minZoom` is 0, so without these the layer unloads every tile as soon as you
 * zoom out, even though `minNativeZoom` would otherwise scale the native tiles.
 *
 * `updateWhenIdle` / `updateWhenZooming: false` keep the current tiles on
 * screen while you drag or wheel-zoom, and only request new ones when the view
 * settles - far less thrash than loading on every pan frame.
 *
 * @param {{ tileSize: number, nativeZoom: number, minZoom: number, maxZoom: number }} info
 * @returns {Record<string, unknown>}
 */
export function tileLayerOptions(info) {
  return {
    tileSize: info.tileSize,
    minZoom: info.minZoom,
    maxZoom: info.maxZoom,
    minNativeZoom: info.nativeZoom,
    maxNativeZoom: info.nativeZoom,
    noWrap: true,
    keepBuffer: 2,
    updateWhenIdle: true,
    updateWhenZooming: false,
  };
}

/**
 * The Leaflet tile layer plus the version bookkeeping.
 *
 * `update()` is given whatever GET /api/map/state last returned and only touches
 * Leaflet when the version actually moved, so polling an idle server costs one
 * small request and nothing else. If the map is mid-pan or mid-zoom, the URL
 * bump waits until `moveend` / `zoomend` so a live refresh does not yank tiles
 * out from under the pointer.
 */
export class TerrainLayer {
  #map;
  #dimension;
  #layer;
  #version;
  #blockBounds;
  /** @type {MapState | null} */
  #pending = null;
  #busy = false;

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
      ...tileLayerOptions(info),
      ...(bounds ? { bounds } : {}),
    }).addTo(map);

    map.on('movestart zoomstart', () => {
      this.#busy = true;
    });
    map.on('moveend zoomend', () => {
      this.#busy = false;
      this.#flushPending();
    });
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
   * @returns {boolean} true when the tiles were reloaded (or queued to reload)
   */
  update(state) {
    if (!state || state.version === this.#version) return false;
    this.#pending = state;
    if (this.#busy) return true;
    return this.#flushPending();
  }

  /**
   * @returns {boolean}
   */
  #flushPending() {
    const state = this.#pending;
    if (!state || state.version === this.#version) {
      this.#pending = null;
      return false;
    }
    this.#pending = null;
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

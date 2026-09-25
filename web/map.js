/**
 * Minimal Leaflet map over Bedrock terrain tiles, with live player markers.
 *
 * Coordinates: Minecraft blocks are the authoritative system. Leaflet is put
 * into a simple pixel CRS where one unit at zoom 0 is one block, and the axes
 * are mapped straight onto Minecraft's:
 *
 *   Leaflet lng = block X
 *   Leaflet lat = block Z      (north up, +Z down, no axis flip)
 *   tile x      = floor(block X / tileSize)
 *   tile y      = floor(block Z / tileSize)
 *
 * L.CRS.Simple would flip the vertical axis (lat = -y), so the transformation
 * is replaced with an identity one to keep lat pointing the same way as Z.
 * Negative coordinates need no special handling: floor division is used
 * everywhere, on the server and here.
 *
 * An experimental 3D surface viewer (Three.js) shares the same page via the
 * 2D / 3D toggle; Leaflet is never replaced.
 */

import { blockToLatLng, latLngToBlock } from './coords.js';
import { MarkerLayer, getStoredMarkerKey, promptForMarkerKey, setStoredMarkerKey } from './markers.js';
import { PlayerLayer, playerStatus } from './players.js';
import { terrainStatus, trackingStatus } from './status.js';
import { TerrainLayer, worldSummary } from './terrain.js';

/** Bump when shipping client fixes that must beat sticky browser/CDN caches. */
const ASSET_VERSION = '20260925a';

const MinecraftCRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
});

const worldLabel = document.getElementById('world');
const cursorLabel = document.getElementById('cursor');
const viewLabel = document.getElementById('view');
const playersLabel = document.getElementById('players');
const terrainStatusLabel = document.getElementById('terrain-status');
const playerStatusLabel = document.getElementById('player-status');
const mapEl = document.getElementById('map');
const view3dEl = document.getElementById('view3d');
const mode2dBtn = document.getElementById('mode-2d');
const mode3dBtn = document.getElementById('mode-3d');

async function main() {
  const info = await fetch('/api/map/info').then((response) => response.json());
  const debug3d = new URLSearchParams(window.location.search).has('debug3d');

  const map = L.map('map', {
    crs: MinecraftCRS,
    minZoom: info.minZoom,
    maxZoom: info.maxZoom,
    zoomControl: true,
    attributionControl: false,
    // SVG is more reliable than Canvas on iOS Safari for circle markers /
    // popups. Terrain tiles are still <img>, so this does not affect them.
    preferCanvas: false,
  });

  // iOS Safari often lays out the map before the visual viewport settles
  // (address bar / safe areas). invalidateSize fixes blank tiles — but must
  // be debounced and size-gated: calling it on every visualViewport resize can
  // recurse and crash the Safari tab ("A problem repeatedly occurred").
  // Gate on the container's real DOM size, not map.getSize(): Leaflet caches
  // getSize(), so a visualViewport-only change can look "unchanged" and skip
  // the invalidate that would clear the stale cache.
  let lastMapSize = { w: 0, h: 0 };
  let sizeRefreshTimer = 0;
  const refreshMapSize = () => {
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === lastMapSize.w && height === lastMapSize.h && lastMapSize.w !== 0) return;
    lastMapSize = { w: width, h: height };
    map.invalidateSize({ pan: false, debounceMoveend: true });
  };
  const scheduleMapSizeRefresh = () => {
    if (sizeRefreshTimer) clearTimeout(sizeRefreshTimer);
    sizeRefreshTimer = window.setTimeout(() => {
      sizeRefreshTimer = 0;
      refreshMapSize();
    }, 150);
  };
  requestAnimationFrame(() => {
    refreshMapSize();
    scheduleMapSizeRefresh();
  });
  window.addEventListener('orientationchange', scheduleMapSizeRefresh);
  // Prefer visualViewport on iOS when present; otherwise window resize.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleMapSizeRefresh);
  } else {
    window.addEventListener('resize', scheduleMapSizeRefresh);
  }

  const terrain = new TerrainLayer(map, info);

  // Prefer the world centre at native zoom over fitBounds(entire extent).
  // fitBounds on a large world (tens of thousands of chunks) requests hundreds
  // of cold tiles at once and can OOM the Node map server.
  if (info.center) {
    map.setView(blockToLatLng(info.center.x, info.center.z), 0);
  } else if (terrain.latLngBounds) {
    map.fitBounds(terrain.latLngBounds);
  } else {
    map.setView(blockToLatLng(0, 0), 0);
  }

  worldLabel.textContent = worldSummary(info.world, info);

  /** @type {import('./viewer3d/viewer.js').TerrainViewer3D | null} */
  let viewer3d = null;
  let viewMode = '2d';
  let switching = false;

  async function setViewMode(mode) {
    if (mode !== '2d' && mode !== '3d') return;
    if (switching) return;
    switching = true;
    try {
      viewMode = mode;
      const is3d = mode === '3d';

      if (mapEl) mapEl.hidden = is3d;
      if (view3dEl) view3dEl.hidden = !is3d;
      mode2dBtn?.classList.toggle('active', !is3d);
      mode3dBtn?.classList.toggle('active', is3d);
      mode2dBtn?.setAttribute('aria-pressed', String(!is3d));
      mode3dBtn?.setAttribute('aria-pressed', String(is3d));

      if (is3d) {
        // Use the current 2D viewport, not map-info centre. info.center is only
        // the midpoint of chunkBounds and can sit in an empty hole on sparse
        // worlds — which produced walls of empty /api/mesh responses and a blank 3D view.
        const viewCenter = latLngToBlock(map.getCenter());
        if (!viewer3d && view3dEl) {
          const { TerrainViewer3D } = await import(`./viewer3d/viewer.js?v=${ASSET_VERSION}`);
          viewer3d = new TerrainViewer3D(view3dEl, {
            dimension: info.dimension,
            center: { x: viewCenter.x, z: viewCenter.z },
            debug: debug3d,
            meshVersion: info.meshVersion ?? 1,
            textureAtlas: Boolean(info.textureAtlas),
          });
          viewer3d.start();
          window.__viewer3d = viewer3d;
        } else {
          viewer3d?.resume();
          viewer3d?.resize();
          viewer3d?.focusXZ(viewCenter.x, viewCenter.z);
        }
      } else {
        viewer3d?.pause();
        scheduleMapSizeRefresh();
      }
    } finally {
      switching = false;
    }
  }

  mode2dBtn?.addEventListener('click', () => {
    void setViewMode('2d');
  });
  mode3dBtn?.addEventListener('click', () => {
    void setViewMode('3d');
  });

  function paintStatus(line, element) {
    if (!element) return;
    element.textContent = line.text;
    element.className = line.kind;
  }

  let lastTerrainState = {
    terrainUpdatedAt: info.terrainUpdatedAt ?? null,
    lastWorldRefresh: null,
    lastRefresh: null,
    refreshError: null,
    consecutiveRefreshFailures: 0,
  };
  let lastMeshVersion = info.meshVersion ?? 1;
  let lastPlayerSnapshot = null;
  let terrainUnreachable = false;
  let tileErrors = 0;

  function refreshStatus() {
    paintStatus(terrainStatus(lastTerrainState, { unreachable: terrainUnreachable, tileErrors }), terrainStatusLabel);
    paintStatus(trackingStatus(lastPlayerSnapshot), playerStatusLabel);
  }

  refreshStatus();

  terrain.layer.on('tileerror', () => {
    tileErrors++;
    refreshStatus();
  });
  terrain.layer.on('tileload', () => {
    if (!tileErrors) return;
    tileErrors = 0;
    refreshStatus();
  });

  map.on('mousemove', (event) => {
    const { x, z } = latLngToBlock(event.latlng);
    cursorLabel.textContent = `cursor X ${x}, Z ${z}`;
  });
  map.on('mouseout', () => {
    cursorLabel.textContent = 'cursor X -, Z -';
  });

  const updateView = () => {
    const centre = latLngToBlock(map.getCenter());
    const visible = map.getBounds();
    const west = Math.floor(visible.getWest());
    const east = Math.ceil(visible.getEast());
    const north = Math.floor(visible.getSouthWest().lat);
    const south = Math.ceil(visible.getNorthEast().lat);
    viewLabel.textContent =
      `centre X ${centre.x}, Z ${centre.z} | visible X ${west}..${east}, Z ${north}..${south} | zoom ${map.getZoom()}`;
  };
  map.on('move zoom', updateView);
  updateView();

  // Terrain: ask whether the world changed and, when it has, reload the tiles
  // that changed by bumping the version in their URLs. The map keeps its view.
  async function pollTerrain() {
    try {
      const state = await fetch('/api/map/state').then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
      terrainUnreachable = false;
      if (tileErrors) tileErrors = 0;
      lastTerrainState = state;
      if (terrain.update(state)) worldLabel.textContent = worldSummary(info.world, state);
      if (
        viewer3d &&
        typeof state.meshVersion === 'number' &&
        state.meshVersion !== lastMeshVersion
      ) {
        lastMeshVersion = state.meshVersion;
        viewer3d.reloadMeshes(state.meshVersion);
      }
      refreshStatus();
      return state;
    } catch (error) {
      terrainUnreachable = true;
      refreshStatus();
      console.error('terrain poll failed:', error);
      return null;
    }
  }

  const terrainInterval = info.terrainPollInterval ?? 0;
  if (terrainInterval > 0) setInterval(pollTerrain, terrainInterval);

  // Shared POI markers (persistent). Independent of live player markers.
  const markerLayer = new MarkerLayer(map);
  try {
    await markerLayer.reload();
  } catch (error) {
    console.error('marker load failed:', error);
  }

  const markerEditButton = document.getElementById('marker-edit');
  function paintMarkerEditState() {
    if (!markerEditButton) return;
    const unlocked = Boolean(getStoredMarkerKey());
    markerEditButton.textContent = unlocked ? 'Marker edit: on' : 'Edit markers';
    markerEditButton.classList.toggle('active', unlocked);
    markerEditButton.title = unlocked
      ? 'Marker editing unlocked for this tab. Right-click the map to add a marker. Click to lock again.'
      : 'Unlock marker editing with MARKER_API_KEY (session only).';
  }
  paintMarkerEditState();
  markerEditButton?.addEventListener('click', () => {
    if (getStoredMarkerKey()) {
      setStoredMarkerKey('');
      paintMarkerEditState();
      markerLayer.reload().catch(() => {});
      return;
    }
    if (promptForMarkerKey()) {
      paintMarkerEditState();
      markerLayer.reload().catch(() => {});
      alert('Marker editing unlocked for this tab. Right-click the map to add a marker.');
    } else {
      paintMarkerEditState();
    }
  });

  // Players: poll the latest positions and reconcile the markers. Polling is
  // enough for a marker every few seconds, so there is no WebSocket.
  const playerLayer = new PlayerLayer(map, info.dimension);
  const pollInterval = info.playerPollInterval ?? 3000;

  async function pollPlayers() {
    try {
      const snapshot = await fetch('/api/players').then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
      lastPlayerSnapshot = snapshot;
      playerLayer.update(snapshot);
      playersLabel.textContent = playerStatus(snapshot, info.dimension);
      refreshStatus();
    } catch (error) {
      lastPlayerSnapshot = null;
      playerLayer.update(null);
      playersLabel.textContent = 'player data unavailable';
      refreshStatus();
      console.error('player poll failed:', error);
    }
  }

  // Exposed for debugging and for the browser coordinate tests.
  window.__map = map;
  window.__players = playerLayer;
  window.__markers = markerLayer;
  window.__setMapMarkerKey = (key) => {
    setStoredMarkerKey(key ?? '');
    paintMarkerEditState();
    return getStoredMarkerKey();
  };
  window.__pollPlayers = pollPlayers;
  window.__terrain = terrain;
  window.__pollTerrain = pollTerrain;
  window.__setViewMode = setViewMode;
  window.__status = () => ({
    terrain: terrainStatusLabel?.textContent ?? '',
    players: playerStatusLabel?.textContent ?? '',
    viewMode,
  });

  await pollPlayers();
  setInterval(pollPlayers, pollInterval);
}

main().catch((error) => {
  worldLabel.textContent = `failed to load map: ${error.message}`;
  if (terrainStatusLabel) {
    terrainStatusLabel.textContent = 'Terrain: map server unreachable';
    terrainStatusLabel.className = 'error';
  }
  console.error(error);
});

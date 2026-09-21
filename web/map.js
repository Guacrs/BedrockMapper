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
 */

import { blockToLatLng, latLngToBlock } from './coords.js';
import { MarkerLayer, getStoredMarkerKey, promptForMarkerKey, setStoredMarkerKey } from './markers.js';
import { PlayerLayer, playerStatus } from './players.js';
import { terrainStatus, trackingStatus } from './status.js';
import { TerrainLayer, worldSummary } from './terrain.js';

const MinecraftCRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
});

const worldLabel = document.getElementById('world');
const cursorLabel = document.getElementById('cursor');
const viewLabel = document.getElementById('view');
const playersLabel = document.getElementById('players');
const terrainStatusLabel = document.getElementById('terrain-status');
const playerStatusLabel = document.getElementById('player-status');

async function main() {
  const info = await fetch('/api/map/info').then((response) => response.json());

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

  // iOS Safari often lays out the map pane before the visual viewport settles
  // (address bar, safe areas). Without invalidateSize, tiles stay blank.
  const refreshMapSize = () => {
    map.invalidateSize({ pan: false });
  };
  requestAnimationFrame(() => {
    refreshMapSize();
    setTimeout(refreshMapSize, 250);
  });
  window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 300));
  window.addEventListener('resize', refreshMapSize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', refreshMapSize);
  }

  const terrain = new TerrainLayer(map, info);

  if (terrain.latLngBounds) {
    map.fitBounds(terrain.latLngBounds);
  } else {
    map.setView(blockToLatLng(0, 0), 0);
  }

  worldLabel.textContent = worldSummary(info.world, info);

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
  window.__status = () => ({
    terrain: terrainStatusLabel?.textContent ?? '',
    players: playerStatusLabel?.textContent ?? '',
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

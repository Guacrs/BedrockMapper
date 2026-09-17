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
import { PlayerLayer, playerStatus } from './players.js';
import { TerrainLayer, worldSummary } from './terrain.js';

const MinecraftCRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
});

const worldLabel = document.getElementById('world');
const cursorLabel = document.getElementById('cursor');
const viewLabel = document.getElementById('view');
const playersLabel = document.getElementById('players');

async function main() {
  const info = await fetch('/api/map/info').then((response) => response.json());

  const map = L.map('map', {
    crs: MinecraftCRS,
    minZoom: info.minZoom,
    maxZoom: info.maxZoom,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
  });

  const terrain = new TerrainLayer(map, info);

  if (terrain.latLngBounds) {
    map.fitBounds(terrain.latLngBounds);
  } else {
    map.setView(blockToLatLng(0, 0), 0);
  }

  worldLabel.textContent = worldSummary(info.world, info);

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
      const state = await fetch('/api/map/state').then((response) => response.json());
      if (terrain.update(state)) worldLabel.textContent = worldSummary(info.world, state);
      return state;
    } catch (error) {
      console.error('terrain poll failed:', error);
      return null;
    }
  }

  const terrainInterval = info.terrainPollInterval ?? 0;
  if (terrainInterval > 0) setInterval(pollTerrain, terrainInterval);

  // Players: poll the latest positions and reconcile the markers. Polling is
  // enough for a marker every few seconds, so there is no WebSocket.
  const playerLayer = new PlayerLayer(map, info.dimension);
  const pollInterval = info.playerPollInterval ?? 3000;

  async function pollPlayers() {
    try {
      const snapshot = await fetch('/api/players').then((response) => response.json());
      playerLayer.update(snapshot);
      playersLabel.textContent = playerStatus(snapshot, info.dimension);
    } catch (error) {
      playerLayer.update(null);
      playersLabel.textContent = 'player data unavailable';
      console.error('player poll failed:', error);
    }
  }

  // Exposed for debugging and for the browser coordinate tests.
  window.__map = map;
  window.__players = playerLayer;
  window.__pollPlayers = pollPlayers;
  window.__terrain = terrain;
  window.__pollTerrain = pollTerrain;

  await pollPlayers();
  setInterval(pollPlayers, pollInterval);
}

main().catch((error) => {
  worldLabel.textContent = `failed to load map: ${error.message}`;
  console.error(error);
});

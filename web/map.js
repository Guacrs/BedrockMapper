/**
 * Minimal Leaflet map over Bedrock terrain tiles.
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

const MinecraftCRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, 1, 0),
});

/** Minecraft block X/Z -> Leaflet LatLng. */
const blockToLatLng = (x, z) => L.latLng(z, x);

/** Leaflet LatLng -> Minecraft block X/Z. */
const latLngToBlock = (latlng) => ({ x: Math.floor(latlng.lng), z: Math.floor(latlng.lat) });

const worldLabel = document.getElementById('world');
const cursorLabel = document.getElementById('cursor');
const viewLabel = document.getElementById('view');

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

  const bounds = info.blockBounds;
  const layerBounds = bounds
    ? L.latLngBounds(blockToLatLng(bounds.minX, bounds.minZ), blockToLatLng(bounds.maxX + 1, bounds.maxZ + 1))
    : null;

  L.tileLayer(`/tiles/${info.dimension}/{z}/{x}/{y}.png`, {
    tileSize: info.tileSize,
    // The server renders one zoom level; Leaflet scales it for the others.
    minNativeZoom: info.nativeZoom,
    maxNativeZoom: info.nativeZoom,
    noWrap: true,
    keepBuffer: 2,
    ...(layerBounds ? { bounds: layerBounds } : {}),
  }).addTo(map);

  if (layerBounds) {
    map.fitBounds(layerBounds);
  } else {
    map.setView(blockToLatLng(0, 0), 0);
  }

  worldLabel.textContent =
    `${info.world.name || 'world'} ${info.world.version ? `(${info.world.version})` : ''} ` +
    `- ${info.chunkCount} chunks` +
    (bounds ? ` - X ${bounds.minX}..${bounds.maxX}, Z ${bounds.minZ}..${bounds.maxZ}` : '');

  map.on('mousemove', (event) => {
    const { x, z } = latLngToBlock(event.latlng);
    cursorLabel.textContent = `X ${x}, Z ${z}`;
  });
  map.on('mouseout', () => {
    cursorLabel.textContent = 'X -, Z -';
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
}

main().catch((error) => {
  worldLabel.textContent = `failed to load map: ${error.message}`;
  console.error(error);
});

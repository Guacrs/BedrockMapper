/**
 * The one conversion between Minecraft block coordinates and Leaflet.
 *
 *   Leaflet lng = block X
 *   Leaflet lat = block Z      (north up, +Z down, no axis flip)
 *
 * Terrain tiles and player markers both go through here, so there is a single
 * coordinate system rather than one per feature. Leaflet accepts a [lat, lng]
 * array anywhere a LatLng is wanted, which keeps this module free of any
 * dependency on Leaflet itself and therefore testable in Node.
 */

/**
 * Minecraft block X/Z -> Leaflet [lat, lng].
 *
 * @param {number} x block X
 * @param {number} z block Z
 * @returns {[number, number]}
 */
export function blockToLatLng(x, z) {
  return [z, x];
}

/**
 * Leaflet LatLng -> the Minecraft block containing it.
 *
 * @param {{ lat: number, lng: number }} latlng
 * @returns {{ x: number, z: number }}
 */
export function latLngToBlock(latlng) {
  return { x: Math.floor(latlng.lng), z: Math.floor(latlng.lat) };
}

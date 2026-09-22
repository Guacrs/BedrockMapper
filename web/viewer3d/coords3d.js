/**
 * Minecraft ↔ Three.js coordinates for the experimental 3D viewer.
 *
 * Identity mapping keeps overlays (players, markers) reversible later:
 *
 *   Minecraft X → Three.js X
 *   Minecraft Y → Three.js Y
 *   Minecraft Z → Three.js Z
 */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{ x: number, y: number, z: number }}
 */
export function minecraftToThree(x, y, z) {
  return { x, y, z };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{ x: number, y: number, z: number }}
 */
export function threeToMinecraft(x, y, z) {
  return { x, y, z };
}

/**
 * @param {number} blockX
 * @param {number} blockZ
 * @returns {{ chunkX: number, chunkZ: number }}
 */
export function blockToChunk(blockX, blockZ) {
  return {
    chunkX: Math.floor(blockX / 16),
    chunkZ: Math.floor(blockZ / 16),
  };
}

/**
 * @param {number} chunkX
 * @param {number} chunkZ
 * @returns {string}
 */
export function chunkKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

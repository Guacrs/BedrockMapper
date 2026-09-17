/**
 * Tile geometry.
 *
 * Minecraft block coordinates stay the authoritative coordinate system. A tile
 * is a fixed square of blocks, so every conversion is plain floor division and
 * negative coordinates behave the same as positive ones.
 *
 *   block X/Z    -> chunk X/Z    floor(block / 16)
 *   block X/Z    -> tile X/Y     floor(block / 256)
 *   chunk X/Z    -> tile X/Y     floor(chunk / 16)
 *   block X/Z    -> pixel in tile  block - tileX * 256   (0..255)
 *
 * Tile Y follows block Z directly (north is up, +Z is down), so no axis is
 * flipped or transposed anywhere in the pipeline.
 */

import { CHUNK_SIZE } from '../world/keys.ts';

/** Tile edge in pixels, and - at native zoom - in blocks. */
export const TILE_SIZE = 256;

/** Chunks along one tile edge. */
export const CHUNKS_PER_TILE = TILE_SIZE / CHUNK_SIZE;

/**
 * The only zoom level rendered on the server: 1 pixel per block. The browser
 * scales these tiles for other zoom levels.
 */
export const NATIVE_ZOOM = 0;

export interface TilePos {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function blockToTile(blockX: number, blockZ: number): TilePos {
  return { x: floorDiv(blockX, TILE_SIZE), y: floorDiv(blockZ, TILE_SIZE) };
}

export function chunkToTile(chunkX: number, chunkZ: number): TilePos {
  return { x: floorDiv(chunkX, CHUNKS_PER_TILE), y: floorDiv(chunkZ, CHUNKS_PER_TILE) };
}

/**
 * Every tile whose pixels are drawn from a chunk.
 *
 * Usually just the tile the chunk sits in. Elevation shading reads the height of
 * the column one block north and one block west, so a chunk on the northern or
 * western edge of a tile is also read by the tile it borders: chunk `15,z` is
 * the last chunk of tile 0 *and* the shading border of tile 1. The diagonal
 * neighbour is not included - shading never looks diagonally.
 */
export function tilesAffectedByChunk(chunkX: number, chunkZ: number): TilePos[] {
  const dependents = [
    { x: chunkX, z: chunkZ },
    { x: chunkX + 1, z: chunkZ },
    { x: chunkX, z: chunkZ + 1 },
  ];
  const tiles: TilePos[] = [];
  for (const chunk of dependents) {
    const tile = chunkToTile(chunk.x, chunk.z);
    if (!tiles.some((seen) => seen.x === tile.x && seen.y === tile.y)) tiles.push(tile);
  }
  return tiles;
}

/** North-west block corner of a tile. */
export function tileToBlock(tileX: number, tileY: number): { x: number; z: number } {
  return { x: tileX * TILE_SIZE, z: tileY * TILE_SIZE };
}

/** North-west chunk of a tile. */
export function tileToChunk(tileX: number, tileY: number): { x: number; z: number } {
  return { x: tileX * CHUNKS_PER_TILE, z: tileY * CHUNKS_PER_TILE };
}

/** Pixel offset of a block inside its tile, always 0..255. */
export function blockOffsetInTile(blockX: number, blockZ: number): { x: number; y: number } {
  return {
    x: blockX - floorDiv(blockX, TILE_SIZE) * TILE_SIZE,
    y: blockZ - floorDiv(blockZ, TILE_SIZE) * TILE_SIZE,
  };
}

/** Chunk bounds -> block bounds, inclusive on both ends. */
export function chunkBoundsToBlockBounds(bounds: Bounds): Bounds {
  return {
    minX: bounds.minX * CHUNK_SIZE,
    maxX: bounds.maxX * CHUNK_SIZE + CHUNK_SIZE - 1,
    minZ: bounds.minZ * CHUNK_SIZE,
    maxZ: bounds.maxZ * CHUNK_SIZE + CHUNK_SIZE - 1,
  };
}

/** Tiles covering a block area, inclusive. */
export function tileRangeForBlockBounds(bounds: Bounds): Bounds {
  return {
    minX: floorDiv(bounds.minX, TILE_SIZE),
    maxX: floorDiv(bounds.maxX, TILE_SIZE),
    minZ: floorDiv(bounds.minZ, TILE_SIZE),
    maxZ: floorDiv(bounds.maxZ, TILE_SIZE),
  };
}

/** Bounding box of a set of chunks, or null when the set is empty. */
export function boundsOfChunks(chunks: readonly { x: number; z: number }[]): Bounds | null {
  if (!chunks.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const chunk of chunks) {
    if (chunk.x < minX) minX = chunk.x;
    if (chunk.x > maxX) maxX = chunk.x;
    if (chunk.z < minZ) minZ = chunk.z;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function boundsCenter(bounds: Bounds): { x: number; z: number } {
  return {
    x: Math.round((bounds.minX + bounds.maxX) / 2),
    z: Math.round((bounds.minZ + bounds.maxZ) / 2),
  };
}

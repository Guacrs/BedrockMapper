/**
 * Turns a decoded chunk surface into a top-down RGBA image.
 *
 * Coordinate mapping (north up, +X right, +Z down - the usual Minecraft map
 * orientation):
 *
 *   world block X/Z -> chunk X/Z    floor(X / 16), floor(Z / 16)
 *   world block X/Z -> local X/Z    X - chunkX * 16, Z - chunkZ * 16  (0..15)
 *   local X/Z       -> pixel X/Y    pixelX = localX, pixelY = localZ
 *   pixel X/Y       -> RGBA offset  (pixelY * width + pixelX) * 4
 *
 * Floor division is used throughout, so block -1 belongs to chunk -1 (local 15)
 * rather than chunk 0.
 */

import { encode as encodePngBytes } from 'fast-png';
import { blockColor, type Rgb } from './colors.ts';
import { CHUNK_SIZE, columnIndex } from '../world/keys.ts';
import { NO_SURFACE, type ChunkSurface } from '../world/surface.ts';

export const CHANNELS = 4;

/** Brightness change per block of elevation difference against the neighbours. */
export const SHADE_PER_BLOCK = 0.06;
export const SHADE_MIN = 0.7;
export const SHADE_MAX = 1.3;

export interface RenderedImage {
  width: number;
  height: number;
  /** Row-major RGBA, 8 bits per channel. */
  data: Uint8Array;
}

export interface RenderOptions {
  /** Elevation shading. On by default. */
  shading?: boolean;
  /**
   * Height of a column outside this chunk, used for shading at the chunk edge.
   * Tile rendering can supply neighbouring chunks here; without it, edge
   * columns are shaded from the neighbours they do have.
   */
  neighborHeight?: (localX: number, localZ: number) => number | null;
}

function sampleHeight(
  surface: ChunkSurface,
  x: number,
  z: number,
  neighborHeight: RenderOptions['neighborHeight'],
): number | null {
  if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) {
    return neighborHeight?.(x, z) ?? null;
  }
  const y = surface.heights[columnIndex(x, z)]!;
  return y === NO_SURFACE ? null : y;
}

/**
 * Shade factor for a column: brighter when it stands above the columns to its
 * north and west, darker when it sits below them. Not a lighting model, just
 * enough relief to read hills and cliffs.
 */
export function shadeFactor(
  surface: ChunkSurface,
  x: number,
  z: number,
  y: number,
  neighborHeight?: RenderOptions['neighborHeight'],
): number {
  const samples = [
    sampleHeight(surface, x, z - 1, neighborHeight),
    sampleHeight(surface, x - 1, z, neighborHeight),
  ].filter((height): height is number => height !== null);
  if (!samples.length) return 1;

  const average = samples.reduce((sum, height) => sum + height, 0) / samples.length;
  const factor = 1 + (y - average) * SHADE_PER_BLOCK;
  return Math.min(SHADE_MAX, Math.max(SHADE_MIN, factor));
}

function applyShade(color: Rgb, factor: number): Rgb {
  return [
    Math.min(255, Math.max(0, Math.round(color[0] * factor))),
    Math.min(255, Math.max(0, Math.round(color[1] * factor))),
    Math.min(255, Math.max(0, Math.round(color[2] * factor))),
  ];
}

/**
 * Renders a 16x16 chunk surface. Columns with no visible block (ungenerated or
 * all-air) are left fully transparent.
 */
export function renderChunkSurface(surface: ChunkSurface, options: RenderOptions = {}): RenderedImage {
  const { shading = true, neighborHeight } = options;
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHANNELS);

  for (let localZ = 0; localZ < CHUNK_SIZE; localZ++) {
    for (let localX = 0; localX < CHUNK_SIZE; localX++) {
      const column = columnIndex(localX, localZ);
      const block = surface.blocks[column];
      const offset = (localZ * CHUNK_SIZE + localX) * CHANNELS;
      if (!block) continue;

      const y = surface.heights[column]!;
      const factor = shading ? shadeFactor(surface, localX, localZ, y, neighborHeight) : 1;
      const [r, g, b] = applyShade(blockColor(block), factor);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }

  return { width: CHUNK_SIZE, height: CHUNK_SIZE, data };
}

/** Nearest-neighbour upscale, for human inspection only. */
export function scaleNearest(image: RenderedImage, factor: number): RenderedImage {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('scale factor must be a positive integer');
  const width = image.width * factor;
  const height = image.height * factor;
  const data = new Uint8Array(width * height * CHANNELS);

  for (let y = 0; y < height; y++) {
    const sourceRow = Math.floor(y / factor) * image.width;
    for (let x = 0; x < width; x++) {
      const source = (sourceRow + Math.floor(x / factor)) * CHANNELS;
      const target = (y * width + x) * CHANNELS;
      data[target] = image.data[source]!;
      data[target + 1] = image.data[source + 1]!;
      data[target + 2] = image.data[source + 2]!;
      data[target + 3] = image.data[source + 3]!;
    }
  }

  return { width, height, data };
}

export function encodePng(image: RenderedImage): Uint8Array {
  return encodePngBytes({
    width: image.width,
    height: image.height,
    data: image.data,
    channels: CHANNELS,
    depth: 8,
  });
}

/** RGBA of one pixel, for tests and validation output. */
export function pixelAt(image: RenderedImage, x: number, y: number): [number, number, number, number] {
  const offset = (y * image.width + x) * CHANNELS;
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ];
}

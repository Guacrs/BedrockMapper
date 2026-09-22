/**
 * Texture atlas metadata + UV helpers for the experimental 3D viewer.
 *
 * Atlas PNG/JSON are produced by `npm run textures:build`. Runtime only reads
 * the normalized files under data/textures/.
 */

import fs from 'node:fs';
import { ATLAS_JSON_PATH, ATLAS_PNG_PATH, atlasFilesExist } from './paths.ts';
import type { TextureKey } from './appearance.ts';

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasMetadata {
  version: string;
  source: string;
  tileSize: number;
  /** Half-pixel inset applied when computing UVs (in atlas pixels). */
  uvInset: number;
  width: number;
  height: number;
  frames: Record<TextureKey, AtlasFrame>;
}

export interface AtlasUvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

let cachedMeta: AtlasMetadata | null | undefined;

export function loadAtlasMetadata(): AtlasMetadata | null {
  if (cachedMeta !== undefined) return cachedMeta;
  try {
    if (!atlasFilesExist()) {
      cachedMeta = null;
      return cachedMeta;
    }
    cachedMeta = JSON.parse(fs.readFileSync(ATLAS_JSON_PATH, 'utf8')) as AtlasMetadata;
    return cachedMeta;
  } catch {
    cachedMeta = null;
    return cachedMeta;
  }
}

export function resetAtlasMetadataCache(): void {
  cachedMeta = undefined;
}

export function readAtlasPng(): Buffer | null {
  try {
    if (!fs.existsSync(ATLAS_PNG_PATH)) return null;
    return fs.readFileSync(ATLAS_PNG_PATH);
  } catch {
    return null;
  }
}

export function atlasFrame(meta: AtlasMetadata, key: TextureKey): AtlasFrame | null {
  return meta.frames[key] ?? null;
}

/**
 * UV rectangle for a frame with a half-pixel (or configured) inset so
 * nearest-neighbour sampling does not bleed into neighbouring tiles.
 */
export function uvRectForFrame(meta: AtlasMetadata, frame: AtlasFrame): AtlasUvRect {
  const inset = meta.uvInset;
  return {
    u0: (frame.x + inset) / meta.width,
    v0: (frame.y + inset) / meta.height,
    u1: (frame.x + frame.w - inset) / meta.width,
    v1: (frame.y + frame.h - inset) / meta.height,
  };
}

export function uvRectForKey(meta: AtlasMetadata, key: TextureKey): AtlasUvRect | null {
  const frame = atlasFrame(meta, key);
  if (!frame) return null;
  return uvRectForFrame(meta, frame);
}

/**
 * Four UV pairs (u,v) matching the mesher's CCW corner order for a cube face.
 * Corner order matches voxel-mesh-builder FACES.
 */
export function faceCornerUvs(
  rect: AtlasUvRect,
  face: 'up' | 'down' | 'north' | 'south' | 'east' | 'west',
): readonly (readonly [number, number])[] {
  const { u0, v0, u1, v1 } = rect;
  // v0 = top of tile in atlas image space (y increases downward in the PNG).
  // Three.js textures are loaded with flipY=false so these UVs map upright.
  const top = v0;
  const bot = v1;
  switch (face) {
    case 'up':
      // corners: (0,1,0),(0,1,1),(1,1,1),(1,1,0) → map X→U, Z→V
      return [
        [u0, top],
        [u0, bot],
        [u1, bot],
        [u1, top],
      ];
    case 'down':
      // corners: (0,0,0),(1,0,0),(1,0,1),(0,0,1)
      return [
        [u0, bot],
        [u1, bot],
        [u1, top],
        [u0, top],
      ];
    case 'south': // +Z
      return [
        [u0, bot],
        [u1, bot],
        [u1, top],
        [u0, top],
      ];
    case 'north': // −Z
      return [
        [u1, bot],
        [u1, top],
        [u0, top],
        [u0, bot],
      ];
    case 'east': // +X
      return [
        [u0, bot],
        [u0, top],
        [u1, top],
        [u1, bot],
      ];
    case 'west': // −X
      return [
        [u1, bot],
        [u0, bot],
        [u0, top],
        [u1, top],
      ];
  }
}

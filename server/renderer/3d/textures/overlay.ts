/**
 * Bedrock terrain_texture `overlay_color` compositing.
 *
 * When a terrain_texture entry includes `overlay_color`, the source image is an
 * alpha-masked tint: RGB holds the untinted colour (e.g. dirt under grass
 * sides), and alpha selects how strongly `overlay_color` multiplies that RGB.
 * The result is always opaque — matching Bedrock atlas behaviour.
 *
 * Blend (channels as 0..1), matching Bedrock Wiki “Overlay Blending” with the
 * missing ×α on the tinted term restored so α=0 preserves the base RGB:
 *
 *   out = rgb * mix(1, overlay_color, alpha)
 *       = rgb * (1 - alpha) + (rgb * overlay_color) * alpha
 *   out.a = 1
 *
 * Vanilla samples currently use this only for `grass_side` / `grass_carried`.
 */

import type { RgbaImage } from './tga.ts';

export type Rgb = readonly [number, number, number];

const OVERLAY_KEY_MARK = '#overlay=';

/** Parse `#rrggbb` / `rrggbb` into 0..255 RGB. */
export function parseOverlayColor(hex: string): Rgb {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Invalid overlay_color "${hex}"`);
  }
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

export function overlayColorToHex(rgb: Rgb): string {
  return rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Atlas / appearance key for a path that was composited with overlay_color.
 * Example: `blocks/grass_side#overlay=df6827`
 */
export function overlayCompositedTextureKey(baseKey: string, overlayHex: string): string {
  const hex = overlayHex.trim().replace(/^#/, '').toLowerCase();
  return `${baseKey}${OVERLAY_KEY_MARK}${hex}`;
}

export function isOverlayCompositedTextureKey(key: string): boolean {
  return key.includes(OVERLAY_KEY_MARK);
}

/**
 * Apply overlay_color to a copy of `source`. Does not mutate the input.
 * Nearest-neighbour identity — no resize here (atlas packer scales later).
 */
export function applyOverlayColor(source: RgbaImage, overlay: Rgb): RgbaImage {
  const [or, og, ob] = overlay;
  const r2 = or / 255;
  const g2 = og / 255;
  const b2 = ob / 255;
  const data = new Uint8Array(source.data.length);

  for (let i = 0; i < source.data.length; i += 4) {
    const r1 = source.data[i]! / 255;
    const g1 = source.data[i + 1]! / 255;
    const b1 = source.data[i + 2]! / 255;
    const a = source.data[i + 3]! / 255;
    // mix(rgb, rgb * overlay, a)
    data[i] = Math.round((r1 * (1 - a) + r1 * r2 * a) * 255);
    data[i + 1] = Math.round((g1 * (1 - a) + g1 * g2 * a) * 255);
    data[i + 2] = Math.round((b1 * (1 - a) + b1 * b2 * a) * 255);
    data[i + 3] = 255;
  }

  return { width: source.width, height: source.height, data };
}

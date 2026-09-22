/**
 * Minimal TGA reader for Bedrock block textures.
 * Supports uncompressed (2) and RLE (10) true-color at 24/32 bpp.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major RGBA, top-left origin. */
  data: Uint8Array;
}

function readPixel(
  bytes: Uint8Array,
  offset: number,
  bytesPerPixel: number,
): [number, number, number, number, number] {
  const b = bytes[offset]!;
  const g = bytes[offset + 1]!;
  const r = bytes[offset + 2]!;
  const a = bytesPerPixel === 4 ? bytes[offset + 3]! : 255;
  return [r, g, b, a, offset + bytesPerPixel];
}

export function decodeTga(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 18) throw new Error('TGA too short');
  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;
  if (colorMapType !== 0) throw new Error('TGA colour-mapped images are not supported');
  if (imageType !== 2 && imageType !== 10) {
    throw new Error(`Unsupported TGA image type ${imageType}`);
  }

  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const bpp = bytes[16]!;
  const descriptor = bytes[17]!;
  if (bpp !== 24 && bpp !== 32) throw new Error(`Unsupported TGA bit depth ${bpp}`);
  if (width <= 0 || height <= 0) throw new Error('Invalid TGA dimensions');

  const headerSize = 18 + idLength;
  const bytesPerPixel = bpp / 8;
  const topOrigin = (descriptor & 0x20) !== 0;
  const raw = new Uint8Array(width * height * 4);

  let src = headerSize;
  if (imageType === 2) {
    const expected = headerSize + width * height * bytesPerPixel;
    if (bytes.length < expected) throw new Error('TGA pixel data truncated');
    for (let i = 0; i < width * height; i++) {
      const [r, g, b, a, next] = readPixel(bytes, src, bytesPerPixel);
      src = next;
      const dst = i * 4;
      raw[dst] = r;
      raw[dst + 1] = g;
      raw[dst + 2] = b;
      raw[dst + 3] = a;
    }
  } else {
    // RLE packed (type 10).
    let written = 0;
    const total = width * height;
    while (written < total) {
      if (src >= bytes.length) throw new Error('TGA RLE data truncated');
      const packet = bytes[src++]!;
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        if (src + bytesPerPixel > bytes.length) throw new Error('TGA RLE pixel truncated');
        const [r, g, b, a, next] = readPixel(bytes, src, bytesPerPixel);
        src = next;
        for (let i = 0; i < count; i++) {
          const dst = (written + i) * 4;
          raw[dst] = r;
          raw[dst + 1] = g;
          raw[dst + 2] = b;
          raw[dst + 3] = a;
        }
        written += count;
      } else {
        for (let i = 0; i < count; i++) {
          if (src + bytesPerPixel > bytes.length) throw new Error('TGA RLE raw truncated');
          const [r, g, b, a, next] = readPixel(bytes, src, bytesPerPixel);
          src = next;
          const dst = (written + i) * 4;
          raw[dst] = r;
          raw[dst + 1] = g;
          raw[dst + 2] = b;
          raw[dst + 3] = a;
        }
        written += count;
      }
    }
  }

  // Convert storage order to top-left row-major.
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = topOrigin ? y : height - 1 - y;
    data.set(raw.subarray(srcY * width * 4, (srcY + 1) * width * 4), y * width * 4);
  }
  return { width, height, data };
}

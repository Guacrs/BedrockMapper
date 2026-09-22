/**
 * Texture atlas + block appearance tests (no Mojang PNGs required for unit
 * cases; optional samples-backed checks run when VANILLA_SAMPLES is set).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { decode as decodePng } from 'fast-png';

import {
  appearanceTextureKeys,
  textureKeyForFace,
  type BlockAppearance,
} from '../server/renderer/3d/textures/appearance.ts';
import {
  atlasFrame,
  faceCornerUvs,
  uvRectForFrame,
  type AtlasMetadata,
} from '../server/renderer/3d/textures/atlas.ts';
import { faceSlot, fullCubeFaceTexture } from '../server/renderer/3d/textures/models.ts';
import {
  applyOverlayColor,
  isOverlayCompositedTextureKey,
  overlayCompositedTextureKey,
  parseOverlayColor,
} from '../server/renderer/3d/textures/overlay.ts';
import { decodeTga, type RgbaImage } from '../server/renderer/3d/textures/tga.ts';
import { firstTextureRef, parseJsonc } from '../server/cli/build-texture-atlas.ts';

function rgba(width: number, height: number, fill: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

function pixel(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
}

describe('texture appearance helpers', () => {
  it('resolves all / up / down / side with fallback to all', () => {
    const allOnly: BlockAppearance = { all: 'blocks/stone' };
    assert.equal(textureKeyForFace(allOnly, 'up'), 'blocks/stone');
    assert.equal(textureKeyForFace(allOnly, 'down'), 'blocks/stone');
    assert.equal(textureKeyForFace(allOnly, 'side'), 'blocks/stone');

    const split: BlockAppearance = {
      up: 'blocks/grass_top',
      down: 'blocks/dirt',
      side: 'blocks/grass_side',
    };
    assert.equal(textureKeyForFace(split, 'up'), 'blocks/grass_top');
    assert.equal(textureKeyForFace(split, 'down'), 'blocks/dirt');
    assert.equal(textureKeyForFace(split, 'side'), 'blocks/grass_side');
  });

  it('returns null for missing appearance / unknown face texture', () => {
    assert.equal(textureKeyForFace(null, 'up'), null);
    assert.equal(textureKeyForFace({}, 'side'), null);
  });

  it('lists appearance texture keys in sorted order', () => {
    assert.deepEqual(
      appearanceTextureKeys({
        side: 'blocks/b',
        up: 'blocks/a',
        down: 'blocks/c',
      }),
      ['blocks/a', 'blocks/b', 'blocks/c'],
    );
  });

  it('maps cube faces to appearance slots', () => {
    assert.equal(faceSlot('up'), 'up');
    assert.equal(faceSlot('down'), 'down');
    assert.equal(faceSlot('north'), 'side');
    assert.equal(faceSlot('east'), 'side');
  });

  it('fullCubeFaceTexture uses appearance DB when present, else null', () => {
    const key = fullCubeFaceTexture('minecraft:stone', 'up');
    // With or without a built atlas: either a real key or null — never throws.
    assert.ok(key === null || key === 'blocks/stone' || key.startsWith('blocks/'));
  });
});

describe('atlas UV helpers', () => {
  const meta: AtlasMetadata = {
    version: 'test',
    source: 'test',
    tileSize: 16,
    uvInset: 0.5,
    width: 64,
    height: 64,
    frames: {
      'blocks/stone': { x: 0, y: 0, w: 16, h: 16 },
      'blocks/dirt': { x: 16, y: 0, w: 16, h: 16 },
    },
  };

  it('looks up frames by texture key', () => {
    assert.deepEqual(atlasFrame(meta, 'blocks/stone'), { x: 0, y: 0, w: 16, h: 16 });
    assert.equal(atlasFrame(meta, 'blocks/missing'), null);
  });

  it('keeps inset UVs inside the atlas and inside the tile', () => {
    const frame = atlasFrame(meta, 'blocks/stone')!;
    const rect = uvRectForFrame(meta, frame);
    assert.ok(rect.u0 > 0);
    assert.ok(rect.v0 > 0);
    assert.ok(rect.u1 < 16 / 64);
    assert.ok(rect.v1 < 16 / 64);
    assert.ok(rect.u0 < rect.u1);
    assert.ok(rect.v0 < rect.v1);
  });

  it('emits four UV corners per face within 0..1', () => {
    const rect = uvRectForFrame(meta, atlasFrame(meta, 'blocks/dirt')!);
    for (const face of ['up', 'down', 'north', 'south', 'east', 'west'] as const) {
      const corners = faceCornerUvs(rect, face);
      assert.equal(corners.length, 4);
      for (const [u, v] of corners) {
        assert.ok(u >= 0 && u <= 1);
        assert.ok(v >= 0 && v <= 1);
      }
    }
  });

  it('matches FACES corner order with deterministic UVs for a known rect', () => {
    // Known rectangle (not from uvRectForFrame) so the expected table is obvious.
    // Convention: atlas top-left image space, v increases downward (flipY=false).
    // FACES corner lists are copied from voxel-mesh-builder.ts.
    const rect = { u0: 0.1, v0: 0.2, u1: 0.4, v1: 0.5 };
    const { u0, v0, u1, v1 } = rect;
    const top = v0;
    const bot = v1;

    // up corners: (0,1,0),(0,1,1),(1,1,1),(1,1,0) → X→U, Z→V
    assert.deepEqual(faceCornerUvs(rect, 'up'), [
      [u0, top],
      [u0, bot],
      [u1, bot],
      [u1, top],
    ]);

    // down corners: (0,0,0),(1,0,0),(1,0,1),(0,0,1)
    assert.deepEqual(faceCornerUvs(rect, 'down'), [
      [u0, bot],
      [u1, bot],
      [u1, top],
      [u0, top],
    ]);

    // south (+Z): (0,0,1),(1,0,1),(1,1,1),(0,1,1) — U along +X, V along +Y
    assert.deepEqual(faceCornerUvs(rect, 'south'), [
      [u0, bot],
      [u1, bot],
      [u1, top],
      [u0, top],
    ]);

    // north (−Z): (0,0,0),(0,1,0),(1,1,0),(1,0,0)
    assert.deepEqual(faceCornerUvs(rect, 'north'), [
      [u1, bot],
      [u1, top],
      [u0, top],
      [u0, bot],
    ]);

    // east (+X): (1,0,0),(1,1,0),(1,1,1),(1,0,1)
    assert.deepEqual(faceCornerUvs(rect, 'east'), [
      [u0, bot],
      [u0, top],
      [u1, top],
      [u1, bot],
    ]);

    // west (−X): (0,0,0),(0,0,1),(0,1,1),(0,1,0)
    assert.deepEqual(faceCornerUvs(rect, 'west'), [
      [u1, bot],
      [u0, bot],
      [u0, top],
      [u1, top],
    ]);
  });

  it('keeps side-face V increasing toward −Y (texture top at high world Y)', () => {
    const rect = { u0: 0.1, v0: 0.2, u1: 0.4, v1: 0.5 };
    // South face: corners 0,1 are y=0; corners 2,3 are y=1.
    const south = faceCornerUvs(rect, 'south');
    assert.equal(south[0]![1], rect.v1); // low Y → bottom of tile (larger v)
    assert.equal(south[2]![1], rect.v0); // high Y → top of tile (smaller v)
    // Detect accidental vertical mirror.
    assert.notEqual(south[0]![1], south[2]![1]);
  });
});

describe('TGA decode', () => {
  it('reads an uncompressed 32-bit top-left TGA', () => {
    // 2×2 BGRA pixels, top-left origin, uncompressed true-color.
    const header = Buffer.alloc(18);
    header[2] = 2; // uncompressed true-color
    header[12] = 2;
    header[14] = 2; // 2×2
    header[16] = 32;
    header[17] = 0x20; // top-left
    const pixels = Buffer.from([
      // (0,0) red
      0, 0, 255, 255,
      // (1,0) green
      0, 255, 0, 255,
      // (0,1) blue
      255, 0, 0, 255,
      // (1,1) white
      255, 255, 255, 255,
    ]);
    const image = decodeTga(Buffer.concat([header, pixels]));
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.deepEqual([...image.data.slice(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...image.data.slice(4, 8)], [0, 255, 0, 255]);
  });
});

describe('JSONC parse (terrain_texture style)', () => {
  it('strips line comments and trailing commas', () => {
    const parsed = parseJsonc(`{
      // comment
      "texture_data": {
        "stone": { "textures": "textures/blocks/stone", },
      },
    }`) as { texture_data: { stone: { textures: string } } };
    assert.equal(parsed.texture_data.stone.textures, 'textures/blocks/stone');
  });
});

describe('overlay_color compositing', () => {
  it('leaves a fully opaque texture unchanged when overlay is white', () => {
    const source = rgba(2, 2, [180, 120, 80, 255]);
    const out = applyOverlayColor(source, [255, 255, 255]);
    assert.deepEqual([...out.data], [...source.data]);
    // Source must not be mutated.
    assert.equal(source.data[3], 255);
  });

  it('preserves base RGB where alpha is 0 (dirt under grass)', () => {
    const source = rgba(1, 1, [150, 108, 74, 0]);
    const out = applyOverlayColor(source, [121, 192, 90]);
    assert.deepEqual(pixel(out, 0, 0), [150, 108, 74, 255]);
  });

  it('multiplies RGB by overlay_color where alpha is 255', () => {
    // Mid-grey mask × green overlay → darkened green, fully opaque.
    const source = rgba(1, 1, [128, 128, 128, 255]);
    const out = applyOverlayColor(source, [0, 255, 0]);
    assert.deepEqual(pixel(out, 0, 0), [0, 128, 0, 255]);
  });

  it('lerps deterministically at partial alpha', () => {
    // rgb=(200,100,0), a=0.5, overlay=(0,255,0)
    // out = rgb*(1-a) + (rgb*overlay)*a
    // R = 200*0.5 + 0*0.5 = 100
    // G = 100*0.5 + 100*0.5 = 100
    // B = 0
    const source = rgba(1, 1, [200, 100, 0, 128]);
    const out = applyOverlayColor(source, [0, 255, 0]);
    const [r, g, b, a] = pixel(out, 0, 0);
    assert.equal(a, 255);
    assert.ok(Math.abs(r - 100) <= 1);
    assert.ok(Math.abs(g - 100) <= 1);
    assert.equal(b, 0);
  });

  it('parses overlay hex and builds unique atlas keys', () => {
    assert.deepEqual(parseOverlayColor('#df6827'), [223, 104, 39]);
    assert.deepEqual(parseOverlayColor('79c05a'), [121, 192, 90]);
    const key = overlayCompositedTextureKey('blocks/grass_side', '#79C05A');
    assert.equal(key, 'blocks/grass_side#overlay=79c05a');
    assert.equal(isOverlayCompositedTextureKey(key), true);
    assert.equal(isOverlayCompositedTextureKey('blocks/dirt'), false);
  });

  it('firstTextureRef preserves overlay_color from terrain_texture objects', () => {
    assert.deepEqual(firstTextureRef('textures/blocks/stone'), {
      path: 'textures/blocks/stone',
    });
    assert.deepEqual(
      firstTextureRef([{ path: 'textures/blocks/grass_side', overlay_color: '#df6827' }]),
      { path: 'textures/blocks/grass_side', overlayColor: '#df6827' },
    );
    assert.deepEqual(
      firstTextureRef({ path: 'textures/blocks/grass_side', overlay_color: '#79c05a' }),
      { path: 'textures/blocks/grass_side', overlayColor: '#79c05a' },
    );
  });

  it('marks only overlay-composited atlas keys so the mesher can skip a second tint', () => {
    // Contract mirrored by voxel-mesh-builder vertexRgb: overlay keys → white
    // vertices; ordinary grayscale tops (e.g. grass_top) keep vertex tint.
    assert.equal(isOverlayCompositedTextureKey('blocks/grass_side#overlay=92bc58'), true);
    assert.equal(isOverlayCompositedTextureKey('blocks/grass_top'), false);
    assert.equal(isOverlayCompositedTextureKey('blocks/dirt'), false);
  });
});

describe('vanilla grass overlay definitions (samples)', () => {
  function findSamplesRoot(): string | null {
    const candidates = [
      process.env.VANILLA_SAMPLES,
      path.resolve('vanilla-samples'),
      '/tmp/bedrock-samples',
      '/tmp/bedrock-samples/bedrock-samples-v1.26.50.4',
    ].filter((v): v is string => Boolean(v));
    for (const candidate of candidates) {
      const marker = path.join(candidate, 'resource_pack', 'textures', 'terrain_texture.json');
      if (fs.existsSync(marker)) return candidate;
      const nested = path.join(
        candidate,
        'bedrock-samples-v1.26.50.4',
        'resource_pack',
        'textures',
        'terrain_texture.json',
      );
      if (fs.existsSync(nested)) {
        return path.join(candidate, 'bedrock-samples-v1.26.50.4');
      }
    }
    return null;
  }

  it('resolves grass_side / grass_carried overlay_color from terrain_texture.json', () => {
    const root = findSamplesRoot();
    if (!root) {
      // Unit environment without samples — skip without failing CI.
      return;
    }
    const terrainPath = path.join(root, 'resource_pack', 'textures', 'terrain_texture.json');
    const terrain = parseJsonc(fs.readFileSync(terrainPath, 'utf8')) as {
      texture_data: Record<string, { textures?: unknown }>;
    };
    const side = firstTextureRef(terrain.texture_data.grass_side?.textures as never);
    const carried = firstTextureRef(terrain.texture_data.grass_carried?.textures as never);
    assert.ok(side);
    assert.equal(side.path, 'textures/blocks/grass_side');
    assert.equal(side.overlayColor?.toLowerCase(), '#df6827');
    assert.ok(carried);
    assert.equal(carried.path, 'textures/blocks/grass_side');
    assert.equal(carried.overlayColor?.toLowerCase(), '#79c05a');
  });

  it('composited grass_side is opaque and no longer equals raw dirt', () => {
    const root = findSamplesRoot();
    if (!root) return;

    const blocksDir = path.join(root, 'resource_pack', 'textures', 'blocks');
    const mask = decodeTga(fs.readFileSync(path.join(blocksDir, 'grass_side.tga')));
    const dirtPng = decodePng(fs.readFileSync(path.join(blocksDir, 'dirt.png')));
    const dirtData =
      dirtPng.data instanceof Uint8Array
        ? new Uint8Array(dirtPng.data.buffer, dirtPng.data.byteOffset, dirtPng.data.byteLength)
        : Uint8Array.from(dirtPng.data as ArrayLike<number>);

    const green = applyOverlayColor(mask, parseOverlayColor('#79c05a'));
    assert.equal(green.width, 16);
    assert.equal(green.height, 16);

    let opaque = 0;
    let differsFromDirt = 0;
    let greenish = 0;
    for (let i = 0; i < 16 * 16; i++) {
      const o = i * 4;
      assert.equal(green.data[o + 3], 255);
      opaque++;
      const same =
        green.data[o] === dirtData[o] &&
        green.data[o + 1] === dirtData[o + 1] &&
        green.data[o + 2] === dirtData[o + 2];
      if (!same) differsFromDirt++;
      // Mask pixels (original a=255) should carry green channel dominance after tint.
      if (mask.data[o + 3] === 255 && green.data[o + 1]! > green.data[o]!) {
        greenish++;
      }
    }
    assert.equal(opaque, 256);
    assert.ok(
      differsFromDirt > 20,
      `expected composited side to differ from dirt (diff=${differsFromDirt})`,
    );
    assert.ok(greenish > 10, `expected green-tinted mask pixels (greenish=${greenish})`);
  });

  it('built grass_block appearance overlays sides only (top stays ordinary for vertex tint)', () => {
    const appearancePath = path.resolve('data/textures/block-appearance.json');
    if (!fs.existsSync(appearancePath)) return;
    const db = JSON.parse(fs.readFileSync(appearancePath, 'utf8')) as {
      blocks: Record<string, { up?: string; down?: string; side?: string; all?: string }>;
    };
    const grass = db.blocks['minecraft:grass_block'];
    if (!grass) return;
    assert.ok(grass.side && isOverlayCompositedTextureKey(grass.side), grass.side);
    assert.ok(grass.up && !isOverlayCompositedTextureKey(grass.up), grass.up);
    assert.ok(grass.down && !isOverlayCompositedTextureKey(grass.down), grass.down);
    assert.equal(grass.down, 'blocks/dirt');
  });
});

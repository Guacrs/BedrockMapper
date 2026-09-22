/**
 * Texture atlas + block appearance tests (no Mojang PNGs required).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
import { decodeTga } from '../server/renderer/3d/textures/tga.ts';
import { parseJsonc } from '../server/cli/build-texture-atlas.ts';

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

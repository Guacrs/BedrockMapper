/**
 * PR31: accurate per-face textures — cardinal appearance slots, facing remap,
 * pillar_axis ends. No lighting / emissive.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appearanceForBlock,
  resetBlockAppearanceCache,
  textureKeyForCubeFace,
  textureKeyForFace,
  type BlockAppearance,
} from '../server/renderer/3d/textures/appearance.ts';
import { fullCubeFaceTexture } from '../server/renderer/3d/textures/models.ts';
import {
  fullCubeModel,
  fullCubeModelForRef,
  hasDistinctCardinalTextures,
} from '../server/renderer/3d/models/families/full-cube.ts';
import { resetBlockModelCache, resolveBlockModel } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

describe('PR31 cardinal appearance lookup', () => {
  it('prefers north/south/east/west over shared side', () => {
    const app: BlockAppearance = {
      up: 'blocks/top',
      down: 'blocks/bottom',
      side: 'blocks/side',
      north: 'blocks/front',
      south: 'blocks/back',
      east: 'blocks/side',
      west: 'blocks/side',
    };
    assert.equal(textureKeyForCubeFace(app, 'north'), 'blocks/front');
    assert.equal(textureKeyForCubeFace(app, 'south'), 'blocks/back');
    assert.equal(textureKeyForCubeFace(app, 'east'), 'blocks/side');
    assert.equal(textureKeyForFace(app, 'side'), 'blocks/side');
  });

  it('falls back cardinal → side → all when slots missing', () => {
    assert.equal(
      textureKeyForCubeFace({ side: 'blocks/side' }, 'north'),
      'blocks/side',
    );
    assert.equal(textureKeyForCubeFace({ all: 'blocks/stone' }, 'east'), 'blocks/stone');
    assert.equal(textureKeyForCubeFace(null, 'up'), null);
  });
});

describe('PR31 appearance DB cardinals (requires textures:build)', () => {
  it('keeps crafting_table front ≠ side', () => {
    resetBlockAppearanceCache();
    const app = appearanceForBlock('minecraft:crafting_table');
    if (!app) {
      // Atlas not built in this environment — skip without failing CI-less gates.
      return;
    }
    assert.equal(app.north, 'blocks/crafting_table_front');
    assert.equal(app.south, 'blocks/crafting_table_front');
    assert.equal(app.east, 'blocks/crafting_table_side');
    assert.equal(app.west, 'blocks/crafting_table_side');
    assert.equal(fullCubeFaceTexture('minecraft:crafting_table', 'north'), app.north);
    assert.equal(fullCubeFaceTexture('minecraft:crafting_table', 'east'), app.east);
    assert.ok(hasDistinctCardinalTextures('minecraft:crafting_table'));
  });

  it('keeps furnace south front distinct from sides', () => {
    resetBlockAppearanceCache();
    const app = appearanceForBlock('minecraft:furnace');
    if (!app) return;
    assert.equal(app.south, 'blocks/furnace_front_off');
    assert.equal(app.north, 'blocks/furnace_side');
    assert.equal(app.east, 'blocks/furnace_side');
  });

  it('aliases oak_door to wooden_door appearance', () => {
    resetBlockAppearanceCache();
    const oak = appearanceForBlock('minecraft:oak_door');
    const wooden = appearanceForBlock('minecraft:wooden_door');
    if (!oak || !wooden) return;
    assert.deepEqual(oak, wooden);
  });

  it('preserves cactus top/bottom/side split', () => {
    resetBlockAppearanceCache();
    const app = appearanceForBlock('minecraft:cactus');
    if (!app) return;
    assert.equal(app.up, 'blocks/cactus_top');
    assert.equal(app.down, 'blocks/cactus_bottom');
    assert.equal(app.side, 'blocks/cactus_side');
    assert.equal(fullCubeFaceTexture('minecraft:cactus', 'north'), app.side);
  });

  it('keeps grass overlay on sides only (no double-tint path)', () => {
    resetBlockAppearanceCache();
    const app = appearanceForBlock('minecraft:grass_block');
    if (!app) return;
    assert.equal(app.up, 'blocks/grass_top');
    assert.equal(app.down, 'blocks/dirt');
    assert.ok(app.side?.includes('#overlay='));
  });
});

describe('PR31 oriented full cubes', () => {
  it('rotates furnace front to match cardinal_direction', () => {
    resetBlockAppearanceCache();
    resetBlockModelCache();
    if (!appearanceForBlock('minecraft:furnace')) return;

    const south = fullCubeModelForRef({
      name: 'minecraft:furnace',
      states: { 'minecraft:cardinal_direction': 'south' },
    } as BlockRef);
    const east = fullCubeModelForRef({
      name: 'minecraft:furnace',
      states: { 'minecraft:cardinal_direction': 'east' },
    } as BlockRef);

    const front = 'blocks/furnace_front_off';
    assert.equal(south.renderBoxes[0]!.faces.south?.textureKey, front);
    assert.equal(east.renderBoxes[0]!.faces.east?.textureKey, front);
    assert.notEqual(east.renderBoxes[0]!.faces.south?.textureKey, front);
  });

  it('remaps oak_log pillar_axis ends to top texture', () => {
    resetBlockAppearanceCache();
    resetBlockModelCache();
    if (!appearanceForBlock('minecraft:oak_log')) return;

    const y = fullCubeModelForRef({
      name: 'minecraft:oak_log',
      states: { pillar_axis: 'y' },
    } as BlockRef);
    const x = fullCubeModelForRef({
      name: 'minecraft:oak_log',
      states: { pillar_axis: 'x' },
    } as BlockRef);

    const top = y.renderBoxes[0]!.faces.up?.textureKey;
    const bark = y.renderBoxes[0]!.faces.north?.textureKey;
    assert.ok(top);
    assert.ok(bark);
    assert.equal(x.renderBoxes[0]!.faces.east?.textureKey, top);
    assert.equal(x.renderBoxes[0]!.faces.west?.textureKey, top);
    assert.equal(x.renderBoxes[0]!.faces.north?.textureKey, bark);
    assert.equal(x.renderBoxes[0]!.faces.up?.textureKey, bark);
  });

  it('resolve cache distinguishes facing', () => {
    resetBlockAppearanceCache();
    resetBlockModelCache();
    if (!appearanceForBlock('minecraft:furnace')) return;

    const a = resolveBlockModel({
      name: 'minecraft:furnace',
      states: { 'minecraft:cardinal_direction': 'north' },
    } as BlockRef)!;
    const b = resolveBlockModel({
      name: 'minecraft:furnace',
      states: { 'minecraft:cardinal_direction': 'west' },
    } as BlockRef)!;
    assert.notEqual(a.key, b.key);
    assert.equal(a.renderBoxes[0]!.faces.north?.textureKey, 'blocks/furnace_front_off');
    assert.equal(b.renderBoxes[0]!.faces.west?.textureKey, 'blocks/furnace_front_off');
  });

  it('unoriented fullCubeModel still works for neighbour stand-ins', () => {
    const stone = fullCubeModel('minecraft:stone');
    assert.equal(stone.isFullCube, true);
    assert.match(stone.key, /^full_cube:/);
  });
});

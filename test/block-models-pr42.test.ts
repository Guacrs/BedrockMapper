/**
 * PR42: chest geometry — single closed AABB + cardinal_direction facing.
 * Double halves deferred (Bedrock has no type left/right state).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  CHEST_BODY,
  chestFacingFromStates,
  chestModel,
  isChestName,
  quarterTurnsForChestFacing,
  tryBuildChest,
} from '../server/renderer/3d/models/families/chest.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR42 chest coverage', () => {
  it('classifies chest family ids as explicit_ok', () => {
    assert.equal(isChestName('minecraft:chest'), true);
    assert.equal(isChestName('minecraft:trapped_chest'), true);
    assert.equal(isChestName('minecraft:ender_chest'), true);
    assert.equal(isChestName('minecraft:copper_chest'), true);
    assert.equal(isChestName('minecraft:waxed_oxidized_copper_chest'), true);
    assert.equal(isChestName('minecraft:chest_minecart'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:chest')?.family, 'chest');
    assert.equal(classifyBlockModelCoverage('minecraft:chest')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:chest')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:trapped_chest')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:ender_chest')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:copper_chest')?.bucket, 'explicit_ok');
  });
});

describe('PR42 chest states', () => {
  it('reads minecraft:cardinal_direction and legacy facing_direction', () => {
    assert.equal(chestFacingFromStates({ 'minecraft:cardinal_direction': 'north' }), 'north');
    assert.equal(chestFacingFromStates({ 'minecraft:cardinal_direction': 'east' }), 'east');
    assert.equal(chestFacingFromStates({ facing_direction: 2 }), 'north');
    assert.equal(chestFacingFromStates({ facing_direction: 5 }), 'east');
    assert.equal(chestFacingFromStates({}), null);
    assert.equal(chestFacingFromStates({ facing_direction: 0 }), null);
  });

  it('maps facing to CCW quarter-turns from south base', () => {
    assert.equal(quarterTurnsForChestFacing('south'), 0);
    assert.equal(quarterTurnsForChestFacing('west'), 1);
    assert.equal(quarterTurnsForChestFacing('north'), 2);
    assert.equal(quarterTurnsForChestFacing('east'), 3);
  });
});

describe('PR42 chest geometry', () => {
  it('builds inset [1,0,1]–[15,14,15] closed body', () => {
    const model = chestModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'south' }),
      'south',
    );
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 1);
    assert.deepEqual(model.renderBoxes[0]!.min, CHEST_BODY.min);
    assert.deepEqual(model.renderBoxes[0]!.max, CHEST_BODY.max);
    assert.deepEqual(model.renderBoxes[0]!.min, [1 * PX, 0, 1 * PX]);
    assert.deepEqual(model.renderBoxes[0]!.max, [15 * PX, 14 * PX, 15 * PX]);
    assert.match(model.key, /^chest:south:/);
  });

  it('orients front via rotateModelY for each cardinal', () => {
    resetBlockModelCache();
    const south = resolveBlockModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'south' }),
    )!;
    const north = resolveBlockModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'north' }),
    )!;
    const east = resolveBlockModel(
      ref('minecraft:trapped_chest', { 'minecraft:cardinal_direction': 'east' }),
    )!;
    assert.match(south.key, /^chest:south:/);
    assert.match(north.key, /^chest:north:/);
    assert.match(east.key, /^chest:east:/);
    assert.notEqual(south.key, north.key);
    // South front texture should move to north face after 180° Y.
    const southFront = south.renderBoxes[0]!.faces.south?.textureKey;
    const northFront = north.renderBoxes[0]!.faces.north?.textureKey;
    assert.ok(southFront);
    assert.equal(northFront, southFront);
  });

  it('accepts legacy facing_direction and rejects missing facing', () => {
    const legacy = tryBuildChest(ref('minecraft:chest', { facing_direction: 3 }));
    assert.equal(legacy.ok, true);
    if (legacy.ok) assert.match(legacy.model.key, /^chest:south:/);
    const bad = tryBuildChest(ref('minecraft:chest', {}));
    assert.equal(bad.ok, false);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const chest = resolveBlockModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'south' }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', chest), false);
  });

  it('resolver caches facings separately', () => {
    resetBlockModelCache();
    const a = resolveBlockModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'south' }),
    )!;
    const b = resolveBlockModel(
      ref('minecraft:chest', { 'minecraft:cardinal_direction': 'west' }),
    )!;
    assert.notEqual(a.key, b.key);
  });
});

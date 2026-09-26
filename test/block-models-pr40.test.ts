/**
 * PR40: standing / wall sign geometry — not hanging signs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  groundSignDirectionFromStates,
  isSignName,
  SIGN_STANDING_BOARD_SOUTH,
  SIGN_WALL_BOARD_NORTH,
  signKindFromName,
  signModel,
  tryBuildSign,
  wallSignFacingFromStates,
} from '../server/renderer/3d/models/families/sign.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR40 sign coverage', () => {
  it('classifies standing/wall as explicit sign; excludes hanging', () => {
    assert.equal(isSignName('minecraft:standing_sign'), true);
    assert.equal(isSignName('minecraft:spruce_standing_sign'), true);
    assert.equal(isSignName('minecraft:wall_sign'), true);
    assert.equal(isSignName('minecraft:acacia_wall_sign'), true);
    assert.equal(isSignName('minecraft:oak_hanging_sign'), false);
    assert.equal(isSignName('minecraft:acacia_hanging_sign'), false);
    // Any *_standing_sign matches (even non-vanilla prefixes); oak uses bare standing_sign.
    assert.equal(isSignName('minecraft:oak_standing_sign'), true);
    assert.equal(signKindFromName('minecraft:standing_sign'), 'standing');
    assert.equal(signKindFromName('minecraft:wall_sign'), 'wall');
    assert.equal(classifyBlockModelCoverage('minecraft:standing_sign')?.family, 'sign');
    assert.equal(classifyBlockModelCoverage('minecraft:wall_sign')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:standing_sign')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:wall_sign')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.category, 'hanging_sign');
  });
});

describe('PR40 sign states', () => {
  it('reads ground_sign_direction 0–15 for standing', () => {
    assert.equal(groundSignDirectionFromStates({}), 0);
    assert.equal(groundSignDirectionFromStates({ ground_sign_direction: 0 }), 0);
    assert.equal(groundSignDirectionFromStates({ ground_sign_direction: 8 }), 8);
    assert.equal(groundSignDirectionFromStates({ ground_sign_direction: 15 }), 15);
    assert.equal(groundSignDirectionFromStates({ ground_sign_direction: '2' }), 2);
    assert.equal(groundSignDirectionFromStates({ ground_sign_direction: 99 }), 0);
  });

  it('reads wall facing_direction 2–5 only', () => {
    assert.equal(wallSignFacingFromStates({ facing_direction: 2 }), 'north');
    assert.equal(wallSignFacingFromStates({ facing_direction: 3 }), 'south');
    assert.equal(wallSignFacingFromStates({ facing_direction: 4 }), 'west');
    assert.equal(wallSignFacingFromStates({ facing_direction: 5 }), 'east');
    assert.equal(wallSignFacingFromStates({ facing_direction: 0 }), null);
    assert.equal(wallSignFacingFromStates({ facing_direction: 1 }), null);
    assert.equal(wallSignFacingFromStates({}), null);
    assert.equal(wallSignFacingFromStates({ facing_direction: 'north' }), 'north');
  });
});

describe('PR40 sign geometry', () => {
  it('builds standing south post + board without rotation', () => {
    const model = signModel(ref('minecraft:standing_sign', { ground_sign_direction: 0 }));
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 2);
    assert.deepEqual(model.renderBoxes[0]!.min, [7 * PX, 0, 7 * PX]);
    assert.deepEqual(model.renderBoxes[0]!.max, [9 * PX, 8 * PX, 9 * PX]);
    assert.deepEqual(model.renderBoxes[1]!.min, [...SIGN_STANDING_BOARD_SOUTH.min]);
    assert.deepEqual(model.renderBoxes[1]!.max, [...SIGN_STANDING_BOARD_SOUTH.max]);
    assert.equal(model.renderBoxes[0]!.rotation, undefined);
    assert.match(model.key, /^sign:standing:0:/);
  });

  it('applies −dir×22.5° Y rotation for non-zero ground_sign_direction', () => {
    const model = signModel(ref('minecraft:birch_standing_sign', { ground_sign_direction: 2 }));
    assert.equal(model.renderBoxes[0]!.rotation?.axis, 'y');
    assert.equal(model.renderBoxes[0]!.rotation?.angle, -45);
    assert.equal(model.renderBoxes[1]!.rotation?.angle, -45);
    assert.match(model.key, /^sign:standing:2:/);
  });

  it('builds wall boards on the correct cell face', () => {
    const n = signModel(ref('minecraft:wall_sign', { facing_direction: 2 }));
    assert.equal(n.renderBoxes.length, 1);
    assert.deepEqual(n.renderBoxes[0]!.min, [...SIGN_WALL_BOARD_NORTH.min]);
    assert.deepEqual(n.renderBoxes[0]!.max, [...SIGN_WALL_BOARD_NORTH.max]);
    assert.match(n.key, /^sign:wall:north:/);

    const e = signModel(ref('minecraft:acacia_wall_sign', { facing_direction: 5 }));
    assert.deepEqual(e.renderBoxes[0]!.min, [0, 4.5 * PX, 0]);
    assert.deepEqual(e.renderBoxes[0]!.max, [2 * PX, 12.5 * PX, 1]);

    const bad = tryBuildSign(ref('minecraft:wall_sign', { facing_direction: 0 }));
    assert.equal(bad.ok, false);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const sign = resolveBlockModel(ref('minecraft:standing_sign', { ground_sign_direction: 0 }))!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', sign), false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', sign), false);
  });

  it('resolver caches standing direction and wall facing separately', () => {
    resetBlockModelCache();
    const a = resolveBlockModel(ref('minecraft:standing_sign', { ground_sign_direction: 0 }))!;
    const b = resolveBlockModel(ref('minecraft:standing_sign', { ground_sign_direction: 8 }))!;
    const c = resolveBlockModel(ref('minecraft:wall_sign', { facing_direction: 2 }))!;
    assert.notEqual(a.key, b.key);
    assert.notEqual(a.key, c.key);
    assert.match(a.key, /:standing:0:/);
    assert.match(b.key, /:standing:8:/);
    assert.match(c.key, /:wall:north:/);
  });
});

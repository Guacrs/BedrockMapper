/**
 * PR41: hanging sign geometry — intrinsic hanging/attached_bit; no text glyphs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  hangingFacingFromStates,
  hangingGroundDirFromStates,
  hangingSignIsAttached,
  hangingSignIsHanging,
  hangingSignModeFromStates,
  hangingSignModel,
  isHangingSignName,
  tryBuildHangingSign,
} from '../server/renderer/3d/models/families/hanging-sign.ts';
import { isSignName } from '../server/renderer/3d/models/families/sign.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR41 hanging sign coverage', () => {
  it('classifies hanging signs as explicit; keeps standing/wall separate', () => {
    assert.equal(isHangingSignName('minecraft:oak_hanging_sign'), true);
    assert.equal(isHangingSignName('minecraft:crimson_hanging_sign'), true);
    assert.equal(isHangingSignName('minecraft:standing_sign'), false);
    assert.equal(isHangingSignName('minecraft:wall_sign'), false);
    assert.equal(isSignName('minecraft:oak_hanging_sign'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:oak_hanging_sign')?.family, 'hanging_sign');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_hanging_sign')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:standing_sign')?.bucket, 'explicit_ok');
  });
});

describe('PR41 hanging sign states (intrinsic)', () => {
  it('derives mode from hanging + attached_bit without neighbours', () => {
    assert.equal(hangingSignModeFromStates({ hanging: false }), 'wall');
    assert.equal(
      hangingSignModeFromStates({ hanging: true, attached_bit: false }),
      'ceiling_parallel',
    );
    assert.equal(
      hangingSignModeFromStates({ hanging: true, attached_bit: true }),
      'ceiling_attached',
    );
    assert.equal(hangingSignIsHanging({ hanging: true }), true);
    assert.equal(hangingSignIsAttached({ attached_bit: true }), true);
  });

  it('reads facing_direction and ground_sign_direction', () => {
    assert.equal(hangingFacingFromStates({ facing_direction: 2 }), 'north');
    assert.equal(hangingFacingFromStates({ facing_direction: 5 }), 'east');
    assert.equal(hangingFacingFromStates({ facing_direction: 0 }), null);
    assert.equal(hangingGroundDirFromStates({}), 0);
    assert.equal(hangingGroundDirFromStates({ ground_sign_direction: 8 }), 8);
  });
});

describe('PR41 hanging sign geometry', () => {
  it('builds ceiling parallel with board + two chains', () => {
    const model = hangingSignModel(
      ref('minecraft:oak_hanging_sign', {
        hanging: true,
        attached_bit: false,
        facing_direction: 3,
      }),
    );
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 3);
    assert.deepEqual(model.renderBoxes[0]!.min, [1 * PX, 0, 7 * PX]);
    assert.deepEqual(model.renderBoxes[0]!.max, [15 * PX, 10 * PX, 9 * PX]);
    assert.match(model.key, /^hanging_sign:ceiling_parallel:south:/);
  });

  it('builds ceiling attached V with Z-leaning chains at dir 0', () => {
    const model = hangingSignModel(
      ref('minecraft:spruce_hanging_sign', {
        hanging: true,
        attached_bit: true,
        ground_sign_direction: 0,
      }),
    );
    assert.equal(model.renderBoxes.length, 3);
    assert.equal(model.renderBoxes[1]!.rotation?.axis, 'z');
    assert.equal(model.renderBoxes[1]!.rotation?.angle, 30);
    assert.equal(model.renderBoxes[2]!.rotation?.angle, -30);
    assert.match(model.key, /^hanging_sign:ceiling_attached:0:/);
  });

  it('builds wall hanging with bar + hangers + board', () => {
    const model = hangingSignModel(
      ref('minecraft:acacia_hanging_sign', {
        hanging: false,
        facing_direction: 2,
      }),
    );
    assert.equal(model.renderBoxes.length, 4);
    assert.match(model.key, /^hanging_sign:wall:north:/);
    const bad = tryBuildHangingSign(ref('minecraft:oak_hanging_sign', { hanging: false }));
    assert.equal(bad.ok, false);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const sign = resolveBlockModel(
      ref('minecraft:oak_hanging_sign', {
        hanging: true,
        attached_bit: false,
        facing_direction: 3,
      }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', sign), false);
  });

  it('resolver caches modes separately', () => {
    resetBlockModelCache();
    const a = resolveBlockModel(
      ref('minecraft:oak_hanging_sign', {
        hanging: true,
        attached_bit: false,
        facing_direction: 3,
      }),
    )!;
    const b = resolveBlockModel(
      ref('minecraft:oak_hanging_sign', {
        hanging: true,
        attached_bit: true,
        ground_sign_direction: 0,
      }),
    )!;
    const c = resolveBlockModel(
      ref('minecraft:oak_hanging_sign', { hanging: false, facing_direction: 2 }),
    )!;
    assert.notEqual(a.key, b.key);
    assert.notEqual(a.key, c.key);
  });
});

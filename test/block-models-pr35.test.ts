/**
 * PR35: button geometry — face attachment + pressed/unpressed.
 * No attachment-system refactor; intrinsic BlockRef geometry only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import {
  BUTTON_FLOOR_DOWN,
  BUTTON_FLOOR_UP,
  buttonFacingFromStates,
  buttonIsPressed,
  isButtonName,
  tryBuildButton,
} from '../server/renderer/3d/models/families/button.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR35 button coverage', () => {
  it('classifies wood and stone-family button ids', () => {
    assert.equal(isButtonName('minecraft:stone_button'), true);
    assert.equal(isButtonName('minecraft:wooden_button'), true);
    assert.equal(isButtonName('minecraft:oak_button'), true);
    assert.equal(isButtonName('minecraft:polished_blackstone_button'), true);
    assert.equal(isButtonName('minecraft:acacia_button'), true);
    assert.equal(isButtonName('minecraft:stone'), false);
    assert.equal(isButtonName('minecraft:stone_pressure_plate'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:stone_button')?.family, 'button');
    assert.equal(classifyBlockModelCoverage('minecraft:crimson_button')?.implementation, 'explicit');
  });
});

describe('PR35 button states', () => {
  it('reads button_pressed_bit and facing_direction int/string', () => {
    assert.equal(buttonIsPressed({}), false);
    assert.equal(buttonIsPressed({ button_pressed_bit: true }), true);
    assert.equal(buttonIsPressed({ button_pressed_bit: 1 }), true);
    assert.equal(buttonIsPressed({ button_pressed_bit: false }), false);

    assert.equal(buttonFacingFromStates({ facing_direction: 0 }), 'down');
    assert.equal(buttonFacingFromStates({ facing_direction: 1 }), 'up');
    assert.equal(buttonFacingFromStates({ facing_direction: 2 }), 'north');
    assert.equal(buttonFacingFromStates({ facing_direction: 3 }), 'south');
    assert.equal(buttonFacingFromStates({ facing_direction: 4 }), 'west');
    assert.equal(buttonFacingFromStates({ facing_direction: 5 }), 'east');
    assert.equal(buttonFacingFromStates({ facing_direction: 'north' }), 'north');
    assert.equal(buttonFacingFromStates({ facing_direction: 'up' }), 'up');
    assert.equal(buttonFacingFromStates({}), null);
    assert.equal(buttonFacingFromStates({ facing_direction: 9 }), null);
  });
});

describe('PR35 button geometry', () => {
  it('floor unpressed matches Java button [5,0,6]–[11,2,10]', () => {
    const built = tryBuildButton(
      ref('minecraft:wooden_button', { facing_direction: 1, button_pressed_bit: false }),
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.facing, 'up');
    assert.equal(built.pressed, false);
    assert.deepEqual(built.model.renderBoxes[0]!.min, [...BUTTON_FLOOR_UP.min]);
    assert.deepEqual(built.model.renderBoxes[0]!.max, [...BUTTON_FLOOR_UP.max]);
    assert.equal(built.model.isFullCube, false);
    assert.match(built.model.key, /^button:up:up:/);
  });

  it('floor pressed is 1px tall', () => {
    const built = tryBuildButton(
      ref('minecraft:stone_button', { facing_direction: 1, button_pressed_bit: true }),
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual(built.model.renderBoxes[0]!.min, [...BUTTON_FLOOR_DOWN.min]);
    assert.deepEqual(built.model.renderBoxes[0]!.max, [...BUTTON_FLOOR_DOWN.max]);
    assert.equal(built.model.renderBoxes[0]!.max[1], PX);
    assert.match(built.model.key, /^button:up:down:/);
  });

  it('ceiling button sits under y=1', () => {
    const built = tryBuildButton(
      ref('minecraft:spruce_button', { facing_direction: 0, button_pressed_bit: false }),
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.facing, 'down');
    assert.equal(built.model.renderBoxes[0]!.max[1], 1);
    assert.equal(built.model.renderBoxes[0]!.min[1], 1 - 2 * PX);
  });

  it('wall buttons place 2px plates on the facing side of the cell', () => {
    const cases: Array<{
      dir: number;
      facing: string;
      axis: 0 | 2;
      lo: boolean;
    }> = [
      { dir: 2, facing: 'north', axis: 2, lo: true },
      { dir: 3, facing: 'south', axis: 2, lo: false },
      { dir: 4, facing: 'west', axis: 0, lo: true },
      { dir: 5, facing: 'east', axis: 0, lo: false },
    ];
    for (const c of cases) {
      const built = tryBuildButton(
        ref('minecraft:birch_button', { facing_direction: c.dir, button_pressed_bit: false }),
      );
      assert.equal(built.ok, true, c.facing);
      if (!built.ok) continue;
      assert.equal(built.facing, c.facing);
      const box = built.model.renderBoxes[0]!;
      const depth = box.max[c.axis]! - box.min[c.axis]!;
      assert.ok(Math.abs(depth - 2 * PX) < 1e-9, c.facing);
      if (c.lo) {
        assert.equal(box.min[c.axis], 0, c.facing);
      } else {
        assert.equal(box.max[c.axis], 1, c.facing);
      }
    }
  });

  it('invalid facing falls back to full cube via resolver', () => {
    resetBlockModelCache();
    const model = resolveBlockModel(
      ref('minecraft:stone_button', { facing_direction: 9, button_pressed_bit: false }),
    )!;
    assert.equal(model.isFullCube, true);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const button = resolveBlockModel(
      ref('minecraft:stone_button', { facing_direction: 1, button_pressed_bit: false }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', button), false);
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', button), false);
  });
});

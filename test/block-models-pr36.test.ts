/**
 * PR36: lever geometry — lever_direction + open_bit (not button facing).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import {
  isLeverName,
  leverDirectionFromStates,
  leverIsOpen,
  LEVER_FLOOR_BASE,
  tryBuildLever,
} from '../server/renderer/3d/models/families/lever.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR36 lever coverage', () => {
  it('classifies lever; does not confuse with buttons', () => {
    assert.equal(isLeverName('minecraft:lever'), true);
    assert.equal(isLeverName('minecraft:stone_button'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:lever')?.family, 'lever');
    assert.equal(classifyBlockModelCoverage('minecraft:lever')?.implementation, 'explicit');
  });
});

describe('PR36 lever states', () => {
  it('reads lever_direction string and legacy int; open_bit powered', () => {
    assert.equal(leverDirectionFromStates({ lever_direction: 'up_north_south' }), 'up_north_south');
    assert.equal(leverDirectionFromStates({ lever_direction: 5 }), 'up_north_south');
    assert.equal(leverDirectionFromStates({ lever_direction: 0 }), 'down_east_west');
    assert.equal(leverDirectionFromStates({ lever_direction: 'north' }), 'north');
    assert.equal(leverDirectionFromStates({}), null);
    assert.equal(leverDirectionFromStates({ facing_direction: 1 }), null);

    assert.equal(leverIsOpen({ open_bit: true }), true);
    assert.equal(leverIsOpen({ open_bit: 1 }), true);
    assert.equal(leverIsOpen({ open_bit: false }), false);
    assert.equal(leverIsOpen({}), false);
  });
});

describe('PR36 lever geometry', () => {
  it('floor up_north_south has cobble base + rotated handle', () => {
    const off = tryBuildLever(
      ref('minecraft:lever', { lever_direction: 'up_north_south', open_bit: false }),
    );
    const on = tryBuildLever(
      ref('minecraft:lever', { lever_direction: 'up_north_south', open_bit: true }),
    );
    assert.equal(off.ok, true);
    assert.equal(on.ok, true);
    if (!off.ok || !on.ok) return;
    assert.equal(off.model.renderBoxes.length, 2);
    assert.equal(off.model.occlusionBoxes.length, 1);
    assert.deepEqual(off.model.renderBoxes[0]!.min, [...LEVER_FLOOR_BASE.min]);
    assert.deepEqual(off.model.renderBoxes[0]!.max, [...LEVER_FLOOR_BASE.max]);
    assert.equal(off.model.renderBoxes[1]!.rotation?.axis, 'x');
    assert.equal(off.model.renderBoxes[1]!.rotation?.angle, 45);
    assert.equal(on.model.renderBoxes[1]!.rotation?.angle, -45);
    assert.equal(off.model.isFullCube, false);
    assert.match(off.model.key, /^lever:up_north_south:off$/);
    assert.match(on.model.key, /^lever:up_north_south:on$/);
  });

  it('up_east_west is Y-rotated floor variant', () => {
    const built = tryBuildLever(
      ref('minecraft:lever', { lever_direction: 'up_east_west', open_bit: false }),
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.match(built.model.key, /^lever:up_east_west:off$/);
    // After 90° CCW, former Z-span becomes X-span → base wider in X than Z.
    const base = built.model.renderBoxes[0]!;
    const xSpan = base.max[0]! - base.min[0]!;
    const zSpan = base.max[2]! - base.min[2]!;
    assert.ok(xSpan > zSpan);
  });

  it('ceiling flip places base under y=1', () => {
    const built = tryBuildLever(
      ref('minecraft:lever', { lever_direction: 'down_north_south', open_bit: false }),
    );
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.model.renderBoxes[0]!.max[1], 1);
    assert.ok(built.model.renderBoxes[0]!.min[1]! >= 1 - 3 * PX - 1e-9);
  });

  it('wall levers sit on the facing cell face with Z-rotated handle', () => {
    for (const dir of ['west', 'north', 'east', 'south'] as const) {
      const built = tryBuildLever(
        ref('minecraft:lever', { lever_direction: dir, open_bit: true }),
      );
      assert.equal(built.ok, true, dir);
      if (!built.ok) continue;
      assert.match(built.model.key, new RegExp(`^lever:wall:${dir}:on$`));
      assert.equal(built.model.renderBoxes.length, 2, dir);
      assert.ok(built.model.renderBoxes[1]!.rotation, dir);
    }
    const west = tryBuildLever(ref('minecraft:lever', { lever_direction: 'west', open_bit: false }))!;
    assert.equal(west.ok, true);
    if (!west.ok) return;
    assert.equal(west.model.renderBoxes[0]!.min[0], 0);
    assert.equal(west.model.renderBoxes[0]!.max[0], 3 * PX);
  });

  it('invalid lever_direction falls back to full cube', () => {
    resetBlockModelCache();
    const model = resolveBlockModel(
      ref('minecraft:lever', { lever_direction: 'bogus', open_bit: false }),
    )!;
    assert.equal(model.isFullCube, true);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const lever = resolveBlockModel(
      ref('minecraft:lever', { lever_direction: 'up_north_south', open_bit: false }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', lever), false);
  });
});

/**
 * PR45: fence gate geometry — intrinsic facing / open / in_wall (not fence mask).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  FENCE_GATE_CLOSED_MIN_Y,
  FENCE_GATE_POST_TOP,
  FENCE_GATE_WALL_MIN_Y,
  FENCE_GATE_WALL_POST_TOP,
  fenceGateFacingFromStates,
  fenceGateInWall,
  fenceGateIsOpen,
  fenceGateModel,
  isFenceGateName,
  quarterTurnsForFenceGateFacing,
  tryBuildFenceGate,
} from '../server/renderer/3d/models/families/fence_gate.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR45 fence gate coverage', () => {
  it('classifies gate ids as explicit_ok fence_gate family', () => {
    assert.equal(isFenceGateName('minecraft:oak_fence_gate'), true);
    assert.equal(isFenceGateName('minecraft:fence_gate'), true);
    assert.equal(isFenceGateName('minecraft:oak_fence'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:oak_fence_gate')?.family, 'fence_gate');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_fence_gate')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:oak_fence_gate')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:bamboo_fence_gate')?.bucket, 'explicit_ok');
  });
});

describe('PR45 fence gate states', () => {
  it('reads cardinal / legacy direction, open_bit, in_wall_bit', () => {
    assert.equal(
      fenceGateFacingFromStates({ 'minecraft:cardinal_direction': 'west' }),
      'west',
    );
    assert.equal(fenceGateFacingFromStates({ direction: 2 }), 'north');
    assert.equal(fenceGateFacingFromStates({}), null);
    assert.equal(fenceGateIsOpen({ open_bit: true }), true);
    assert.equal(fenceGateIsOpen({ open_bit: false }), false);
    assert.equal(fenceGateIsOpen({}), false);
    assert.equal(fenceGateInWall({ in_wall_bit: true }), true);
    assert.equal(fenceGateInWall({ in_wall_bit: false }), false);
  });

  it('maps facing to Java blockstate Y turns from south base', () => {
    assert.equal(quarterTurnsForFenceGateFacing('south'), 0);
    assert.equal(quarterTurnsForFenceGateFacing('west'), 3);
    assert.equal(quarterTurnsForFenceGateFacing('north'), 2);
    assert.equal(quarterTurnsForFenceGateFacing('east'), 1);
  });
});

describe('PR45 fence gate geometry', () => {
  it('builds closed normal model with 8 boxes and post height 16/16', () => {
    const model = fenceGateModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      false,
      false,
    );
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 8);
    assert.match(model.key, /^fence_gate:south:closed:normal:/);
    const maxY = Math.max(...model.renderBoxes.map((b) => b.max[1]));
    const minY = Math.min(...model.renderBoxes.map((b) => b.min[1]));
    assert.equal(maxY, FENCE_GATE_POST_TOP);
    assert.equal(minY, FENCE_GATE_CLOSED_MIN_Y);
  });

  it('builds open model with swung doors (still 8 boxes)', () => {
    const closed = fenceGateModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      false,
      false,
    );
    const open = fenceGateModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: true,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      true,
      false,
    );
    assert.equal(open.renderBoxes.length, 8);
    assert.match(open.key, /^fence_gate:south:open:normal:/);
    // Open doors extend toward +Z; closed barrier is at z≈7–9/16
    const closedMaxZ = Math.max(...closed.renderBoxes.map((b) => b.max[2]));
    const openMaxZ = Math.max(...open.renderBoxes.map((b) => b.max[2]));
    assert.ok(openMaxZ > closedMaxZ, `open maxZ ${openMaxZ} should exceed closed ${closedMaxZ}`);
  });

  it('lowers geometry by 3px when in_wall_bit', () => {
    const wall = fenceGateModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: true,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      false,
      true,
    );
    assert.match(wall.key, /^fence_gate:south:closed:wall:/);
    const maxY = Math.max(...wall.renderBoxes.map((b) => b.max[1]));
    const minY = Math.min(...wall.renderBoxes.map((b) => b.min[1]));
    assert.equal(maxY, FENCE_GATE_WALL_POST_TOP);
    assert.equal(minY, FENCE_GATE_WALL_MIN_Y);
  });

  it('orients via rotateModelY; variants share box count', () => {
    resetBlockModelCache();
    const s = resolveBlockModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
    )!;
    const n = resolveBlockModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'north',
      }),
    )!;
    const spruce = resolveBlockModel(
      ref('minecraft:spruce_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
    )!;
    assert.match(s.key, /^fence_gate:south:closed:normal:/);
    assert.match(n.key, /^fence_gate:north:closed:normal:/);
    assert.notEqual(s.key, n.key);
    assert.equal(s.renderBoxes.length, spruce.renderBoxes.length);
    assert.equal(spruce.renderBoxes[0]!.faces.north?.textureKey, 'blocks/planks_spruce');
  });

  it('aliases oak_fence_gate texture to legacy fence_gate planks', () => {
    const model = fenceGateModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
    );
    assert.equal(model.renderBoxes[0]!.faces.north?.textureKey, 'blocks/planks_oak');
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const gate = resolveBlockModel(
      ref('minecraft:oak_fence_gate', {
        open_bit: false,
        in_wall_bit: false,
        'minecraft:cardinal_direction': 'south',
      }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', gate), false);
  });

  it('rejects missing facing; accepts legacy direction', () => {
    assert.equal(tryBuildFenceGate(ref('minecraft:oak_fence_gate', { open_bit: false })).ok, false);
    const legacy = tryBuildFenceGate(
      ref('minecraft:birch_fence_gate', { open_bit: false, in_wall_bit: false, direction: 0 }),
    );
    assert.equal(legacy.ok, true);
    if (legacy.ok) assert.match(legacy.model.key, /^fence_gate:south:closed:normal:/);
  });
});

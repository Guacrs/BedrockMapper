/**
 * PR30: coverage-driven common geometry — carpet, pressure plate, snow layer,
 * ladder, torch, cactus. Bedrock states researched; no texture redesign.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isCactusName, cactusModel } from '../server/renderer/3d/models/families/cactus.ts';
import { isCarpetName, carpetModel } from '../server/renderer/3d/models/families/carpet.ts';
import { isLadderName, tryBuildLadder } from '../server/renderer/3d/models/families/ladder.ts';
import {
  isPressurePlateName,
  pressurePlateIsPressed,
  pressurePlateModel,
} from '../server/renderer/3d/models/families/pressure-plate.ts';
import {
  isSnowLayerName,
  snowLayerCount,
  snowLayerModel,
} from '../server/renderer/3d/models/families/snow-layer.ts';
import { isTorchName, torchFacingFromStates, torchModel } from '../server/renderer/3d/models/families/torch.ts';
import {
  classifyBlockModelCoverage,
} from '../server/renderer/3d/models/coverage.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

describe('PR30 carpet', () => {
  it('classifies coloured and moss carpets', () => {
    assert.equal(isCarpetName('minecraft:red_carpet'), true);
    assert.equal(isCarpetName('minecraft:moss_carpet'), true);
    assert.equal(isCarpetName('minecraft:pale_moss_carpet'), true);
    assert.equal(isCarpetName('minecraft:oak_slab'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:white_carpet')?.family, 'carpet');
  });

  it('builds a 1px floor plate that is not full-cube', () => {
    resetBlockModelCache();
    const model = resolveBlockModel({ name: 'minecraft:white_carpet', states: {} } as BlockRef)!;
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 1);
    // Bedrock pixel plate: full XZ, height 1/16 from y=0.
    assert.deepEqual(model.renderBoxes[0]!.min, [0, 0, 0]);
    assert.deepEqual(model.renderBoxes[0]!.max, [1, PX, 1]);
    assert.match(model.key, /^carpet:/);
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    // Full XZ at y=0 → occludes the block below (same as bottom slab).
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'up', model), true);
    // Only 1px tall → does not fully occlude a side neighbour's unit face.
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', model), false);
  });
});

describe('PR30 pressure plate', () => {
  it('detects ids and pressed state from redstone_signal', () => {
    assert.equal(isPressurePlateName('minecraft:oak_pressure_plate'), true);
    assert.equal(isPressurePlateName('minecraft:stone_pressure_plate'), true);
    assert.equal(pressurePlateIsPressed({ redstone_signal: 0 }), false);
    assert.equal(pressurePlateIsPressed({ redstone_signal: 1 }), true);
    assert.equal(pressurePlateIsPressed({ redstone_signal: 15 }), true);
  });

  it('uses shorter height when pressed', () => {
    resetBlockModelCache();
    const up = pressurePlateModel({
      name: 'minecraft:stone_pressure_plate',
      states: { redstone_signal: 0 },
    });
    const down = pressurePlateModel({
      name: 'minecraft:stone_pressure_plate',
      states: { redstone_signal: 1 },
    });
    assert.ok(up.renderBoxes[0]!.max[1]! > down.renderBoxes[0]!.max[1]!);
    assert.equal(up.isFullCube, false);
    assert.match(up.key, /:up:/);
    assert.match(down.key, /:down:/);
  });
});

describe('PR30 snow layer', () => {
  it('maps Bedrock height 0..7 → 1..8 layers of 2px', () => {
    assert.equal(isSnowLayerName('minecraft:snow_layer'), true);
    assert.equal(isSnowLayerName('minecraft:snow'), false);
    assert.equal(snowLayerCount({ height: 0 }), 1);
    assert.equal(snowLayerCount({ height: 7 }), 8);
    assert.equal(snowLayerCount({}), 1);
  });

  it('scales Y max with layer count', () => {
    resetBlockModelCache();
    const one = snowLayerModel({ name: 'minecraft:snow_layer', states: { height: 0 } });
    const four = snowLayerModel({ name: 'minecraft:snow_layer', states: { height: 3 } });
    const full = snowLayerModel({ name: 'minecraft:snow_layer', states: { height: 7 } });
    // height 0 → 1 layer = 2px; height 3 → 4 layers = 8px; height 7 → 16px.
    assert.deepEqual(one.renderBoxes[0]!.min, [0, 0, 0]);
    assert.deepEqual(one.renderBoxes[0]!.max, [1, 2 * PX, 1]);
    assert.deepEqual(four.renderBoxes[0]!.max, [1, 8 * PX, 1]);
    assert.equal(full.renderBoxes[0]!.max[1], 1);
    assert.equal(full.isFullCube, false);
  });
});

describe('PR30 ladder', () => {
  it('builds a north-facing panel; invalid facing falls back to cube', () => {
    assert.equal(isLadderName('minecraft:ladder'), true);
    const ok = tryBuildLadder({
      name: 'minecraft:ladder',
      states: { facing_direction: 2 },
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.facing, 'north');
      assert.equal(ok.model.renderBoxes[0]!.max[2], 3 * PX);
      assert.equal(ok.model.isFullCube, false);
    }
    resetBlockModelCache();
    const fallback = resolveBlockModel({
      name: 'minecraft:ladder',
      states: { facing_direction: 0 },
    } as BlockRef)!;
    assert.equal(fallback.isFullCube, true);
  });
});

describe('PR30 torch', () => {
  it('floor torch is upright cross; wall torch against attachment face', () => {
    assert.equal(isTorchName('minecraft:torch'), true);
    assert.equal(isTorchName('minecraft:soul_torch'), true);
    assert.equal(isTorchName('minecraft:lantern'), false);
    assert.equal(torchFacingFromStates({ torch_facing_direction: 'top' }), 'top');
    assert.equal(torchFacingFromStates({ torch_facing_direction: 'east' }), 'east');
    assert.equal(torchFacingFromStates({}), 'top');

    resetBlockModelCache();
    // Floor: upright cross, height 10/16 — no emissive (PR33).
    const floor = torchModel({ name: 'minecraft:torch', states: { torch_facing_direction: 'top' } });
    assert.equal(floor.renderBoxes.length, 2);
    assert.equal(floor.isFullCube, false);
    assert.equal(floor.renderBoxes[0]!.max[1], 10 * PX);
    assert.equal(floor.renderBoxes[1]!.max[1], 10 * PX);

    // Microsoft: torch_facing_direction = "block the torch is attached to"
    // relative to its position → stub sits on that face of the cell.
    const against = {
      west: (b: { min: readonly number[]; max: readonly number[] }) =>
        b.min[0] === 0 && b.max[0] === 10 * PX,
      east: (b: { min: readonly number[]; max: readonly number[] }) =>
        b.min[0] === 1 - 10 * PX && b.max[0] === 1,
      north: (b: { min: readonly number[]; max: readonly number[] }) =>
        b.min[2] === 0 && b.max[2] === 10 * PX,
      south: (b: { min: readonly number[]; max: readonly number[] }) =>
        b.min[2] === 1 - 10 * PX && b.max[2] === 1,
    } as const;
    for (const dir of ['west', 'east', 'north', 'south'] as const) {
      const wall = torchModel({
        name: 'minecraft:torch',
        states: { torch_facing_direction: dir },
      });
      assert.equal(wall.renderBoxes.length, 1, dir);
      assert.ok(against[dir](wall.renderBoxes[0]!), `${dir} must sit on attachment face`);
    }
  });
});

describe('PR30 cactus', () => {
  it('insets 1px on sides and is not full-cube', () => {
    assert.equal(isCactusName('minecraft:cactus'), true);
    assert.equal(isCactusName('minecraft:cactus_flower'), false);
    const model = cactusModel('minecraft:cactus');
    // Bedrock footprint [1,0,1]–[15,16,15] px — sides do not meet unit plane.
    assert.deepEqual(model.renderBoxes[0]!.min, [PX, 0, PX]);
    assert.deepEqual(model.renderBoxes[0]!.max, [1 - PX, 1, 1 - PX]);
    assert.equal(model.isFullCube, false);
    assert.equal(classifyBlockModelCoverage('minecraft:cactus')?.family, 'cactus');
    resetBlockModelCache();
    const stone = resolveBlockModel({ name: 'minecraft:stone', states: {} } as BlockRef)!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', model), false);
  });
});

describe('PR30 coverage inventory', () => {
  it('moves PR30 families out of accidental full_cube and keeps gates as fallback', () => {
    assert.equal(classifyBlockModelCoverage('minecraft:red_carpet')?.family, 'carpet');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_pressure_plate')?.family, 'pressure_plate');
    assert.equal(classifyBlockModelCoverage('minecraft:snow_layer')?.family, 'snow_layer');
    assert.equal(classifyBlockModelCoverage('minecraft:ladder')?.family, 'ladder');
    assert.equal(classifyBlockModelCoverage('minecraft:torch')?.family, 'torch');
    assert.equal(classifyBlockModelCoverage('minecraft:cactus')?.family, 'cactus');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_fence_gate')?.family, 'fallback');
    assert.equal(classifyBlockModelCoverage('minecraft:lantern')?.family, 'future');
    assert.equal(classifyBlockModelCoverage('minecraft:stone_button')?.family, 'future');
  });
});

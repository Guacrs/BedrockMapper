/**
 * PR44: campfire geometry — logs + lit fire planes; extinguished + cardinal facing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blockLightingFor,
  isEmissiveBlock,
} from '../server/renderer/3d/lighting/block-lighting.ts';
import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  CAMPFIRE_LOG_HEIGHT,
  campfireFacingFromStates,
  campfireIsLit,
  campfireModel,
  isCampfireName,
  quarterTurnsForCampfireFacing,
  tryBuildCampfire,
} from '../server/renderer/3d/models/families/campfire.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR44 campfire coverage', () => {
  it('classifies campfire ids as explicit_ok', () => {
    assert.equal(isCampfireName('minecraft:campfire'), true);
    assert.equal(isCampfireName('minecraft:soul_campfire'), true);
    assert.equal(isCampfireName('minecraft:soul_torch'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:campfire')?.family, 'campfire');
    assert.equal(classifyBlockModelCoverage('minecraft:campfire')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:campfire')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:soul_campfire')?.bucket, 'explicit_ok');
  });
});

describe('PR44 campfire states', () => {
  it('reads extinguished (inverted lit) and cardinal / legacy direction', () => {
    assert.equal(campfireIsLit({ extinguished: false }), true);
    assert.equal(campfireIsLit({ extinguished: true }), false);
    assert.equal(campfireIsLit({}), true);
    assert.equal(campfireFacingFromStates({ 'minecraft:cardinal_direction': 'west' }), 'west');
    assert.equal(campfireFacingFromStates({ direction: 2 }), 'north');
    assert.equal(campfireFacingFromStates({}), null);
  });

  it('maps facing to Java blockstate Y turns from south base', () => {
    assert.equal(quarterTurnsForCampfireFacing('south'), 0);
    assert.equal(quarterTurnsForCampfireFacing('west'), 3);
    assert.equal(quarterTurnsForCampfireFacing('north'), 2);
    assert.equal(quarterTurnsForCampfireFacing('east'), 1);
  });
});

describe('PR44 campfire geometry', () => {
  it('builds lit model with 5 logs + 2 fire planes', () => {
    const model = campfireModel(
      ref('minecraft:campfire', {
        extinguished: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      true,
    );
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 7);
    assert.equal(model.renderBoxes[5]!.rotation?.angle, 45);
    assert.equal(model.renderBoxes[5]!.rotation?.rescale, true);
    assert.deepEqual(model.occlusionBoxes[0]!.max[1], CAMPFIRE_LOG_HEIGHT);
    assert.match(model.key, /^campfire:south:lit:/);
  });

  it('builds unlit model without fire planes', () => {
    const model = campfireModel(
      ref('minecraft:campfire', {
        extinguished: true,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      false,
    );
    assert.equal(model.renderBoxes.length, 5);
    assert.match(model.key, /^campfire:south:unlit:/);
    // Unlit logs use plain log texture (no lit_log)
    assert.equal(model.renderBoxes[0]!.faces.east?.textureKey, 'blocks/campfire_log');
  });

  it('soul campfire uses soul fire / lit_log textures when lit', () => {
    const model = campfireModel(
      ref('minecraft:soul_campfire', {
        extinguished: false,
        'minecraft:cardinal_direction': 'south',
      }),
      'south',
      true,
    );
    assert.equal(model.renderBoxes[5]!.faces.north?.textureKey, 'blocks/soul_campfire');
    assert.equal(model.renderBoxes[0]!.faces.east?.textureKey, 'blocks/soul_campfire_log_lit');
  });

  it('orients via rotateModelY for each cardinal', () => {
    resetBlockModelCache();
    const s = resolveBlockModel(
      ref('minecraft:campfire', {
        extinguished: false,
        'minecraft:cardinal_direction': 'south',
      }),
    )!;
    const n = resolveBlockModel(
      ref('minecraft:campfire', {
        extinguished: false,
        'minecraft:cardinal_direction': 'north',
      }),
    )!;
    assert.match(s.key, /^campfire:south:lit:/);
    assert.match(n.key, /^campfire:north:lit:/);
    assert.notEqual(s.key, n.key);
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const fire = resolveBlockModel(
      ref('minecraft:campfire', {
        extinguished: false,
        'minecraft:cardinal_direction': 'south',
      }),
    )!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', fire), false);
  });

  it('rejects missing facing; accepts legacy direction', () => {
    assert.equal(tryBuildCampfire(ref('minecraft:campfire', { extinguished: false })).ok, false);
    const legacy = tryBuildCampfire(
      ref('minecraft:campfire', { extinguished: false, direction: 0 }),
    );
    assert.equal(legacy.ok, true);
    if (legacy.ok) assert.match(legacy.model.key, /^campfire:south:lit:/);
  });
});

describe('PR44 campfire emissive (PR33 routing)', () => {
  it('emits when lit and is dark when extinguished', () => {
    assert.equal(
      isEmissiveBlock('minecraft:campfire', { extinguished: false }),
      true,
    );
    assert.equal(
      isEmissiveBlock('minecraft:campfire', { extinguished: true }),
      false,
    );
    assert.equal(blockLightingFor('minecraft:campfire', { extinguished: true })?.emission, 0);
    assert.ok(
      (blockLightingFor('minecraft:campfire', { extinguished: false })?.emission ?? 0) > 0,
    );
    assert.ok(
      (blockLightingFor('minecraft:soul_campfire', { extinguished: false })?.emission ?? 0) >
        0,
    );
    // Soul is dimmer than normal when lit
    const normal = blockLightingFor('minecraft:campfire', { extinguished: false })!.emission;
    const soul = blockLightingFor('minecraft:soul_campfire', { extinguished: false })!.emission;
    assert.ok(soul < normal);
  });
});

/**
 * Phase 3: automated model-family coverage inventory against appearance DB.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  classifyBlockModelCoverage,
  summarizeCoverage,
  type ModelCoverageEntry,
} from '../server/renderer/3d/models/coverage.ts';

function appearanceBlockNames(): string[] {
  const raw = JSON.parse(readFileSync('data/textures/block-appearance.json', 'utf8')) as {
    blocks?: Record<string, unknown>;
  } & Record<string, unknown>;
  const blocks = raw.blocks ?? raw;
  return Object.keys(blocks).filter((k) => k.startsWith('minecraft:') || !k.includes(':'));
}

describe('model family coverage inventory', () => {
  it('classifies known families with explicit vs fallback distinctions', () => {
    assert.equal(classifyBlockModelCoverage('minecraft:stone')?.family, 'full_cube');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_slab')?.family, 'slab');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_stairs')?.family, 'stair');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_fence')?.family, 'fence');
    assert.equal(classifyBlockModelCoverage('minecraft:glass_pane')?.family, 'pane');
    assert.equal(classifyBlockModelCoverage('minecraft:wooden_door')?.family, 'door');
    assert.equal(classifyBlockModelCoverage('minecraft:oak_trapdoor')?.family, 'trapdoor');
    assert.equal(classifyBlockModelCoverage('minecraft:cobblestone_wall')?.family, 'wall');
    assert.equal(classifyBlockModelCoverage('minecraft:short_grass')?.family, 'cross');
    assert.equal(classifyBlockModelCoverage('minecraft:short_grass')?.implementation, 'explicit');
    assert.equal(classifyBlockModelCoverage('minecraft:tall_grass')?.family, 'future');
    assert.equal(classifyBlockModelCoverage('minecraft:lectern')?.family, 'future');
    assert.equal(classifyBlockModelCoverage('minecraft:air'), null);
  });

  it('summarizes appearance-DB coverage without claiming fallback equals correct models', () => {
    const entries: ModelCoverageEntry[] = [];
    for (const name of appearanceBlockNames()) {
      const e = classifyBlockModelCoverage(name);
      if (e) entries.push(e);
    }
    const summary = summarizeCoverage(entries);
    assert.ok(summary.total > 100, 'appearance DB should list many blocks');
    assert.ok(summary.byFamily.wall >= 10, 'expected multiple wall variants');
    assert.ok(summary.byFamily.fence >= 5);
    assert.ok(summary.byFamily.pane >= 1);
    assert.ok(summary.byFamily.cross >= 10, 'PR25 allowlist plants');
    assert.ok(summary.byFamily.full_cube >= 50);
    assert.ok(summary.byFamily.future >= 5);
    // Explicit families include cube/slab/stair/fence/pane/door/trapdoor/wall/cross
    assert.ok(summary.byImplementation.explicit >= 60);
  });
});

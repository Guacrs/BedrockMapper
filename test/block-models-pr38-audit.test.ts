/**
 * PR38: geometry correctness audit — which cubes are wrong?
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditCatalog,
  classifyGeometryAudit,
  groupRoadmapByCategory,
  roadmapEntries,
  summarizeGeometryAudit,
} from '../server/renderer/3d/models/geometry-audit.ts';

describe('PR38 geometry audit classification', () => {
  it('marks dedicated families as explicit_ok', () => {
    assert.equal(classifyGeometryAudit('minecraft:oak_stairs')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:rail')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:lever')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:stone')?.bucket, 'intentional_full_cube');
  });

  it('flags known non-cubes that still mesh as full cubes', () => {
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.category, 'hanging_sign');
    assert.equal(classifyGeometryAudit('minecraft:oak_hanging_sign')?.priority, 'p0');

    assert.equal(classifyGeometryAudit('minecraft:chest')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:chain')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:candle')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:campfire')?.bucket, 'known_incorrect');
    assert.equal(classifyGeometryAudit('minecraft:tripwire_hook')?.category, 'tripwire_hook');
    assert.equal(classifyGeometryAudit('minecraft:brewing_stand')?.priority, 'p2');
  });

  it('keeps fence gates as intentional fallback with roadmap priority', () => {
    const g = classifyGeometryAudit('minecraft:oak_fence_gate');
    assert.equal(g?.bucket, 'intentional_fallback');
    assert.equal(g?.category, 'fence_gate');
    assert.equal(g?.priority, 'p1');
  });

  it('does not flag ordinary planks/logs as incorrect', () => {
    assert.equal(classifyGeometryAudit('minecraft:oak_planks')?.bucket, 'intentional_full_cube');
    assert.equal(classifyGeometryAudit('minecraft:bamboo_planks')?.bucket, 'intentional_full_cube');
    assert.equal(classifyGeometryAudit('minecraft:stone')?.bucket, 'intentional_full_cube');
  });
});

describe('PR38 catalog audit', () => {
  it('audits the appearance∪colors catalog with a non-empty incorrect backlog', () => {
    const entries = auditCatalog();
    const summary = summarizeGeometryAudit(entries);
    assert.ok(summary.total > 1000, `catalog too small: ${summary.total}`);
    assert.ok(summary.byBucket.explicit_ok > 100);
    assert.ok(summary.byBucket.intentional_full_cube > 100);
    assert.ok(summary.incorrectTotal > 50, `expected substantial incorrect backlog, got ${summary.incorrectTotal}`);
    assert.ok(summary.byPriority.p0 > 10, 'p0 should include signs/chests/candles/chains');

    const roadmap = groupRoadmapByCategory(entries);
    assert.ok(roadmap.some((g) => g.category === 'hanging_sign' || g.category === 'sign'));
    assert.ok(roadmap.some((g) => g.category === 'chest'));
    assert.ok(roadmapEntries(entries).length === summary.incorrectTotal + summary.byBucket.intentional_fallback);
  });
});

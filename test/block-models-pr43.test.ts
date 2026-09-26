/**
 * PR43: chain geometry — crossed 3px planes + pillar_axis orientation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBlockModelCoverage } from '../server/renderer/3d/models/coverage.ts';
import { classifyGeometryAudit } from '../server/renderer/3d/models/geometry-audit.ts';
import {
  CHAIN_PLANE_A_Y,
  CHAIN_SHAFT_Y,
  chainAxisFromStates,
  chainModel,
  isChainName,
  tryBuildChain,
} from '../server/renderer/3d/models/families/chain.ts';
import { isFaceFullyOccluded } from '../server/renderer/3d/models/occlude.ts';
import { resolveBlockModel, resetBlockModelCache } from '../server/renderer/3d/models/resolve.ts';
import type { BlockRef } from '../server/renderer/3d/models/types.ts';

const PX = 1 / 16;

function ref(name: string, states: BlockRef['states'] = {}): BlockRef {
  return { name, states };
}

describe('PR43 chain coverage', () => {
  it('classifies chain family ids as explicit_ok', () => {
    assert.equal(isChainName('minecraft:chain'), true);
    assert.equal(isChainName('minecraft:iron_chain'), true);
    assert.equal(isChainName('minecraft:copper_chain'), true);
    assert.equal(isChainName('minecraft:waxed_oxidized_copper_chain'), true);
    assert.equal(isChainName('minecraft:chain_command_block'), false);
    assert.equal(classifyBlockModelCoverage('minecraft:chain')?.family, 'chain');
    assert.equal(classifyBlockModelCoverage('minecraft:iron_chain')?.implementation, 'explicit');
    assert.equal(classifyGeometryAudit('minecraft:chain')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:copper_chain')?.bucket, 'explicit_ok');
    assert.equal(classifyGeometryAudit('minecraft:weathered_copper_chain')?.bucket, 'explicit_ok');
  });
});

describe('PR43 chain states', () => {
  it('reads pillar_axis and defaults missing/invalid to y', () => {
    assert.equal(chainAxisFromStates({ pillar_axis: 'x' }), 'x');
    assert.equal(chainAxisFromStates({ pillar_axis: 'y' }), 'y');
    assert.equal(chainAxisFromStates({ pillar_axis: 'z' }), 'z');
    assert.equal(chainAxisFromStates({}), 'y');
    assert.equal(chainAxisFromStates({ pillar_axis: 'bogus' }), 'y');
  });
});

describe('PR43 chain geometry', () => {
  it('builds vertical crossed planes with 45° Y rotation and 3px shaft', () => {
    const model = chainModel(ref('minecraft:iron_chain', { pillar_axis: 'y' }), 'y');
    assert.equal(model.isFullCube, false);
    assert.equal(model.renderBoxes.length, 2);
    assert.deepEqual(model.renderBoxes[0]!.min, CHAIN_PLANE_A_Y.min);
    assert.deepEqual(model.renderBoxes[0]!.max, CHAIN_PLANE_A_Y.max);
    assert.equal(model.renderBoxes[0]!.rotation?.axis, 'y');
    assert.equal(model.renderBoxes[0]!.rotation?.angle, 45);
    assert.equal(model.renderBoxes[1]!.rotation?.axis, 'y');
    assert.deepEqual(model.occlusionBoxes[0]!.min, CHAIN_SHAFT_Y.min);
    assert.deepEqual(model.occlusionBoxes[0]!.max, CHAIN_SHAFT_Y.max);
    assert.match(model.key, /^chain:y:/);
  });

  it('builds x and z orientations with remapped length axis', () => {
    const x = chainModel(ref('minecraft:iron_chain', { pillar_axis: 'x' }), 'x');
    const z = chainModel(ref('minecraft:iron_chain', { pillar_axis: 'z' }), 'z');
    assert.match(x.key, /^chain:x:/);
    assert.match(z.key, /^chain:z:/);
    assert.equal(x.renderBoxes[0]!.rotation?.axis, 'x');
    assert.equal(z.renderBoxes[0]!.rotation?.axis, 'z');
    // X length: min.x=0 max.x=1, cross-section in YZ at 6.5–9.5
    assert.equal(x.renderBoxes[0]!.min[0], 0);
    assert.equal(x.renderBoxes[0]!.max[0], 1);
    assert.deepEqual(x.occlusionBoxes[0]!.min, [0, 6.5 * PX, 6.5 * PX]);
    assert.deepEqual(z.occlusionBoxes[0]!.min, [6.5 * PX, 6.5 * PX, 0]);
  });

  it('copper variants share geometry keys by axis only differing in block name', () => {
    const iron = chainModel(ref('minecraft:iron_chain', { pillar_axis: 'y' }), 'y');
    const copper = chainModel(ref('minecraft:copper_chain', { pillar_axis: 'y' }), 'y');
    assert.deepEqual(iron.renderBoxes[0]!.min, copper.renderBoxes[0]!.min);
    assert.deepEqual(iron.renderBoxes[0]!.max, copper.renderBoxes[0]!.max);
    assert.equal(iron.renderBoxes[0]!.rotation?.angle, copper.renderBoxes[0]!.rotation?.angle);
    assert.notEqual(iron.key, copper.key);
  });

  it('assigns side textures on vertical plane faces', () => {
    const model = chainModel(ref('minecraft:chain', { pillar_axis: 'y' }), 'y');
    const ns = model.renderBoxes[0]!.faces;
    assert.equal(ns.north?.textureKey, 'blocks/chain2');
    assert.equal(ns.south?.textureKey, 'blocks/chain2');
    const ew = model.renderBoxes[1]!.faces;
    assert.equal(ew.east?.textureKey, 'blocks/chain2');
    assert.equal(ew.west?.textureKey, 'blocks/chain2');
  });

  it('aliases iron_chain textures to legacy chain appearance', () => {
    const model = chainModel(ref('minecraft:iron_chain', { pillar_axis: 'y' }), 'y');
    assert.equal(model.renderBoxes[0]!.faces.north?.textureKey, 'blocks/chain2');
  });

  it('does not occlude neighbour unit faces', () => {
    resetBlockModelCache();
    const chain = resolveBlockModel(ref('minecraft:iron_chain', { pillar_axis: 'y' }))!;
    const stone = resolveBlockModel(ref('minecraft:stone'))!;
    assert.equal(isFaceFullyOccluded(stone.renderBoxes[0]!, 'east', chain), false);
  });

  it('resolver caches axes separately and defaults missing axis to y', () => {
    resetBlockModelCache();
    const y = resolveBlockModel(ref('minecraft:iron_chain', { pillar_axis: 'y' }))!;
    const x = resolveBlockModel(ref('minecraft:iron_chain', { pillar_axis: 'x' }))!;
    const missing = resolveBlockModel(ref('minecraft:iron_chain', {}))!;
    assert.notEqual(y.key, x.key);
    assert.match(missing.key, /^chain:y:/);
    const bad = tryBuildChain(ref('minecraft:stone', {}));
    assert.equal(bad.ok, false);
  });
});

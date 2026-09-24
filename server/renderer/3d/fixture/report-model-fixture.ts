/**
 * Deterministic model-resolution report for the PR28 fixture.
 *
 * Compares Minecraft fixture world state → contextual model resolution
 * (masks / WallShape / cache keys / isFullCube) without requiring a browser.
 */

import { connectionMaskKey } from '../models/connection.ts';
import {
  connectionMaskAtWorld,
  isContextualConnectedName,
  wallShapeAtWorld,
} from '../models/contextual.ts';
import { isCrossName } from '../models/families/cross.ts';
import { isDoorName } from '../models/families/door.ts';
import { isFenceName } from '../models/families/fence.ts';
import { isPaneName } from '../models/families/pane.ts';
import { isSingleSlabName } from '../models/families/slab.ts';
import { isStairName } from '../models/families/stair.ts';
import { isTrapdoorName } from '../models/families/trapdoor.ts';
import { isWallName } from '../models/families/wall.ts';
import { resolveBlockModel, resetBlockModelCache } from '../models/resolve.ts';
import type { BlockModel } from '../models/types.ts';
import { buildFixtureNeighborhood } from './build-fixture-volumes.ts';
import {
  modelFixtureCells,
  modelFixtureExpectations,
  modelFixtureReciprocalLinks,
  type Cardinal,
  type FixtureExpectation,
  type ReciprocalLink,
} from './model-fixture-layout.ts';

export interface ModelFixtureReportLine {
  readonly id: string;
  readonly label?: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly name: string;
  readonly states: Readonly<Record<string, string>>;
  readonly family: string;
  readonly modelKey: string;
  readonly isFullCube: boolean;
  readonly boxCount: number;
  readonly mask?: string;
  readonly post?: boolean;
  readonly tall?: boolean;
  /** Parsed mask flags when contextual; undefined for intrinsic families. */
  readonly maskFlags?: { north: boolean; east: boolean; south: boolean; west: boolean };
}

function familyOf(name: string): string {
  if (isWallName(name)) return 'wall';
  if (isFenceName(name)) return 'fence';
  if (isPaneName(name)) return 'pane';
  if (isDoorName(name)) return 'door';
  if (isTrapdoorName(name)) return 'trapdoor';
  if (isSingleSlabName(name)) return 'slab';
  if (isStairName(name)) return 'stair';
  if (isCrossName(name)) return 'cross';
  if (name.includes('double_slab') || name.includes('double_cut_')) return 'full_cube';
  return 'full_cube';
}

function formatStates(states: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(states).sort()) {
    out[key] = String(states[key]);
  }
  return out;
}

export function reportModelFixture(): ModelFixtureReportLine[] {
  resetBlockModelCache();
  const lines: ModelFixtureReportLine[] = [];

  for (const cell of modelFixtureCells()) {
    const chunkX = Math.floor(cell.x / 16);
    const chunkZ = Math.floor(cell.z / 16);
    const neighborhood = buildFixtureNeighborhood(chunkX, chunkZ);
    const ref = {
      name: cell.block.name,
      states: { ...(cell.block.states ?? {}) },
    };

    let model: BlockModel;
    let mask: string | undefined;
    let maskFlags: ModelFixtureReportLine['maskFlags'];
    let post: boolean | undefined;
    let tall: boolean | undefined;

    if (isWallName(ref.name)) {
      const shape = wallShapeAtWorld(neighborhood, cell.x, cell.y, cell.z, ref.name);
      model = resolveBlockModel(ref, shape.mask, shape)!;
      mask = connectionMaskKey(shape.mask);
      maskFlags = { ...shape.mask };
      post = shape.post;
      tall = shape.tall;
    } else if (isContextualConnectedName(ref.name)) {
      const m = connectionMaskAtWorld(neighborhood, cell.x, cell.y, cell.z, ref.name);
      model = resolveBlockModel(ref, m)!;
      mask = connectionMaskKey(m);
      maskFlags = { ...m };
    } else {
      model = resolveBlockModel(ref)!;
    }

    lines.push({
      id: cell.id,
      label: cell.label,
      x: cell.x,
      y: cell.y,
      z: cell.z,
      chunkX,
      chunkZ,
      name: ref.name,
      states: formatStates(ref.states),
      family: familyOf(ref.name),
      modelKey: model.key,
      isFullCube: model.isFullCube,
      boxCount: model.renderBoxes.length,
      mask,
      maskFlags,
      post,
      tall,
    });
  }

  return lines;
}

export function formatModelFixtureReport(lines: readonly ModelFixtureReportLine[]): string {
  const out: string[] = ['# Model fixture resolution report (PR28)', ''];
  for (const line of lines) {
    out.push(`## ${line.id}${line.label ? ` — ${line.label}` : ''}`);
    out.push(`Chunk ${line.chunkX},${line.chunkZ}`);
    out.push(`  ${line.name} @ ${line.x},${line.y},${line.z}`);
    const stateKeys = Object.keys(line.states);
    if (stateKeys.length) {
      out.push(`  states = ${stateKeys.map((k) => `${k}=${line.states[k]}`).join(', ')}`);
    }
    out.push(`  family = ${line.family}`);
    if (line.mask) out.push(`  mask = ${line.mask}`);
    if (line.post !== undefined) out.push(`  post = ${line.post}`);
    if (line.tall !== undefined) out.push(`  tall = ${line.tall}`);
    out.push(`  model = ${line.modelKey}`);
    out.push(`  isFullCube = ${line.isFullCube}`);
    out.push(`  boxes = ${line.boxCount}`);
    out.push('');
  }
  return out.join('\n');
}

export interface ExpectationFailure {
  readonly id: string;
  readonly message: string;
}

export function assertFixtureExpectations(
  lines: readonly ModelFixtureReportLine[],
  expectations: readonly FixtureExpectation[] = modelFixtureExpectations(),
): ExpectationFailure[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const failures: ExpectationFailure[] = [];

  for (const exp of expectations) {
    const line = byId.get(exp.id);
    if (!line) {
      failures.push({ id: exp.id, message: 'missing from report' });
      continue;
    }
    if (line.family !== exp.family) {
      failures.push({
        id: exp.id,
        message: `family expected ${exp.family}, got ${line.family}`,
      });
    }
    if (line.isFullCube !== exp.isFullCube) {
      failures.push({
        id: exp.id,
        message: `isFullCube expected ${exp.isFullCube}, got ${line.isFullCube}`,
      });
    }
    if (exp.mask) {
      const got = line.mask;
      const want = connectionMaskKey(exp.mask);
      if (got !== want) {
        failures.push({ id: exp.id, message: `mask expected ${want}, got ${got}` });
      }
    }
    if (exp.post !== undefined && line.post !== exp.post) {
      failures.push({ id: exp.id, message: `post expected ${exp.post}, got ${line.post}` });
    }
    if (exp.tall !== undefined && line.tall !== exp.tall) {
      failures.push({ id: exp.id, message: `tall expected ${exp.tall}, got ${line.tall}` });
    }
    if (exp.modelKeyPrefix && !line.modelKey.startsWith(exp.modelKeyPrefix)) {
      failures.push({
        id: exp.id,
        message: `modelKey expected prefix ${exp.modelKeyPrefix}, got ${line.modelKey}`,
      });
    }
  }
  return failures;
}

const OPPOSITE: Record<Cardinal, Cardinal> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * Assert A→B and B→A connection masks for every authored reciprocal link.
 * Does not cover intentional asymmetries (wall↛fence, pane↛fence).
 */
export function assertReciprocalConnectivity(
  lines: readonly ModelFixtureReportLine[],
  links: readonly ReciprocalLink[] = modelFixtureReciprocalLinks(),
): ExpectationFailure[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const failures: ExpectationFailure[] = [];

  for (const link of links) {
    const a = byId.get(link.aId);
    const b = byId.get(link.bId);
    if (!a || !b) {
      failures.push({
        id: `${link.aId}↔${link.bId}`,
        message: `missing report line(s): a=${!!a} b=${!!b}`,
      });
      continue;
    }
    if (!a.maskFlags || !b.maskFlags) {
      failures.push({
        id: `${link.aId}↔${link.bId}`,
        message: 'both cells must be contextual (have ConnectionMask)',
      });
      continue;
    }
    const fromB = OPPOSITE[link.fromA];
    if (!a.maskFlags[link.fromA]) {
      failures.push({
        id: `${link.aId}↔${link.bId}`,
        message: `${link.aId}.${link.fromA} expected true`,
      });
    }
    if (!b.maskFlags[fromB]) {
      failures.push({
        id: `${link.aId}↔${link.bId}`,
        message: `${link.bId}.${fromB} expected true (reciprocal of ${link.aId}.${link.fromA})`,
      });
    }
  }
  return failures;
}

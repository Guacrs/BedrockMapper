/**
 * PR28 — declarative model-validation fixture layout.
 *
 * Absolute Overworld coordinates for a constructed Bedrock test pad.
 * Used by:
 * - in-memory ChunkBlocks builders (unit tests)
 * - `scripts/make-model-fixture-world.ts` (LevelDB world)
 * - model-resolution report (expected vs actual)
 *
 * Chunk boundaries deliberately crossed at x=16 and z=16 (chunk 0|1).
 */

import type { BlockStateValue } from '../models/types.ts';

export interface FixtureBlock {
  readonly name: string;
  readonly states?: Readonly<Record<string, BlockStateValue>>;
}

export interface FixtureCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: FixtureBlock;
  /** Optional human label for the report. */
  readonly label?: string;
}

/** Platform Y for the fixture pad (solid stone under structures). */
export const FIXTURE_PLATFORM_Y = 64;
/** Default structure Y (one above platform). */
export const FIXTURE_Y = 65;

/** Chunks that contain the fixture (inclusive). */
export const FIXTURE_CHUNK_RANGE = {
  minX: 0,
  maxX: 2,
  minZ: 0,
  maxZ: 2,
} as const;

function b(name: string, states?: Readonly<Record<string, BlockStateValue>>): FixtureBlock {
  return states ? { name, states } : { name };
}

/**
 * All authored fixture cells (structures only — platform is filled separately).
 * Coordinates are world X/Y/Z.
 */
export function modelFixtureCells(): readonly FixtureCell[] {
  const y = FIXTURE_Y;
  const cells: FixtureCell[] = [];

  const place = (
    id: string,
    x: number,
    z: number,
    block: FixtureBlock,
    label?: string,
    yOverride?: number,
  ) => {
    cells.push({ id, x, y: yOverride ?? y, z, block, label });
  };

  // --- Slabs (z=2) ---
  place('slab-bottom', 2, 2, b('minecraft:oak_slab', { 'minecraft:vertical_half': 'bottom' }), 'slab bottom');
  place('slab-top', 4, 2, b('minecraft:oak_slab', { 'minecraft:vertical_half': 'top' }), 'slab top');
  place('slab-double', 6, 2, b('minecraft:oak_double_slab'), 'double slab id → full cube');

  // --- Stairs all facings + upside-down (z=4) ---
  for (const [weirdo, tag] of [
    [0, 'east'],
    [1, 'west'],
    [2, 'south'],
    [3, 'north'],
  ] as const) {
    place(
      `stair-${tag}`,
      2 + weirdo * 2,
      4,
      b('minecraft:oak_stairs', {
        weirdo_direction: weirdo,
        upside_down_bit: false,
        'minecraft:corner': 'none',
      }),
      `stair facing ${tag}`,
    );
    place(
      `stair-${tag}-up`,
      2 + weirdo * 2,
      5,
      b('minecraft:oak_stairs', {
        weirdo_direction: weirdo,
        upside_down_bit: true,
        'minecraft:corner': 'none',
      }),
      `stair upside-down ${tag}`,
    );
  }

  // --- Fences (z=8): isolated, N, corner, T, 4-way ---
  place('fence-isolated', 2, 8, b('minecraft:oak_fence'), 'fence isolated');

  place('fence-n-post', 5, 8, b('minecraft:oak_fence'), 'fence with north rail');
  place('fence-n-neighbor', 5, 7, b('minecraft:oak_fence'));

  place('fence-corner', 8, 8, b('minecraft:oak_fence'), 'fence NE corner');
  place('fence-corner-n', 8, 7, b('minecraft:oak_fence'));
  place('fence-corner-e', 9, 8, b('minecraft:oak_fence'));

  place('fence-t', 12, 8, b('minecraft:oak_fence'), 'fence T (N+E+W)');
  place('fence-t-n', 12, 7, b('minecraft:oak_fence'));
  place('fence-t-e', 13, 8, b('minecraft:oak_fence'));
  place('fence-t-w', 11, 8, b('minecraft:oak_fence'));

  // Chunk-boundary fence: west cell in chunk 0, east in chunk 1 (x=15|16)
  // Keep clear of other fence clusters so the mask is exactly E↔W.
  place('fence-boundary-w', 15, 8, b('minecraft:oak_fence'), 'fence at chunk boundary west');
  place('fence-boundary-e', 16, 8, b('minecraft:oak_fence'), 'fence at chunk boundary east');

  // Fence ↔ stone attach
  place('fence-to-stone', 22, 8, b('minecraft:oak_fence'), 'fence → stone east');
  place('fence-to-stone-cube', 23, 8, b('minecraft:stone'));

  // Fence ↛ nether (incompatible family)
  place('fence-wood', 26, 8, b('minecraft:oak_fence'), 'oak ↛ nether east');
  place('fence-nether', 27, 8, b('minecraft:nether_brick_fence'));

  // 4-way plus well clear of the x=15|16 boundary pair (still crosses into chunk 2)
  place('fence-plus', 34, 8, b('minecraft:oak_fence'), 'fence 4-way');
  place('fence-plus-n', 34, 7, b('minecraft:oak_fence'));
  place('fence-plus-s', 34, 9, b('minecraft:oak_fence'));
  place('fence-plus-e', 35, 8, b('minecraft:oak_fence'));
  place('fence-plus-w', 33, 8, b('minecraft:oak_fence'));

  // --- Panes / iron bars (z=12) ---
  place('pane-isolated', 2, 12, b('minecraft:glass_pane'), 'pane isolated');
  place('pane-pair-a', 5, 12, b('minecraft:glass_pane'), 'pane ↔ bars');
  place('pane-pair-b', 6, 12, b('minecraft:iron_bars'));
  place('pane-to-stone', 9, 12, b('minecraft:glass_pane'), 'pane → stone');
  place('pane-to-stone-cube', 10, 12, b('minecraft:stone'));
  place('pane-no-fence', 13, 12, b('minecraft:glass_pane'), 'pane ↛ fence');
  place('pane-no-fence-n', 13, 11, b('minecraft:oak_fence'));

  // Pane chunk boundary
  place('pane-boundary-w', 15, 12, b('minecraft:glass_pane'), 'pane chunk boundary west');
  place('pane-boundary-e', 16, 12, b('minecraft:iron_bars'), 'bars chunk boundary east');

  // --- Doors (z=14): lower + upper halves ---
  place(
    'door-closed-lower',
    2,
    14,
    b('minecraft:wooden_door', {
      'minecraft:cardinal_direction': 'east',
      door_hinge_bit: false,
      open_bit: false,
      upper_block_bit: false,
    }),
    'door closed lower',
  );
  place(
    'door-closed-upper',
    2,
    14,
    b('minecraft:wooden_door', {
      'minecraft:cardinal_direction': 'east',
      door_hinge_bit: false,
      open_bit: false,
      upper_block_bit: true,
    }),
    'door closed upper',
    y + 1,
  );
  place(
    'door-open-lower',
    5,
    14,
    b('minecraft:wooden_door', {
      'minecraft:cardinal_direction': 'east',
      door_hinge_bit: true,
      open_bit: true,
      upper_block_bit: false,
    }),
    'door open hinge-right lower',
  );
  place(
    'door-open-upper',
    5,
    14,
    b('minecraft:wooden_door', {
      'minecraft:cardinal_direction': 'east',
      door_hinge_bit: true,
      open_bit: true,
      upper_block_bit: true,
    }),
    'door open hinge-right upper',
    y + 1,
  );

  // --- Trapdoors (z=18) ---
  place(
    'trap-closed-bottom',
    2,
    18,
    b('minecraft:oak_trapdoor', { direction: 0, open_bit: false, upside_down_bit: false }),
    'trapdoor closed bottom',
  );
  place(
    'trap-closed-top',
    4,
    18,
    b('minecraft:oak_trapdoor', { direction: 0, open_bit: false, upside_down_bit: true }),
    'trapdoor closed top',
  );
  place(
    'trap-open',
    6,
    18,
    b('minecraft:oak_trapdoor', { direction: 1, open_bit: true, upside_down_bit: false }),
    'trapdoor open',
  );

  // --- Walls (z=22) ---
  place('wall-isolated', 2, 22, b('minecraft:cobblestone_wall'), 'wall isolated');
  place('wall-straight-a', 5, 22, b('minecraft:cobblestone_wall'), 'wall straight E-W');
  place('wall-straight-b', 6, 22, b('minecraft:cobblestone_wall'));
  place('wall-straight-c', 7, 22, b('minecraft:cobblestone_wall'));

  place('wall-corner', 10, 22, b('minecraft:cobblestone_wall'), 'wall corner');
  place('wall-corner-n', 10, 21, b('minecraft:mossy_cobblestone_wall'));
  place('wall-corner-e', 11, 22, b('minecraft:stone_brick_wall'));

  place('wall-t', 14, 22, b('minecraft:cobblestone_wall'), 'wall T');
  place('wall-t-n', 14, 21, b('minecraft:cobblestone_wall'));
  place('wall-t-e', 15, 22, b('minecraft:cobblestone_wall'));
  place('wall-t-w', 13, 22, b('minecraft:cobblestone_wall'));

  place('wall-plus', 18, 22, b('minecraft:cobblestone_wall'), 'wall 4-way');
  place('wall-plus-n', 18, 21, b('minecraft:cobblestone_wall'));
  place('wall-plus-s', 18, 23, b('minecraft:cobblestone_wall'));
  place('wall-plus-e', 19, 22, b('minecraft:cobblestone_wall'));
  place('wall-plus-w', 17, 22, b('minecraft:cobblestone_wall'));

  place('wall-to-stone', 22, 22, b('minecraft:cobblestone_wall'), 'wall → stone');
  place('wall-to-stone-cube', 23, 22, b('minecraft:stone'));

  place('wall-to-pane', 26, 22, b('minecraft:cobblestone_wall'), 'wall → pane');
  place('wall-to-pane-n', 26, 21, b('minecraft:glass_pane'));

  place('wall-no-fence', 29, 22, b('minecraft:cobblestone_wall'), 'wall ↛ fence');
  place('wall-no-fence-e', 30, 22, b('minecraft:oak_fence'));

  // Tall case: wall with block above
  place('wall-tall', 33, 22, b('minecraft:cobblestone_wall'), 'wall with above → tall');
  place('wall-tall-above', 33, 22, b('minecraft:stone'), undefined, y + 1);

  // Wall chunk boundary
  place('wall-boundary-w', 15, 24, b('minecraft:cobblestone_wall'), 'wall chunk boundary west');
  place('wall-boundary-e', 16, 24, b('minecraft:stone_brick_wall'), 'wall chunk boundary east');

  // --- Cross plants (z=28) ---
  place('cross-grass', 2, 28, b('minecraft:short_grass'), 'cross short_grass');
  place('cross-fern', 4, 28, b('minecraft:fern'), 'cross fern');
  place('cross-poppy', 6, 28, b('minecraft:poppy'), 'cross poppy');
  place('cross-sapling', 8, 28, b('minecraft:oak_sapling'), 'cross oak_sapling');
  place('cross-deadbush', 10, 28, b('minecraft:deadbush'), 'cross deadbush');

  // Mixed: plant next to fence/wall/pane (must not connect)
  place('cross-mix-plant', 14, 28, b('minecraft:short_grass'), 'plant beside fence (no attach)');
  place('cross-mix-fence', 15, 28, b('minecraft:oak_fence'));
  place('cross-mix-wall', 17, 28, b('minecraft:cobblestone_wall'));
  place('cross-mix-pane', 18, 28, b('minecraft:glass_pane'));

  // --- Mixed neighborhood showcase (z=32), straddling x=16 ---
  //
  //           wall
  //            N
  // fence - wall - stone   (centre at 16,32)
  //            |
  //           pane
  place('mix-centre', 16, 32, b('minecraft:cobblestone_wall'), 'mixed: wall centre');
  place('mix-n', 16, 31, b('minecraft:mossy_cobblestone_wall'));
  place('mix-e', 17, 32, b('minecraft:stone'));
  place('mix-s', 16, 33, b('minecraft:glass_pane'));
  place('mix-w', 15, 32, b('minecraft:oak_fence'));

  return Object.freeze(cells);
}

/** Cells that have deterministic expected report fields. */
export interface FixtureExpectation {
  readonly id: string;
  readonly family: string;
  readonly isFullCube: boolean;
  readonly mask?: { north: boolean; east: boolean; south: boolean; west: boolean };
  readonly post?: boolean;
  readonly tall?: boolean;
  readonly modelKeyPrefix?: string;
}

export function modelFixtureExpectations(): readonly FixtureExpectation[] {
  return Object.freeze([
    { id: 'slab-bottom', family: 'slab', isFullCube: false, modelKeyPrefix: 'slab:bottom:' },
    { id: 'slab-top', family: 'slab', isFullCube: false, modelKeyPrefix: 'slab:top:' },
    { id: 'slab-double', family: 'full_cube', isFullCube: true, modelKeyPrefix: 'full_cube:' },
    { id: 'stair-east', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:' },
    { id: 'fence-isolated', family: 'fence', isFullCube: false, mask: { north: false, east: false, south: false, west: false }, modelKeyPrefix: 'fence:n0e0s0w0:' },
    { id: 'fence-n-post', family: 'fence', isFullCube: false, mask: { north: true, east: false, south: false, west: false }, modelKeyPrefix: 'fence:n1e0s0w0:' },
    { id: 'fence-corner', family: 'fence', isFullCube: false, mask: { north: true, east: true, south: false, west: false } },
    { id: 'fence-plus', family: 'fence', isFullCube: false, mask: { north: true, east: true, south: true, west: true } },
    { id: 'fence-boundary-w', family: 'fence', isFullCube: false, mask: { north: false, east: true, south: false, west: false } },
    { id: 'fence-boundary-e', family: 'fence', isFullCube: false, mask: { north: false, east: false, south: false, west: true } },
    { id: 'pane-isolated', family: 'pane', isFullCube: false, mask: { north: false, east: false, south: false, west: false } },
    { id: 'pane-pair-a', family: 'pane', isFullCube: false, mask: { north: false, east: true, south: false, west: false } },
    { id: 'pane-no-fence', family: 'pane', isFullCube: false, mask: { north: false, east: false, south: false, west: false } },
    { id: 'pane-boundary-w', family: 'pane', isFullCube: false, mask: { north: false, east: true, south: false, west: false } },
    { id: 'door-closed-lower', family: 'door', isFullCube: false, modelKeyPrefix: 'door:' },
    { id: 'trap-closed-bottom', family: 'trapdoor', isFullCube: false, modelKeyPrefix: 'trapdoor:' },
    { id: 'wall-isolated', family: 'wall', isFullCube: false, mask: { north: false, east: false, south: false, west: false }, post: true, tall: false },
    { id: 'wall-straight-b', family: 'wall', isFullCube: false, mask: { north: false, east: true, south: false, west: true }, post: false, tall: false },
    { id: 'wall-plus', family: 'wall', isFullCube: false, mask: { north: true, east: true, south: true, west: true }, post: false, tall: false },
    { id: 'wall-tall', family: 'wall', isFullCube: false, post: true, tall: true },
    { id: 'wall-no-fence', family: 'wall', isFullCube: false, mask: { north: false, east: false, south: false, west: false } },
    { id: 'wall-boundary-w', family: 'wall', isFullCube: false, mask: { north: false, east: true, south: false, west: false } },
    { id: 'cross-grass', family: 'cross', isFullCube: false, modelKeyPrefix: 'cross:' },
    { id: 'mix-centre', family: 'wall', isFullCube: false, mask: { north: true, east: true, south: true, west: false }, post: true, tall: false },
  ]);
}

/**
 * Cardinal links that must be reciprocal on both contextual families.
 * Catches asymmetric `connectsTo` classifiers (A→B but not B→A).
 */
export type Cardinal = 'north' | 'east' | 'south' | 'west';

export interface ReciprocalLink {
  readonly aId: string;
  readonly bId: string;
  /** Direction from A toward B. */
  readonly fromA: Cardinal;
}

export function modelFixtureReciprocalLinks(): readonly ReciprocalLink[] {
  return Object.freeze([
    { aId: 'fence-n-post', bId: 'fence-n-neighbor', fromA: 'north' },
    { aId: 'fence-corner', bId: 'fence-corner-n', fromA: 'north' },
    { aId: 'fence-corner', bId: 'fence-corner-e', fromA: 'east' },
    { aId: 'fence-t', bId: 'fence-t-n', fromA: 'north' },
    { aId: 'fence-t', bId: 'fence-t-e', fromA: 'east' },
    { aId: 'fence-t', bId: 'fence-t-w', fromA: 'west' },
    { aId: 'fence-plus', bId: 'fence-plus-n', fromA: 'north' },
    { aId: 'fence-plus', bId: 'fence-plus-s', fromA: 'south' },
    { aId: 'fence-plus', bId: 'fence-plus-e', fromA: 'east' },
    { aId: 'fence-plus', bId: 'fence-plus-w', fromA: 'west' },
    { aId: 'fence-boundary-w', bId: 'fence-boundary-e', fromA: 'east' },
    { aId: 'pane-pair-a', bId: 'pane-pair-b', fromA: 'east' },
    { aId: 'pane-boundary-w', bId: 'pane-boundary-e', fromA: 'east' },
    { aId: 'wall-straight-a', bId: 'wall-straight-b', fromA: 'east' },
    { aId: 'wall-straight-b', bId: 'wall-straight-c', fromA: 'east' },
    { aId: 'wall-corner', bId: 'wall-corner-n', fromA: 'north' },
    { aId: 'wall-corner', bId: 'wall-corner-e', fromA: 'east' },
    { aId: 'wall-t', bId: 'wall-t-n', fromA: 'north' },
    { aId: 'wall-t', bId: 'wall-t-e', fromA: 'east' },
    { aId: 'wall-t', bId: 'wall-t-w', fromA: 'west' },
    { aId: 'wall-plus', bId: 'wall-plus-n', fromA: 'north' },
    { aId: 'wall-plus', bId: 'wall-plus-s', fromA: 'south' },
    { aId: 'wall-plus', bId: 'wall-plus-e', fromA: 'east' },
    { aId: 'wall-plus', bId: 'wall-plus-w', fromA: 'west' },
    { aId: 'wall-boundary-w', bId: 'wall-boundary-e', fromA: 'east' },
    { aId: 'wall-to-pane', bId: 'wall-to-pane-n', fromA: 'north' },
    { aId: 'mix-centre', bId: 'mix-n', fromA: 'north' },
    { aId: 'mix-centre', bId: 'mix-s', fromA: 'south' },
  ]);
}

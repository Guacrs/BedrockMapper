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

  // --- PR30 common geometry pad (z=36) ---
  place('carpet-red', 2, 36, b('minecraft:red_carpet'), 'carpet 1px');
  place(
    'plate-up',
    4,
    36,
    b('minecraft:stone_pressure_plate', { redstone_signal: 0 }),
    'pressure plate up',
  );
  place(
    'plate-down',
    6,
    36,
    b('minecraft:oak_pressure_plate', { redstone_signal: 1 }),
    'pressure plate pressed',
  );
  place('snow-1', 8, 36, b('minecraft:snow_layer', { height: 0 }), 'snow 1 layer');
  place('snow-4', 10, 36, b('minecraft:snow_layer', { height: 3 }), 'snow 4 layers');
  place(
    'ladder-n',
    12,
    36,
    b('minecraft:ladder', { facing_direction: 2 }),
    'ladder facing north',
  );
  place(
    'torch-floor',
    14,
    36,
    b('minecraft:torch', { torch_facing_direction: 'top' }),
    'floor torch',
  );
  place(
    'torch-wall',
    16,
    36,
    b('minecraft:soul_torch', { torch_facing_direction: 'west' }),
    'wall torch',
  );
  place('cactus', 18, 36, b('minecraft:cactus', { age: 0 }), 'cactus inset');

  // --- PR39 candles (z=34) — one family, multi-box from `candles` 0–3 ---
  place(
    'candle-1-unlit',
    2,
    34,
    b('minecraft:candle', { candles: 0, lit: false }),
    '1 candle unlit',
  );
  place(
    'candle-1-lit',
    4,
    34,
    b('minecraft:candle', { candles: 0, lit: true }),
    '1 candle lit',
  );
  place(
    'candle-2-lit',
    6,
    34,
    b('minecraft:red_candle', { candles: 1, lit: true }),
    '2 red candles lit',
  );
  place(
    'candle-3-lit',
    8,
    34,
    b('minecraft:blue_candle', { candles: 2, lit: true }),
    '3 blue candles lit',
  );
  place(
    'candle-4-lit',
    10,
    34,
    b('minecraft:white_candle', { candles: 3, lit: true }),
    '4 white candles lit',
  );
  place(
    'candle-4-unlit',
    12,
    34,
    b('minecraft:yellow_candle', { candles: 3, lit: false }),
    '4 yellow candles unlit',
  );

  // --- PR40 standing / wall signs (z=30) — hanging signs are PR41 ---
  place(
    'sign-standing-s',
    2,
    30,
    b('minecraft:standing_sign', { ground_sign_direction: 0 }),
    'oak standing south (dir 0)',
  );
  place(
    'sign-standing-n',
    4,
    30,
    b('minecraft:spruce_standing_sign', { ground_sign_direction: 8 }),
    'spruce standing north (dir 8)',
  );
  place(
    'sign-standing-diag',
    6,
    30,
    b('minecraft:birch_standing_sign', { ground_sign_direction: 2 }),
    'birch standing SW (dir 2, 45°)',
  );
  place('sign-wall-n-support', 10, 31, b('minecraft:stone'));
  place(
    'sign-wall-n',
    10,
    30,
    b('minecraft:wall_sign', { facing_direction: 2 }),
    'oak wall facing north',
  );
  place('sign-wall-e-support', 11, 30, b('minecraft:stone'));
  place(
    'sign-wall-e',
    12,
    30,
    b('minecraft:acacia_wall_sign', { facing_direction: 5 }),
    'acacia wall facing east',
  );
  place('sign-wall-s-support', 16, 29, b('minecraft:stone'));
  place(
    'sign-wall-s',
    16,
    30,
    b('minecraft:crimson_wall_sign', { facing_direction: 3 }),
    'crimson wall facing south',
  );
  place('sign-wall-w-support', 21, 30, b('minecraft:stone'));
  place(
    'sign-wall-w',
    20,
    30,
    b('minecraft:warped_wall_sign', { facing_direction: 4 }),
    'warped wall facing west',
  );

  // --- PR41 hanging signs (z=28) — intrinsic hanging/attached_bit; no text ---
  place('hanging-ceil-par-support', 2, 28, b('minecraft:stone'), undefined, y + 1);
  place(
    'hanging-ceil-parallel',
    2,
    28,
    b('minecraft:oak_hanging_sign', {
      hanging: true,
      attached_bit: false,
      facing_direction: 3,
      ground_sign_direction: 0,
    }),
    'oak ceiling parallel south',
  );
  place('hanging-ceil-att-support', 4, 28, b('minecraft:stone'), undefined, y + 1);
  place(
    'hanging-ceil-attached',
    4,
    28,
    b('minecraft:spruce_hanging_sign', {
      hanging: true,
      attached_bit: true,
      facing_direction: 2,
      ground_sign_direction: 0,
    }),
    'spruce ceiling attached V (dir 0)',
  );
  place('hanging-ceil-diag-support', 6, 28, b('minecraft:stone'), undefined, y + 1);
  place(
    'hanging-ceil-diag',
    6,
    28,
    b('minecraft:birch_hanging_sign', {
      hanging: true,
      attached_bit: true,
      facing_direction: 2,
      ground_sign_direction: 2,
    }),
    'birch ceiling attached SW (dir 2)',
  );
  place('hanging-wall-n-support', 10, 29, b('minecraft:stone'));
  place(
    'hanging-wall-n',
    10,
    28,
    b('minecraft:acacia_hanging_sign', {
      hanging: false,
      attached_bit: false,
      facing_direction: 2,
      ground_sign_direction: 0,
    }),
    'acacia wall hanging north',
  );
  place('hanging-wall-e-support', 13, 28, b('minecraft:stone'));
  place(
    'hanging-wall-e',
    14,
    28,
    b('minecraft:crimson_hanging_sign', {
      hanging: false,
      attached_bit: false,
      facing_direction: 5,
      ground_sign_direction: 0,
    }),
    'crimson wall hanging east',
  );

  // --- PR34 lanterns (z=44) ---
  place(
    'lantern-floor',
    2,
    44,
    b('minecraft:lantern', { hanging: false }),
    'floor lantern',
  );
  place(
    'lantern-hanging',
    4,
    44,
    b('minecraft:lantern', { hanging: true }),
    'hanging lantern',
  );
  place(
    'soul-lantern-floor',
    6,
    44,
    b('minecraft:soul_lantern', { hanging_bit: false }),
    'soul lantern floor (hanging_bit)',
  );
  place(
    'soul-lantern-hanging',
    8,
    44,
    b('minecraft:soul_lantern', { hanging_bit: true }),
    'soul lantern hanging (hanging_bit)',
  );
  // Ceiling support above hanging lanterns (visual/fixture context only)
  place('lantern-hanging-support', 4, 44, b('minecraft:stone'), undefined, y + 1);
  place('soul-lantern-hanging-support', 8, 44, b('minecraft:stone'), undefined, y + 1);

  // --- PR35 buttons (z=46, still within chunk Z=0..2) ---
  // Floor (facing_direction=1): unpressed oak + pressed stone
  place(
    'button-floor-up',
    2,
    46,
    b('minecraft:wooden_button', { facing_direction: 1, button_pressed_bit: false }),
    'floor button unpressed',
  );
  place(
    'button-floor-down',
    4,
    46,
    b('minecraft:stone_button', { facing_direction: 1, button_pressed_bit: true }),
    'floor button pressed',
  );
  // Ceiling (0) under a stone support
  place(
    'button-ceiling',
    6,
    46,
    b('minecraft:spruce_button', { facing_direction: 0, button_pressed_bit: false }),
    'ceiling button',
  );
  place('button-ceiling-support', 6, 46, b('minecraft:stone'), undefined, y + 1);
  // Wall facings 2..5 on the sides of stone pillars
  place('button-wall-n-support', 10, 45, b('minecraft:stone'));
  place(
    'button-wall-n',
    10,
    46,
    b('minecraft:acacia_button', { facing_direction: 2, button_pressed_bit: false }),
    'wall button north',
  );
  place('button-wall-s-support', 12, 47, b('minecraft:stone'));
  place(
    'button-wall-s',
    12,
    46,
    b('minecraft:birch_button', { facing_direction: 3, button_pressed_bit: false }),
    'wall button south',
  );
  place('button-wall-w-support', 13, 46, b('minecraft:stone'));
  place(
    'button-wall-w',
    14,
    46,
    b('minecraft:stone_button', { facing_direction: 4, button_pressed_bit: false }),
    'wall button west',
  );
  place('button-wall-e-support', 17, 46, b('minecraft:stone'));
  place(
    'button-wall-e',
    16,
    46,
    b('minecraft:polished_blackstone_button', {
      facing_direction: 5,
      button_pressed_bit: true,
    }),
    'wall button east pressed',
  );

  // --- PR36 levers (z=38) ---
  place(
    'lever-floor-off',
    2,
    38,
    b('minecraft:lever', { lever_direction: 'up_north_south', open_bit: false }),
    'floor lever off',
  );
  place(
    'lever-floor-on',
    4,
    38,
    b('minecraft:lever', { lever_direction: 'up_east_west', open_bit: true }),
    'floor lever on EW',
  );
  place(
    'lever-ceiling',
    6,
    38,
    b('minecraft:lever', { lever_direction: 'down_north_south', open_bit: false }),
    'ceiling lever',
  );
  place('lever-ceiling-support', 6, 38, b('minecraft:stone'), undefined, y + 1);
  place('lever-wall-n-support', 10, 37, b('minecraft:stone'));
  place(
    'lever-wall-n',
    10,
    38,
    b('minecraft:lever', { lever_direction: 'north', open_bit: false }),
    'wall lever north off',
  );
  place('lever-wall-w-support', 13, 38, b('minecraft:stone'));
  place(
    'lever-wall-w',
    14,
    38,
    b('minecraft:lever', { lever_direction: 'west', open_bit: true }),
    'wall lever west on',
  );

  // --- PR37 rails (z=42) ---
  // Stored rail_direction is authoritative. Neighbours illustrate adjacency /
  // chunk-boundary cases for verification — they do not rewrite geometry.
  place(
    'rail-flat-ns',
    2,
    42,
    b('minecraft:rail', { rail_direction: 0 }),
    'flat north-south rail',
  );
  place(
    'rail-flat-ew',
    4,
    42,
    b('minecraft:rail', { rail_direction: 1 }),
    'flat east-west rail',
  );
  place(
    'rail-asc-e',
    6,
    42,
    b('minecraft:rail', { rail_direction: 2 }),
    'ascending east',
  );
  place(
    'rail-asc-n',
    8,
    42,
    b('minecraft:rail', { rail_direction: 4 }),
    'ascending north',
  );
  place(
    'rail-corner-se',
    10,
    42,
    b('minecraft:rail', { rail_direction: 6 }),
    'corner south-east',
  );
  place(
    'rail-corner-nw',
    12,
    42,
    b('minecraft:rail', { rail_direction: 8 }),
    'corner north-west',
  );
  place(
    'rail-powered-off',
    24,
    42,
    b('minecraft:golden_rail', { rail_direction: 0, rail_data_bit: false }),
    'golden rail unpowered NS',
  );
  place(
    'rail-powered-on',
    26,
    42,
    b('minecraft:golden_rail', { rail_direction: 1, rail_data_bit: true }),
    'golden rail powered EW',
  );
  place(
    'rail-detector',
    28,
    42,
    b('minecraft:detector_rail', { rail_direction: 0, rail_data_bit: true }),
    'detector rail powered',
  );
  place(
    'rail-activator',
    30,
    42,
    b('minecraft:activator_rail', { rail_direction: 5, rail_data_bit: false }),
    'activator ascending south',
  );
  // Straight NS pair across chunk X boundary — stored direction keeps NS even
  // when the opposite chunk is absent from a single-chunk neighborhood probe.
  place(
    'rail-boundary-w',
    15,
    42,
    b('minecraft:rail', { rail_direction: 1 }),
    'rail chunk boundary west (EW)',
  );
  place(
    'rail-boundary-e',
    16,
    42,
    b('minecraft:rail', { rail_direction: 1 }),
    'rail chunk boundary east (EW)',
  );
  // Adjacent rail + non-rail: geometry still from stored state (not fence attach).
  place(
    'rail-beside-stone',
    20,
    42,
    b('minecraft:rail', { rail_direction: 0 }),
    'rail beside stone (non-rail adjacency)',
  );
  place('rail-beside-stone-cube', 21, 42, b('minecraft:stone'));

  // --- PR32 stair corners (z=40) ---
  // Straight facings already live at z=4; this pad covers corner shapes.
  place(
    'stair-corner-outer-r',
    2,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'outer_right',
    }),
    'stair outer_right east',
  );
  place(
    'stair-corner-outer-l',
    4,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'outer_left',
    }),
    'stair outer_left east',
  );
  place(
    'stair-corner-inner-r',
    6,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'inner_right',
    }),
    'stair inner_right east',
  );
  place(
    'stair-corner-inner-l',
    8,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'inner_left',
    }),
    'stair inner_left east',
  );
  place(
    'stair-corner-outer-r-s',
    10,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 2,
      upside_down_bit: false,
      'minecraft:corner': 'outer_right',
    }),
    'stair outer_right south',
  );
  place(
    'stair-corner-outer-r-up',
    12,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: true,
      'minecraft:corner': 'outer_right',
    }),
    'stair outer_right upside-down',
  );
  // Corner adjacent to full cube (east of corner)
  place(
    'stair-corner-to-cube',
    14,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'outer_left',
    }),
    'stair corner → stone',
  );
  place('stair-corner-to-cube-n', 15, 40, b('minecraft:stone'));
  // Corner adjacent to another stair (straight)
  place(
    'stair-corner-to-stair',
    18,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'inner_right',
    }),
    'stair corner → straight stair',
  );
  place(
    'stair-corner-to-stair-e',
    19,
    40,
    b('minecraft:oak_stairs', {
      weirdo_direction: 0,
      upside_down_bit: false,
      'minecraft:corner': 'none',
    }),
  );

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
    { id: 'stair-east', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:none:' },
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
    { id: 'carpet-red', family: 'carpet', isFullCube: false, modelKeyPrefix: 'carpet:' },
    { id: 'plate-up', family: 'pressure_plate', isFullCube: false, modelKeyPrefix: 'pressure_plate:up:' },
    { id: 'plate-down', family: 'pressure_plate', isFullCube: false, modelKeyPrefix: 'pressure_plate:down:' },
    { id: 'snow-1', family: 'snow_layer', isFullCube: false, modelKeyPrefix: 'snow_layer:h1:' },
    { id: 'snow-4', family: 'snow_layer', isFullCube: false, modelKeyPrefix: 'snow_layer:h4:' },
    { id: 'ladder-n', family: 'ladder', isFullCube: false, modelKeyPrefix: 'ladder:north:' },
    { id: 'torch-floor', family: 'torch', isFullCube: false, modelKeyPrefix: 'torch:top:' },
    { id: 'torch-wall', family: 'torch', isFullCube: false, modelKeyPrefix: 'torch:wall:west:' },
    { id: 'cactus', family: 'cactus', isFullCube: false, modelKeyPrefix: 'cactus:' },
    { id: 'candle-1-unlit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:1:unlit:' },
    { id: 'candle-1-lit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:1:lit:' },
    { id: 'candle-2-lit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:2:lit:' },
    { id: 'candle-3-lit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:3:lit:' },
    { id: 'candle-4-lit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:4:lit:' },
    { id: 'candle-4-unlit', family: 'candle', isFullCube: false, modelKeyPrefix: 'candle:4:unlit:' },
    { id: 'sign-standing-s', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:standing:0:' },
    { id: 'sign-standing-n', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:standing:8:' },
    { id: 'sign-standing-diag', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:standing:2:' },
    { id: 'sign-wall-n', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:wall:north:' },
    { id: 'sign-wall-e', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:wall:east:' },
    { id: 'sign-wall-s', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:wall:south:' },
    { id: 'sign-wall-w', family: 'sign', isFullCube: false, modelKeyPrefix: 'sign:wall:west:' },
    { id: 'hanging-ceil-parallel', family: 'hanging_sign', isFullCube: false, modelKeyPrefix: 'hanging_sign:ceiling_parallel:south:' },
    { id: 'hanging-ceil-attached', family: 'hanging_sign', isFullCube: false, modelKeyPrefix: 'hanging_sign:ceiling_attached:0:' },
    { id: 'hanging-ceil-diag', family: 'hanging_sign', isFullCube: false, modelKeyPrefix: 'hanging_sign:ceiling_attached:2:' },
    { id: 'hanging-wall-n', family: 'hanging_sign', isFullCube: false, modelKeyPrefix: 'hanging_sign:wall:north:' },
    { id: 'hanging-wall-e', family: 'hanging_sign', isFullCube: false, modelKeyPrefix: 'hanging_sign:wall:east:' },
    { id: 'lantern-floor', family: 'lantern', isFullCube: false, modelKeyPrefix: 'lantern:floor:' },
    { id: 'lantern-hanging', family: 'lantern', isFullCube: false, modelKeyPrefix: 'lantern:hanging:' },
    { id: 'soul-lantern-floor', family: 'lantern', isFullCube: false, modelKeyPrefix: 'lantern:floor:' },
    { id: 'soul-lantern-hanging', family: 'lantern', isFullCube: false, modelKeyPrefix: 'lantern:hanging:' },
    { id: 'button-floor-up', family: 'button', isFullCube: false, modelKeyPrefix: 'button:up:up:' },
    { id: 'button-floor-down', family: 'button', isFullCube: false, modelKeyPrefix: 'button:up:down:' },
    { id: 'button-ceiling', family: 'button', isFullCube: false, modelKeyPrefix: 'button:down:up:' },
    { id: 'button-wall-n', family: 'button', isFullCube: false, modelKeyPrefix: 'button:north:up:' },
    { id: 'button-wall-s', family: 'button', isFullCube: false, modelKeyPrefix: 'button:south:up:' },
    { id: 'button-wall-w', family: 'button', isFullCube: false, modelKeyPrefix: 'button:west:up:' },
    { id: 'button-wall-e', family: 'button', isFullCube: false, modelKeyPrefix: 'button:east:down:' },
    { id: 'lever-floor-off', family: 'lever', isFullCube: false, modelKeyPrefix: 'lever:up_north_south:off' },
    { id: 'lever-floor-on', family: 'lever', isFullCube: false, modelKeyPrefix: 'lever:up_east_west:on' },
    { id: 'lever-ceiling', family: 'lever', isFullCube: false, modelKeyPrefix: 'lever:down_north_south:off' },
    { id: 'lever-wall-n', family: 'lever', isFullCube: false, modelKeyPrefix: 'lever:wall:north:off' },
    { id: 'lever-wall-w', family: 'lever', isFullCube: false, modelKeyPrefix: 'lever:wall:west:on' },
    { id: 'rail-flat-ns', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:north_south:plain:' },
    { id: 'rail-flat-ew', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:east_west:plain:' },
    { id: 'rail-asc-e', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:ascending_east:plain:' },
    { id: 'rail-asc-n', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:ascending_north:plain:' },
    { id: 'rail-corner-se', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:south_east:plain:' },
    { id: 'rail-corner-nw', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:north_west:plain:' },
    { id: 'rail-powered-off', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:north_south:off:' },
    { id: 'rail-powered-on', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:east_west:on:' },
    { id: 'rail-detector', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:north_south:on:' },
    { id: 'rail-activator', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:ascending_south:off:' },
    { id: 'rail-boundary-w', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:east_west:plain:' },
    { id: 'rail-boundary-e', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:east_west:plain:' },
    { id: 'rail-beside-stone', family: 'rail', isFullCube: false, modelKeyPrefix: 'rail:north_south:plain:' },
    { id: 'stair-corner-outer-r', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:outer_right:' },
    { id: 'stair-corner-outer-l', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:outer_left:' },
    { id: 'stair-corner-inner-r', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:inner_right:' },
    { id: 'stair-corner-inner-l', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:inner_left:' },
    { id: 'stair-corner-outer-r-s', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:south:bottom:outer_right:' },
    { id: 'stair-corner-outer-r-up', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:top:outer_right:' },
    { id: 'stair-corner-to-cube', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:outer_left:' },
    { id: 'stair-corner-to-stair', family: 'stair', isFullCube: false, modelKeyPrefix: 'stair:east:bottom:inner_right:' },
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

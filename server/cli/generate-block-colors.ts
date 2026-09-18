/**
 * Builds data/block-colors.json from official Bedrock vanilla samples.
 *
 *   VANILLA_SAMPLES=/path/to/bedrock-samples npm run block-colors:generate
 *
 * Sources, in order of authority:
 *   1. behavior_pack/blocks/*.json `minecraft:map_color` (exact Bedrock hex + tint)
 *   2. the published MapColor table used by vanilla maps, assigned to the
 *      identifiers listed in metadata/vanilladata_modules/mojang-blocks.json
 *   3. documented Bedrock tint methods (grass, foliage, water, …)
 *
 * Family-name fallbacks and the hash colour are applied at runtime, not here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHexColor,
  rgbToHex,
  type BlockColorDatabase,
  type BlockColorEntry,
  type TintMethod,
} from '../renderer/block-palette.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const outFile = path.join(projectRoot, 'data', 'block-colors.json');

/** Official vanilla map-colour RGB (Minecraft wiki / MapColor.java). */
const MAP = {
  GRASS: '#7FB238',
  SAND: '#F7E9A3',
  WOOL: '#C7C7C7',
  FIRE: '#FF0000',
  ICE: '#A0A0FF',
  METAL: '#A7A7A7',
  PLANT: '#007C00',
  SNOW: '#FFFFFF',
  CLAY: '#A4A8B8',
  DIRT: '#976D4D',
  STONE: '#707070',
  WATER: '#4040FF',
  WOOD: '#8F7748',
  QUARTZ: '#FFFCF5',
  COLOR_ORANGE: '#D87F33',
  COLOR_MAGENTA: '#B24CD8',
  COLOR_LIGHT_BLUE: '#6699D8',
  COLOR_YELLOW: '#E5E533',
  COLOR_LIGHT_GREEN: '#7FCC19',
  COLOR_PINK: '#F27FA5',
  COLOR_GRAY: '#4C4C4C',
  COLOR_LIGHT_GRAY: '#999999',
  COLOR_CYAN: '#4C7F99',
  COLOR_PURPLE: '#7F3FB2',
  COLOR_BLUE: '#334CB2',
  COLOR_BROWN: '#664C33',
  COLOR_GREEN: '#667F33',
  COLOR_RED: '#993333',
  COLOR_BLACK: '#191919',
  GOLD: '#FAEE4D',
  DIAMOND: '#5CDBD5',
  LAPIS: '#4A80FF',
  EMERALD: '#00D93A',
  PODZOL: '#815631',
  NETHER: '#700200',
  TERRACOTTA_WHITE: '#D1B1A1',
  TERRACOTTA_ORANGE: '#9F5224',
  TERRACOTTA_MAGENTA: '#95576C',
  TERRACOTTA_LIGHT_BLUE: '#706C8A',
  TERRACOTTA_YELLOW: '#BA8524',
  TERRACOTTA_LIGHT_GREEN: '#677535',
  TERRACOTTA_PINK: '#A04D4E',
  TERRACOTTA_GRAY: '#392923',
  TERRACOTTA_LIGHT_GRAY: '#876B62',
  TERRACOTTA_CYAN: '#575C5C',
  TERRACOTTA_PURPLE: '#7A4958',
  TERRACOTTA_BLUE: '#4C3E5C',
  TERRACOTTA_BROWN: '#4C3223',
  TERRACOTTA_GREEN: '#4C522A',
  TERRACOTTA_RED: '#8E3C2E',
  TERRACOTTA_BLACK: '#251610',
  CRIMSON_NYLIUM: '#BD3031',
  CRIMSON_STEM: '#943F61',
  CRIMSON_HYPHAE: '#5C191D',
  WARPED_NYLIUM: '#167E86',
  WARPED_STEM: '#3A8E8C',
  WARPED_HYPHAE: '#562C3E',
  WARPED_WART: '#14B485',
  DEEPSLATE: '#646464',
  RAW_IRON: '#D8AF93',
  GLOW_LICHEN: '#7FA796',
} as const;

/** Plains-like defaults from the Bedrock tint-method documentation. */
const NEUTRAL_TINTS = {
  grass: '#92BC58',
  water: '#44AFF5',
  default_foliage: '#77AB2F',
  birch_foliage: '#80A755',
  evergreen_foliage: '#619961',
  dry_foliage: '#A37546',
} as const;

const DYES = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;

const DYE_COLOR: Record<(typeof DYES)[number], string> = {
  white: MAP.SNOW,
  orange: MAP.COLOR_ORANGE,
  magenta: MAP.COLOR_MAGENTA,
  light_blue: MAP.COLOR_LIGHT_BLUE,
  yellow: MAP.COLOR_YELLOW,
  lime: MAP.COLOR_LIGHT_GREEN,
  pink: MAP.COLOR_PINK,
  gray: MAP.COLOR_GRAY,
  light_gray: MAP.COLOR_LIGHT_GRAY,
  cyan: MAP.COLOR_CYAN,
  purple: MAP.COLOR_PURPLE,
  blue: MAP.COLOR_BLUE,
  brown: MAP.COLOR_BROWN,
  green: MAP.COLOR_GREEN,
  red: MAP.COLOR_RED,
  black: MAP.COLOR_BLACK,
};

const TERRACOTTA_DYE: Record<(typeof DYES)[number], string> = {
  white: MAP.TERRACOTTA_WHITE,
  orange: MAP.TERRACOTTA_ORANGE,
  magenta: MAP.TERRACOTTA_MAGENTA,
  light_blue: MAP.TERRACOTTA_LIGHT_BLUE,
  yellow: MAP.TERRACOTTA_YELLOW,
  lime: MAP.TERRACOTTA_LIGHT_GREEN,
  pink: MAP.TERRACOTTA_PINK,
  gray: MAP.TERRACOTTA_GRAY,
  light_gray: MAP.TERRACOTTA_LIGHT_GRAY,
  cyan: MAP.TERRACOTTA_CYAN,
  purple: MAP.TERRACOTTA_PURPLE,
  blue: MAP.TERRACOTTA_BLUE,
  brown: MAP.TERRACOTTA_BROWN,
  green: MAP.TERRACOTTA_GREEN,
  red: MAP.TERRACOTTA_RED,
  black: MAP.TERRACOTTA_BLACK,
};

const WOOD_PARTS = [
  'planks',
  'log',
  'wood',
  'stairs',
  'slab',
  'double_slab',
  'fence',
  'fence_gate',
  'door',
  'trapdoor',
  'pressure_plate',
  'button',
  'sign',
  'standing_sign',
  'wall_sign',
  'hanging_sign',
  'shelf',
] as const;

function id(name: string): string {
  return name.startsWith('minecraft:') ? name : `minecraft:${name}`;
}

function wood(prefix: string): string[] {
  return [
    ...WOOD_PARTS.map((part) => `${prefix}_${part}`),
    `stripped_${prefix}_log`,
    `stripped_${prefix}_wood`,
  ];
}

function stoneSet(prefix: string): string[] {
  return [
    prefix,
    `${prefix}_slab`,
    `${prefix}_double_slab`,
    `${prefix}_stairs`,
    `${prefix}_wall`,
  ];
}

function samplesRoot(): string {
  const fromEnv = process.env.VANILLA_SAMPLES;
  const candidates = [
    fromEnv,
    path.join(projectRoot, 'vanilla-samples'),
    '/tmp/bedrock-samples',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const blocks = path.join(candidate, 'metadata/vanilladata_modules/mojang-blocks.json');
    if (fs.existsSync(blocks)) return candidate;
    // zip extracts with or without a top-level folder
    const nested = path.join(candidate, 'bedrock-samples-v1.26.50.4', 'metadata/vanilladata_modules/mojang-blocks.json');
    if (fs.existsSync(nested)) return path.join(candidate, 'bedrock-samples-v1.26.50.4');
  }
  throw new Error(
    'Vanilla Bedrock samples not found. Download the min zip of Mojang/bedrock-samples (v1.26.50.4 or later) and set VANILLA_SAMPLES to that folder.',
  );
}

function readVanillaIdentifiers(root: string): { version: string; names: string[] } {
  const file = path.join(root, 'metadata/vanilladata_modules/mojang-blocks.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    data_items?: { name: string }[];
  };
  const names = (data.data_items ?? []).map((item) => item.name).filter(Boolean).sort();
  const versionFile = path.join(root, 'version.json');
  let version = '1.26.50.4';
  if (fs.existsSync(versionFile)) {
    const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf8')) as { latest?: { version?: string } };
    version = parsed.latest?.version ?? version;
  }
  const manifest = path.join(root, 'behavior_pack/manifest.json');
  if (version === 'unknown' && fs.existsSync(manifest)) {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { header?: { version?: number[] } };
    if (parsed.header?.version) version = parsed.header.version.join('.');
  }
  return { version, names };
}

function parseMapColorComponent(value: unknown): BlockColorEntry | null {
  if (typeof value === 'string') {
    parseHexColor(value);
    return { color: rgbToHex(parseHexColor(value)), tint: 'none' };
  }
  if (Array.isArray(value) && value.length >= 3) {
    const rgb = [Number(value[0]), Number(value[1]), Number(value[2])] as [number, number, number];
    return { color: rgbToHex(rgb), tint: 'none' };
  }
  if (value && typeof value === 'object') {
    const object = value as { color?: unknown; tint_method?: unknown };
    if (object.color == null) return null;
    const base = parseMapColorComponent(object.color);
    if (!base) return null;
    const tint = typeof object.tint_method === 'string' ? object.tint_method : 'none';
    return { color: base.color, tint: tint as TintMethod };
  }
  return null;
}

function readBedrockJsonColors(root: string): Record<string, BlockColorEntry> {
  const dir = path.join(root, 'behavior_pack/blocks');
  const out: Record<string, BlockColorEntry> = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as {
      'minecraft:block'?: { description?: { identifier?: string }; components?: Record<string, unknown> };
    };
    const block = data['minecraft:block'];
    const identifier = block?.description?.identifier;
    const component = block?.components?.['minecraft:map_color'];
    if (!identifier || component == null) continue;
    const entry = parseMapColorComponent(component);
    if (entry) out[identifier] = entry;
  }
  return out;
}

function assignTableColors(names: ReadonlySet<string>): Record<string, BlockColorEntry> {
  const blocks: Record<string, BlockColorEntry> = {};
  const known = (candidate: string) => names.has(id(candidate));
  const paint = (color: string, list: string[], tint: TintMethod = 'none') => {
    for (const name of list) {
      if (known(name) || name.startsWith('minecraft:')) {
        const key = id(name);
        if (names.has(key)) blocks[key] = { color, tint };
      }
    }
  };

  // Dyeable construction blocks.
  const dyedKinds = [
    'wool',
    'carpet',
    'bed',
    'stained_glass',
    'stained_glass_pane',
    'shulker_box',
    'glazed_terracotta',
    'concrete',
    'concrete_powder',
    'candle',
    'wool_slab',
    'wool_stairs',
    'wool_double_slab',
    'concrete_slab',
    'concrete_stairs',
    'concrete_double_slab',
  ];
  for (const dye of DYES) {
    paint(
      DYE_COLOR[dye],
      dyedKinds.map((kind) => `${dye}_${kind}`),
    );
    paint(TERRACOTTA_DYE[dye], [`${dye}_terracotta`]);
  }
  paint(MAP.COLOR_PURPLE, ['shulker_box', 'undyed_shulker_box']);

  // Wood families (default / vertical log colour).
  paint(MAP.WOOD, wood('oak'));
  paint(MAP.PODZOL, wood('spruce'));
  paint(MAP.SAND, wood('birch'));
  paint(MAP.DIRT, wood('jungle'));
  paint(MAP.COLOR_ORANGE, wood('acacia'));
  paint(MAP.COLOR_BROWN, wood('dark_oak'));
  paint(MAP.COLOR_RED, wood('mangrove'));
  paint(MAP.TERRACOTTA_WHITE, wood('cherry'));
  paint(MAP.QUARTZ, wood('pale_oak'));
  paint(MAP.COLOR_YELLOW, wood('bamboo'));
  paint(MAP.COLOR_YELLOW, ['bamboo_mosaic', 'bamboo_mosaic_slab', 'bamboo_mosaic_double_slab', 'bamboo_mosaic_stairs']);
  paint(MAP.CRIMSON_STEM, wood('crimson'));
  paint(MAP.WARPED_STEM, wood('warped'));
  paint(MAP.SAND, wood('poplar'));
  paint(MAP.CRIMSON_HYPHAE, ['crimson_hyphae', 'stripped_crimson_hyphae']);
  paint(MAP.WARPED_HYPHAE, ['warped_hyphae', 'stripped_warped_hyphae']);
  paint(MAP.CRIMSON_STEM, ['crimson_stem', 'stripped_crimson_stem']);
  paint(MAP.WARPED_STEM, ['warped_stem', 'stripped_warped_stem']);

  // Leaves: Bedrock map tint uses a white base so the foliage tint is the colour.
  paint('#FFFFFF', ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'vine'], 'default_foliage');
  paint('#FFFFFF', ['birch_leaves'], 'birch_foliage');
  paint('#FFFFFF', ['spruce_leaves'], 'evergreen_foliage');
  paint('#FFFFFF', ['leaf_litter'], 'dry_foliage');
  paint(MAP.COLOR_PINK, ['cherry_leaves', 'cherry_sapling', 'cactus_flower']);
  paint(MAP.METAL, ['pale_oak_leaves', 'pale_oak_sapling']);
  paint(MAP.PLANT, ['azalea_leaves', 'azalea_leaves_flowered', 'azalea', 'flowering_azalea']);
  paint('#FFFFFF', ['orange_poplar_leaves', 'red_poplar_leaves', 'yellow_poplar_leaves'], 'default_foliage');

  // Grass / plants / water with Bedrock tint methods.
  paint('#FFFFFF', ['grass_block', 'short_grass', 'fern', 'large_fern', 'tall_grass', 'reeds', 'pink_petals', 'wildflowers'], 'grass');
  paint('#FFFFFF', ['water', 'flowing_water', 'cauldron'], 'water');
  paint(MAP.GRASS, ['slime', 'slime_block']);
  paint(MAP.PLANT, [
    'sapling',
    'oak_sapling',
    'spruce_sapling',
    'birch_sapling',
    'jungle_sapling',
    'acacia_sapling',
    'dark_oak_sapling',
    'mangrove_propagule',
    'poplar_sapling',
    'wheat',
    'carrots',
    'potatoes',
    'beetroot',
    'sweet_berry_bush',
    'cave_vines',
    'cave_vines_body_with_berries',
    'cave_vines_head_with_berries',
    'spore_blossom',
    'big_dripleaf',
    'small_dripleaf_block',
    'hanging_roots',
    'cactus',
    'bamboo',
    'bamboo_sapling',
    'torchflower',
    'torchflower_crop',
    'pitcher_crop',
    'pitcher_plant',
    'bush',
    'firefly_bush',
    'poppy',
    'dandelion',
    'blue_orchid',
    'allium',
    'azure_bluet',
    'red_tulip',
    'orange_tulip',
    'white_tulip',
    'pink_tulip',
    'oxeye_daisy',
    'cornflower',
    'lily_of_the_valley',
    'wither_rose',
    'sunflower',
    'lilac',
    'rose_bush',
    'peony',
    'closed_eyeblossom',
    'open_eyeblossom',
    'waterlily',
    'mangrove_roots',
  ]);

  paint(MAP.SAND, [
    'sand',
    'suspicious_sand',
    'sandstone',
    'sandstone_slab',
    'sandstone_double_slab',
    'sandstone_stairs',
    'sandstone_wall',
    'cut_sandstone',
    'cut_sandstone_slab',
    'cut_sandstone_double_slab',
    'chiseled_sandstone',
    'smooth_sandstone',
    'smooth_sandstone_slab',
    'smooth_sandstone_double_slab',
    'smooth_sandstone_stairs',
    'glowstone',
    'end_stone',
    'end_bricks',
    'end_brick_slab',
    'end_brick_double_slab',
    'end_brick_stairs',
    'end_brick_wall',
    'bone_block',
    'turtle_egg',
    'scaffolding',
    'ochre_froglight',
    'frog_spawn',
  ]);
  paint(MAP.COLOR_ORANGE, [
    'red_sand',
    'red_sandstone',
    'red_sandstone_slab',
    'red_sandstone_double_slab',
    'red_sandstone_stairs',
    'red_sandstone_wall',
    'cut_red_sandstone',
    'cut_red_sandstone_slab',
    'cut_red_sandstone_double_slab',
    'chiseled_red_sandstone',
    'smooth_red_sandstone',
    'smooth_red_sandstone_slab',
    'smooth_red_sandstone_double_slab',
    'smooth_red_sandstone_stairs',
    'terracotta',
    'hardened_clay',
    'pumpkin',
    'carved_pumpkin',
    'lit_pumpkin',
    'honey_block',
    'honeycomb_block',
    'raw_copper_block',
    'lightning_rod',
    'creaking_heart',
  ]);

  paint(MAP.STONE, [
    'stone',
    'stone_slab',
    'stone_double_slab',
    'stone_stairs',
    'andesite',
    ...stoneSet('andesite'),
    ...stoneSet('polished_andesite').filter((name) => !name.endsWith('_wall')),
    'cobblestone',
    ...stoneSet('cobblestone'),
    'bedrock',
    'gold_ore',
    'iron_ore',
    'coal_ore',
    'lapis_ore',
    'diamond_ore',
    'redstone_ore',
    'emerald_ore',
    'copper_ore',
    'lit_redstone_ore',
    'lit_lapis_ore',
    'dispenser',
    'dropper',
    'furnace',
    'lit_furnace',
    'blast_furnace',
    'lit_blast_furnace',
    'smoker',
    'lit_smoker',
    'observer',
    'stonecutter_block',
    'stonecutter',
    'piston',
    'sticky_piston',
    'piston_arm_collision',
    'sticky_piston_arm_collision',
    'gravel',
    'suspicious_gravel',
    'hopper',
    'cauldron',
    'lava_cauldron',
    'monster_spawner',
    'mob_spawner',
    'ender_chest',
    'end_portal_frame',
    'crafter',
    'vault',
    'trial_spawner',
    'smooth_stone',
    'smooth_stone_slab',
    'smooth_stone_double_slab',
    'stone_pressure_plate',
    'mossy_cobblestone',
    ...stoneSet('mossy_cobblestone'),
    'stone_bricks',
    'stonebrick',
    ...stoneSet('stone_brick'),
    'mossy_stone_bricks',
    ...stoneSet('mossy_stone_brick'),
    'cracked_stone_bricks',
    'chiseled_stone_bricks',
    'infested_stone',
    'infested_cobblestone',
    'infested_stone_bricks',
    'infested_mossy_stone_bricks',
    'infested_cracked_stone_bricks',
    'infested_chiseled_stone_bricks',
    'monster_egg',
  ]);

  paint(MAP.DEEPSLATE, [
    'deepslate',
    'cobbled_deepslate',
    ...stoneSet('cobbled_deepslate'),
    'polished_deepslate',
    ...stoneSet('polished_deepslate'),
    'deepslate_bricks',
    ...stoneSet('deepslate_brick'),
    'cracked_deepslate_bricks',
    'deepslate_tiles',
    ...stoneSet('deepslate_tile'),
    'cracked_deepslate_tiles',
    'chiseled_deepslate',
    'reinforced_deepslate',
    'infested_deepslate',
    'deepslate_gold_ore',
    'deepslate_iron_ore',
    'deepslate_coal_ore',
    'deepslate_lapis_ore',
    'deepslate_diamond_ore',
    'deepslate_redstone_ore',
    'lit_deepslate_redstone_ore',
    'deepslate_emerald_ore',
    'deepslate_copper_ore',
  ]);

  paint(MAP.DIRT, [
    'dirt',
    'coarse_dirt',
    'farmland',
    'grass_path',
    'dirt_with_roots',
    'rooted_dirt',
    'packed_mud',
    'granite',
    ...stoneSet('granite'),
    'polished_granite',
    'polished_granite_slab',
    'polished_granite_double_slab',
    'polished_granite_stairs',
    'jukebox',
    'brown_mushroom_block',
  ]);
  paint(MAP.PODZOL, ['podzol', 'campfire', 'soul_campfire', 'muddy_mangrove_roots']);
  paint(MAP.CLAY, ['clay', 'heavy_core']);
  paint(MAP.SNOW, ['snow', 'snow_layer', 'powder_snow', 'snow_block']);
  paint(MAP.ICE, ['ice', 'frosted_ice', 'packed_ice', 'blue_ice']);
  paint(MAP.FIRE, ['lava', 'flowing_lava', 'tnt', 'fire', 'redstone_block']);
  paint(MAP.WATER, ['kelp', 'kelp_plant', 'seagrass', 'bubble_column']);
  paint(MAP.WOOD, [
    'noteblock',
    'bookshelf',
    'chiseled_bookshelf',
    'chest',
    'trapped_chest',
    'crafting_table',
    'daylight_detector',
    'daylight_detector_inverted',
    'loom',
    'barrel',
    'cartography_table',
    'fletching_table',
    'lectern',
    'smithing_table',
    'composter',
    'deadbush',
    'beehive',
    'wall_banner',
    'standing_banner',
    'petrified_oak_slab',
  ]);
  paint(MAP.QUARTZ, [
    'diorite',
    ...stoneSet('diorite'),
    'polished_diorite',
    'polished_diorite_slab',
    'polished_diorite_double_slab',
    'polished_diorite_stairs',
    'quartz_block',
    'quartz_slab',
    'quartz_double_slab',
    'quartz_stairs',
    'quartz_bricks',
    'quartz_pillar',
    'chiseled_quartz_block',
    'smooth_quartz',
    'smooth_quartz_slab',
    'smooth_quartz_double_slab',
    'smooth_quartz_stairs',
    'sea_lantern',
    'target',
  ]);
  paint(MAP.METAL, [
    'iron_block',
    'iron_door',
    'iron_trapdoor',
    'iron_bars',
    'brewing_stand',
    'heavy_weighted_pressure_plate',
    'anvil',
    'lantern',
    'soul_lantern',
    'grindstone',
    'lodestone',
    'chain',
    'iron_chain',
  ]);
  paint(MAP.WOOL, ['web', 'mushroom_stem']);
  paint(MAP.COLOR_BROWN, ['soul_sand', 'soul_soil', 'command_block', 'brown_mushroom']);
  paint(MAP.COLOR_GREEN, ['end_portal_frame', 'chain_command_block', 'sea_pickle', 'moss_carpet', 'moss_block', 'dried_kelp_block']);
  paint(MAP.COLOR_RED, [
    'brick_block',
    'brick_slab',
    'brick_double_slab',
    'brick_stairs',
    'brick_wall',
    'red_mushroom_block',
    'nether_wart',
    'nether_wart_block',
    'enchanting_table',
    'shroomlight',
    'sniffer_egg',
    'red_mushroom',
  ]);
  paint(MAP.COLOR_BLACK, [
    'obsidian',
    'crying_obsidian',
    'end_portal',
    'end_gateway',
    'dragon_egg',
    'coal_block',
    'basalt',
    'polished_basalt',
    'smooth_basalt',
    'netherite_block',
    'ancient_debris',
    'respawn_anchor',
    'blackstone',
    ...stoneSet('blackstone'),
    'gilded_blackstone',
    'polished_blackstone',
    ...stoneSet('polished_blackstone'),
    'polished_blackstone_bricks',
    ...stoneSet('polished_blackstone_brick'),
    'cracked_polished_blackstone_bricks',
    'chiseled_polished_blackstone',
    'sculk',
    'sculk_vein',
    'sculk_catalyst',
    'sculk_shrieker',
    'sculk_sensor',
    'calibrated_sculk_sensor',
  ]);
  paint(MAP.GOLD, ['gold_block', 'light_weighted_pressure_plate', 'bell', 'raw_gold_block', 'potent_sulfur']);
  paint(MAP.DIAMOND, [
    'diamond_block',
    'beacon',
    'prismarine_bricks',
    'prismarine_brick_slab',
    'prismarine_brick_double_slab',
    'prismarine_brick_stairs',
    'dark_prismarine',
    'dark_prismarine_slab',
    'dark_prismarine_double_slab',
    'dark_prismarine_stairs',
    'conduit',
  ]);
  paint(MAP.LAPIS, ['lapis_block']);
  paint(MAP.EMERALD, ['emerald_block']);
  paint(MAP.NETHER, [
    'netherrack',
    'nether_brick',
    'nether_brick_fence',
    'nether_brick_slab',
    'nether_brick_double_slab',
    'nether_brick_stairs',
    'nether_brick_wall',
    'cracked_nether_bricks',
    'chiseled_nether_bricks',
    'red_nether_brick',
    'red_nether_brick_slab',
    'red_nether_brick_double_slab',
    'red_nether_brick_stairs',
    'red_nether_brick_wall',
    'nether_gold_ore',
    'quartz_ore',
    'magma',
    'crimson_roots',
    'crimson_fungus',
    'weeping_vines',
  ]);
  paint(MAP.CRIMSON_NYLIUM, ['crimson_nylium']);
  paint(MAP.WARPED_NYLIUM, ['warped_nylium']);
  paint(MAP.WARPED_WART, ['warped_wart_block']);
  paint(MAP.COLOR_CYAN, [
    'prismarine',
    'prismarine_slab',
    'prismarine_double_slab',
    'prismarine_stairs',
    'prismarine_wall',
    'warped_roots',
    'warped_fungus',
    'twisting_vines',
    'nether_sprouts',
  ]);
  paint(MAP.COLOR_PURPLE, [
    'mycelium',
    'chorus_plant',
    'chorus_flower',
    'repeating_command_block',
    'amethyst_block',
    'budding_amethyst',
    'amethyst_cluster',
    'small_amethyst_bud',
    'medium_amethyst_bud',
    'large_amethyst_bud',
  ]);
  paint(MAP.COLOR_YELLOW, [
    'sponge',
    'wet_sponge',
    'hay_block',
    'bee_nest',
    'short_dry_grass',
    'tall_dry_grass',
    ...stoneSet('sulfur'),
    ...stoneSet('polished_sulfur'),
    ...stoneSet('sulfur_brick'),
    'sulfur_bricks',
    'chiseled_sulfur',
    'sulfur_spike',
  ]);
  paint(MAP.COLOR_RED, [
    ...stoneSet('cinnabar'),
    ...stoneSet('polished_cinnabar'),
    ...stoneSet('cinnabar_brick'),
    'cinnabar_bricks',
    'chiseled_cinnabar',
  ]);
  paint(MAP.TERRACOTTA_WHITE, ['calcite']);
  paint(MAP.TERRACOTTA_ORANGE, [
    'resin_bricks',
    'resin_brick_slab',
    'resin_brick_double_slab',
    'resin_brick_stairs',
    'resin_brick_wall',
    'resin_block',
    'resin_clump',
    'chiseled_resin_bricks',
  ]);
  paint(MAP.TERRACOTTA_GRAY, [...stoneSet('tuff'), 'tuff', 'polished_tuff', ...stoneSet('polished_tuff'), 'tuff_bricks', ...stoneSet('tuff_brick'), 'chiseled_tuff', 'chiseled_tuff_bricks']);
  paint(MAP.TERRACOTTA_LIGHT_GRAY, [...stoneSet('mud_brick'), 'mud_bricks']);
  paint(MAP.TERRACOTTA_CYAN, ['mud']);
  paint(MAP.TERRACOTTA_BROWN, ['dripstone_block', 'pointed_dripstone']);
  paint(MAP.TERRACOTTA_RED, ['decorated_pot']);
  paint(MAP.RAW_IRON, ['raw_iron_block']);
  paint(MAP.GLOW_LICHEN, ['glow_lichen', 'verdant_froglight']);
  paint(MAP.COLOR_PINK, ['pearlescent_froglight']);
  paint(MAP.COLOR_LIGHT_GRAY, ['structure_block', 'jigsaw', 'pale_moss_block', 'pale_moss_carpet']);
  paint(MAP.TERRACOTTA_LIGHT_GRAY, ['silver_terracotta', 'light_gray_terracotta']);
  paint(MAP.COLOR_LIGHT_GRAY, [
    'silver_glazed_terracotta',
    'silver_wool',
    'silver_carpet',
    'silver_concrete',
    'silver_concrete_powder',
    'silver_shulker_box',
    'silver_stained_glass',
    'silver_stained_glass_pane',
  ]);
  paint(MAP.COLOR_GRAY, [
    'tinted_glass',
    'dried_ghast',
    'dead_tube_coral',
    'dead_brain_coral',
    'dead_bubble_coral',
    'dead_fire_coral',
    'dead_horn_coral',
    'dead_tube_coral_block',
    'dead_brain_coral_block',
    'dead_bubble_coral_block',
    'dead_fire_coral_block',
    'dead_horn_coral_block',
    'dead_tube_coral_fan',
    'dead_brain_coral_fan',
    'dead_bubble_coral_fan',
    'dead_fire_coral_fan',
    'dead_horn_coral_fan',
    'dead_coral_fan',
  ]);
  paint(MAP.COLOR_YELLOW, ['horn_coral', 'horn_coral_block', 'horn_coral_fan']);
  paint(MAP.COLOR_PINK, ['brain_coral', 'brain_coral_block', 'brain_coral_fan']);
  paint(MAP.COLOR_PURPLE, ['bubble_coral', 'bubble_coral_block', 'bubble_coral_fan']);
  paint(MAP.COLOR_RED, ['fire_coral', 'fire_coral_block', 'fire_coral_fan']);
  paint(MAP.COLOR_BLUE, ['tube_coral', 'tube_coral_block', 'tube_coral_fan']);

  // Copper family.
  const copperStages = ['', 'exposed_', 'weathered_', 'oxidized_'];
  const copperColors = [MAP.COLOR_ORANGE, MAP.TERRACOTTA_LIGHT_GRAY, MAP.WARPED_STEM, MAP.WARPED_NYLIUM];
  for (const [i, stage] of copperStages.entries()) {
    const color = copperColors[i]!;
    const names: string[] = [];
    for (const waxed of ['', 'waxed_']) {
      const p = `${waxed}${stage}copper`;
      names.push(
        `${p}`,
        `${p}_block`,
        `cut_${p}`,
        `${p}_grate`,
        `${p}_bulb`,
        `${p}_door`,
        `${p}_trapdoor`,
        `${p}_bars`,
        `cut_${p}_slab`,
        `cut_${p}_double_slab`,
        `cut_${p}_stairs`,
        `chiseled_${p}`,
        `${waxed}${stage}cut_copper`,
        `${waxed}${stage}cut_copper_slab`,
        `${waxed}${stage}cut_copper_stairs`,
        `${waxed}${stage}copper_block`,
        `${waxed}${stage}copper_grate`,
        `${waxed}${stage}copper_bulb`,
        `${waxed}${stage}copper_door`,
        `${waxed}${stage}copper_trapdoor`,
        `${waxed}${stage}chiseled_copper`,
      );
    }
    paint(color, names);
  }

  paint(MAP.COLOR_MAGENTA, ['purpur_block', 'purpur_pillar', 'purpur_slab', 'purpur_double_slab', 'purpur_stairs', 'purpur_line']);
  paint(MAP.COLOR_LIGHT_GREEN, ['melon_block']);
  paint(MAP.NETHER, ['redstone_lamp', 'lit_redstone_lamp']);

  return blocks;
}

/** Categories for leftover vanilla identifiers that the table listed as transparent or under a Bedrock alias. */
function assignLeftovers(names: readonly string[], blocks: Record<string, BlockColorEntry>): void {
  const copy = (from: string, to: string) => {
    const source = blocks[id(from)];
    if (source) blocks[id(to)] = { ...source };
  };

  for (const name of names) {
    if (blocks[name]) continue;
    const short = name.slice('minecraft:'.length);

    if (short === 'air' || short.startsWith('light_block') || short === 'barrier' || short === 'structure_void' || short === 'unknown') {
      blocks[name] = { color: '#000000', tint: 'none' };
      continue;
    }
    if (short.startsWith('element_') || short === 'compound_creator' || short === 'element_constructor' || short === 'lab_table' || short === 'material_reducer' || short === 'chemical_heat' || short === 'camera') {
      blocks[name] = { color: MAP.METAL, tint: 'none' };
      continue;
    }
    if (short.endsWith('_candle_cake') || short === 'candle_cake' || short === 'cake' || short === 'candle') {
      blocks[name] = { color: MAP.SNOW, tint: 'none' };
      continue;
    }
    if (short.endsWith('_head') || short.endsWith('_skull')) {
      blocks[name] = { color: MAP.STONE, tint: 'none' };
      continue;
    }
    if (short.endsWith('_wall_fan')) {
      copy(short.replace('_wall_fan', '_fan'), short);
      if (blocks[name]) continue;
      copy(short.replace('_wall_fan', ''), short);
      if (blocks[name]) continue;
    }
    if (short.startsWith('hard_') && short.includes('glass')) {
      const inner = short.slice('hard_'.length);
      copy(inner, short);
      if (blocks[name]) continue;
      blocks[name] = { color: MAP.WOOL, tint: 'none' };
      continue;
    }
    if (short === 'glass' || short === 'glass_pane' || short === 'hard_glass' || short === 'hard_glass_pane') {
      blocks[name] = { color: MAP.WOOL, tint: 'none' };
      continue;
    }
    if (short.includes('copper_chest') || short.includes('copper_golem_statue') || short.includes('copper_lantern') || short.includes('copper_chain')) {
      const stage = short.includes('oxidized') ? MAP.WARPED_NYLIUM : short.includes('weathered') ? MAP.WARPED_STEM : short.includes('exposed') ? MAP.TERRACOTTA_LIGHT_GRAY : MAP.COLOR_ORANGE;
      blocks[name] = { color: stage, tint: 'none' };
      continue;
    }
    if (short.endsWith('_lightning_rod') || short === 'lightning_rod') {
      blocks[name] = { color: MAP.COLOR_ORANGE, tint: 'none' };
      continue;
    }
    if (short.includes('double_cut_copper_slab') || short.includes('cut_copper')) {
      const stage = short.includes('oxidized') ? MAP.WARPED_NYLIUM : short.includes('weathered') ? MAP.WARPED_STEM : short.includes('exposed') ? MAP.TERRACOTTA_LIGHT_GRAY : MAP.COLOR_ORANGE;
      blocks[name] = { color: stage, tint: 'none' };
      continue;
    }
    if (
      short === 'rail' ||
      short === 'golden_rail' ||
      short === 'detector_rail' ||
      short === 'activator_rail' ||
      short === 'ladder' ||
      short === 'lever' ||
      short === 'tripwire_hook' ||
      short === 'trip_wire' ||
      short === 'redstone_wire' ||
      short === 'end_rod'
    ) {
      blocks[name] = { color: MAP.METAL, tint: 'none' };
      continue;
    }
    if (short.includes('torch')) {
      blocks[name] = { color: MAP.WOOD, tint: 'none' };
      continue;
    }
    if (short.includes('repeater') || short.includes('comparator')) {
      blocks[name] = { color: MAP.STONE, tint: 'none' };
      continue;
    }
    if (short === 'anvil' || short === 'chipped_anvil' || short === 'damaged_anvil') {
      blocks[name] = { color: MAP.METAL, tint: 'none' };
      continue;
    }
    if (short === 'bamboo_block' || short === 'stripped_bamboo_block') {
      blocks[name] = { color: MAP.COLOR_YELLOW, tint: 'none' };
      continue;
    }
    if (short === 'wooden_door' || short === 'wooden_button' || short === 'wooden_pressure_plate' || short === 'fence_gate' || short === 'trapdoor' || short === 'standing_sign' || short === 'wall_sign') {
      blocks[name] = { color: MAP.WOOD, tint: 'none' };
      continue;
    }
    if (short === 'darkoak_standing_sign' || short === 'darkoak_wall_sign') {
      blocks[name] = { color: MAP.COLOR_BROWN, tint: 'none' };
      continue;
    }
    if (short === 'normal_stone_slab' || short === 'normal_stone_double_slab' || short === 'normal_stone_stairs') {
      blocks[name] = { color: MAP.STONE, tint: 'none' };
      continue;
    }
    if (short.startsWith('end_stone_brick')) {
      blocks[name] = { color: MAP.SAND, tint: 'none' };
      continue;
    }
    if (short === 'prismarine_bricks_stairs') {
      blocks[name] = { color: MAP.DIAMOND, tint: 'none' };
      continue;
    }
    if (short === 'cocoa' || short === 'melon_stem' || short === 'pumpkin_stem' || short === 'golden_dandelion') {
      blocks[name] = { color: MAP.PLANT, tint: 'none' };
      continue;
    }
    if (short === 'soul_fire') {
      blocks[name] = { color: MAP.COLOR_LIGHT_BLUE, tint: 'none' };
      continue;
    }
    if (short === 'portal') {
      blocks[name] = { color: MAP.COLOR_PURPLE, tint: 'none' };
      continue;
    }
    if (short === 'flower_pot' || short === 'frame' || short === 'glow_frame') {
      blocks[name] = { color: MAP.WOOD, tint: 'none' };
      continue;
    }
    if (short === 'bed' || short === 'straw_bed') {
      blocks[name] = { color: MAP.COLOR_RED, tint: 'none' };
      continue;
    }
    if (short === 'polished_blackstone_button' || short === 'polished_blackstone_pressure_plate') {
      blocks[name] = { color: MAP.COLOR_BLACK, tint: 'none' };
      continue;
    }
    if (short === 'stone_button') {
      blocks[name] = { color: MAP.STONE, tint: 'none' };
      continue;
    }
    if (short === 'pale_hanging_moss') {
      blocks[name] = { color: MAP.COLOR_LIGHT_GRAY, tint: 'none' };
      continue;
    }
    if (short === 'petrified_oak_double_slab') {
      blocks[name] = { color: MAP.WOOD, tint: 'none' };
      continue;
    }
    if (short === 'allow' || short === 'deny' || short === 'border_block') {
      blocks[name] = { color: MAP.STONE, tint: 'none' };
      continue;
    }
    if (short === 'underwater_tnt') {
      blocks[name] = { color: MAP.FIRE, tint: 'none' };
      continue;
    }
  }
}

function applyDocumentedTints(blocks: Record<string, BlockColorEntry>): void {
  const tintWhite = (names: string[], tint: TintMethod) => {
    for (const name of names) {
      const key = id(name);
      const current = blocks[key];
      blocks[key] = { color: '#FFFFFF', tint };
      if (current && current.tint !== 'none' && current.tint !== tint) {
        blocks[key] = { color: current.color, tint };
      }
    }
  };
  tintWhite(
    ['grass_block', 'short_grass', 'fern', 'large_fern', 'tall_grass', 'reeds', 'pink_petals', 'wildflowers'],
    'grass',
  );
  tintWhite(['water', 'flowing_water'], 'water');
  tintWhite(['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'vine'], 'default_foliage');
  tintWhite(['birch_leaves'], 'birch_foliage');
  tintWhite(['spruce_leaves'], 'evergreen_foliage');
  tintWhite(['leaf_litter'], 'dry_foliage');
}

const root = samplesRoot();
const { version, names } = readVanillaIdentifiers(root);
const nameSet = new Set(names);
const table = assignTableColors(nameSet);
applyDocumentedTints(table);
assignLeftovers(names, table);
const jsonColors = readBedrockJsonColors(root);

const blocks: Record<string, BlockColorEntry> = { ...table };
// Official Bedrock JSON wins when a block actually ships a map_color component.
for (const [identifier, entry] of Object.entries(jsonColors)) {
  blocks[identifier] = entry;
}

const sorted: Record<string, BlockColorEntry> = {};
for (const key of Object.keys(blocks).sort()) sorted[key] = blocks[key]!;

const database: BlockColorDatabase = {
  version,
  source:
    'Mojang bedrock-samples behavior_pack/blocks minecraft:map_color, overlaid on the published vanilla MapColor table and Bedrock tint methods',
  vanillaCount: names.length,
  vanillaIdentifiers: names,
  neutralTints: { ...NEUTRAL_TINTS },
  blocks: sorted,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(database, null, 2)}\n`);

const jsonCount = Object.keys(jsonColors).length;
const tableOnly = Object.keys(table).filter((key) => !(key in jsonColors)).length;
console.log(`Wrote ${outFile}`);
console.log(`  vanilla identifiers: ${names.length} (Bedrock samples ${version})`);
console.log(`  Bedrock JSON map_color: ${jsonCount}`);
console.log(`  MapColor table assignments: ${tableOnly}`);
console.log(`  stored explicit colours: ${Object.keys(sorted).length}`);
console.log(`  missing from table (family/hash at runtime): ${names.length - Object.keys(sorted).filter((key) => nameSet.has(key)).length}`);

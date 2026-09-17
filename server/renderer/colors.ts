/**
 * Procedural block colours.
 *
 * Deliberately hand-picked flat colours - no Minecraft textures are used or
 * needed. Lookup order is: exact block name, then a small set of name rules
 * (so `*_leaves`, `*_log`, `deepslate_*` and friends work without listing every
 * wood type), then a deterministic hash-based fallback so an unknown block from
 * a future update gets a stable colour instead of crashing the renderer.
 */

export type Rgb = readonly [number, number, number];

const EXACT: Record<string, Rgb> = {
  'minecraft:grass_block': [106, 168, 79],
  'minecraft:short_grass': [110, 165, 78],
  'minecraft:tallgrass': [110, 165, 78],
  'minecraft:fern': [98, 150, 70],
  'minecraft:large_fern': [98, 150, 70],
  'minecraft:moss_block': [89, 122, 44],
  'minecraft:moss_carpet': [89, 122, 44],
  'minecraft:dirt': [134, 96, 67],
  'minecraft:coarse_dirt': [122, 88, 60],
  'minecraft:rooted_dirt': [144, 104, 74],
  'minecraft:dirt_with_roots': [144, 104, 74],
  'minecraft:podzol': [105, 67, 30],
  'minecraft:mycelium': [140, 116, 128],
  'minecraft:mud': [65, 57, 56],
  'minecraft:clay': [160, 166, 179],
  'minecraft:farmland': [122, 88, 60],
  'minecraft:stone': [136, 136, 136],
  'minecraft:cobblestone': [122, 122, 122],
  'minecraft:mossy_cobblestone': [110, 122, 100],
  'minecraft:andesite': [132, 134, 133],
  'minecraft:granite': [154, 108, 90],
  'minecraft:diorite': [188, 188, 190],
  'minecraft:calcite': [223, 222, 216],
  'minecraft:tuff': [108, 109, 102],
  'minecraft:gravel': [140, 133, 126],
  'minecraft:bedrock': [58, 58, 58],
  'minecraft:obsidian': [21, 18, 30],
  'minecraft:sand': [219, 207, 163],
  'minecraft:red_sand': [190, 102, 33],
  'minecraft:water': [59, 110, 190],
  'minecraft:flowing_water': [59, 110, 190],
  'minecraft:lava': [214, 96, 26],
  'minecraft:flowing_lava': [214, 96, 26],
  'minecraft:ice': [145, 190, 230],
  'minecraft:packed_ice': [160, 205, 240],
  'minecraft:blue_ice': [130, 185, 240],
  'minecraft:frosted_ice': [160, 205, 240],
  'minecraft:snow': [250, 250, 250],
  'minecraft:snow_layer': [246, 250, 252],
  'minecraft:powder_snow': [246, 250, 252],
  'minecraft:sculk': [30, 54, 58],
  'minecraft:sculk_vein': [38, 62, 66],
  'minecraft:sculk_catalyst': [42, 68, 72],
  'minecraft:sculk_shrieker': [52, 78, 80],
  'minecraft:netherrack': [110, 50, 46],
  'minecraft:end_stone': [220, 223, 158],
  'minecraft:seagrass': [58, 120, 78],
  'minecraft:kelp': [48, 105, 62],
  'minecraft:brown_mushroom': [150, 118, 92],
  'minecraft:red_mushroom': [180, 74, 66],
  'minecraft:poppy': [176, 68, 60],
  'minecraft:dandelion': [214, 196, 76],
};

/** Name rules, checked in order. */
const RULES: readonly { match: (name: string) => boolean; color: Rgb }[] = [
  { match: (n) => n.endsWith('_leaves'), color: [42, 92, 42] },
  { match: (n) => n.endsWith('_log') || n.endsWith('_wood') || n.startsWith('minecraft:stripped_'), color: [102, 76, 47] },
  { match: (n) => n.endsWith('_planks') || n.endsWith('_slab') || n.endsWith('_stairs'), color: [150, 116, 71] },
  { match: (n) => n.endsWith('_sapling') || n.endsWith('_bush') || n === 'minecraft:vine', color: [70, 122, 52] },
  { match: (n) => n.includes('deepslate'), color: [72, 72, 78] },
  { match: (n) => n.includes('sandstone'), color: [216, 203, 155] },
  { match: (n) => n.includes('terracotta'), color: [152, 94, 67] },
  { match: (n) => n.includes('_ore'), color: [124, 126, 130] },
  { match: (n) => n.includes('basalt') || n.includes('blackstone'), color: [64, 62, 66] },
  { match: (n) => n.includes('concrete') || n.includes('wool'), color: [170, 170, 170] },
  { match: (n) => n.includes('coral'), color: [190, 96, 140] },
  { match: (n) => n.includes('water'), color: [59, 110, 190] },
  { match: (n) => n.includes('grass'), color: [106, 168, 79] },
  { match: (n) => n.includes('flower') || n.includes('tulip'), color: [190, 120, 130] },
];

/**
 * Stable pseudo-random colour for unknown blocks (FNV-1a over the name).
 * Saturation and lightness are fixed so fallback colours stay readable and are
 * obviously "not a real palette entry" without being garish.
 */
function fallbackColor(blockName: string): Rgb {
  let hash = 0x811c9dc5;
  for (let i = 0; i < blockName.length; i++) {
    hash ^= blockName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hslToRgb((hash % 360) / 360, 0.35, 0.5);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h * 6;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const cache = new Map<string, Rgb>();

/** Colour for a block name. Never throws; unknown names get a stable colour. */
export function blockColor(blockName: string): Rgb {
  const cached = cache.get(blockName);
  if (cached) return cached;

  const exact = EXACT[blockName];
  const color = exact ?? RULES.find((rule) => rule.match(blockName))?.color ?? fallbackColor(blockName);
  cache.set(blockName, color);
  return color;
}

/** True when the colour came from the curated palette rather than the hash fallback. */
export function hasKnownColor(blockName: string): boolean {
  return blockName in EXACT || RULES.some((rule) => rule.match(blockName));
}

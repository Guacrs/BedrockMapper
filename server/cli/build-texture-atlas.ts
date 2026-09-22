/**
 * Builds data/textures/{atlas.png, atlas.json, block-appearance.json} from
 * Mojang bedrock-samples (vanilla resource pack).
 *
 *   VANILLA_SAMPLES=/path/to/bedrock-samples npm run textures:build
 *
 * Requires the *full* samples zip (min zip omits block PNGs).
 *
 * Generated Minecraft texture assets are NOT committed — see README / LICENSE
 * note referencing Mojang/bedrock-samples (Minecraft EULA).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode as decodePng, encode as encodePng } from 'fast-png';

import type { BlockAppearance, BlockAppearanceDatabase } from '../renderer/3d/textures/appearance.ts';
import type { AtlasFrame, AtlasMetadata } from '../renderer/3d/textures/atlas.ts';
import { resolveBlockColor } from '../renderer/colors.ts';
import { loadBlockColorDatabase } from '../renderer/block-palette.ts';
import {
  applyOverlayColor,
  overlayCompositedTextureKey,
  overlayColorToHex,
  parseOverlayColor,
  type Rgb as OverlayRgb,
} from '../renderer/3d/textures/overlay.ts';
import {
  ATLAS_JSON_PATH,
  ATLAS_PNG_PATH,
  BLOCK_APPEARANCE_PATH,
  PROJECT_ROOT,
  TEXTURES_DIR,
} from '../renderer/3d/textures/paths.ts';
import { decodeTga, type RgbaImage } from '../renderer/3d/textures/tga.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Bedrock blocks.json keys that differ from modern block identifiers. */
const BLOCKS_JSON_KEY_BY_ID: Record<string, string> = {
  'minecraft:grass_block': 'grass',
  'minecraft:trip_wire': 'tripWire',
};

/**
 * When blocks.json uses a legacy key, also emit the modern minecraft: id so
 * ChunkBlocks names resolve. Keys are blocks.json names.
 */
const EXTRA_IDS_BY_BLOCKS_JSON_KEY: Record<string, string[]> = {
  grass: ['minecraft:grass_block'],
  tripWire: ['minecraft:trip_wire'],
};

function samplesRoot(): string {
  const fromEnv = process.env.VANILLA_SAMPLES;
  const candidates = [
    fromEnv,
    path.join(PROJECT_ROOT, 'vanilla-samples'),
    '/tmp/bedrock-samples',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const marker = path.join(candidate, 'resource_pack', 'blocks.json');
    if (fs.existsSync(marker)) return candidate;
    const nested = path.join(candidate, 'bedrock-samples-v1.26.50.4', 'resource_pack', 'blocks.json');
    if (fs.existsSync(nested)) return path.join(candidate, 'bedrock-samples-v1.26.50.4');
  }
  throw new Error(
    'Vanilla Bedrock samples not found (need the *full* zip with resource_pack/textures/blocks). ' +
      'Download Mojang/bedrock-samples and set VANILLA_SAMPLES to that folder.',
  );
}

/** Strip // and /* * / comments and trailing commas (terrain_texture.json is JSONC). */
export function parseJsonc(text: string): unknown {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, '');
  const noTrailing = noLine.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

function readVersion(root: string): string {
  const versionFile = path.join(root, 'version.json');
  if (fs.existsSync(versionFile)) {
    const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf8')) as {
      latest?: { version?: string };
    };
    if (parsed.latest?.version) return parsed.latest.version;
  }
  const manifest = path.join(root, 'resource_pack', 'manifest.json');
  if (fs.existsSync(manifest)) {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      header?: { min_engine_version?: number[] };
    };
    const ver = parsed.header?.min_engine_version;
    if (ver) return ver.join('.');
  }
  return 'unknown';
}

type TerrainTextureRef = string | { path?: string; overlay_color?: string };
type TerrainTextures = TerrainTextureRef | TerrainTextureRef[];

interface TerrainEntry {
  textures?: TerrainTextures;
}

interface ResolvedTextureRef {
  /** Resource path without extension, e.g. textures/blocks/grass_side */
  path: string;
  /** Present when terrain_texture requests overlay_color compositing. */
  overlayColor?: string;
}

/**
 * Pick the first usable texture reference from a terrain_texture `textures` value.
 * Preserves overlay_color when the entry is an object (lost by path-only helpers).
 */
export function firstTextureRef(textures: TerrainTextures | undefined): ResolvedTextureRef | null {
  if (textures == null) return null;
  if (typeof textures === 'string') return { path: textures };
  if (Array.isArray(textures)) {
    if (textures.length === 0) return null;
    const first = textures[0]!;
    if (typeof first === 'string') return { path: first };
    if (first.path) {
      return {
        path: first.path,
        overlayColor: first.overlay_color,
      };
    }
    return null;
  }
  if (typeof textures === 'object' && textures.path) {
    return {
      path: textures.path,
      overlayColor: textures.overlay_color,
    };
  }
  return null;
}

function toTextureKey(resourcePath: string): string {
  // "textures/blocks/stone" → "blocks/stone"
  return resourcePath.replace(/^textures\//, '').replace(/\.(png|tga)$/i, '');
}

function loadRgba(absBase: string): RgbaImage | null {
  const pngPath = `${absBase}.png`;
  if (fs.existsSync(pngPath)) {
    const decoded = decodePng(fs.readFileSync(pngPath));
    const { width, height } = decoded;
    const src = decoded.data;
    const channels = src.length / (width * height);
    const data = new Uint8Array(width * height * 4);
    if (channels === 4) {
      data.set(src);
    } else if (channels === 3) {
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        data[j] = src[i]!;
        data[j + 1] = src[i + 1]!;
        data[j + 2] = src[i + 2]!;
        data[j + 3] = 255;
      }
    } else if (channels === 1) {
      for (let i = 0, j = 0; i < src.length; i++, j += 4) {
        const v = src[i]!;
        data[j] = v;
        data[j + 1] = v;
        data[j + 2] = v;
        data[j + 3] = 255;
      }
    } else {
      return null;
    }
    return { width, height, data };
  }
  const tgaPath = `${absBase}.tga`;
  if (fs.existsSync(tgaPath)) {
    return decodeTga(fs.readFileSync(tgaPath));
  }
  return null;
}

/**
 * Resolve a blocks.json texture alias to an atlas key, loading (and optionally
 * overlay-compositing) the image into `images`.
 *
 * `overlayColorOverride` replaces terrain_texture's overlay_color when the
 * consuming block uses a biome tint method (Bedrock applies the grass colormap
 * with the same alpha-mask blend at runtime; offline we bake plains neutral).
 */
function resolveAliasToKey(
  alias: string,
  textureData: Record<string, TerrainEntry>,
  resourcePackRoot: string,
  images: Map<string, RgbaImage>,
  overlayColorOverride?: OverlayRgb | null,
): string | null {
  const entry = textureData[alias];
  if (!entry) return null;
  const ref = firstTextureRef(entry.textures);
  if (!ref) return null;
  const absBase = path.join(resourcePackRoot, ref.path);
  const source = loadRgba(absBase);
  if (!source) return null;

  const baseKey = toTextureKey(ref.path);
  if (ref.overlayColor) {
    const overlay = overlayColorOverride ?? parseOverlayColor(ref.overlayColor);
    const key = overlayCompositedTextureKey(baseKey, overlayColorToHex(overlay));
    if (!images.has(key)) {
      images.set(key, applyOverlayColor(source, overlay));
    }
    return key;
  }

  if (!images.has(baseKey)) {
    images.set(baseKey, source);
  }
  return baseKey;
}

/**
 * If any runtime id for this blocks.json entry uses a biome tint method,
 * return that method's plains/neutral tint so overlay masks bake the same
 * green the mesher applies to grayscale tops via vertex colour.
 */
function biomeOverlayTintOverride(runtimeIds: Iterable<string>): OverlayRgb | null {
  const db = loadBlockColorDatabase();
  for (const id of runtimeIds) {
    const tint = resolveBlockColor(id).tint;
    if (tint === 'none') continue;
    const hex = db.neutralTints?.[tint];
    if (hex) return parseOverlayColor(hex);
  }
  return null;
}

type RawFaceTextures = string | Record<string, string>;

function normalizeAppearance(
  textures: RawFaceTextures,
  textureData: Record<string, TerrainEntry>,
  resourcePackRoot: string,
  images: Map<string, RgbaImage>,
  overlayColorOverride?: OverlayRgb | null,
): BlockAppearance | null {
  if (typeof textures === 'string') {
    const key = resolveAliasToKey(
      textures,
      textureData,
      resourcePackRoot,
      images,
      overlayColorOverride,
    );
    if (!key) return null;
    return { all: key };
  }

  const upAlias = textures.up ?? textures['*'];
  const downAlias = textures.down ?? textures['*'];
  const sideAlias =
    textures.side ?? textures.north ?? textures.south ?? textures.east ?? textures.west ?? textures['*'];

  // Require at least one resolvable face; prefer compact all/up/down/side form.
  if (upAlias && downAlias && sideAlias && upAlias === downAlias && downAlias === sideAlias) {
    const key = resolveAliasToKey(
      upAlias,
      textureData,
      resourcePackRoot,
      images,
      overlayColorOverride,
    );
    return key ? { all: key } : null;
  }

  const appearance: BlockAppearance = {};
  if (upAlias) {
    const key = resolveAliasToKey(
      upAlias,
      textureData,
      resourcePackRoot,
      images,
      overlayColorOverride,
    );
    if (key) appearance.up = key;
  }
  if (downAlias) {
    const key = resolveAliasToKey(
      downAlias,
      textureData,
      resourcePackRoot,
      images,
      overlayColorOverride,
    );
    if (key) appearance.down = key;
  }
  if (sideAlias) {
    const key = resolveAliasToKey(
      sideAlias,
      textureData,
      resourcePackRoot,
      images,
      overlayColorOverride,
    );
    if (key) appearance.side = key;
  }

  if (!appearance.up && !appearance.down && !appearance.side && !appearance.all) return null;

  // If only one unique key, collapse to `all`.
  const keys = [appearance.up, appearance.down, appearance.side].filter(Boolean) as string[];
  if (keys.length > 0 && keys.every((k) => k === keys[0])) {
    return { all: keys[0] };
  }
  return appearance;
}

function nextPowerOfTwo(n: number): number {
  let x = 1;
  while (x < n) x <<= 1;
  return x;
}

function packAtlas(
  keys: string[],
  images: Map<string, RgbaImage>,
  tileSize: number,
): { width: number; height: number; frames: Record<string, AtlasFrame>; pixels: Uint8Array } {
  const count = keys.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const width = nextPowerOfTwo(columns * tileSize);
  const height = nextPowerOfTwo(rows * tileSize);
  const pixels = new Uint8Array(width * height * 4);
  const frames: Record<string, AtlasFrame> = {};

  keys.forEach((key, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * tileSize;
    const y = row * tileSize;
    frames[key] = { x, y, w: tileSize, h: tileSize };
    const image = images.get(key)!;
    // Nearest-neighbour scale into the tile if dimensions differ.
    for (let ty = 0; ty < tileSize; ty++) {
      for (let tx = 0; tx < tileSize; tx++) {
        const sx = Math.min(image.width - 1, Math.floor((tx * image.width) / tileSize));
        const sy = Math.min(image.height - 1, Math.floor((ty * image.height) / tileSize));
        const src = (sy * image.width + sx) * 4;
        const dst = ((y + ty) * width + (x + tx)) * 4;
        pixels[dst] = image.data[src]!;
        pixels[dst + 1] = image.data[src + 1]!;
        pixels[dst + 2] = image.data[src + 2]!;
        pixels[dst + 3] = image.data[src + 3]!;
      }
    }
  });

  return { width, height, frames, pixels };
}

export function buildTextureAtlas(samplesPath?: string): {
  appearance: BlockAppearanceDatabase;
  atlas: AtlasMetadata;
  textureCount: number;
  blockCount: number;
} {
  const root = samplesPath ?? samplesRoot();
  const resourcePack = path.join(root, 'resource_pack');
  const blocksPath = path.join(resourcePack, 'blocks.json');
  const terrainPath = path.join(resourcePack, 'textures', 'terrain_texture.json');
  if (!fs.existsSync(blocksPath) || !fs.existsSync(terrainPath)) {
    throw new Error(`Missing resource_pack blocks.json / textures/terrain_texture.json under ${root}`);
  }

  const blocksJson = parseJsonc(fs.readFileSync(blocksPath, 'utf8')) as Record<
    string,
    { textures?: RawFaceTextures }
  >;
  const terrainJson = parseJsonc(fs.readFileSync(terrainPath, 'utf8')) as {
    texture_data?: Record<string, TerrainEntry>;
  };
  const textureData = terrainJson.texture_data ?? {};
  const version = readVersion(root);

  const blocks: Record<string, BlockAppearance> = {};
  const images = new Map<string, RgbaImage>();

  const blockKeys = Object.keys(blocksJson)
    .filter((k) => k !== 'format_version')
    .sort();

  for (const shortName of blockKeys) {
    const def = blocksJson[shortName];
    if (!def?.textures) continue;

    const runtimeIds = new Set<string>([`minecraft:${shortName}`]);
    for (const extra of EXTRA_IDS_BY_BLOCKS_JSON_KEY[shortName] ?? []) runtimeIds.add(extra);
    // Also ensure reverse alias targets are covered when blocks.json uses modern names.
    for (const [id, key] of Object.entries(BLOCKS_JSON_KEY_BY_ID)) {
      if (key === shortName) runtimeIds.add(id);
    }

    const overlayOverride = biomeOverlayTintOverride(runtimeIds);
    const appearance = normalizeAppearance(
      def.textures,
      textureData,
      resourcePack,
      images,
      overlayOverride,
    );
    if (!appearance) continue;

    for (const id of [...runtimeIds].sort()) {
      blocks[id] = appearance;
    }
  }

  const sortedKeys = [...images.keys()].sort();
  const tileSize = 16;
  const packed = packAtlas(sortedKeys, images, tileSize);
  const source = `Mojang/bedrock-samples resource_pack (${version})`;

  const appearance: BlockAppearanceDatabase = {
    version,
    source,
    blockCount: Object.keys(blocks).length,
    blocks,
  };

  const atlas: AtlasMetadata = {
    version,
    source,
    tileSize,
    uvInset: 0.5,
    width: packed.width,
    height: packed.height,
    frames: packed.frames,
  };

  fs.mkdirSync(TEXTURES_DIR, { recursive: true });
  fs.writeFileSync(BLOCK_APPEARANCE_PATH, `${JSON.stringify(appearance, null, 2)}\n`);
  fs.writeFileSync(ATLAS_JSON_PATH, `${JSON.stringify(atlas, null, 2)}\n`);
  const png = encodePng({
    width: packed.width,
    height: packed.height,
    data: packed.pixels,
  });
  fs.writeFileSync(ATLAS_PNG_PATH, png);

  return {
    appearance,
    atlas,
    textureCount: sortedKeys.length,
    blockCount: appearance.blockCount,
  };
}

function main(): void {
  const result = buildTextureAtlas();
  console.log(`Wrote ${path.relative(PROJECT_ROOT, TEXTURES_DIR)}/`);
  console.log(`  blocks:    ${result.blockCount}`);
  console.log(`  textures:  ${result.textureCount}`);
  console.log(`  atlas:     ${result.atlas.width}×${result.atlas.height} (tile ${result.atlas.tileSize})`);
  console.log(`  version:   ${result.atlas.version}`);
  console.log('Generated Minecraft texture assets are local-only; do not commit atlas.png.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'build-texture-atlas.ts');
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

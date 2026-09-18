/**
 * Procedural block colours for the top-down renderer.
 *
 * Colours come from the generated vanilla database (official Bedrock
 * `minecraft:map_color` plus the published MapColor table), then family-name
 * fallbacks, then a deterministic hash. See block-palette.ts.
 */

export {
  blockColor,
  describeBlockColor,
  hasKnownColor,
  hashFallbackNames,
  resolveBlockColor,
  type Rgb,
} from './block-palette.ts';

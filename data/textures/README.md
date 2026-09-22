# Generated Minecraft textures

This directory is filled by:

```bash
VANILLA_SAMPLES=/path/to/bedrock-samples npm run textures:build
```

Use the **full** Mojang/bedrock-samples release (the min zip omits block PNGs).

Generated files (`atlas.png`, `atlas.json`, `block-appearance.json`) are gitignored and
must not be committed. They are subject to the Minecraft EULA via
[Mojang/bedrock-samples LICENSE.md](https://github.com/Mojang/bedrock-samples/blob/main/LICENSE.md).

## Overlay / mask compositing

When `terrain_texture.json` lists `overlay_color` on a texture (vanilla: grass
sides), the atlas builder alpha-masks that colour onto the source TGA/PNG and
packs the **opaque** result. RGB under transparent pixels is preserved (dirt
under grass), matching Bedrock’s overlay blend. Keys look like
`blocks/grass_side#overlay=92bc58`.

For blocks whose colour DB uses a biome tint method (`grass`, foliage, …), the
bake uses that method’s plains/neutral tint — the same alpha-mask path Bedrock
applies at runtime with the grass colormap — so sides match vertex-tinted tops.

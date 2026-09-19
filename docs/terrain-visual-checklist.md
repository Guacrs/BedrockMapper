# Terrain visual validation checklist

Use this after a renderer colour change. Unit tests can pass while the map still
looks wrong, so walk a real Bedrock world in the browser and check the items
below.

## Suggested test world contents

Create or open a world that includes as many of these as practical:

- Ocean (deep) and a shallow river or shoreline
- Forest canopy next to open plains grass
- Desert sand and red sand (or a mesa / badlands pocket)
- Snow / ice (mountain peak or frozen river)
- Hills or a cliff face (for elevation shading)
- Dirt path / grass path roads
- Player-built structures: oak planks, stone bricks, clay bricks, white concrete,
  terracotta, wool, iron/copper blocks
- Farmland with crops
- Gravel beach or patch

## What to inspect in the web map

1. **Water** — Oceans and rivers read as blue immediately. Deep water should look
   slightly darker than shallow shoreline water. Flat open ocean should not look
   heavily mottled from slope shading.
2. **Grass / foliage** — Plains grass is a muted olive map green (not neon).
   Oak, birch and spruce leaves are distinct from each other and from grass.
   **Dappled forest** (and other tinted biomes) should show their biome colour —
   orange canopy/grass in dappled forest, not plains green.
3. **Sand / red sand / snow / ice** — Desert, red sand, snow and ice are
   immediately separable from grass and stone.
4. **Elevation** — Hills and cliffs show subtle brightness changes (lighter on
   rises, darker in drops). Shading stays mild; it should not look like a
   satellite DEM.
5. **Paths / roads** — Paths remain visible as brown packed-dirt corridors,
   helped by being slightly lower than surrounding grass.
6. **Structures** — Planks, clay bricks, concrete, terracotta and metal blocks
   stand apart from natural stone/dirt. Buildings should not dissolve into the
   terrain colour.
7. **Deepslate / caves at surface** — Darker gray than regular stone where
   deepslate is exposed.
8. **Zoomed-out view** — At zoom &lt; 0, biomes and builds are still
   recognizable as colour regions (water vs land vs desert vs snow).
9. **No surprises** — Air / light blocks never paint as terrain. Unknown future
   blocks still paint something readable rather than crashing.

## Optional debug commands

```bash
npm run block-colors:report
WORLD_PATH=/path/to/world npm run block-colors:world
npm run render-chunk -- --chunk X,Z --scale 16
```

If colours look wrong after regenerating `data/block-colors.json`, delete
`MAP_CACHE/tiles` (or the whole `MAP_CACHE`) so tiles redraw.

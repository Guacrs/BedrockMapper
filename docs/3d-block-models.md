# Experimental 3D: block states + block models

**Status:** PR19–PR42 frozen · **PR43 chain models in progress** · Next after freeze: campfires (PR44); lighting only after model-coverage milestone.

**Frozen predecessors:**

| PR | Scope |
|----|--------|
| PR16 | Experimental voxel 3D meshes, streaming, meshVersion |
| PR17 | Texture atlas, UVs, offline `overlay_color` bake |
| PR18 | Empty-mesh 204, `textureAtlas` flag, CDN/app cache |
| PR19 | This document (research) |
| **PR20** | State retention, model resolver, full cube + slab, Option A occlusion |
| **PR21** | Straight stairs + `weirdo_direction` transforms |
| **PR22** | Connected fences — `BlockRef` / `ConnectionMask` separation (**frozen**) |
| **PR23** | Glass panes + iron bars — reuse `ConnectionMask`, thin occlusion |
| **PR24** | Doors + trapdoors — intrinsic state transforms (no ConnectionMask) (**frozen**) |
| **PR25** | Cross / plant models — `minecraft:geometry.cross` planes (**frozen**, in beta) |
| **PR26** | Wall models — contextual ConnectionMask + post/tall (**frozen**) |
| **PR27** | Model-system audit + coverage inventory A–K (**frozen**, in beta) |
| **PR28** | Constructed Bedrock fixture world + model-resolution report (**frozen**, in beta) |
| **PR29** | Occlusion shared-plane gate + fixture-driven visual/integration fixes (**frozen**, in beta) |
| **PR30** | Coverage-driven common geometry (carpet, plate, snow, ladder, torch, cactus) (**frozen**, in beta) |
| **PR31** | Accurate per-face textures (cardinals, facing, UV density, tint safety) (**frozen**, in beta) |
| **PR32** | Complete stair corner models (`minecraft:corner`) (**frozen**, in beta) |
| **PR33** | Rendered lighting + emissive materials (no light propagation) (**frozen**, in beta) |
| **PR34** | Lantern floor/hanging models (**frozen**, in beta) |
| **PR35** | Button face-attached models (**frozen**, in beta) |
| **PR36** | Lever base + angled handle (**frozen**, in beta) |
| **PR37** | Rail flat/ascending/corner (**frozen**, in beta) |
| **PR38** | Non-full-cube geometry coverage audit (**frozen**, in beta) |
| **PR39** | Candle family — multi-box by count + lit/emissive (**frozen**) |
| **PR40** | Standing/wall signs (**frozen**) |
| **PR41** | Hanging signs — intrinsic hanging/attached_bit (**frozen**) |
| **PR42** | Chest models — single closed AABB + cardinal facing (**frozen**) |
### PR20 implemented

- `ChunkBlocks` palette stores immutable `BlockRef { name, states }` (NBT `version` still dropped)
- `server/renderer/3d/models/` — types, resolve, occlude, families `full-cube` + `slab`
- Mesher resolves models once per palette entry; full-cube↔full-cube keeps O(1) cull
- Single slabs: ids ending in `_slab` excluding `double_slab` / `double_cut_*`; state `minecraft:vertical_half` ∈ {bottom, top}
- Double slabs: distinct ids → full-cube fallback
- Side-face UVs for half-height boxes **crop** the atlas tile vertically (Minecraft convention)
- Occlusion **Option A**: drop a face only when fully covered; partial cover keeps the whole face
- `MeshChunk` layout unchanged; PR17 appearance/atlas untouched

### PR21 implemented

- Straight `*_stairs` only (4× `weirdo_direction` × bottom/upside-down)
- **`weirdo_direction` mapping** (documented in `families/stair.ts`):
  - `0=east (+X)`, `1=west (−X)`, `2=south (+Z)`, `3=north (−Z)`
  - Evidence: Minecraft Wiki Stairs/BS (Bedrock table); cairn-lang-formats cites the same listing; Bedrock `/fill` recipes use +X/−X/+Z/−Z
  - Sample JSON only lists ints 0–3 — labels are **not** in mojang-blocks.json
- Geometry: base east bottom stair (lower slab + east upper step) → `rotateModelY` → optional `flipModelY`
- Corner shapes (`minecraft:corner` ≠ `none`) → **PR32** (no longer full-cube fallback for supported values)
- UVs: unit-cell density crop on partial box faces (shared helper with slabs)
- Occlusion: unchanged PR20 Option A

### PR22 implemented

**Architecture (hard requirement):**

```text
BlockRef
  = block ID + intrinsic Bedrock states
        │
        ▼
ConnectionMask
  = N / E / S / W neighbour relationships  (NOT on BlockRef)
        │
        ▼
BlockModel
  = post + connected rails
        │
        ▼
Voxel mesher
```

- `models/connection.ts` — `ConnectionMask` + cache key `n#e#s#w#`
- `models/families/fence.ts` — post `[6,0,6]–[10,16,10]` + dual rails per direction (Y 6–9 / 12–15)
- Mesher computes mask via `VoxelNeighborhood` / `blockRefAtWorld` (chunk boundaries + missing = no link)
- Model cache keyed by **name + mask**, not palette `BlockRef` alone (same palette entry → different rails per cell)
- Stored `minecraft:connection_*` on the palette entry are **ignored** for geometry (older worlds often have `{}`; preview bits are neighbour-derived anyway)

**Bedrock connection rules (researched, not Java-copied):**

| Self | Neighbour | Connect? |
|------|-----------|----------|
| wooden `*_fence` | other wooden fence | yes |
| wooden fence | `nether_brick_fence` | **no** |
| either fence family | fence gate | yes |
| either fence family | full-cube solid | yes |
| either fence family | slab / stair / air / missing | no |

Evidence: Minecraft Wiki Fence (Bedrock states + wooden≠nether); Microsoft `minecraft:connection` trait; Bedrock Wiki custom-fence geo (post/rails pixel sizes).

**Visual validation:** demo-world LevelDB scan found **zero** fence palette entries. Geometry is therefore exercised by the synthetic fixture in `test/block-models-fence.test.ts` (isolated, single dirs, all-4, combinations, non-connectable, same-fence, chunk boundary, missing data, cache, cube/slab/stair regressions) plus a dumped mesh summary artifact.

**Fixture caveat:** the synthetic fixture validates **geometry + neighbour connectivity logic** (masks, rails, chunk borders, cache keys). It does **not** prove that a production BDS world stores the same fence ids/states we assume, nor that live LevelDB palettes emit `connection_*` bits. Real-world fence rendering remains unobserved until a world containing fences is available.

**Connectivity ≠ occlusion:** fence attach uses an explicit classifier (`compatible fence` / `gate` / `model.isFullCube`) — never `isSolidAt` / `isRenderableCube`. A full cube may occlude a rail end without the fence becoming a full-cube occluder itself.

### PR23 implemented

Reuses PR22 `ConnectionMask` via `models/contextual.ts` (shared neighbour gather + family `connectsTo`).

- `models/families/pane.ts` — glass panes (incl. stained/hard) + `iron_bars`
- Geometry: 2×2 post `[7,0,7]–[9,16,9]` + full-height 2px arms per connection
- Attach: pane↔pane/bars, pane→full cube; **pane↛fence**, pane↛slab/gate/air
- `isFullCube` always **false** — explicit tests that panes do not cull neighbour unit faces
- Demo world: **zero** pane/bars entries → synthetic fixture (same caveat as PR22)

### PR24 implemented

Intrinsic state families (no ConnectionMask) — same transform path as stairs:

**Doors** (`families/door.ts`):

- States: `minecraft:cardinal_direction` (or legacy `direction` 0=S,1=W,2=N,3=E), `door_hinge_bit`, `open_bit`, `upper_block_bit`
- Closed facing east → west 3/16 strip; open left → north strip; open right → south strip; then `rotateModelY`
- Closed left/right share the same footprint; hinge only affects the open swing
- **Upper/lower:** two independent cells, identical XZ panel per cell; `upper_block_bit` selects texture half (`door_wood_lower` vs `door_wood_upper`) — not a double-tall mesh in one cell
- Wiki evidence: “door facing east occupies the west part of its block when closed”
- Missing/invalid facing → full-cube fallback
- 32 state combos + explicit hinge×open box assertions + stacked-half mesh test

**Trapdoors** (`families/trapdoor.ts`):

- States: `direction` 0–3, `open_bit`, `upside_down_bit`
- Closed bottom/top plates; open → vertical flap on facing wall
- 16 state combos tested; missing direction → full-cube fallback

Both always `isFullCube: false`. Not treated as solid attach targets for fences/panes.

### PR25 implemented

Cross / plant family (`families/cross.ts`) — intrinsic geometry, **no** `ConnectionMask`:

**Bedrock research:**

- Vanilla identifier `minecraft:geometry.cross` (Microsoft Learn `minecraft:geometry`) — engine-built-in, not a shipped `.geo.json`.
- Footprint matches classic cross: two vertical planes through block centre (Java from/to 0.8…15.2 at axis 8); AABB mesher uses 1px thickness centred on 8/16.
- Front/back = both cardinal faces per plane (no material-side global change).
- Explicit allowlist of short ids (short_grass, fern, deadbush, saplings, flowers, mushrooms, nether roots/fungi/sprouts, plus a few legacy aliases). **Not** a “thin block” heuristic.
- Deferred (full-cube fallback until researched): double plants (`tall_grass`, `large_fern`, sunflower, …), vines, berry bushes, bamboo stalks, `pink_petals` / wildflowers.

**Contracts preserved:**

- `isFullCube === false` — does not cull neighbour unit faces
- Explicit refuse in fence/pane `connectsTo` classifiers (and `neighbourIsFullCubeForConnection`)
- Unit-cell UV density via existing `faceCornerUvsForBox` (near-full tile on near-full-width planes)
- No `ThinBlockModel` abstraction

**Visual validation:** demo LevelDB typically has **zero** cross-plant palette entries (grass_block ≠ short_grass). Geometry + connectivity exclusion exercised by `test/block-models-cross.test.ts` synthetic fixture. Same caveat as PR22/23: synthetic validation does **not** prove production BDS world state distribution.

**Frozen (do not expand):** allowlist stays explicit — do not add ids without Bedrock evidence they use `minecraft:geometry.cross`.

### PR26 implemented

Wall family (`families/wall.ts`) — contextual, **not** a fence reuse:

**Bedrock research:**

- States: `wall_connection_type_{n,e,s,w}` ∈ {none, short, tall} + `wall_post_bit` (Microsoft Learn + Wiki). **Ignored on BlockRef** — inferred at mesh time (same empty-NBT rationale as fences).
- Attach (`wallConnectsTo`, ≠ fence/pane/`isSolidAt`): wall↔wall, wall→full cube, wall→pane/bars, wall→gate, wall→trapdoor (BE 1.16.20). **wall↛fence**. Plants refused via `isCrossName` from `cross.ts`.
- Post: omitted on straight N–S / E–W **or** four-way; forced when a non-air block is above (wiki).
- Tall vs short (**accepted frozen limitation**): Bedrock exposes independent `wall_connection_type_{n,e,s,w}` ∈ {none, short, tall}. This PR uses `ConnectionMask` (boolean connect) + **one global `tall` bit** — if any non-invisible block sits above the wall cell, **every** connected arm uses tall height (16/16); otherwise all arms are short (14/16). Per-direction short/tall is deferred.
- Geometry: post `[4,0,4]–[12,16,12]` (Y `1` = full 16/16 block height); arms 6px (5–11), height 14/16 or 16/16.
- Cache key: `wall:{mask}:p{0|1}:t{0|1}:{name}` — never shared with fence/pane keys.
- Fence/pane classifiers updated to **accept walls** as attach targets. Asymmetry intentional: **wall↛fence** while fence→wall and pane→wall connect.

**Contracts:** `isFullCube === false`; Option A occlusion unchanged; ConnectionMask stays boolean (post/tall are `WallShape` extras).

**Visual validation:** synthetic fixture in `test/block-models-wall.test.ts`. Same caveat as PR22/23.

**Frozen:** keep explicit `wallConnectsTo` (never `isSolidAt`). Accept uniform-tall approximation until a later per-direction height milestone.


---

## 18. Model-system audit checkpoint (after PR24)

Before adding plants/walls/crosses, freeze these contracts:

| Layer | Contract |
|-------|----------|
| `BlockRef` | Intrinsic palette identity only — never neighbour rails/arms |
| `ConnectionMask` | Fence/pane/**wall** horizontal attach; computed at mesh time via `VoxelNeighborhood` |
| `resolveBlockModel` | Process cache by family key; contextual families require mask |
| `rotateModelY` / `flipModelY` | Shared transform primitives — families stay separate |
| `isFullCube` | Fast occlusion path; thin/hinged/connected families stay false |
| Option A occlusion | Drop face only when fully covered |
| `faceCornerUvsForBox` | Unit-cell UV density on partial boxes |
| Unsupported state | Full-cube fallback (visible, never silent empty) |

**Do not** merge door/trapdoor/slab into a generic “thin block” framework yet. Extract shared primitives only when three+ families need the same helper.

**Next:** PR29 fixture-driven visual/integration fixes (below) — then coverage-driven geometry (PR30), accurate textures (PR31), lighting (PR32). Do not add families opportunistically.

### Deferred (still)

- Per-direction wall tall/short (currently uniform `tall` from above)
- Inner/outer corner stairs
- Double plants / vines / berry bushes / bamboo stalks / floor flowers
- Custom `.geo.json`
- Exact stair–stair polygon clipping
- Greedy meshing / water / resource-pack runtime overrides

---

## 19. Model-system audit (after PR25 + PR26)

**Status:** documentation + coverage inventory only — **no refactor** · **frozen**.

Cross ownership is now canonical:

```text
coverage.ts → families/cross.ts (`isCrossName`)
wall.ts     → families/cross.ts (`isCrossName`) for plant refuse
```

Duplicated local `isWall` helpers in fence/pane remain intentional circular-import avoidance — do not extract a shared module in this freeze.

### 19.1 Contracts still holding

| Layer | Status after PR25/PR26 |
|-------|------------------------|
| `BlockRef` | Intrinsic only — walls/crosses do not write neighbour state into palette refs |
| `ConnectionMask` | Boolean N/E/S/W for fence / pane / wall horizontal attach |
| `WallShape` | Wall-only `{post, tall}` contextual extras; cache-keyed separately from fences |
| `BlockModel` | Boxes + materials + `isFullCube`; families remain separate modules |
| Transforms | `rotateModelY` / `flipModelY` used by stairs/doors/trapdoors — unchanged |
| UV / materials | PR17 atlas + `faceCornerUvsForBox` unit-cell density; crosses use same helper |
| Occlusion | Option A; `isFullCube` is occlusion-only, never a connectivity shortcut |
| Connection | Explicit per-family classifiers — **never** `isSolidAt()` |
| Cache keys | Family-prefixed; walls include `p`/`t`; fences/panes include mask only |
| Fallback | Unsupported / invalid state → full cube (visible) |

### 19.2 Supported model families

| Family | Kind | Module | Contextual? |
|--------|------|--------|-------------|
| Full cube | geometric | `families/full-cube.ts` | no |
| Slab | geometric | `families/slab.ts` | no (intrinsic half) |
| Stair | state-driven | `families/stair.ts` | no |
| Fence | contextual | `families/fence.ts` | yes (`ConnectionMask`) |
| Pane / iron bars | contextual | `families/pane.ts` | yes |
| Door | state-driven | `families/door.ts` | no |
| Trapdoor | state-driven | `families/trapdoor.ts` | no |
| Cross / plant | geometric | `families/cross.ts` (**PR25**) | no |
| Wall | contextual | `families/wall.ts` (**PR26**) | yes (`ConnectionMask` + `WallShape`) |
| Carpet | geometric | `families/carpet.ts` (**PR30**) | no |
| Pressure plate | state-driven | `families/pressure-plate.ts` (**PR30**) | no |
| Snow layer | state-driven | `families/snow-layer.ts` (**PR30**) | no |
| Ladder | state-driven | `families/ladder.ts` (**PR30**) | no |
| Torch | state-driven | `families/torch.ts` (**PR30**) | no |
| Cactus | geometric | `families/cactus.ts` (**PR30**) | no |

### 19.3 Geometry / transform / texture contracts

- **Geometry primitives:** axis-aligned `ModelBox` lists only (no greedy mesh, no `.geo.json`).
- **Transform primitives:** Y rotation + Y flip — shared; not a generic “thin block” framework.
- **Texture/UV:** unit-cell density on partial boxes; nearly full-tile on near-full-width cross planes.
- **Occlusion contract:** drop face only when neighbour occlusion fully covers it; thin families never set `isFullCube`.
- **Connection contract:** family `connectsTo(self, neighbour, neighbourIsFullCube)`; peer families (wall↔pane, fence↔wall) are explicit.
- **Fallback contract:** prefer visible full cube over empty/malformed geometry; document uncertainty.
- **Cache-key contract:** must include every geometry-relevant input (name, mask, wall post/tall, door/trapdoor/stair states).

### 19.4 Coverage inventory (A–K)

Automated report: `server/renderer/3d/models/coverage.ts` + `test/block-model-coverage.test.ts` against `data/textures/block-appearance.json`.

| Code | Category | Meaning |
|------|----------|---------|
| A | Full cube | Explicit default cube model |
| B | Slab | Explicit single-slab model |
| C | Stair | Explicit straight + corner stairs (`minecraft:corner`) |
| D | Fence | Explicit connected fence |
| E | Pane / iron bar | Explicit connected pane |
| F | Door | Explicit state-driven door |
| G | Trapdoor | Explicit state-driven trapdoor |
| H | Cross / plant | Explicit allowlist + geometry in `cross.ts` (PR25, in beta) |
| I | Wall | Explicit connected wall (PR26) |
| — | Carpet / plate / snow / ladder / torch / cactus | Explicit PR30 families (see §22) |
| J | Fallback | Safe full-cube stand-in (e.g. fence gates — attach only) |
| K | Future | Known custom geometry / research required |

**Important:** membership in J or K is **not** a claim that the rendered full cube matches Bedrock. The inventory separates “explicit implementation” from “safe fallback” from “unknown / future”.

### 19.5 Known limitations / unsupported Bedrock geometry

- Per-direction wall short/tall (uniform `tall` from above)
- Corner stairs, fence-gate models, double plants, vines, berry bushes, bamboo stalks, floor flowers (`pink_petals`)
- Exact stair–stair clipping; water transparency; resource-pack `.geo.json`; greedy meshing / LOD
- Demo worlds often lack fence/pane/plant/wall palette entries — synthetic fixtures validate logic, not BDS distributions

### 19.6 Refactor verdict

**No refactor justified yet.** Shared helpers (`ConnectionMask`, `rotateModelY`, `faceCornerUvsForBox`, `neighbourIsFullCubeForConnection`) already cover the cross-family needs. A generic “thin/connected block” framework would blur BlockRef vs ConnectionMask vs occlusion and is explicitly deferred until three+ families need the same new helper.

---

## 20. Constructed model fixture world (PR28)

Integrated validation path (not another opportunistic family):

```text
Declarative layout (model-fixture-layout.ts)
    ↓
In-memory ChunkBlocks  ──→  resolution report + reciprocal + geometry asserts
    ↓
Synthetic LevelDB world (write-fixture-world.ts)
    ↓
decodeSubChunk → ChunkBlocks → contextual resolve → mesh → Three.js viewer
```

**Scope wording:** this is a **constructed / synthetic** Bedrock LevelDB fixture (hand-built SubChunkPrefix NBT), not a world generated by BDS itself. It proves `writer → LevelDB → decodeSubChunk → BlockRef` using the same decoder production uses. It does **not** yet prove parity with a naturally saved BDS world.

**What it covers:** slabs (bottom/top/double), stairs (4 facings + upside-down), fences (isolated/N/corner/T/4-way/stone attach/nether exclusion/chunk boundary), panes+bars (same + fence exclusion + boundary), doors (open/closed, hinge, halves), trapdoors (top/bottom/open), walls (isolated/straight/corner/T/4-way/stone/pane attach/fence exclusion/tall-above/boundary), cross plants, mixed neighbourhood straddling x=16.

**Deterministic report:** `npm run report-model-fixture` (add `-- --assert` to fail on expectation drift). Compares world cell → family / ConnectionMask / WallShape post+tall / model key / `isFullCube` / box count. Also asserts **reciprocal connectivity** on authored links (A.east ↔ B.west, etc.) and behavioral geometry (slab Y halves, tall vs short wall arms, cross thin planes, isolated vs connected box counts). Intentional asymmetries (wall↛fence, pane↛fence) are asserted separately.

**Commands:**

| Script | Purpose |
|--------|---------|
| `npm run make-model-fixture-world` | Write `model-fixture-world/` synthetic LevelDB pad |
| `npm run report-model-fixture` | Print resolution report |
| `npm test` → `test/model-fixture.test.ts` | Expectations + reciprocity + geometry + LevelDB round-trip |

**Bit coercion:** Bedrock stores `*_bit` as TAG_Byte (0/1). `ChunkBlocks.blockRefFromPaletteEntry` now coerces those bytes to boolean so door/stair/trapdoor `=== true` checks survive LevelDB round-trip.

**Architecture preserved:** `BlockRef` intrinsic; `ConnectionMask` / `WallShape` contextual; `isFullCube` occlusion-only — no ThinBlock abstraction. PR28 validates the existing model system; it does not change family geometry.

**Next after PR28:** fixture-driven visual/integration fixes (PR29, below), then coverage inventory → remaining geometry → water/transparency → complex models → performance/LOD.

---

## 21. Occlusion shared-plane fix (PR29)

**Bug found by PR28 audit:** `isFaceFullyOccluded` treated any full-cube neighbour as covering *every* emit face, including faces that do not lie on the shared unit-cell plane. That violated the Option A examples in §5.3 and silently removed:

- bottom-slab tops under a cube above
- top-slab bottoms under a cube below
- door / cross / fence / pane / wall interior panels beside solids
- stair step tops under cubes above

**Fix:** require `faceLiesOnUnitSharedPlane(emitBox, face)` before either the `isFullCube` fast path or the `rectCovers` loop. Interior faces never cull against adjacent cells.

**Wall tall:** fixture `wall-tall` remains post-only (tall only affects arms). Uniform-tall limitation is **unchanged** — not redesigned in PR29.

**Validation:** `test/block-models-occlusion.test.ts` + existing family suites + `npm run report-model-fixture -- --assert`.

---

## 22. Coverage-driven common geometry (PR30) — **frozen**

**Goal:** stop rendering common non-cubes as full cubes when Bedrock evidence is sufficient. No texture redesign, no lighting, no ThinBlock abstraction.

| Family | Module | Bedrock evidence (states / geo) | Notes |
|--------|--------|----------------------------------|-------|
| Carpet | `families/carpet.ts` | no geo states; 1px floor plate | `pale_moss_carpet` side flaps **deferred** |
| Pressure plate | `families/pressure-plate.ts` | `redstone_signal` → pressed height | inset 14×14 footprint |
| Snow layer | `families/snow-layer.ts` | `height` 0..7 → layers 1..8 × 2px | `covered_bit` ignored; not `minecraft:snow` |
| Ladder | `families/ladder.ts` | `facing_direction` 2..5 | 0/1/missing → full-cube fallback |
| Torch | `families/torch.ts` | `torch_facing_direction` | floor cross + wall stub on **attachment** face (Microsoft); **no emissive** (PR33) |
| Cactus | `families/cactus.ts` | `age` ignored for geometry | 1px side inset; `cactus_flower` stays research |

**Still J (fallback):** fence gates (attach-only).  
**Still K (future):** chains, beds, chests, vines, double plants, wall signs, …

**Validation:** `test/block-models-pr30.test.ts` + fixture cells at z=36 + coverage inventory.

**Not in PR30:** per-face texture redesign (PR31), stair corners (PR32), lighting/emissive (PR33), lanterns (PR34).

---

## 23. Accurate per-face textures (PR31) — **frozen**

**Goal:** make face materials match Bedrock definitions against the PR30 geometry. No lighting / emissive / water / LOD.

```text
BlockRef → model family → ModelFace → Bedrock texture → atlas frame → UV crop → tint/overlay
```

| Change | Detail |
|--------|--------|
| Cardinal slots | `BlockAppearance` keeps `north/south/east/west` when `blocks.json` distinguishes them (no collapse into one `side`) |
| Lookup | `textureKeyForCubeFace` / `fullCubeFaceTexture` — cardinal → side → all → null |
| Facing remap | `fullCubeModelForRef` rotates materials so authored front matches `minecraft:cardinal_direction` / `facing_direction` |
| Pillar axis | `pillar_axis` x/z remaps log end-caps to top texture |
| Aliases | builder emits `oak_door`↔`wooden_door`, `oak_trapdoor`↔`trapdoor` |
| UV density | unchanged unit-cell crop (`faceCornerUvsForBox`) — thin faces do not stretch full tiles |
| Tint safety | overlay-composited keys stay vertex-white (no double grass tint) |
| Missing texture | `textureKey: null` → vertex colour only (deterministic; no invented texture) |

**Validation:** `test/block-models-pr31.test.ts` + `npm run textures:build` + existing atlas/family suites.

---

## 24. Complete stair corner models (PR32) — **frozen**

**Goal:** replace the PR21 full-cube fallback for `minecraft:corner` ≠ `none` with correct Bedrock corner geometry. No texture/lighting work.

### Bedrock state research

| State | Domain | Evidence |
|-------|--------|----------|
| `weirdo_direction` | 0=east, 1=west, 2=south, 3=north | Wiki Stairs/BS Bedrock table; PR21 |
| `upside_down_bit` | bool | Wiki + mojang-blocks |
| `minecraft:corner` | `none`, `inner_left`, `inner_right`, `outer_left`, `outer_right` | mojang-blocks.json enum; Wiki Stairs/BS Bedrock (Preview 26.50+); Microsoft Learn `placement_direction` trait |

Left/right are relative to looking along the `weirdo_direction` facing (Java-parity convention Bedrock adopted when exposing the corner state): facing east → left = north (−Z), right = south (+Z).

Missing `minecraft:corner` → treat as `none` (straight). Unknown string values → full-cube fallback (never silent wrong corners).

### Geometry strategy

Canonical **east + bottom** boxes per shape, then `rotateModelY` / `flipModelY`:

| Corner | Boxes (east-bottom) |
|--------|---------------------|
| `none` | lower slab + east upper half |
| `outer_left` | lower + NE upper quarter |
| `outer_right` | lower + SE upper quarter |
| `inner_left` | lower + east upper half + NW west quarter |
| `inner_right` | lower + east upper half + SW west quarter |

All corner stairs keep `isFullCube: false`. Occlusion uses existing PR29 shared-plane Option A — no ThinBlock.

**Validation:** `test/block-models-stair.test.ts` (PR32 suite) + fixture cells at z=40 + `report-model-fixture --assert`.

**Out of scope:** textures (PR31), lighting, water, LOD, unrelated families.

---

## 25. Rendered lighting + emissive materials (PR33) — **frozen**

**Goal:** make self-lit blocks (torch, glowstone, …) visibly glow in the Three.js viewer. Establish the lighting pipeline without Minecraft BlockLight / SkyLight propagation.

```text
BlockRef.name
    ↓  blockLightingFor / isEmissiveBlock
emission + lightColor
    ↓  voxel-mesh-builder routes faces
MeshChunk.terrain  |  MeshChunk.emissive?
    ↓                      ↓
MeshStandardMaterial   MeshStandardMaterial
(no emissive)          (emissiveIntensity > 0)
```

| Change | Detail |
|--------|--------|
| Catalog | `lighting/block-lighting.ts` — Bedrock light levels 0–15 → emission 0..1; optional RGB tint |
| Mesher | Emissive faces → `mesh.emissive` sibling; terrain stays separate; occlusion unchanged |
| Vertex colours | Emissive layer uses `lightColor` scaled by emission (not map tint bake) |
| Viewer | Shared `emissiveMaterial` (MeshStandardMaterial + emissive channel); per-chunk Group |
| Lights | Existing hemisphere + directional; soft AmbientLight fill for shadowed emitter faces |
| Non-emissive | `unlit_redstone_torch` (emission 0) stays on terrain |
| Wall torch | Canonical west-attached 2×10×2 stick at −22.5° (ModelBox `rotation`), `rotateModelY` for N/E/S/W; sprite UV crop; not an AABB stub |

**Known minor imperfection (accepted):** wall-torch vertical faces only — the small top/inside face of the canted stick is untextured, so a thin open edge can show at some angles. Correct cantilevered orientation matters more; closing that face is deferred (not worth holding the freeze).

**Out of scope:** BlockLight / SkyLight propagation, per-face light maps, water caustics, LOD, inventing glow for decorative blocks without Bedrock emission evidence.

**Validation:** `test/block-models-pr33.test.ts` + wall-torch cantilever visual check.

---

## 26. Lantern models (PR34) — **frozen**

**Goal:** stop rendering lanterns as full cubes. Floor vs hanging geometry with Java-parity AABBs + 45° hangers. Reuse PR33 emission — no BlockLight / SkyLight work.

### Bedrock state research

| State | Domain | Evidence |
|-------|--------|----------|
| `hanging` | bool | Microsoft Learn block-state listings; Wiki Bedrock table (metadata 0x1) |
| `hanging_bit` | bool | Microsoft intrinsic block-states list (same meaning) |

Missing / false → floor. Either key accepted (`hanging` preferred when both present — either true wins).

### Geometry (Java `template_lantern` / `template_hanging_lantern` parity)

| Variant | Body | Cap | Hangers |
|---------|------|-----|---------|
| Floor | [5,0,5]–[11,7,11] | [6,7,6]–[10,9,10] | two 1px planes @ 45° Y, y=9..11 |
| Hanging | [5,1,5]–[11,8,11] | [6,8,6]–[10,10,10] | longer hangers (NS→15, EW→16) |

Sprite UVs cropped via `tileUv` from the lantern atlas tile. Occlusion uses body+cap only (`isFullCube: false`). No neighbourhood connectivity.

**Ids:** `lantern`, `soul_lantern`, `*_copper_lantern` (including waxed). Not `sea_lantern` / `jack_o_lantern`.

**Emission:** unchanged PR33 catalog levels (15 / 10); copper lanterns share level 15. Lighting discrepancies (propagation, BlockLight) are **out of scope** — document only.

**Validation:** `test/block-models-pr34.test.ts` + fixture cells at z=44 + `report-model-fixture --assert`.

**Frozen.** Visual check confirmed floor vs hanging cages + warm/cool emissive; hanging body stays low in-cell with hangers to Y=16 (Java-parity — not raised to the ceiling). No further geometry or lighting changes in this PR.

---

## 27. Button models (PR35)

**Goal:** stop rendering buttons as full cubes. Face-attached thin plates with pressed/unpressed depth. Intrinsic BlockRef geometry only — no attachment-system refactor.

### Bedrock state research

| State | Domain | Evidence |
|-------|--------|----------|
| `facing_direction` | 0..5 int (also string down/up/N/S/W/E) | Wiki Bedrock Button/BS; Microsoft listings / intrinsic list |
| `button_pressed_bit` | bool | Wiki + Microsoft |

| Value | Meaning |
|-------|---------|
| 0 | ceiling — plate faces down |
| 1 | floor — plate faces up |
| 2..5 | wall N/S/W/E (ladder-style cell face) |

Missing/invalid facing → full-cube fallback (same policy as ladder).

### Geometry (Java `button` / `button_pressed` parity)

| State | AABB (pixels) |
|-------|----------------|
| Floor unpressed | [5,0,6]–[11,2,10] |
| Floor pressed | [5,0,6]–[11,1,10] |
| Ceiling / wall | same 6×4×depth plate remapped to the face |

Bedrock has no separate floor Y-rotation — footprint orientation is fixed. Textures use appearance `all` (planks / stone / polished_blackstone).

**Support neighbours:** geometry does **not** depend on neighbour solidity. Floating buttons (support removed) still render from stored state — out of scope for a generalized attach system.

**Validation:** `test/block-models-pr35.test.ts` + fixture cells at z=46 + `report-model-fixture --assert`.

**Frozen.** Visual check confirmed floor / ceiling / wall thin plates (pressed thinner). No attachment-system refactor. Merge into beta when ready; no further button geometry in this PR.

---

## 28. Lever models (PR36)

**Goal:** stop rendering levers as full cubes. Separate base (attach face) + handle (orientation / powered) using Bedrock states — **not** button `facing_direction`.

### Bedrock state research

| State | Domain | Evidence |
|-------|--------|----------|
| `lever_direction` | string enum (or legacy int 0–7) | Microsoft listings / intrinsic list; Wiki Lever/BS Bedrock |
| `open_bit` | bool | activated / powered (same name as doors, different meaning) |

| `lever_direction` | Attachment | Off handle points |
|-------------------|------------|-------------------|
| `up_north_south` (5) | floor | south |
| `up_east_west` (6) | floor | east |
| `down_north_south` (7) | ceiling | south |
| `down_east_west` (0) | ceiling | east |
| `north` (4) / `south` (3) / `west` (2) / `east` (1) | wall | (wall: down=on, up=off) |

**Do not** reuse button `facing_direction` — levers use a dedicated enum.

### Geometry (Java `lever` / `lever_on` parity)

| Part | Floor AABB (px) | Notes |
|------|-----------------|-------|
| Base | [5,0,4]–[11,3,12] | cobblestone texture |
| Handle | [7,1,7]–[9,11,9] | lever texture; ±45° about X at origin (8,1,8) |

`open_bit=true` → −45° (Java `lever.json`); `false` → +45° (`lever_on.json`). Floor/ceiling variants via `rotateModelY` / `flipModelY`; wall variants remapped onto the attach face. `isFullCube: false`. Intrinsic only.

**Validation:** `test/block-models-pr36.test.ts` + fixture + `report-model-fixture --assert`.

**Frozen.** Visual check confirmed floor / wall / ceiling cobble bases + angled handles. No attachment-system refactor. Next: PR37 rails (stored `rail_direction` authoritative; narrow neighbor fallback only).

---

## 29. Rail models (PR37)

**Goal:** stop rendering rails as full cubes. Flat / ascending / corner shapes from Bedrock `rail_direction`, with powered texture as a separate axis from geometry.

### Bedrock state research

| Id | States | Evidence |
|----|--------|----------|
| `rail` | `rail_direction` 0–9 | Wiki Rail/BS Bedrock — includes corners 6–9 |
| `golden_rail` / `detector_rail` / `activator_rail` | `rail_direction` 0–5 + `rail_data_bit` | Wiki + Microsoft listings — **no corners** |

| `rail_direction` | Shape |
|------------------|-------|
| 0 | flat north–south |
| 1 | flat east–west |
| 2–5 | ascending E/W/N/S |
| 6–9 | corners SE/SW/NW/NE (`rail` only) |

**Authoritative shape:** LevelDB stores `rail_direction` (updated by the game on place/neighbor change). Meshing uses **stored state**, not a fence-style ConnectionMask rewrite. A narrow `railShapeFromNeighbors` exists only as missing-state fallback / fixture verification — not a generic rail connectivity framework.

**Powered:** `rail_data_bit` selects powered vs unpowered **texture** (appearance up vs down); geometry is shared.

**Validation:** `test/block-models-pr37.test.ts` + fixture (incl. chunk-boundary EW at x=15/16) + `report-model-fixture --assert`. Visual: flat / ascending / corner / powered variants confirmed. Terrain cutout `alphaTest` required for rail/cross sprites.

**Frozen.** Landed on `beta` via fast-forward (`71b3a7b`). Stored `rail_direction` authoritative; no generic rail connectivity framework. Next: **PR38** systematic non-full-cube coverage audit (evidence-driven roadmap) — not ad-hoc tripwire/signs picks, and not BlockLight yet.

---

## 30. Non-full-cube coverage audit (PR38)

**Goal:** answer — *which blocks currently render incorrectly as full cubes even though Bedrock geometry is not a full cube?* — from the live catalog, not a guessed wishlist.

### Pipeline

```text
appearance.json ∪ block-colors.json
      ↓
classifyBlockModelCoverage (family ownership)
      ↓
classifyGeometryAudit (correctness bucket)
      ↓
roadmap by priority × category
```

| Bucket | Meaning |
|--------|---------|
| `explicit_ok` | Dedicated family already |
| `intentional_full_cube` | True / intentional cube |
| `intentional_fallback` | J stand-in (fence gates) |
| `known_incorrect` | Evidence says non-cube; still cube mesh |
| `suspected_incorrect` | Heuristic only — research before coding |

**CLI:** `npm run report-model-coverage` (optional `--markdown docs/model-coverage-audit.md`, `--json`).

**Do not** jump to BlockLight/SkyLight from here. Next PRs implement **one audited family (or tight group) at a time** starting at p0 (candles / signs / hanging signs / chests / chains / campfires). Lighting remains a separate architectural milestone after the model-coverage bar.

**Validation:** `test/block-models-pr38-audit.test.ts` + regenerated `docs/model-coverage-audit.md`.

**Frozen.** Landed on `beta`. Use the audit as the coverage milestone baseline — implement one family (or tight group) per PR from the p0 roadmap. Do not jump to BlockLight/SkyLight yet.

---

## 31. Candle models (PR39)

**Goal:** stop rendering floor candles as full cubes. One model family with multiple boxes driven by Bedrock state — not a separate model file per candle count.

### Bedrock research

```text
Bedrock candle block
├─ candles 0–3  → visual stick count 1–4 (“number of extra candles”)
├─ lit true/false
├─ (no waterlogged block state — layers system; mesh from stored lit)
└─ colour = separate block ids sharing geometry
```

Candle cakes (`*_candle_cake`) are **out of scope** (cake + one candle — later family).

### Geometry

Java `template_*_candle(s)` parity: each stick is a 2×H×2 px AABB; layouts for 1–4 sticks share one resolver. Lit adds a 1px wick as crossed ±45° Y planes with UV crop from the same candle atlas tile (no separate flame/particle system).

Heights (px): 1→H=6; 2→5+6; 3→3+5+6; 4→3+5+5+6.

### Lighting

Reuse PR33 emissive mesh. When `lit=true`, emission = Bedrock light level `3 × count` (3/6/9/12). Unlit → terrain layer only. Atlas ships unlit candle tiles; lit look is wax UV + emissive glow.

### Validation

`test/block-models-pr39.test.ts` + fixture cells at z=34 + `report-model-fixture --assert` + `npm run report-model-coverage` (floor candles move `known_incorrect` → `explicit_ok`).

**Out of scope:** candle cakes, general transparent/emissive particle systems, BlockLight/SkyLight, signs.

**Frozen.** One multi-box family by `candles`/`lit`; cakes deferred. Visual: multi-stick + lit/unlit emissive confirmed. Next: **PR40** standing/wall signs (hanging signs are PR41).

---

## 32. Standing / wall sign models (PR40)

**Goal:** stop rendering standing and wall signs as full cubes. Hanging signs stay **out of scope** (PR41).

### Bedrock research

```text
Standing sign (*_standing_sign / standing_sign)
├─ ground_sign_direction 0–15  (22.5°; 0=south … 8=north …)
├─ wood variant = block id
└─ text = Sign block entity (NOT a model state)

Wall sign (*_wall_sign / wall_sign)
├─ facing_direction 2–5 (N/S/W/E; 0/1 unused)
├─ board faces that direction (attach opposite)
└─ wood variant = block id
```

**Architectural answer:** Bedrock does **not** separate “model orientation” from “text-facing” on the palette — `ground_sign_direction` / `facing_direction` **are** the board orientation. Text content is block-entity / `BlockSignComponent` data and is not meshed here.

No `waterlogged` sign block state (layers). Do not infer these semantics from Java `rotation` / `facing` / `waterlogged` names.

### Geometry

Classic plank-board AABBs (Java uses an entity renderer for sign boards; silhouette matches common Bedrock collision):

| Kind | Boxes |
|------|--------|
| Standing (dir=0 south) | post `[7,0,7]–[9,8,9]`, board `[0,8,7]–[16,14,9]`; Y-rotate `−dir×22.5°` |
| Wall north | board `[0,4.5,14]–[16,12.5,16]`; other facings remap |

Appearance DB maps signs → plank `all` textures.

### Validation

`test/block-models-pr40.test.ts` + fixture cells at z=30 + `report-model-fixture --assert` + coverage audit (standing/wall → `explicit_ok`; hanging remain `known_incorrect`).

**Out of scope:** hanging signs, sign text glyphs, BlockLight/SkyLight.

**Frozen.** One `sign.ts` family; palette orientation is the model orientation (no separate textFacing). Visual: standing post+board and wall thin boards confirmed. Next: **PR41** hanging signs (intrinsic `hanging`/`attached_bit`/orientation — no text glyphs).

---

## 33. Hanging sign models (PR41)

**Goal:** stop rendering hanging signs as full cubes. Support chains/bracket from **stored Bedrock states** — no neighbour probe, no text glyphs.

### Bedrock research — intrinsic, not contextual

```text
*_hanging_sign (one id per wood)
├─ hanging          → ceiling (true) vs wall bracket (false)
├─ attached_bit     → V / up-arrow chains (true) vs parallel (false)
├─ facing_direction → wall + ceiling-parallel orientation (2–5)
└─ ground_sign_direction → ceiling-attached orientation (0–15)
```

Microsoft listings put all four states on the same block id. Wiki: wide ceiling → parallel; narrow/sneak → V (`attached_bit`); side → wall bracket. Placement writes those bits into LevelDB; meshing reads them only (same authority rule as rails / PR40 signs).

**Architectural answer:** support configuration is **intrinsic**. PR41 does **not** need a ConnectionMask / neighbour resolver.

Text remains Sign block-entity data — **out of scope**.

### Geometry

| Mode | States | Boxes |
|------|--------|--------|
| Ceiling parallel | `hanging` + !`attached_bit` | board + 2 vertical chains; `facing_direction` |
| Ceiling attached | `hanging` + `attached_bit` | board + ±30° Z-lean V chains; `ground_sign_direction` |
| Wall | !`hanging` | bar + short hangers + board; `facing_direction` |

### Validation

`test/block-models-pr41.test.ts` + fixture z=28 + coverage (hanging → `explicit_ok`).

**Out of scope:** sign text glyphs, BlockLight/SkyLight, chests.

**Frozen.** Support mode is intrinsic (`hanging`/`attached_bit`); no neighbour probe; no text glyphs. Visual: ceiling chains + wall brackets confirmed. Next: **PR42** chests (facing intrinsic; Bedrock has no `type` double state).

---

## 34. Chest models (PR42)

**Goal:** stop rendering chests as full cubes. Facing from stored Bedrock states only — no double-half pairing yet.

### Bedrock research

```text
chest / trapped_chest / ender_chest / *copper_chest
└─ minecraft:cardinal_direction ∈ {north,south,east,west}  → latch / front facing
```

Microsoft listings and wiki (Bedrock ≥1.20.40): only `minecraft:cardinal_direction`. Java's `type` left/right/single is **not** on Bedrock palettes — double chests are neighbour/block-entity pairing. **Deferred.** Legacy int `facing_direction` 2–5 accepted as fallback for older worlds.

### Geometry

| Mode | Boxes |
|------|--------|
| Single closed | one inset AABB `[1,0,1]–[15,14,15]`; south = authored front; `rotateModelY` for facing |

Inventory textures (`chest_front` / `_side` / `_top`, copper `*_inventory_*`) are authored for that single box — no separate latch mesh.

### Validation

`test/block-models-pr42.test.ts` + fixture z=26 + coverage (chests → `explicit_ok`).

**Out of scope:** double-chest halves, lid animation, BlockLight/SkyLight, chains.

**Frozen.** Facing intrinsic; Bedrock has no `type` double state. Visual: inset AABB + cardinal fronts confirmed. Next: **PR43** chains (`pillar_axis`).

---

## 35. Chain models (PR43)

**Goal:** stop rendering chains as full cubes. Orientation from stored Bedrock `pillar_axis` only.

### Bedrock research

```text
chain / iron_chain / *copper_chain
└─ pillar_axis ∈ {x, y, z}  → length axis (intrinsic)
```

Microsoft listings + wiki (Bedrock): only `pillar_axis`. Default `y` (vertical). Java `axis` / `waterlogged` — waterlogged deferred (not geometry). Orientation is **intrinsic** — no neighbour probe. Copper oxidization/waxed variants share geometry; textures differ via appearance DB. Legacy id `minecraft:chain` aliases iron textures.

### Geometry

| Axis | Boxes |
|------|--------|
| `y` (vertical) | two 3px crossed planes (1px thick), 45° about Y; collision shaft `[6.5,0,6.5]–[9.5,16,9.5]` |
| `x` / `z` | same crossed planes remapped along the length axis; 45° about that axis |

Matches Java `chain.json` crossed planes + wiki 3px centred collision (faces 3/32 from centre).

### Validation

`test/block-models-pr43.test.ts` + fixture z=20 + coverage (chains → `explicit_ok`).

**Out of scope:** waterlogged, BlockLight/SkyLight, campfires, generic rod abstraction.

**In progress.** Next after freeze: **PR44** campfires.

---
## 1. Current architecture


```text
Bedrock LevelDB
    ↓  mcbe-leveldb SubChunkPrefix.parse
SubChunk { layers[].palette: BlockState{name, states}[], indices }
    ↓  ChunkBlocks.fromSubChunks  → palette: BlockRef{name, states}[]  (PR20)
ChunkBlocks
    ↓
VoxelNeighborhood
    ↓  resolveBlockModel(…) → … | candle | sign | hanging_sign | chest | chain
    ↓  isFaceFullyOccluded (Option A)
box-face mesher (voxel-mesh-builder.ts)
    ↓  PR17 atlas UVs
    ↓  PR33 isEmissiveBlock(name, states?)
MeshChunk { positions…, indices, emissive? }
    ↓
Three.js (terrain + emissive)
```

**PR39:** candle family — multi-box from `candles`/`lit`; cakes deferred. **Frozen.**
**PR40:** standing/wall signs — palette orientation is model orientation. **Frozen.**
**PR41:** hanging signs — intrinsic `hanging`/`attached_bit`/orientation; no text. **Frozen.**
**PR42:** chests — facing from `minecraft:cardinal_direction`; double halves deferred. **Frozen.**
**PR43:** chains — `pillar_axis` crossed planes; copper variants share geometry. **In progress.**
---

## 2. Actual Bedrock data discovered

### 2.1 What the world (LevelDB) actually gives us

`mcbe-leveldb` schema for each palette entry (`Block`):

| Field | Type | Present in LevelDB | Kept in `SubChunk.BlockState` | Kept in `ChunkBlocks` |
|-------|------|--------------------|-------------------------------|------------------------|
| `name` | string (`minecraft:oak_stairs`) | yes | **yes** | **yes** |
| `states` | compound of string/int/bool | yes | **yes** | **yes** (`BlockRef.states`, PR20) |
| `version` | int (e.g. serialization epoch) | yes | **no** (`toBlockState` ignores it) | n/a |

There is **no separate runtime ID** in the SubChunkPrefix palette today. Numeric `raw_id` exists only in metadata (`mojang-blocks.json`), not in the chunk palette path BedrockMapper uses.

Decoder API already sufficient to reconstruct state for meshing:

- `entryContentTypeToFormatMap.SubChunkPrefix.parse` → layers with full `Block` compounds
- `decodeSubChunk` → `BlockState { name, states }`

**PR20 closed the historical discard gap:** `ChunkBlocks` now retains `states` on each palette `BlockRef`. NBT `version` is still dropped. Boolean `*_bit` TAG_Byte values are coerced to JS booleans on load (PR28).

Demo-world samples (full cubes only):

```json
{"name":"minecraft:dirt","states":{}}
{"name":"minecraft:grass_block","states":{}}
{"name":"minecraft:stone","states":{}}
```

Expected state shapes (from `metadata/vanilladata_modules/mojang-blocks.json` + `block_properties`) for the research targets:

| Block ID | Properties (names) | Value domains |
|----------|-------------------|---------------|
| `minecraft:stone` / `dirt` / `grass_block` | _(none)_ | empty `states` |
| `minecraft:oak_stairs` | `weirdo_direction`, `upside_down_bit`, `minecraft:corner` | int 0–3; bool; `none` / `inner_*` / `outer_*` |
| `minecraft:oak_slab` | `minecraft:vertical_half` | `bottom` \| `top` |
| `minecraft:oak_fence` | `minecraft:connection_{n,e,s,w}` | bool × 4 |
| `minecraft:glass_pane` | same connection bools | bool × 4 |
| `minecraft:torch` | `torch_facing_direction` | `top` \| cardinal \| `unknown` |
| `minecraft:wooden_door` | `minecraft:cardinal_direction`, `open_bit`, `upper_block_bit`, `door_hinge_bit` | — |
| `minecraft:trapdoor` | `direction`, `open_bit`, `upside_down_bit` | int 0–3; bools |

**Naming pitfall:** resource-pack `blocks.json` still uses legacy keys (`grass`, `wooden_door`, `trapdoor`) while world NBT uses modern ids (`minecraft:grass_block`, `minecraft:wooden_door`, `minecraft:trapdoor`). PR17 already bridges some of this for textures; model code must use **world** ids.

### 2.2 Resource pack — textures, almost no terrain geometry

| Path | Finding |
|------|---------|
| `resource_pack/blocks.json` | Texture + sound only. e.g. `"oak_stairs": { "textures": "wood_oak" }`. **No model / geometry fields** for classic blocks. |
| `resource_pack/textures/terrain_texture.json` | Alias → PNG (+ rare `overlay_color`). Owned by PR17. |
| `resource_pack/models/blocks/*.geo.json` | **Only 4 files:** shelf mushrooms + straw bed halves. **Not** stairs/slabs/fences/doors/torches. |
| `resource_pack/models/entity/` | Entity `minecraft:geometry` (bones/cubes/uv). Not terrain. |

Vanilla schema (`Geometry.json` 1.26.20) documents built-in render identifiers:

- `minecraft:geometry.full_block`
- `minecraft:geometry.cross`

Classic structural shapes are **engine-built-in**, not shipped as parseable cube lists in the samples.

### 2.3 Behavior pack — archetypes + collision shapes

| Path | Finding |
|------|---------|
| `behavior_pack/blocks/*.block.json` | Colored concrete/wool stairs/slabs use `block_archetype.slab_block` / `stair_block`. No mesh cubes. |
| `behavior_pack/shapes/*.json` | `minecraft:voxel_shape` AABBs for **collision / support**, not render meshes. Fence shape is **post only** `[6,0,6]–[10,16,10]` (rails not in that shape file). |
| Permutations | Almost unused for vanilla classics; `shelf_mushroom_block.json` is the rare data-driven geometry + permutation example. |

### 2.4 Geometry format when it *does* exist

Bedrock geo JSON (shelf mushroom) structure:

```text
format_version
minecraft:geometry[]
  description.identifier / texture_width / texture_height
  bones[]
    name, pivot?
    cubes[]
      origin[3], size[3], pivot?
      uv.{north,south,east,west,up,down}.{uv, uv_size, material_instance?}
```

This is **not** Java Edition `elements[]` with `from`/`to`/`faces.uv`/`cullface`. If PR19 ever parses geo files, it must target this bone/cube schema — but for stairs/slabs that path is a dead end in vanilla samples.

---

## 3. Separate these concepts

| Concept | Meaning in BedrockMapper | Example |
|---------|--------------------------|---------|
| **1. Block ID** | Namespaced string from palette `name` | `minecraft:oak_stairs` |
| **2. Block state** | `states` map from palette | `weirdo_direction=1`, `upside_down_bit=false`, `minecraft:corner=none` |
| **3. Texture appearance** | PR17 atlas frame(s) via `blocks.json` → `terrain_texture` | oak planks / grass_side#overlay=… |
| **4. Geometry / model** | Mesh primitives in block space (boxes or faces) | stair “straight” two-box hull |
| **5. Transform** | Rotation/mirror of a base model from state | facing east → rotate Y 90° |
| **6. Occlusion geometry** | Which volumes hide neighbour faces | full cube; half-slab AABB; fence post |

Today the pipeline collapses (1)+(optional 2 discarded) → always full-cube (4)+(6) → PR17 texture (3). PR19 must keep these layers distinct.

---

## 4. Proposed internal model

Because vanilla does **not** ship stair/slab/fence render meshes as data, the first system should be **procedural families** keyed by world state, consuming **PR17 textures**.

### 4.1 Types (proposed — not implemented)

```ts
/** Stable identity of a palette entry after state normalize. */
type BlockRef = {
  name: string;                          // minecraft:oak_stairs
  states: Readonly<Record<string, string | number | boolean>>;
};

/** Which atlas frame a face samples (PR17 TextureKey / appearance). */
type FaceMaterial = {
  textureKey: string | null;             // atlas frame id, or null → vertex colour only
  tint?: 'none' | 'grass' | 'foliage' | …;
};

/**
 * Axis-aligned box in local block space, units = blocks, origin at block min corner.
 * 0..1 matches one Minecraft block (same convention as current cube mesher).
 */
type ModelBox = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** Per-box face materials; missing face → culled / not emitted. */
  faces: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', FaceMaterial>>;
};

/**
 * Immutable render model in local space BEFORE facing transform.
 * Occlusion may use a coarser set of boxes than renderBoxes.
 */
type BlockModel = {
  key: string;                           // family + variant, e.g. "slab:bottom"
  renderBoxes: readonly ModelBox[];
  /** Volumes that can hide neighbour faces (may equal renderBoxes). */
  occlusionBoxes: readonly ModelBox[];
  /** True only if occlusionBoxes cover the unit cube. */
  isFullCube: boolean;
};

/** After applying facing / upside-down transform; still immutable & cacheable. */
type OrientedBlockModel = BlockModel & {
  transformKey: string;                  // e.g. "rotY=1|flipY=0"
};
```

**Why boxes, not free meshes, for v1?** Stairs/slabs/fences/panes/doors are historically unions of AABBs. Matches collision-shape intuition, easy UV projection onto PR17 atlas frames, cheap occlusion tests. Free bone/cube geo remains a **later** adapter for the rare `.geo.json` blocks.

### 4.2 Families the representation must eventually cover

| Family | Boxes (sketch) | State → variant |
|--------|----------------|-----------------|
| full_cube | one unit box | none |
| slab | bottom or top half | `vertical_half` |
| stair | 2–3 boxes (straight / inner / outer) | `weirdo_direction`, `upside_down_bit`, `corner` |
| fence | post + up to 4 rails | connection_* (or infer from neighbours) |
| pane | thin center + connections | connection_* |
| torch | thin upright / wall stub | `torch_facing_direction` |
| door | thin panel (lower/upper) | cardinal + open + hinge + upper |
| trapdoor | thin plate flat or open | direction + open + upside_down |
| cross / plant | two planes (later; or reuse geo.cross idea) | mostly none |

---

## 5. Occlusion / culling strategy

### 5.1 What exists today

```ts
isRenderableCube(name)  // false only for air/barrier/…; else true
isSolidAt(...)          // ≡ isRenderableCube(neighbour name)
// mesher: if isSolidAt(neighbour toward face) → skip whole unit face
```

That is **unit-face solid occlusion**. It is correct only when every renderable block is a full cube.

### 5.2 Abstractions needed (names illustrative)

| Capability | Purpose |
|------------|---------|
| `isRenderable(ref)` | Should this cell emit any geometry? (air/invisible out) |
| `isFullCube(model)` | Fast path: keep today’s unit-face cull |
| `occlusionBoxes(model)` | Volumes that can hide geometry |
| `faceHiddenByNeighbour(faceQuad, neighbourModel, direction)` | Precise cull for partials |
| `renderModel(ref)` | Geometry + materials to emit |

Optional later: neighbour-dependent **connection** resolution for fences/panes (state may already store connections in Bedrock; verify per world before inferring).

### 5.3 Precision for the **first** implementation

**Recommended:** axis-aligned **box–box occlusion** at face granularity:

1. Emit each exposed quad of each `renderBox`.
2. Against the neighbour’s `occlusionBoxes`, if the quad is **fully covered** by the neighbour’s projected silhouette on that face plane → drop it.
3. If `isFullCube(self) && isFullCube(neighbour)` → use today’s O(1) path.

**Not in v1:**

- Triangle–triangle exact clip
- Non-AABB stair–stair contact surfaces beyond box unions
- Transparent-aware occlusion (glass still occludes like opaque for v1, same as today)

**Examples:**

| Self | Neighbour | Expected |
|------|-----------|----------|
| full cube | full cube | shared face removed (today) |
| bottom slab | full cube **beside** | slab’s **side** on the unit plane may cull; **top at y=0.5 stays** (not on shared plane with the cell above) |
| bottom slab | full cube **above** | slab top stays — emit face must lie on the unit shared plane (PR29) |
| bottom slab | bottom slab | shared vertical faces between overlapping halves removed |
| fence | fence | only post/rail overlaps cull; lots of faces remain |
| stair | stair | approximate via 2–3 boxes; small cracks acceptable in v1 |

**PR29 invariant:** a neighbour can only occlude an emit face that lies on the unit-cell plane toward that neighbour (`faceLiesOnUnitSharedPlane`).

---

## 6. Procedural vs data-driven vs hybrid

| Approach | Fit to actual samples | Verdict |
|----------|----------------------|---------|
| **A. Pure procedural** | Matches reality: stairs/slabs/fences have no geo JSON | **Primary for v1 families** |
| **B. Parse Bedrock geo** | Only 4 block geos; classics missing | **Defer**; adapter later for mushrooms/beds/custom |
| **C. Hybrid** | Procedural families + PR17 textures + optional geo loader | **End-state architecture** |

**Recommended hybrid split:**

| Data-driven (reuse now) | Procedural (write in code) | Later data-driven |
|-------------------------|----------------------------|-------------------|
| Block id + states from LevelDB | Box models for slab/stair/fence/pane/torch/door | `.geo.json` → boxes/meshes |
| PR17 atlas keys / UVs / overlays | Facing transforms (`weirdo_direction` → rotY) | Custom BP permutations |
| `mojang-blocks` property catalogs (tests / validation) | Occlusion boxes per family | Voxel_shape import for occlusion only (optional) |

Do **not** pretend `blocks.json` or `terrain_texture.json` encode geometry — they do not.

---

## 7. Model resolution & caches

```text
BlockRef { name, states }
    ↓  normalizeStates(name, states)   // drop irrelevant keys; sort; coerce types
    ↓  familyOf(name)                  // e.g. "*_stairs" → stair
    ↓  variantKey(family, states)      // e.g. stair:dir=1:up=0:corner=none
ModelKey = `${family}:${variantKey}`
    ↓
baseModels.get(ModelKey)               // immutable BlockModel, no rotation
    ↓  orient(base, facingTransform)
OrientedKey = `${ModelKey}|${transformKey}`
    ↓
orientedModels.get(OrientedKey)        // immutable OrientedBlockModel
    ↓
mesher looks up once per palette entry (not per voxel)
```

**Rules:**

- Base models immutable; never mutate after insert.
- Cache **oriented** models — rotations are cheap but meshing touches millions of cells.
- **No JSON / filesystem I/O during chunk meshing.** All catalogs loaded at process start (or first mesh).
- Texture keys resolved when building the `BlockModel` (call into PR17 appearance helpers once per model key), not per face emission if avoidable.
- Neighbour-dependent fence/pane: either trust stored connection bits, or compute a **connection mask** into the ModelKey (`fence:n1e0s1w0`) so results stay cacheable.

---

## 8. Mesh integration (design only)

```text
VoxelNeighborhood  (must expose BlockRef, not only names)
    ↓
for each cell:
  ref = volume.refAt(...)
  if !isRenderable(ref): continue
  oriented = resolveOrientedModel(ref)     // cached
  for each renderBox.face:
    if faceFullyOccluded(face, neighbourOriented): continue
    append quads → MeshChunk arrays
    UVs from face.textureKey via PR17 atlas UV helpers
    colors from existing tint / white rules
```

| Question | Answer |
|----------|--------|
| Where model lookup occurs | Once per palette entry → map palette index → `OrientedBlockModel`; per cell only indexes that map |
| Where transforms occur | In resolver when building oriented cache — **not** per vertex in the hot loop |
| Where face culling occurs | Mesher, using neighbour oriented occlusion boxes |
| Where UV lookup occurs | When emitting a kept face (atlas rect from PR17); materials baked into model |
| Does `MeshChunk` need to change? | **No** for v1 — still positions/normals/colors/uvs/indices |
| Are colors still sufficient? | Yes — keep PR17 white-vs-tint rules |
| Generate into MeshChunk arrays? | Yes, same as today; no per-block Three.js objects |

**Required for models (done in PR20):** `ChunkBlocks` retains `BlockRef { name, states }` (NBT `version` still dropped).

---

## 9. Performance design

Target: thousands of chunk meshes over time, many rebuilds on `meshVersion`.

| Technique | Note |
|-----------|------|
| Immutable base + oriented model caches | Process-lifetime `Map`s; bounded LRU if needed |
| Palette-local model table | 16³ cells share ≤ tens of palette entries |
| Full-cube fast path | Keep current code path when `isFullCube` |
| Precomputed quads optional | Oriented model may store expanded float quads to memcpy |
| No parsing in mesher | Startup load only |
| Avoid per-block allocations | Push into shared `number[]` buffers; reuse scratch |

---

## 10. First implementation scope (recommended)

**Phase A (architecture-proving, smallest useful set):**

1. **Full cube** — regression: identical meshes to today for stone/dirt/grass  
2. **Slab** — `vertical_half` bottom/top  
3. **Stair** — straight + upside-down + 4 facings; **defer** inner/outer corner shapes to Phase A2 if needed  

**Phase B (connection families):**

4. Fence (post + rails from connection bits)  
5. Pane  

**Phase C (thin / hinged):**

6. Torch  
7. Trapdoor  
8. Door (lower/upper)  

**Rationale:** Slab + stair exercise state → transform → partial occlusion → PR17 UVs without neighbour-connection complexity. Fence/pane need connection semantics and are a second milestone. Doors need two-block vertical pairing.

**Explicitly out of first coding PR:** water planes, greedy meshing, LOD, 3D players/markers, parsing all `.geo.json`, importing collision shapes as render meshes, every stair corner shape.

---

## 11. Testing strategy (define now, implement later)

| Area | Cases |
|------|--------|
| State decode | Palette entry round-trip: name+states preserved through a future `ChunkBlocks` |
| Model resolution | Same `BlockRef` → same `ModelKey`; stair facing rotates boxes |
| Full cube regression | Mesh of all-stone chunk matches current builder (hash / invariants) |
| Slab geometry | Bottom vs top box bounds; UVs on horizontal faces |
| Stair orientations | 4× `weirdo_direction` × upside_down; optional corner variants |
| Rotation | Transform purity: rotating then inverse restores base |
| UV mapping | Textured slab/stair still land in PR17 atlas frames |
| Partial culling | Slab against cube; slab against slab; stair against cube |
| Fence / pane | Connection masks; no full-cube occlusion between parallel panes |
| Model cache | Second resolve hits cache; no duplicate objects |
| Unknown block | Falls back to full cube (today’s conservative rule) |

---

## 12. Concrete handling table

| Block | State data (world) | Model source | Geometry | Rotation | Texture source (PR17) | Proposed handling |
|-------|-------------------|--------------|----------|----------|------------------------|-------------------|
| `minecraft:stone` | `{}` | procedural `full_cube` | unit box | none | `flattened_stone` / stone | Keep current path |
| `minecraft:dirt` | `{}` | full_cube | unit box | none | dirt | Keep current path |
| `minecraft:grass_block` | `{}` | full_cube | unit box | none | grass_top / grass_side#overlay / dirt | Keep current path + PR17 overlay |
| `minecraft:oak_slab` | `minecraft:vertical_half` | procedural `slab` | half box | none | `oak_planks` | Phase A |
| `minecraft:oak_stairs` | `weirdo_direction`, `upside_down_bit`, `minecraft:corner` | procedural `stair` | 2–3 boxes | Y rot from direction; flip for upside_down | `wood_oak` / oak planks | Phase A (corners optional A2) |
| `minecraft:oak_fence` | connection_* bools | procedural `fence` | post + rails | none | oak planks | Phase B |
| `minecraft:glass_pane` | connection_* bools | procedural `pane` | thin center + arms | none | glass / glass_pane_top | Phase B |
| `minecraft:torch` | `torch_facing_direction` | procedural `torch` | thin column / wall stub | facing | `torch_on` | Phase C |
| `minecraft:wooden_door` | cardinal, open, upper, hinge | procedural `door` | thin panel | facing + open | door_lower / door_upper | Phase C |
| `minecraft:trapdoor` | direction, open, upside_down | procedural `trapdoor` | thin plate | facing + open | `trapdoor` | Phase C |
| shelf mushroom etc. | BP permutations | optional geo parse | bone cubes | BP transform | material_instance | Later adapter only |

---

## 13. Risks

| Risk | Mitigation |
|------|------------|
| Stair `minecraft:corner` shapes wrong | Start with `corner=none` only; golden screenshots |
| Fence connection bits absent/stale in some worlds | Detect empty connections; optional neighbour inference behind a flag |
| Discarding NBT `version` breaks future state renames | Monitor; can plumb version later without model API break |
| Partial occlusion cracks / z-fight | Slight UV inset already in PR17; keep conservative “fully covered” cull |
| Performance regression on all-cube worlds | Mandatory `isFullCube` fast path + palette model table |
| Texture face mapping on rotated stairs | Define face materials in **local** space; transform face dirs with boxes |

## 14. Known unknowns

- Exact mapping of `weirdo_direction` 0–3 → north/east/south/west in Bedrock 1.26 (must verify against a real placed stair in a test world).
- Whether fence/pane connection bits are always authored in palette or sometimes require neighbour inference.
- Whether double slabs appear as a distinct block id vs two halves.
- How waterlogged layer 1 should interact with models (still ignored; out of scope).
- Whether any marketplace/vanilla packs ship classic stair geos that we should prefer when present.

## 15. Explicit non-goals (this research + first coding PR)

- Implementing models in this documentation PR  
- Modifying PR16/PR17/PR18 frozen code except the future, deliberate `ChunkBlocks` state retention  
- Water rendering, greedy meshing, LOD, 3D players/markers  
- Java Edition model JSON compatibility  
- Parsing all entity geos  
- Perfect stair–stair occlusion  
- Runtime resource-pack hot reload  

## 16. Proposed TypeScript module layout (future coding)

```text
server/renderer/3d/models/
  types.ts           # BlockModel, ModelBox, …
  families/
    full-cube.ts
    slab.ts
    stair.ts
    …
  resolve.ts         # BlockRef → OrientedBlockModel + caches
  occlude.ts         # box–box face coverage
  transform.ts       # rotY / flipY on boxes + face ids
```

Wire-in point: `voxel-mesh-builder.ts` replaces the unit-cube loop with “resolve + occlude + emit”, keeping `MeshChunk` unchanged.

---

## 17. Summary recommendation

1. **States are already decoded; ChunkBlocks throws them away** — that is the first coding change when implementation starts.  
2. **Vanilla samples do not provide stair/slab/fence render meshes** — use **procedural box families** + PR17 textures.  
3. **First scope: full cube + slab + straight stair** to prove resolver, transform, occlusion, and UV integration.  
4. **Occlusion: box coverage with full-cube fast path** — not exact poly clipping.  
5. **MeshChunk stays as-is.**  
6. **Do not touch texture atlas / overlay pipeline.**

This document freezes the research baseline for PR19. Coding work requires a separate implementation brief.

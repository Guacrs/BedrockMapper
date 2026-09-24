# Experimental 3D: block states + block models

**Status:** PR19 research · **PR20** cube+slab · **PR21** stairs · **PR22** fences (**frozen**) · **PR23** panes · **PR24** doors+trapdoors (**frozen**) · **PR26** walls.

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
| **PR25** | Cross / plant models — separate branch `cursor/3d-cross-models-ef90` |
| **PR26** | Wall models — contextual ConnectionMask + post/tall (**this PR**) |

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
- Unsupported `minecraft:corner` ≠ `none` → **full-cube fallback** (no silent wrong straight stair)
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

### PR26 implemented

Wall family (`families/wall.ts`) — contextual, **not** a fence reuse:

**Bedrock research:**

- States: `wall_connection_type_{n,e,s,w}` ∈ {none, short, tall} + `wall_post_bit` (Microsoft Learn + Wiki). **Ignored on BlockRef** — inferred at mesh time (same empty-NBT rationale as fences).
- Attach (`wallConnectsTo`, ≠ fence/pane/`isSolidAt`): wall↔wall, wall→full cube, wall→pane/bars, wall→gate, wall→trapdoor (BE 1.16.20). **wall↛fence**. Plants explicitly refused (allowlist mirrors PR25).
- Post: omitted on straight N–S / E–W **or** four-way; forced when a non-air block is above (wiki).
- Tall vs short: single `tall` flag for all arms when anything is above the cell (approximation of per-side tall — documented limitation).
- Geometry: post `[4,0,4]–[12,16,12]`; arms 6px (5–11), height 14/16 or 16/16.
- Cache key: `wall:{mask}:p{0|1}:t{0|1}:{name}` — never shared with fence/pane keys.
- Fence/pane classifiers updated to **accept walls** as attach targets (reciprocal for panes; fences attach to walls).

**Contracts:** `isFullCube === false`; Option A occlusion unchanged; ConnectionMask stays boolean (post/tall are `WallShape` extras).

**Visual validation:** synthetic fixture in `test/block-models-wall.test.ts`. Same caveat as PR22/23.

---

## 18. Model-system audit checkpoint (after PR24)

Before adding plants/walls/crosses, freeze these contracts:

| Layer | Contract |
|-------|----------|
| `BlockRef` | Intrinsic palette identity only — never neighbour rails/arms |
| `ConnectionMask` | Fence/pane only; computed at mesh time via `VoxelNeighborhood` |
| `resolveBlockModel` | Process cache by family key; contextual families require mask |
| `rotateModelY` / `flipModelY` | Shared transform primitives — families stay separate |
| `isFullCube` | Fast occlusion path; thin/hinged/connected families stay false |
| Option A occlusion | Drop face only when fully covered |
| `faceCornerUvsForBox` | Unit-cell UV density on partial boxes |
| Unsupported state | Full-cube fallback (visible, never silent empty) |

**Do not** merge door/trapdoor/slab into a generic “thin block” framework yet. Extract shared primitives only when three+ families need the same helper.

**Next families (later):** cross/plants (PR25 branch), then optional `.geo.json` — only after this checkpoint holds under review.

### Deferred (still)

- Cross / plant geometry (PR25 — separate PR)
- Per-direction wall tall/short (currently uniform `tall` from above)
- Inner/outer corner stairs
- Double plants / vines / berry bushes / bamboo stalks
- Custom `.geo.json`
- Exact stair–stair polygon clipping
- Greedy meshing / water / resource-pack runtime overrides

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
    ↓  resolveBlockModel(BlockRef[, ConnectionMask[, WallShape]]) → full_cube | slab | stair | fence | pane | door | trapdoor | wall
    ↓  isFaceFullyOccluded (Option A)
box-face mesher (voxel-mesh-builder.ts)
    ↓  PR17: appearance → atlas UVs (side UV crop for half-height boxes)
MeshChunk { positions, normals, colors, uvs, indices }
    ↓
Three.js
```

**PR20–26 geometry:** full cubes + slabs + straight stairs + fences + panes/bars + doors + trapdoors + walls. Plants/crosses are on PR25 (separate branch). Corner stairs fall back to full cube.

---

## 2. Actual Bedrock data discovered

### 2.1 What the world (LevelDB) actually gives us

`mcbe-leveldb` schema for each palette entry (`Block`):

| Field | Type | Present in LevelDB | Kept in `SubChunk.BlockState` | Kept in `ChunkBlocks` |
|-------|------|--------------------|-------------------------------|------------------------|
| `name` | string (`minecraft:oak_stairs`) | yes | **yes** | **yes** |
| `states` | compound of string/int/bool | yes | **yes** | **no** (stripped) |
| `version` | int (e.g. serialization epoch) | yes | **no** (`toBlockState` ignores it) | n/a |

There is **no separate runtime ID** in the SubChunkPrefix palette today. Numeric `raw_id` exists only in metadata (`mojang-blocks.json`), not in the chunk palette path BedrockMapper uses.

Decoder API already sufficient to reconstruct state for meshing:

- `entryContentTypeToFormatMap.SubChunkPrefix.parse` → layers with full `Block` compounds
- `decodeSubChunk` → `BlockState { name, states }`

**Nothing is missing from the decoder for stairs/slabs/fences.** The gap is intentional discard in `ChunkBlocks.fromSubChunks`.

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
| bottom slab | full cube | slab’s bottom/side faces vs cube: top of slab stays; sides may partial-cull against cube |
| bottom slab | bottom slab | shared vertical faces between overlapping halves removed |
| fence | fence | only post/rail overlaps cull; lots of faces remain |
| stair | stair | approximate via 2–3 boxes; small cracks acceptable in v1 |

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

**Required production change when coding starts (not in this PR):** `ChunkBlocks` must stop discarding `states` (store `BlockState` or parallel state arrays). That is the single unavoidable data-path change before models work.

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

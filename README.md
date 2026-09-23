# BedrockMapper

A lightweight top-down web map for an **official Mojang Minecraft Bedrock Dedicated Server**.
It reads the live world through a snapshot of its LevelDB and shows online players as markers.

It is not a BlueMap clone. The default view is a 2D Leaflet map. An **experimental** Three.js
surface-terrain 3D mode is available from the same page (no Minecraft textures, no caves, no
entities yet). One process, one Overworld map, colours from the shared BedrockMapper palette.

Verified against **Bedrock Dedicated Server 1.26.51.1**.

## Requirements

- **Node.js >= 22.6.** TypeScript is run directly with Node's type stripping; there is no bundler and
  no compile step.
- An **official Bedrock Dedicated Server** world directory — the folder that contains `db/`,
  `level.dat` and `levelname.txt`. Java Edition, Paper/Spigot/Fabric, Realms, PocketMine and Nukkit
  worlds are not supported.
- Linux x64, Windows x64 or macOS arm64. The LevelDB binding ships prebuilt binaries for those;
  other platforms need CMake and a C++ toolchain.
- The map is written for current **Bedrock 26.x** worlds (`SubChunkPrefix` format version 9, storage
  version 10). Older converted worlds may have numeric-ID subchunks, which are reported and skipped.

Player markers additionally need the BDS Script API behaviour pack in `addons/` (Beta APIs experiment
and `@minecraft/server-net`). The terrain map works without it.

## Installation

```bash
git clone <this-repository>
cd bedrock-map
npm install
cp .env.example .env
```

Edit `.env` and point `WORLD_PATH` at the world **directory**, not at `db/` and not at `worlds/`:

```
WORLD_PATH=/opt/bds/worlds/Bedrock level
```

There is nothing to compile. `npm run start` is the production command.

## Configuration

Every setting is documented in `.env.example`. A value that is set but unusable stops startup with a
sentence saying what to change; nothing is silently replaced with a default.

| Setting | Default | Purpose |
| --- | --- | --- |
| `WORLD_PATH` | _(required)_ | BDS world directory (`db/` + `level.dat`) |
| `HOST` | `127.0.0.1` | Bind address. `127.0.0.1` is local only. `0.0.0.0` listens on every interface |
| `PORT` | `3000` | HTTP port |
| `MAP_CACHE` | `./cache` | Snapshots and rendered tiles. Must **not** be inside `WORLD_PATH` |
| `WORLD_REFRESH_INTERVAL` | `90000` | How often the live world is checked, in ms. `0` reads it once |
| `TILE_UPDATE_COOLDOWN` | `60000` | After a tile redraw, ignore further digests for that tile for this many ms. `0` off |
| `REFRESH_RENDER_CONCURRENCY` | `2` | How many tiles a refresh redraws at once (1–16) |
| `PLAYER_UPDATE_INTERVAL` | `3000` | How often the browser polls for player positions, in ms |
| `PLAYER_DATA_TIMEOUT` | `10000` | After this many ms without a report, markers disappear |
| `API_KEY` | _(empty)_ | Shared secret for `POST /api/players`. Empty disables player updates |
| `MARKER_API_KEY` | _(empty)_ | Shared secret for marker create/update/delete. Keep separate from `API_KEY` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

### Binding and security

The default `HOST=127.0.0.1` is the safe one: only programs on the same machine can open the map.

`HOST=0.0.0.0` makes the map reachable from other machines. There is **no login**. Anyone who can
reach `PORT` can see the terrain, player names and live positions, and shared map markers. Mutating
`/api/players` needs `API_KEY`; mutating `/api/markers` needs `MARKER_API_KEY`. Put a reverse proxy
or a firewall in front of it if the host is reachable from the internet, and never expose those write
endpoints publicly.

### Cache layout

The map server writes only under `MAP_CACHE`:

```
MAP_CACHE/world-snapshot/<world-id>/<source-id>/db/   copy of the LevelDB
MAP_CACHE/tiles/<dimension>/<zoom>/<x>/<y>.png        rendered tiles
```

Abandoned copies (a snapshot interrupted by a crash) and leftover `*.tmp` tile writes are deleted on
startup, after a refresh and on shutdown. The snapshot currently in use and its valid tiles are kept,
so a restart does not rebuild the whole map.

## BDS addon installation

The terrain map does not need this. Install it if you want live player markers.

Paths below are relative to the BDS directory. `<world>` is your `level-name` (`Bedrock level` by
default). The pack UUID is `6abf84b2-7bdb-4ab5-8eac-193f4c903bb9`; the script-module UUID (used for
config) is `46c4ccc2-f4a5-48c1-9f29-b3460e2e7add`.

1. **Copy the behaviour pack**

   ```bash
   cp -r addons/bedrock-map-player-tracker /path/to/bds/behavior_packs/
   ```

2. **Enable it on the world**, in `worlds/<world>/world_behavior_packs.json`:

   ```json
   [
     {
       "pack_id": "6abf84b2-7bdb-4ab5-8eac-193f4c903bb9",
       "version": [0, 1, 0]
     }
   ]
   ```

3. **Allow the Script API modules.** `@minecraft/server-net` is not allowed by default. Copy the
   shipped permissions into a folder named after the script-module UUID:

   ```bash
   mkdir -p /path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add
   cp addons/bedrock-map-player-tracker/config/permissions.json \
      /path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add/
   ```

   Required modules: `@minecraft/server`, `@minecraft/server-net`, `@minecraft/server-admin`.

4. **Set the API key and endpoint** in that same folder. `secrets.json` holds the key (BDS keeps it
   out of the script); `variables.json` holds the URL:

   ```bash
   cp addons/bedrock-map-player-tracker/config/{secrets.json,variables.json} \
      /path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add/
   ```

   `mapApiKey` in `secrets.json` **must match** `API_KEY` in the map server's `.env`.
   `mapEndpoint` should stay on localhost, e.g. `http://127.0.0.1:3000/api/players`.

5. **Enable the Beta APIs experiment** on the world. `@minecraft/server-net` and
   `@minecraft/server-admin` are pre-release modules and will not load without it. A client can toggle
   it in the world settings; on a headless server, stop BDS and set the `gametest` byte inside the
   `experiments` compound of `worlds/<world>/level.dat`.

6. **Restart BDS.** The console should show:

   ```
   [bedrock-map] player tracker reporting to http://127.0.0.1:3000/api/players every 60 ticks
   ```

More detail, including how to confirm it with `curl`, is in [`addons/README.md`](addons/README.md).

This pack only works on a **dedicated server**. The Script API HTTP client does not exist in the game
client or on Realms.

## Running

```bash
npm run start
```

That command:

1. Validates `.env`
2. Checks `WORLD_PATH` exists and looks like a Bedrock world
3. Creates `MAP_CACHE` if needed
4. Copies the world database into the cache and opens the **copy**
5. Starts the HTTP server
6. Begins the terrain refresh timer (unless `WORLD_REFRESH_INTERVAL=0`)
7. Serves the web map

A missing world, a bad port, a cache it cannot write to, or a `WORLD_PATH` that points at `db/`
itself exits with a human-readable error and does not bind the port.

`SIGINT` and `SIGTERM` stop the timers, stop accepting requests, close the snapshot, sweep leftover
temp files and exit. The live BDS world is never opened and never written to.

`npm run dev` is the same server with Node's `--watch` for local work. Do not use it as the
production process.

## Accessing

With the defaults:

```
http://127.0.0.1:3000
```

If you set `HOST=0.0.0.0` and `PORT=3000`, other machines use `http://<server-ip>:3000`.

`GET /api/health` is a JSON status for a process supervisor or a load balancer. It reports the world
name, map version, last refresh time and player-data age. It does not include paths, keys or bind
addresses.

The map page shows a small status in the top right: when the terrain last updated, and whether player
reports are live or stale. A failed refresh keeps the last good map on screen and says so.

Use the **2D / 3D** toggle (top right) to switch views. 2D is the existing Leaflet map. 3D is an
experimental Three.js viewer that streams Minecraft chunks around the camera as **full-cube
block meshes** (exposed faces only).

Append `?debug3d=1` to show loaded chunk count, camera Minecraft coordinates and FPS in 3D mode.

### Experimental 3D mode

3D reuses the same world snapshot and subchunk decode path as 2D tiles. Each chunk mesh is built
from renderable full cubes (`isRenderableCube` — invisible blocks skipped; everything else is a
cube for now, including water/leaves/partial blocks). When a texture atlas has been built, faces
sample Minecraft block textures; otherwise the viewer falls back to `blockColor` vertex colours
(same map-colour palette as 2D, without surface water-depth / biome multiply on every face).
Three.js lighting shades via normals.

| Item | Detail |
| --- | --- |
| Toggle | **2D** / **3D** buttons on the map page |
| API | `GET /api/mesh/:dimension/:chunkX/:chunkZ` → JSON mesh (`positions`, `normals`, `colors`, `uvs`, `indices`); **204** when that chunk has no block data |
| Textures | Optional atlas: `GET /api/textures/atlas.png` + `atlas.json`; `/api/map/info` exposes `textureAtlas: true/false` |
| Streaming | Loads ~`(2r+1)²` chunks around the camera (`r = 4`); unloads beyond radius 6 |
| Cache | In-memory mesh + block-volume caches (LRU, capped at 512); invalidated for the chunk **and** its four face neighbours when digests change |
| Live 3D refresh | `meshVersion` in `/api/map/state` bumps on any chunk digest change; the viewer reloads visible meshes |
| Coordinates | Minecraft X/Y/Z map 1:1 to Three.js X/Y/Z |

#### Optional Minecraft textures

Block textures are **not** committed to this repository. They are generated locally from
[Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples) (see that repo’s `LICENSE.md`:
files are subject to the [Minecraft EULA](https://www.minecraft.net/en-us/eula)).

Use the **full** samples release (the min zip omits `resource_pack/textures/blocks/*.png`):

```bash
VANILLA_SAMPLES=/path/to/bedrock-samples npm run textures:build
```

This writes gitignored files under `data/textures/`:

- `block-appearance.json` — normalized `minecraft:block` → up/down/side texture keys
- `atlas.json` / `atlas.png` — deterministic texture atlas + UV frames

The server starts without these files. The 2D map is unaffected. The 3D viewer keeps working
with vertex colours until the atlas is built; after a build, restart (or rely on the atlas HTTP
endpoints) and reload the page.

**Current limitations (intentional):** no stairs/slabs/fences models, no water transparency, no
greedy meshing, no LOD, no 3D players/markers, no animated textures, no custom resource packs at
runtime. The older heightmap builder remains in `server/renderer/3d/mesh-builder.ts` for reference
but is not used by `/api/mesh`.

Demo without BDS:

```bash
node --experimental-strip-types scripts/make-demo-world.ts
WORLD_PATH=./demo-world MAP_CACHE=./cache npm start
```

The demo world includes a small tower, wall, stepped cliff and tree so vertical geometry is obvious.

## Shared map markers

Persistent POIs (bases, farms, villages, portals, …) are separate from live player markers.

- `GET /api/markers` — public; every visitor sees the same list
- `POST /api/markers`, `PATCH /api/markers/:id`, `DELETE /api/markers/:id` — require `MARKER_API_KEY`
  (not `API_KEY`, so a browser-held marker key cannot post fake players)
- Stored in `MAP_CACHE/markers.json` (survives restarts; not mixed with player state)

On the map: markers load automatically. Click **Edit markers** (top right) and enter `MARKER_API_KEY`
to unlock this tab (sessionStorage only — no query-string unlock). Then right-click to add; open a
marker popup to edit/delete. Click **Marker edit: on** again to lock.

## Updating

1. Stop BedrockMapper (`SIGINT` / `SIGTERM`, or your supervisor's stop). Do **not** stop BDS.
2. `git pull` (or unpack the new files) and `npm install`.
3. Read `.env.example` for new settings; merge anything you need into `.env`.
4. If the terrain colours changed, delete `MAP_CACHE/tiles` (or the whole `MAP_CACHE`) so tiles redraw.
5. `npm run start`.

The tile cache and the current world snapshot survive a restart as long as `MAP_CACHE` is the same
directory. A world that changed while the map was down is snapshotted again on startup; only tiles
that no longer match are dropped.

Updating BDS itself is independent. After a Bedrock version change, confirm the world still opens
(`npm run inspect-world`) before relying on the map. Script API module versions in the addon's
`manifest.json` may need bumping when Mojang ships a new beta.

## Backup / safety

BedrockMapper is **read-only** with respect to the Minecraft world.

The LevelDB build BDS ships does not take an exclusive lock, so a mapper *can* open the live `db/`
directory — and doing so is destructive. Opening LevelDB replays the write-ahead log and may compact
tables, which rewrites `.ldb` files, `MANIFEST` and `CURRENT` underneath the running server. That
was verified against BDS 1.26.51.1.

So the map never opens the live database. It copies `db/` into `MAP_CACHE` and opens the copy. The
live world is only ever listed and read as ordinary files. Integration tests hash the source
database before and after a full refresh; on a live server the map process has no open file handle
and no mapped file under the world directory.

A copy taken while BDS is writing may have a torn tail on the write-ahead log. LevelDB recovers that
on the copy. If the copy cannot be opened, the previous snapshot keeps serving and the next refresh
tries again. For a fully consistent snapshot you can still run `save hold` / `save query` /
`save resume` in the BDS console; the map does not need it.

Back up the BDS world the way you already do. `MAP_CACHE` is disposable: delete it and the map
rebuilds from the world on the next start.

## Operations notes

Logs are one line per event (`terrain.updated`, `players.stale`, `shutdown.complete`). Player
movement is not logged — only the addon coming online, joins, leaves, reports stopping, and terrain
that actually changed.

A temporary refresh failure does not take the process down. `/api/health` returns `"status":
"degraded"` until a refresh succeeds again; tiles keep coming from the last good snapshot.

Useful commands besides `start`:

```bash
npm run inspect-world                    # dump chunks from the snapshot
npm run render-chunk -- --chunk 0,0      # one PNG, for debugging
npm run block-colors:report              # vanilla map-colour coverage
npm run block-colors:world               # colour source for surface blocks in WORLD_PATH
npm test                                 # unit tests
TEST_WORLD_PATH="/opt/bds/worlds/Bedrock level" npm test
npm run typecheck
```

## Known limitations

- Overworld only. The Nether and the End are not rendered.
- One rendered zoom level for 2D (1 pixel per block). Zooming out scales tiles in the browser.
- Experimental 3D renders **full-cube exposed faces** (optional Minecraft texture atlas;
  otherwise vertex colours — not a BlueMap-complete viewer — no special block models, water
  transparency, LOD, or 3D overlays yet).
- Terrain is as fresh as `WORLD_REFRESH_INTERVAL` **and** as fresh as BDS's own saving.
  Tiles that just redrew also respect `TILE_UPDATE_COOLDOWN` so busy areas are not
  redrawn on every save. The browser only fetches new tiles after pan/zoom settles.
- Every refresh that finds a change scans the whole chunk list, so cost grows with world size.
- Grass / foliage / water use per-biome tints from Data3D when available (client
  biome colours / climate colormaps). Wipe `MAP_CACHE/tiles` after upgrading so
  old plains-green tiles redraw.
- Player tracking needs the Beta APIs experiment and a dedicated server.
- Positions can be a few seconds behind the player.
- Simulated GameTest players are skipped; real players are unaffected.

After a colour or shading change, walk through
[`docs/terrain-visual-checklist.md`](docs/terrain-visual-checklist.md).

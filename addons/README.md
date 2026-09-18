# Bedrock Map player tracker (behaviour pack)

`bedrock-map-player-tracker` runs on **Bedrock Dedicated Server** and POSTs the position of every
online player to the map server every three seconds. It reads player state through the official Script
API and writes nothing to the world.

```
BDS Script API -> POST /api/players -> map server (in memory) -> browser markers
```

Only the position of currently online players is sent. There is no history, no statistics and nothing
is stored on disk.

## Requirements

- Bedrock **Dedicated** Server. `@minecraft/server-net` does not exist in the game client or on
  Realms, so this pack only works on a dedicated server.
- The **Beta APIs** experiment enabled on the world, because `@minecraft/server-net` and
  `@minecraft/server-admin` are pre-release modules.
- `@minecraft/server-net` added to the allowed modules; it is not allowed by default.

Verified against BDS **1.26.51.1** with `@minecraft/server` `2.4.0-beta`, `@minecraft/server-net`
`1.0.0-beta` and `@minecraft/server-admin` `1.0.0-beta`.

## Install

Paths below are relative to your BDS directory, and `<world>` is your `level-name`
(`Bedrock level` by default).

1. **Copy the pack** into the server:

   ```bash
   cp -r addons/bedrock-map-player-tracker "/path/to/bds/behavior_packs/"
   ```

2. **Enable it on the world**, in `worlds/<world>/world_behavior_packs.json`. Create the file if it
   does not exist; the `pack_id` is the pack's header UUID and the version is its header version:

   ```json
   [
     {
       "pack_id": "6abf84b2-7bdb-4ab5-8eac-193f4c903bb9",
       "version": [0, 1, 0]
     }
   ]
   ```

3. **Allow the networking module.** Copy the shipped permissions file to a folder named after the
   pack's *script module* UUID:

   ```bash
   mkdir -p "/path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add"
   cp addons/bedrock-map-player-tracker/config/permissions.json \
      "/path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add/"
   ```

   Per-pack permissions are preferred over editing `config/default/permissions.json`, so no other
   pack gains HTTP access.

4. **Set the API key and endpoint** in that same folder. `secrets.json` holds the key, which the
   server keeps out of the script itself; `variables.json` holds the non-secret settings:

   ```bash
   cp addons/bedrock-map-player-tracker/config/{secrets.json,variables.json} \
      "/path/to/bds/config/46c4ccc2-f4a5-48c1-9f29-b3460e2e7add/"
   ```

   Then edit them:

   ```json
   // secrets.json - must match API_KEY in the map server's .env
   { "mapApiKey": "your-api-key" }
   ```

   ```json
   // variables.json
   {
     "mapEndpoint": "http://127.0.0.1:3000/api/players",
     "mapIntervalTicks": 60
   }
   ```

   `mapIntervalTicks` is in ticks: 20 ticks is one second, so 60 is every three seconds.

5. **Enable the Beta APIs experiment** on the world. A client can toggle it in the world settings.
   On a headless server, set the `gametest` byte inside the `experiments` compound of
   `worlds/<world>/level.dat` (also set `experiments_ever_used` and
   `saved_with_toggled_experiments`). Stop the server before editing.

6. **Restart BDS.** The console should show:

   ```
   [bedrock-map] player tracker reporting to http://127.0.0.1:3000/api/players every 60 ticks (API key from secret)
   ```

## Checking it works

```bash
curl -s localhost:3000/api/players
```

With one player online you get something like:

```json
{
  "players": [
    { "name": "Daniel", "id": "-4294967294", "x": 1234.5, "y": 68, "z": -543.2, "dimension": "overworld" }
  ],
  "updatedAt": "2026-09-17T20:31:04.512Z",
  "stale": false,
  "ageMs": 240,
  "timeoutMs": 10000
}
```

If the map server answers 401, the key in `secrets.json` does not match `API_KEY` in `.env`. If
nothing arrives at all, check the BDS console: a missing Beta APIs experiment or missing module
permission is reported there when the world loads.

## Notes and limits

- The key is sent as `X-Api-Key`. A `SecretString` from the Script API cannot be concatenated into an
  `Authorization: Bearer <key>` value, only passed as a complete header value; the map server accepts
  either header.
- Keep `mapEndpoint` on localhost or a private network. BDS's HTTP client should not be pointed at
  the public internet, and the map server's player endpoint should not be exposed there either.
- Players in the Nether or the End are still reported, with their dimension, but the map only draws
  Overworld players for now.
- A missed update is harmless: the next one replaces the whole list. If updates stop for longer than
  `PLAYER_DATA_TIMEOUT`, the map drops every marker rather than showing players who may have left.

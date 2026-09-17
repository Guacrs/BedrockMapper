/**
 * Bedrock Map player tracker.
 *
 * Runs inside Bedrock Dedicated Server and POSTs the position of every online
 * player to the map server every few seconds. It only reads player state - it
 * changes nothing in the world.
 *
 *   BDS Script API -> HTTP POST /api/players -> map server (memory) -> browser
 *
 * Configuration comes from the server's own script config, not from this file;
 * see addons/README.md. Defaults point at a map server on the same machine.
 */

import { system, world } from '@minecraft/server';
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from '@minecraft/server-net';

const DEFAULTS = {
  /** Map server endpoint. Keep this on localhost. */
  endpoint: 'http://127.0.0.1:3000/api/players',
  /** 20 ticks is one second, so 60 ticks is roughly every 3 seconds. */
  intervalTicks: 60,
  /** Seconds before a request is abandoned; well under the update interval. */
  timeoutSeconds: 2,
};

/**
 * Server variables and secrets live in `config/<script module uuid>/` on the
 * server. They are optional: without them the defaults above are used and the
 * request goes out unauthenticated, which the map server will reject.
 *
 * `@minecraft/server-admin` is imported lazily because a server that does not
 * allow the module should still load this script and report why.
 */
async function loadConfig() {
  const config = { ...DEFAULTS, apiKey: null, apiKeySource: 'none' };
  let admin;
  try {
    admin = await import('@minecraft/server-admin');
  } catch (error) {
    console.warn(
      `[bedrock-map] @minecraft/server-admin is not available (${error}); ` +
        'using built-in defaults and no API key',
    );
    return config;
  }

  const { variables, secrets } = admin;
  const variable = (name) => {
    try {
      return variables.get(name);
    } catch {
      return undefined;
    }
  };

  const endpoint = variable('mapEndpoint');
  if (typeof endpoint === 'string' && endpoint) config.endpoint = endpoint;

  const interval = variable('mapIntervalTicks');
  if (typeof interval === 'number' && interval >= 20) config.intervalTicks = Math.floor(interval);

  // A secret keeps the key out of the pack and out of the script's reach: it
  // stays a SecretString and is only resolved when the header goes out.
  try {
    const secret = secrets.get('mapApiKey');
    if (secret) {
      config.apiKey = secret;
      config.apiKeySource = 'secret';
      return config;
    }
  } catch {
    // No secrets.json, or the server does not allow secrets. Fall through.
  }

  const plain = variable('mapApiKey');
  if (typeof plain === 'string' && plain) {
    config.apiKey = plain;
    config.apiKeySource = 'variable';
  }
  return config;
}

/**
 * The payload the map server expects.
 *
 * A player can be mid-join or mid-leave when the interval fires, so an entry
 * that cannot be read is skipped rather than losing the whole update.
 */
function collectPlayers() {
  const round = (value) => Math.round(value * 100) / 100;
  const players = [];
  let skipped = 0;

  for (const player of world.getAllPlayers()) {
    try {
      const { x, y, z } = player.location;
      players.push({
        name: player.name,
        // Stable for the whole session, so a marker survives a name change.
        id: String(player.id),
        x: round(x),
        y: round(y),
        z: round(z),
        dimension: player.dimension.id,
      });
    } catch {
      skipped++;
    }
  }

  return { players, skipped };
}

async function start() {
  const config = await loadConfig();
  console.log(
    `[bedrock-map] player tracker reporting to ${config.endpoint} every ${config.intervalTicks} ticks ` +
      `(API key from ${config.apiKeySource})`,
  );
  if (!config.apiKey) {
    console.warn(
      '[bedrock-map] no API key configured; the map server will reject these updates. ' +
        'Add mapApiKey to the pack\'s secrets.json or variables.json.',
    );
  }

  let inFlight = false;
  let consecutiveFailures = 0;
  let reportedSkips = 0;

  const report = async () => {
    // Never queue up requests: a slow map server must not build a backlog.
    if (inFlight) return;
    inFlight = true;
    try {
      const { players, skipped } = collectPlayers();
      if (skipped && reportedSkips < 3) {
        reportedSkips++;
        console.warn(`[bedrock-map] skipped ${skipped} player(s) whose state could not be read this tick`);
      }
      const request = new HttpRequest(config.endpoint)
        .setMethod(HttpRequestMethod.Post)
        .setBody(JSON.stringify({ players }))
        .setTimeout(config.timeoutSeconds);

      const headers = [new HttpHeader('Content-Type', 'application/json')];
      if (config.apiKey) {
        // A SecretString cannot be concatenated into "Bearer <key>", so the
        // key travels in its own header, which the map server also accepts.
        headers.push(new HttpHeader('X-Api-Key', config.apiKey));
      }
      request.setHeaders(headers);

      const response = await http.request(request);
      if (response.status >= 200 && response.status < 300) {
        if (consecutiveFailures) {
          console.log(`[bedrock-map] map server reachable again after ${consecutiveFailures} failure(s)`);
        }
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        // Log the first failure and then only occasionally, so a map server
        // that is down does not flood the console.
        if (consecutiveFailures === 1 || consecutiveFailures % 20 === 0) {
          console.warn(
            `[bedrock-map] map server answered HTTP ${response.status}: ${String(response.body).slice(0, 200)}`,
          );
        }
      }
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures === 1 || consecutiveFailures % 20 === 0) {
        console.warn(`[bedrock-map] could not reach the map server: ${error}`);
      }
    } finally {
      inFlight = false;
    }
  };

  system.runInterval(() => {
    void report();
  }, config.intervalTicks);
  void report();
}

// Player positions are only available once the world is up.
system.run(() => {
  void start().catch((error) => {
    console.error(`[bedrock-map] player tracker failed to start: ${error}`);
  });
});

/**
 * Map server: serves the browser map, its assets and the terrain tiles.
 *
 * Read-only with respect to the Minecraft world - everything goes through the
 * snapshot copy created by the world reader.
 */

import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCache, cleanupHappened } from './cache.ts';
import { ConfigError, configWarnings, describeConfig, loadConfig, type Config } from './config.ts';
import { createLogger, silentLogger, type Logger } from './log.ts';
import { MapService, type RefreshStats } from './map-service.ts';
import { JsonMarkerStore, MarkerConflictError, MarkerNotFoundError } from './markers/store.ts';
import { MarkerValidationError, parseMarkerCreate, parseMarkerPatch } from './markers/validate.ts';
import { logPlayerEvent, PlayerActivity } from './players/activity.ts';
import { PlayerStore, PlayerValidationError, parsePlayerUpdate } from './players/store.ts';
import { checkEnvironment, formatProblems } from './startup.ts';
import { hashFallbackNames, summarizeDatabase } from './renderer/block-palette.ts';
import { NATIVE_ZOOM } from './tiles/coords.ts';
import { dimensionById } from './world/dimensions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const WEB_ROOT = path.join(projectRoot, 'web');
const LEAFLET_ROOT = path.join(projectRoot, 'node_modules', 'leaflet', 'dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

const TILE_PATH = /^\/tiles\/([a-z]+)\/(-?\d+)\/(-?\d+)\/(-?\d+)\.png$/;

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length });
  response.end(bytes);
}

function sendText(response: http.ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

function sendPng(response: http.ServerResponse, bytes: Uint8Array, source: string): void {
  response.writeHead(200, {
    'content-type': 'image/png',
    'content-length': bytes.length,
    'cache-control': 'no-cache',
    'x-tile-source': source,
  });
  response.end(Buffer.from(bytes));
}

/** Serves a file from a fixed root, refusing anything that escapes it. */
async function sendFile(
  response: http.ServerResponse,
  root: string,
  relativePath: string,
): Promise<boolean> {
  const target = path.resolve(root, `.${path.posix.normalize(`/${relativePath}`)}`);
  if (target !== root && !target.startsWith(root + path.sep)) return false;

  const bytes = await fs.readFile(target).catch(() => null);
  if (!bytes) return false;

  response.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
    'content-length': bytes.length,
    'cache-control': 'no-cache',
  });
  response.end(bytes);
  return true;
}

/** Player updates are tiny; anything larger is a mistake or an attack. */
const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Compares secrets without leaking their length through timing. */
function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Reads the shared secret from `Authorization: Bearer <key>`, or from
 * `X-Api-Key`. The second form exists because the BDS Script API hands out the
 * server's secret as an opaque `SecretString` that cannot be concatenated into
 * a "Bearer <key>" value, only passed as a whole header value.
 */
function apiKeyFrom(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1]!.trim();
  }
  const direct = request.headers['x-api-key'];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return value?.trim() ? value.trim() : null;
}

/**
 * How often the browser asks whether the terrain changed. Matches the server's
 * refresh interval (clamped), so an idle tab is not polling twice as often as
 * the world can possibly change. Zero when refreshing is switched off, which
 * tells the browser not to poll at all.
 */
export function terrainPollInterval(worldRefreshInterval: number): number {
  if (worldRefreshInterval <= 0) return 0;
  return Math.max(5_000, Math.min(120_000, worldRefreshInterval));
}

/** The URL printed at startup: loopback when the server is bound to every interface. */
export function listenUrl(host: string, port: number): string {
  const display = host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
  const wrapped = display.includes(':') && !display.startsWith('[') ? `[${display}]` : display;
  return `http://${wrapped}:${port}`;
}

/** One line summarising what a terrain refresh did, for the server log. */
export function describeRefresh(stats: RefreshStats): string | null {
  if (stats.error) return `terrain refresh failed: ${stats.error}`;
  if (!stats.sourceChanged) return null;
  const changed = stats.addedChunks + stats.changedChunks + stats.removedChunks;
  if (!changed) {
    return `world files changed but no chunk did (${Math.round(stats.totalMs)} ms)`;
  }
  return (
    `terrain updated: ${changed} chunks (${stats.addedChunks} new, ${stats.changedChunks} changed, ` +
    `${stats.removedChunks} gone), ${stats.tilesInvalidated} tiles invalidated` +
    (stats.tilesSkippedCooldown
      ? ` (${stats.tilesSkippedCooldown} still cooling down)`
      : '') +
    `, ${stats.tilesRegenerated} redrawn, ${stats.tilesChanged} of them different, ` +
    `map version ${stats.version}, ${Math.round(stats.totalMs)} ms`
  );
}

function logRefresh(log: Logger, stats: RefreshStats): void {
  if (stats.error) {
    log.warn('terrain.refresh_failed', {
      error: stats.error,
      failures: undefined,
      ms: Math.round(stats.totalMs),
    });
    return;
  }
  if (!stats.sourceChanged) {
    log.debug('terrain.unchanged', { ms: Math.round(stats.totalMs) });
    return;
  }
  const chunks = stats.addedChunks + stats.changedChunks + stats.removedChunks;
  if (!chunks) {
    log.info('terrain.files_changed', { ms: Math.round(stats.totalMs) });
    return;
  }
  log.info('terrain.updated', {
    chunks,
    added: stats.addedChunks,
    changed: stats.changedChunks,
    removed: stats.removedChunks,
    tilesInvalidated: stats.tilesInvalidated,
    tilesSkippedCooldown: stats.tilesSkippedCooldown,
    redrawn: stats.tilesRegenerated,
    tilesChanged: stats.tilesChanged,
    version: stats.version,
    ms: Math.round(stats.totalMs),
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface HealthInfo {
  status: 'ok' | 'degraded';
  world: string;
  worldVersion: string | null;
  mapVersion: number;
  lastWorldRefresh: string | null;
  playerDataAge: number | null;
}

export interface StartedServer {
  server: http.Server;
  map: MapService;
  players: PlayerStore;
  markers: JsonMarkerStore;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  log?: Logger;
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`PORT ${port} is already in use on ${host}. Choose a free PORT.`));
      } else if (error.code === 'EADDRNOTAVAIL') {
        reject(new Error(`HOST ${host} is not an address on this machine.`));
      } else {
        reject(error);
      }
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeHttp(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const force = setTimeout(() => {
      server.closeAllConnections();
    }, 2000);
    force.unref();
    server.close((error) => {
      clearTimeout(force);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

export async function startServer(config: Config, options: StartServerOptions = {}): Promise<StartedServer> {
  const log = options.log ?? silentLogger;
  const map = await MapService.create({
    worldPath: config.worldPath,
    cacheDir: config.cacheDir,
    tileUpdateCooldownMs: config.tileUpdateCooldown,
    refreshRenderConcurrency: config.refreshRenderConcurrency,
    log,
  });
  const players = new PlayerStore(config.playerDataTimeout);
  const markers = new JsonMarkerStore(config.cacheDir, {
    onInvalid: (message) => log.warn('markers.invalid', { message }),
  });
  await markers.ready();
  const activity = new PlayerActivity(config.playerDataTimeout);
  const snapshot = map.world.snapshot;

  const swept = await cleanCache(config.cacheDir, {
    worldPath: config.worldPath,
    keepSourceIds: [snapshot.sourceId],
  });
  if (cleanupHappened(swept)) {
    log.info('cache.cleaned', {
      snapshots: swept.snapshotsRemoved.length,
      tempFiles: swept.tempFilesRemoved,
      bytes: swept.bytesFreed,
    });
  }

  log.info('world.detected', {
    name: map.info.world.name || '(unnamed)',
    version: map.info.world.version,
    chunks: map.info.chunkCount,
    sourceId: snapshot.sourceId,
  });
  log.info('snapshot.ready', {
    copied: snapshot.copied,
    files: snapshot.fileCount,
    bytes: snapshot.byteCount,
    ms: Math.round(snapshot.copyMs),
  });

  let closing = false;
  const server = http.createServer((request, response) => {
    if (closing) {
      sendText(response, 503, 'shutting down');
      return;
    }
    void handle(request, response).catch((error: unknown) => {
      log.error('request.failed', { path: request.url, error: message(error) });
      if (!response.headersSent) sendText(response, 500, 'internal error');
      else response.end();
    });
  });

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === 'POST' && pathname === '/api/players') {
      await handlePlayerUpdate(request, response);
      return;
    }

    if (await handleMarkerRequest(request, response, pathname)) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed');
      return;
    }

    if (pathname === '/api/health') {
      const playerState = players.snapshot();
      const degraded = map.consecutiveRefreshFailures > 0;
      sendJson(response, 200, {
        status: degraded ? 'degraded' : 'ok',
        world: map.info.world.name || 'world',
        worldVersion: map.info.world.version,
        mapVersion: map.version,
        lastWorldRefresh: map.lastRefresh?.at ?? null,
        playerDataAge: playerState.ageMs,
      } satisfies HealthInfo);
      return;
    }

    if (pathname === '/api/debug/block-colors') {
      const summary = summarizeDatabase();
      sendJson(response, 200, {
        ...summary,
        hashFallbacksSeen: hashFallbackNames(),
      });
      return;
    }

    if (pathname === '/api/map/info') {
      sendJson(response, 200, {
        ...map.info,
        version: map.version,
        worldRefreshInterval: config.worldRefreshInterval,
        terrainPollInterval: terrainPollInterval(config.worldRefreshInterval),
        playerPollInterval: config.playerUpdateInterval,
        playerDataTimeout: config.playerDataTimeout,
      });
      return;
    }

    // What the browser polls to notice terrain changes: small, cheap, and
    // enough to rebuild the tile URLs and the extent readout.
    if (pathname === '/api/map/state') {
      sendJson(response, 200, {
        ...map.state,
        worldRefreshInterval: config.worldRefreshInterval,
        lastRefresh: map.lastRefresh,
        consecutiveRefreshFailures: map.consecutiveRefreshFailures,
        refreshError: map.lastRefresh?.error ?? null,
        lastWorldRefresh: map.lastRefresh?.at ?? null,
      });
      return;
    }

    if (pathname === '/api/players') {
      sendJson(response, 200, players.snapshot(url.searchParams.get('dimension') ?? undefined));
      return;
    }

    const tile = TILE_PATH.exec(pathname);
    if (tile) {
      const [, dimensionId, zoom, x, y] = tile;
      try {
        dimensionById(dimensionId!);
      } catch {
        sendText(response, 404, 'unknown dimension');
        return;
      }
      if (Number(zoom) !== NATIVE_ZOOM) {
        sendText(response, 404, `only zoom ${NATIVE_ZOOM} is rendered`);
        return;
      }
      try {
        const result = await map.tile(dimensionId as never, Number(zoom), Number(x), Number(y));
        sendPng(response, result.bytes, result.empty ? 'empty' : result.cached ? 'cache' : 'rendered');
      } catch (error) {
        // A failed render must not punch a hole in the map: serve a transparent
        // tile so the last good neighbouring terrain stays on screen.
        log.warn('tile.failed', {
          tile: `${dimensionId}/${zoom}/${x}/${y}`,
          error: message(error),
        });
        sendPng(response, map.emptyTile, 'error');
      }
      return;
    }

    if (pathname.startsWith('/vendor/leaflet/')) {
      if (await sendFile(response, LEAFLET_ROOT, pathname.slice('/vendor/leaflet/'.length))) return;
      sendText(response, 404, 'not found');
      return;
    }

    if (await sendFile(response, WEB_ROOT, pathname === '/' ? 'index.html' : pathname)) return;
    sendText(response, 404, 'not found');
  }

  /**
   * Accepts one player-position report from the BDS addon and replaces the
   * in-memory list with it. Nothing is written to disk.
   */
  async function handlePlayerUpdate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!config.apiKey) {
      sendJson(response, 503, {
        error: 'API_KEY is not configured, so player updates are refused. Set it in .env.',
      });
      return;
    }

    const token = apiKeyFrom(request);
    if (!token) {
      response.setHeader('www-authenticate', 'Bearer');
      sendJson(response, 401, {
        error: 'missing "Authorization: Bearer <API_KEY>" or "X-Api-Key: <API_KEY>" header',
      });
      return;
    }
    if (!secretsMatch(config.apiKey, token)) {
      sendJson(response, 401, { error: 'invalid API key' });
      return;
    }

    let raw: string;
    try {
      raw = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) sendJson(response, 413, { error: error.message });
      else sendJson(response, 400, { error: 'could not read request body' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(response, 400, { error: 'body is not valid JSON' });
      return;
    }

    try {
      const update = parsePlayerUpdate(parsed);
      players.replace(update);
      for (const event of activity.record(update)) logPlayerEvent(log, event);
      sendJson(response, 200, { ok: true, players: update.length });
    } catch (error) {
      if (error instanceof PlayerValidationError) sendJson(response, 400, { error: error.message });
      else throw error;
    }
  }

  /**
   * Shared map markers. GET is public; create / update / delete need the API key.
   * Returns true when the path was a marker route (including 404/405 on that route).
   */
  async function handleMarkerRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const markerMatch = /^\/api\/markers(?:\/([^/]+))?$/.exec(pathname);
    if (!markerMatch) return false;
    const id = markerMatch[1] ? decodeURIComponent(markerMatch[1]) : null;
    const method = request.method ?? 'GET';

    if (method === 'GET' || method === 'HEAD') {
      if (id) {
        const marker = await markers.get(id);
        if (!marker) {
          sendJson(response, 404, { error: 'marker not found' });
          return true;
        }
        sendJson(response, 200, marker);
        return true;
      }
      sendJson(response, 200, { markers: await markers.list() });
      return true;
    }

    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      if (!requireMarkerAuth(request, response)) return true;
    } else {
      sendText(response, 405, 'method not allowed');
      return true;
    }

    if (method === 'POST') {
      if (id) {
        sendText(response, 405, 'method not allowed');
        return true;
      }
      const body = await readJsonBody(request, response);
      if (body === undefined) return true;
      try {
        const created = await markers.create(parseMarkerCreate(body));
        sendJson(response, 201, created);
      } catch (error) {
        if (error instanceof MarkerValidationError) sendJson(response, 400, { error: error.message });
        else if (error instanceof MarkerConflictError) sendJson(response, 409, { error: error.message });
        else throw error;
      }
      return true;
    }

    if (!id) {
      sendText(response, 405, 'method not allowed');
      return true;
    }

    if (method === 'DELETE') {
      const removed = await markers.delete(id);
      if (!removed) {
        sendJson(response, 404, { error: 'marker not found' });
        return true;
      }
      sendJson(response, 200, { ok: true, id });
      return true;
    }

    // PATCH
    const body = await readJsonBody(request, response);
    if (body === undefined) return true;
    try {
      const updated = await markers.update(id, parseMarkerPatch(body));
      sendJson(response, 200, updated);
    } catch (error) {
      if (error instanceof MarkerValidationError) sendJson(response, 400, { error: error.message });
      else if (error instanceof MarkerNotFoundError) sendJson(response, 404, { error: error.message });
      else throw error;
    }
    return true;
  }

  function requireMarkerAuth(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    if (!config.markerApiKey) {
      sendJson(response, 503, {
        error: 'MARKER_API_KEY is not configured, so marker edits are refused. Set it in .env.',
      });
      return false;
    }
    const token = apiKeyFrom(request);
    if (!token) {
      response.setHeader('www-authenticate', 'Bearer');
      sendJson(response, 401, {
        error: 'missing "Authorization: Bearer <MARKER_API_KEY>" or "X-Api-Key: <MARKER_API_KEY>" header',
      });
      return false;
    }
    if (!secretsMatch(config.markerApiKey, token)) {
      sendJson(response, 401, { error: 'invalid API key' });
      return false;
    }
    return true;
  }

  async function readJsonBody(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<unknown | undefined> {
    let raw: string;
    try {
      raw = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) sendJson(response, 413, { error: error.message });
      else sendJson(response, 400, { error: 'could not read request body' });
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      sendJson(response, 400, { error: 'body is not valid JSON' });
      return undefined;
    }
  }

  await listen(server, config.port, config.host);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  const refreshTimer =
    config.worldRefreshInterval > 0
      ? setInterval(() => {
          void map.refresh().then((stats) => {
            logRefresh(log, stats);
            if (stats.error) return;
            void cleanCache(config.cacheDir, {
              worldPath: config.worldPath,
              keepSourceIds: [map.world.snapshot.sourceId],
            }).then((result) => {
              if (cleanupHappened(result)) {
                log.info('cache.cleaned', {
                  snapshots: result.snapshotsRemoved.length,
                  tempFiles: result.tempFilesRemoved,
                  bytes: result.bytesFreed,
                });
              }
            });
          });
        }, config.worldRefreshInterval).unref()
      : null;

  const staleTimer = setInterval(() => {
    for (const event of activity.poll()) logPlayerEvent(log, event);
  }, Math.max(1000, Math.round(config.playerDataTimeout / 2))).unref();

  let closed: Promise<void> | null = null;
  const close = async (): Promise<void> => {
    if (closed) return closed;
    closed = (async () => {
      closing = true;
      log.info('shutdown.begin', { host: config.host, port });
      if (refreshTimer) clearInterval(refreshTimer);
      clearInterval(staleTimer);
      await closeHttp(server);
      const keepSourceIds = [map.world.snapshot.sourceId];
      await map.close();
      const result = await cleanCache(config.cacheDir, {
        worldPath: config.worldPath,
        keepSourceIds,
        tempGraceMs: 0,
      });
      if (cleanupHappened(result)) {
        log.info('cache.cleaned', {
          snapshots: result.snapshotsRemoved.length,
          tempFiles: result.tempFilesRemoved,
          bytes: result.bytesFreed,
        });
      }
      log.info('shutdown.complete');
    })();
    return closed;
  };

  return { server, map, players, markers, host: config.host, port, close };
}

function logStartup(log: Logger, config: Config, started: StartedServer): void {
  const info = started.map.info;
  const url = listenUrl(config.host, started.port);
  log.info('startup.listening', {
    url,
    host: config.host,
    port: started.port,
  });
  log.plain(`Bedrock map server on ${url}`);
  log.plain(`  world:      ${config.worldPath} (${info.world.version ?? 'unknown version'})`);
  log.plain(`  snapshot:   ${started.map.world.snapshot.dbPath}`);
  log.plain(
    `  tile cache: ${started.map.tileCache.root}${started.map.tileCache.clearedStaleTiles ? ' (cleared, world changed)' : ''}`,
  );
  log.plain(`  chunks:     ${info.chunkCount} with block data`);
  if (info.blockBounds && info.center) {
    log.plain(
      `  extent:     block X ${info.blockBounds.minX}..${info.blockBounds.maxX}, ` +
        `Z ${info.blockBounds.minZ}..${info.blockBounds.maxZ}, centre ${info.center.x},${info.center.z}`,
    );
  } else {
    log.plain('  extent:     no chunks with block data found');
  }
  log.plain(
    `  players:    POST /api/players ${config.apiKey ? 'requires the API key from your .env' : 'DISABLED - set API_KEY in .env'}` +
      `, stale after ${config.playerDataTimeout} ms, browser polls every ${config.playerUpdateInterval} ms`,
  );
  log.plain(
    `  markers:    GET /api/markers (public); create/update/delete ${
      config.markerApiKey ? 'require MARKER_API_KEY' : 'DISABLED - set MARKER_API_KEY in .env'
    }, stored in ${started.markers.filePath}`,
  );
  log.plain(
    `  terrain:    ${
      config.worldRefreshInterval > 0
        ? `checked every ${config.worldRefreshInterval} ms, browser polls every ${terrainPollInterval(config.worldRefreshInterval)} ms` +
          `, tile cooldown ${config.tileUpdateCooldown} ms, redraw concurrency ${config.refreshRenderConcurrency}`
        : 'automatic refresh DISABLED (WORLD_REFRESH_INTERVAL=0)'
    }`,
  );
  if (config.host === '0.0.0.0' || config.host === '::') {
    log.plain(`  bind:       ${config.host} (reachable from other machines; there is no login)`);
  }
}

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  log?: Logger;
}

/**
 * Production startup: validate the configuration, check the world is readable,
 * then serve the map. Throws after printing a human-readable error; the CLI
 * entry point turns that into an exit code.
 */
export async function main(options: MainOptions = {}): Promise<StartedServer> {
  const env = options.env ?? process.env;
  let config: Config;
  try {
    config = loadConfig({}, env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(formatProblems(error.problems));
    } else {
      console.error(`BedrockMapper cannot start: ${message(error)}`);
    }
    throw error;
  }

  const report = await checkEnvironment(config, { webRoot: WEB_ROOT, leafletRoot: LEAFLET_ROOT });
  if (report.problems.length) {
    console.error(formatProblems(report.problems));
    throw new ConfigError(report.problems);
  }

  const log = options.log ?? createLogger({ level: config.logLevel });
  log.info('startup.begin', describeConfig(config));
  for (const warning of [...configWarnings(config), ...report.warnings]) {
    log.warn('config.warning', { msg: warning });
  }

  try {
    const started = await startServer(config, { log });
    logStartup(log, config, started);
    return started;
  } catch (error) {
    log.error('startup.failed', { error: message(error) });
    console.error(`BedrockMapper cannot start: ${message(error)}`);
    throw error;
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  try {
    const started = await main();
    let stopping = false;
    const onSignal = (signal: NodeJS.Signals) => {
      if (stopping) return;
      stopping = true;
      void started.close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(`shutdown failed: ${message(error)}`);
          process.exit(1);
        },
      );
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('unhandledRejection', (reason) => {
      console.error(`unhandled rejection (server keeps running): ${message(reason)}`);
    });
  } catch {
    process.exit(1);
  }
}

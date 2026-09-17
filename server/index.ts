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
import { loadConfig, type Config } from './config.ts';
import { MapService } from './map-service.ts';
import { PlayerStore, PlayerValidationError, parsePlayerUpdate } from './players/store.ts';
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

/** Reads the shared secret from `Authorization: Bearer <key>`. */
function bearerToken(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

export interface StartedServer {
  server: http.Server;
  map: MapService;
  players: PlayerStore;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(config: Config): Promise<StartedServer> {
  const map = await MapService.create({ worldPath: config.worldPath, cacheDir: config.cacheDir });
  const players = new PlayerStore(config.playerDataTimeout);

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('request failed:', error);
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

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed');
      return;
    }

    if (pathname === '/api/map/info') {
      sendJson(response, 200, {
        ...map.info,
        playerPollInterval: config.playerUpdateInterval,
        playerDataTimeout: config.playerDataTimeout,
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
      try {
        const result = await map.tile(dimensionId as never, Number(zoom), Number(x), Number(y));
        response.writeHead(200, {
          'content-type': 'image/png',
          'content-length': result.bytes.length,
          'cache-control': 'no-cache',
          'x-tile-source': result.empty ? 'empty' : result.cached ? 'cache' : 'rendered',
        });
        response.end(Buffer.from(result.bytes));
      } catch (error) {
        sendText(response, 404, error instanceof Error ? error.message : 'tile not available');
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

    const token = bearerToken(request);
    if (!token) {
      response.setHeader('www-authenticate', 'Bearer');
      sendJson(response, 401, { error: 'missing Authorization: Bearer <API_KEY> header' });
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
      sendJson(response, 200, { ok: true, players: update.length });
    } catch (error) {
      if (error instanceof PlayerValidationError) sendJson(response, 400, { error: error.message });
      else throw error;
    }
  }

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    server,
    map,
    players,
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await map.close();
    },
  };
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const config = loadConfig();
  const started = await startServer(config);
  const info = started.map.info;
  console.log(`Bedrock map server on http://localhost:${started.port}`);
  console.log(`  world:      ${config.worldPath} (${info.world.version ?? 'unknown version'})`);
  console.log(`  snapshot:   ${started.map.world.snapshot.dbPath}`);
  console.log(`  tile cache: ${started.map.tileCache.root}${started.map.tileCache.clearedStaleTiles ? ' (cleared, world changed)' : ''}`);
  console.log(`  chunks:     ${info.chunkCount} with block data`);
  if (info.blockBounds && info.center) {
    console.log(
      `  extent:     block X ${info.blockBounds.minX}..${info.blockBounds.maxX}, ` +
        `Z ${info.blockBounds.minZ}..${info.blockBounds.maxZ}, centre ${info.center.x},${info.center.z}`,
    );
  } else {
    console.log('  extent:     no chunks with block data found');
  }
  console.log(
    `  players:    POST /api/players ${config.apiKey ? 'requires the API key from your .env' : 'DISABLED - set API_KEY in .env'}` +
      `, stale after ${config.playerDataTimeout} ms, browser polls every ${config.playerUpdateInterval} ms`,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void started.close().then(() => process.exit(0));
    });
  }
}

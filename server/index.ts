/**
 * Map server: serves the browser map, its assets and the terrain tiles.
 *
 * Read-only with respect to the Minecraft world - everything goes through the
 * snapshot copy created by the world reader.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.ts';
import { MapService } from './map-service.ts';
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

export interface StartedServer {
  server: http.Server;
  map: MapService;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(config: Config): Promise<StartedServer> {
  const map = await MapService.create({ worldPath: config.worldPath, cacheDir: config.cacheDir });

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('request failed:', error);
      if (!response.headersSent) sendText(response, 500, 'internal error');
      else response.end();
    });
  });

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed');
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/map/info') {
      sendJson(response, 200, map.info);
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

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    server,
    map,
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

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void started.close().then(() => process.exit(0));
    });
  }
}

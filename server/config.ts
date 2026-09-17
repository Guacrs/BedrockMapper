/**
 * Configuration from the environment (see .env.example).
 * `.env` is loaded with Node's built-in loader, so there is no dotenv dependency.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  worldPath: string;
  port: number;
  cacheDir: string;
  /** How often the browser polls for player positions, milliseconds. */
  playerUpdateInterval: number;
  /** After this long without a player update the list is treated as unavailable. */
  playerDataTimeout: number;
  /** Shared secret required by POST /api/players. */
  apiKey: string;
}

let envLoaded = false;

export function loadEnv(envPath = '.env'): void {
  if (envLoaded) return;
  envLoaded = true;
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadEnv();
  const worldPath = overrides.worldPath ?? process.env.WORLD_PATH ?? '';
  if (!worldPath) {
    throw new Error('WORLD_PATH is not set. Copy .env.example to .env and point it at your world.');
  }
  return {
    worldPath: path.resolve(worldPath),
    port: overrides.port ?? number(process.env.PORT, 3000),
    cacheDir: path.resolve(overrides.cacheDir ?? process.env.MAP_CACHE ?? './cache'),
    playerUpdateInterval:
      overrides.playerUpdateInterval ?? number(process.env.PLAYER_UPDATE_INTERVAL, 3000),
    playerDataTimeout: overrides.playerDataTimeout ?? number(process.env.PLAYER_DATA_TIMEOUT, 10000),
    apiKey: overrides.apiKey ?? process.env.API_KEY ?? '',
  };
}

/**
 * Configuration from the environment (see .env.example).
 *
 * `.env` is read with Node's built-in loader, so there is no dotenv dependency.
 * Every setting is parsed strictly: a value that is set but unusable is an error
 * with a sentence saying what to do about it, never a silent fallback that makes
 * a production server behave differently from its configuration file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLogLevel, type LogLevel } from './log.ts';

export interface Config {
  /** The BDS world directory: the folder containing db/ and level.dat. */
  worldPath: string;
  /** Interface to bind to. Local-only by default. */
  host: string;
  port: number;
  /** Where snapshots and rendered tiles live. */
  cacheDir: string;
  /** How often the live world is checked for changes, milliseconds. 0 disables. */
  worldRefreshInterval: number;
  /** How often the browser polls for player positions, milliseconds. */
  playerUpdateInterval: number;
  /** After this long without a player update the list is treated as unavailable. */
  playerDataTimeout: number;
  /** Shared secret required by POST /api/players. Empty disables the endpoint. */
  apiKey: string;
  logLevel: LogLevel;
}

export const DEFAULTS = {
  host: '127.0.0.1',
  port: 3000,
  cacheDir: './cache',
  worldRefreshInterval: 30_000,
  playerUpdateInterval: 3_000,
  playerDataTimeout: 10_000,
  logLevel: 'info' as LogLevel,
};

/** Refreshing faster than this hammers the disk for no visible benefit. */
const MIN_REFRESH_INTERVAL = 1_000;
const MIN_PLAYER_INTERVAL = 500;
const MIN_PLAYER_TIMEOUT = 1_000;

/** Placeholder from .env.example; a real deployment must replace it. */
const EXAMPLE_API_KEY = 'change-this';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything wrong with the configuration, reported in one go. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

let envLoaded = false;

/**
 * Loads `.env` from the working directory, or from the installation directory
 * when the server is started from somewhere else (a systemd unit, an init
 * script). Existing environment variables always win.
 */
export function loadEnv(envPath?: string): string | null {
  if (envLoaded && !envPath) return null;
  envLoaded = true;
  const candidates = envPath ? [envPath] : [path.resolve('.env'), path.join(projectRoot, '.env')];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    return candidate;
  }
  return null;
}

interface Parser {
  problems: string[];
  integer(name: string, fallback: number, options?: { min?: number; max?: number; allowZero?: boolean }): number;
}

function createParser(env: NodeJS.ProcessEnv): Parser {
  const problems: string[] = [];
  return {
    problems,
    integer(name, fallback, options = {}) {
      const raw = env[name];
      if (raw === undefined || raw.trim() === '') return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        problems.push(`${name}="${raw}" is not a whole number.`);
        return fallback;
      }
      if (options.allowZero && value === 0) return 0;
      const min = options.min ?? 1;
      const max = options.max ?? Number.MAX_SAFE_INTEGER;
      if (value < min || value > max) {
        const zero = options.allowZero ? ', or 0 to switch it off' : '';
        problems.push(`${name}=${raw} is out of range: expected ${min}..${max}${zero}.`);
        return fallback;
      }
      return value;
    },
  };
}

/**
 * Builds the configuration, or throws `ConfigError` listing everything that has
 * to be fixed first. Overrides win over the environment, which is how the tests
 * and the CLI tools configure themselves.
 */
export function loadConfig(
  overrides: Partial<Config> = {},
  env: NodeJS.ProcessEnv = process.env,
): Config {
  if (env === process.env) loadEnv();
  const parse = createParser(env);

  const worldPath = overrides.worldPath ?? env.WORLD_PATH ?? '';
  if (!worldPath.trim()) {
    parse.problems.push(
      'WORLD_PATH is not set. Copy .env.example to .env and point WORLD_PATH at your ' +
        'Bedrock world directory (the folder containing db/ and level.dat).',
    );
  }

  const logLevelRaw = env.LOG_LEVEL?.trim().toLowerCase();
  if (logLevelRaw && !isLogLevel(logLevelRaw)) {
    parse.problems.push(`LOG_LEVEL="${env.LOG_LEVEL}" is not one of debug, info, warn, error.`);
  }

  const host = (overrides.host ?? env.HOST ?? DEFAULTS.host).trim();
  if (!host) parse.problems.push('HOST is empty. Use 127.0.0.1 for local access or 0.0.0.0 for every interface.');

  const config: Config = {
    worldPath: worldPath.trim() ? path.resolve(worldPath.trim()) : '',
    host,
    port: overrides.port ?? parse.integer('PORT', DEFAULTS.port, { min: 0, max: 65535, allowZero: true }),
    cacheDir: path.resolve(overrides.cacheDir ?? env.MAP_CACHE?.trim() ?? DEFAULTS.cacheDir),
    worldRefreshInterval:
      overrides.worldRefreshInterval ??
      parse.integer('WORLD_REFRESH_INTERVAL', DEFAULTS.worldRefreshInterval, {
        min: MIN_REFRESH_INTERVAL,
        allowZero: true,
      }),
    playerUpdateInterval:
      overrides.playerUpdateInterval ??
      parse.integer('PLAYER_UPDATE_INTERVAL', DEFAULTS.playerUpdateInterval, { min: MIN_PLAYER_INTERVAL }),
    playerDataTimeout:
      overrides.playerDataTimeout ??
      parse.integer('PLAYER_DATA_TIMEOUT', DEFAULTS.playerDataTimeout, { min: MIN_PLAYER_TIMEOUT }),
    apiKey: overrides.apiKey ?? env.API_KEY?.trim() ?? '',
    logLevel: overrides.logLevel ?? (logLevelRaw && isLogLevel(logLevelRaw) ? logLevelRaw : DEFAULTS.logLevel),
  };

  if (parse.problems.length) throw new ConfigError(parse.problems);
  return config;
}

/**
 * Things that are allowed but probably not what someone meant. These are logged
 * at startup and do not stop the server.
 */
export function configWarnings(config: Config): string[] {
  const warnings: string[] = [];

  if (!config.apiKey) {
    warnings.push(
      'API_KEY is not set, so POST /api/players is refused and no player markers will appear.',
    );
  } else if (config.apiKey === EXAMPLE_API_KEY) {
    warnings.push(`API_KEY is still the example value "${EXAMPLE_API_KEY}"; set your own secret.`);
  } else if (config.apiKey.length < 12) {
    warnings.push('API_KEY is very short; use a long random secret.');
  }

  if (config.host === '0.0.0.0' || config.host === '::') {
    warnings.push(
      `HOST=${config.host} exposes the map on every interface with no authentication. ` +
        'Put it behind a reverse proxy or a firewall if the machine is reachable from the internet.',
    );
  }

  if (config.worldRefreshInterval === 0) {
    warnings.push('WORLD_REFRESH_INTERVAL=0: terrain is read once at startup and never refreshed.');
  } else if (config.worldRefreshInterval < 5_000) {
    warnings.push(
      `WORLD_REFRESH_INTERVAL=${config.worldRefreshInterval} ms is aggressive; each refresh copies the ` +
        'world database and rescans its chunks.',
    );
  }

  if (config.playerDataTimeout <= config.playerUpdateInterval) {
    warnings.push(
      `PLAYER_DATA_TIMEOUT (${config.playerDataTimeout} ms) is not longer than PLAYER_UPDATE_INTERVAL ` +
        `(${config.playerUpdateInterval} ms), so markers will keep flickering out between reports.`,
    );
  }

  return warnings;
}

/** The configuration as it will be used, for the startup log. No secrets. */
export function describeConfig(config: Config): Record<string, unknown> {
  return {
    world: config.worldPath,
    cache: config.cacheDir,
    host: config.host,
    port: config.port,
    refresh: config.worldRefreshInterval,
    playerTimeout: config.playerDataTimeout,
    apiKey: config.apiKey ? 'set' : 'unset',
    logLevel: config.logLevel,
  };
}

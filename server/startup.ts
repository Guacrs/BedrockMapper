/**
 * Startup checks.
 *
 * Everything that can be wrong with a deployment is worth finding out before the
 * HTTP port is bound: a world path that points at the wrong folder, a cache
 * directory nobody can write to, a `db/` that is not a LevelDB. Each problem is
 * reported as a sentence that says what to change, and all of them are reported
 * at once so a misconfigured server needs one fix-and-retry, not five.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';

export interface EnvironmentReport {
  /** Reasons the server must not start. */
  problems: string[];
  /** Things worth saying out loud that are not fatal. */
  warnings: string[];
}

const WORLD_HINT =
  'WORLD_PATH must be the world directory itself - the folder containing db/, level.dat and ' +
  'levelname.txt - not the db/ folder and not the worlds/ folder.';

async function statOrNull(target: string) {
  return fs.stat(target).catch(() => null);
}

function isInside(parent: string, child: string): boolean {
  const from = path.resolve(parent);
  const to = path.resolve(child);
  return to === from || to.startsWith(from + path.sep);
}

/** Checks the world directory really is a Bedrock world we can read. */
export async function checkWorld(worldPath: string): Promise<EnvironmentReport> {
  const problems: string[] = [];
  const warnings: string[] = [];

  const world = await statOrNull(worldPath);
  if (!world) {
    problems.push(`WORLD_PATH does not exist: ${worldPath}. ${WORLD_HINT}`);
    return { problems, warnings };
  }
  if (!world.isDirectory()) {
    problems.push(`WORLD_PATH is not a directory: ${worldPath}. ${WORLD_HINT}`);
    return { problems, warnings };
  }

  const dbPath = path.join(worldPath, 'db');
  const db = await statOrNull(dbPath);
  if (!db?.isDirectory()) {
    const looksLikeADatabase = await statOrNull(path.join(worldPath, 'CURRENT'));
    problems.push(
      looksLikeADatabase
        ? `WORLD_PATH points at a LevelDB directory (${worldPath}), not at the world. ${WORLD_HINT}`
        : `No db/ directory inside WORLD_PATH: ${dbPath} is missing. ${WORLD_HINT}`,
    );
    return { problems, warnings };
  }

  const entries = await fs.readdir(dbPath).catch(() => null);
  if (!entries) {
    problems.push(`Cannot read the world database directory: ${dbPath}. Check the file permissions.`);
    return { problems, warnings };
  }
  if (!entries.includes('CURRENT')) {
    problems.push(
      `${dbPath} does not look like a Bedrock LevelDB: no CURRENT file. ` +
        'Is the server still creating the world?',
    );
  }
  if (!entries.some((name) => /\.(ldb|log)$/.test(name))) {
    problems.push(`${dbPath} contains no .ldb or .log files, so there is no world data to read.`);
  }

  // Reading is all we ever do, so that is all we check for.
  const unreadable = await fs
    .access(path.join(dbPath, 'CURRENT'), fs.constants.R_OK)
    .then(() => false)
    .catch(() => true);
  if (entries.includes('CURRENT') && unreadable) {
    problems.push(
      `Cannot read ${path.join(dbPath, 'CURRENT')}. The map server needs read access to the world ` +
        'files (it never writes to them).',
    );
  }

  if (!(await statOrNull(path.join(worldPath, 'level.dat')))) {
    warnings.push(
      `No level.dat in ${worldPath}, so the world name and version cannot be reported. ` +
        'The map will still render.',
    );
  }

  return { problems, warnings };
}

/**
 * Checks the cache directory, creating it if needed. This is the one directory
 * the server writes to, and it must never be inside the world.
 */
export async function checkCache(cacheDir: string, worldPath: string): Promise<EnvironmentReport> {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (worldPath && isInside(worldPath, cacheDir)) {
    problems.push(
      `MAP_CACHE (${cacheDir}) is inside WORLD_PATH (${worldPath}). The map server writes snapshots ` +
        'and tiles into the cache, and it must never write anything inside the live world. ' +
        'Point MAP_CACHE somewhere else.',
    );
    return { problems, warnings };
  }

  const created = await fs
    .mkdir(cacheDir, { recursive: true })
    .then(() => true)
    .catch(() => false);
  if (!created && !(await statOrNull(cacheDir))) {
    problems.push(`Cannot create the cache directory ${cacheDir}. Check MAP_CACHE and its permissions.`);
    return { problems, warnings };
  }

  const probe = path.join(cacheDir, `.write-probe-${process.pid}`);
  const writable = await fs
    .writeFile(probe, 'ok')
    .then(() => true)
    .catch(() => false);
  if (writable) await fs.rm(probe, { force: true }).catch(() => {});
  else problems.push(`Cannot write to the cache directory ${cacheDir}. Check its permissions.`);

  return { problems, warnings };
}

/** The HTML/JS/CSS and the Leaflet files the production server serves as-is. */
export async function checkStaticAssets(webRoot: string, leafletRoot: string): Promise<EnvironmentReport> {
  const problems: string[] = [];
  const required = [
    [webRoot, 'index.html', 'the map page'],
    [webRoot, 'map.js', 'the map script'],
    [webRoot, 'style.css', 'the map stylesheet'],
    [leafletRoot, 'leaflet.js', 'Leaflet (run npm install)'],
    [leafletRoot, 'leaflet.css', 'Leaflet CSS (run npm install)'],
  ] as const;
  for (const [root, name, what] of required) {
    if (!(await statOrNull(path.join(root, name)))) {
      problems.push(`Missing ${what}: ${path.join(root, name)}`);
    }
  }
  return { problems, warnings: [] };
}

/** Every startup check, in one report. */
export async function checkEnvironment(
  config: Config,
  assets?: { webRoot: string; leafletRoot: string },
): Promise<EnvironmentReport> {
  const reports = [
    await checkWorld(config.worldPath),
    await checkCache(config.cacheDir, config.worldPath),
    ...(assets ? [await checkStaticAssets(assets.webRoot, assets.leafletRoot)] : []),
  ];
  return {
    problems: reports.flatMap((report) => report.problems),
    warnings: reports.flatMap((report) => report.warnings),
  };
}

/** The message a misconfigured server exits with. */
export function formatProblems(problems: readonly string[]): string {
  const heading =
    problems.length === 1
      ? 'BedrockMapper cannot start; this needs fixing first:'
      : `BedrockMapper cannot start; ${problems.length} things need fixing first:`;
  return [heading, ...problems.map((problem) => `  - ${problem}`), '', 'See .env.example for what each setting means.'].join(
    '\n',
  );
}

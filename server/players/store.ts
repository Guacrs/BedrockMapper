/**
 * Latest known player positions, held in memory only.
 *
 * The map server never persists player data and never derives it from the
 * world files: every position comes from a live POST by the BDS addon. Each
 * update replaces the previous one wholesale, which is why a player who left
 * simply stops being reported.
 *
 * If the updates stop - server stopped, addon disabled, network gone - the list
 * goes stale after a configurable timeout and is reported as unavailable rather
 * than pretending the last known players are still online.
 */

/** A player as reported by the BDS addon. */
export interface PlayerPosition {
  /** Display name, also the fallback marker identity. */
  name: string;
  /** Stable identity from the Script API (`Player.id`) when available. */
  id?: string;
  x: number;
  y: number;
  z: number;
  /** Normalised dimension id, e.g. `overworld`. */
  dimension: string;
}

export interface PlayerSnapshot {
  players: PlayerPosition[];
  /** ISO timestamp of the last accepted update, null if there never was one. */
  updatedAt: string | null;
  /** True when no update has arrived within the timeout. */
  stale: boolean;
  /** Milliseconds since the last update, null if there never was one. */
  ageMs: number | null;
  /** The staleness timeout in force, so a client can show a countdown. */
  timeoutMs: number;
}

export class PlayerValidationError extends Error {}

/** Entries above this are refused rather than filling memory. */
const MAX_PLAYERS = 200;
const MAX_NAME_LENGTH = 64;
const MAX_ID_LENGTH = 64;
const MAX_DIMENSION_LENGTH = 64;
/** Well outside any reachable Bedrock coordinate. */
const COORDINATE_LIMIT = 100_000_000;

function fail(message: string): never {
  throw new PlayerValidationError(message);
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') fail(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (!trimmed) fail(`"${field}" must not be empty`);
  if (trimmed.length > maxLength) fail(`"${field}" must be at most ${maxLength} characters`);
  return trimmed;
}

function requireCoordinate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${field}" must be a finite number`);
  if (Math.abs(value) > COORDINATE_LIMIT) fail(`"${field}" is out of range`);
  return value;
}

/**
 * `minecraft:overworld` and `overworld` mean the same dimension; the Script API
 * reports the namespaced form.
 */
export function normaliseDimension(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith('minecraft:') ? trimmed.slice('minecraft:'.length) : trimmed;
}

/**
 * Validates an untrusted `{ players: [...] }` body.
 *
 * Unknown fields are dropped rather than passed through to the browser, and
 * anything malformed throws `PlayerValidationError` so the route can answer 400
 * with a usable message.
 */
export function parsePlayerUpdate(body: unknown): PlayerPosition[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('body must be a JSON object');
  }
  const players = (body as { players?: unknown }).players;
  if (!Array.isArray(players)) fail('"players" must be an array');
  if (players.length > MAX_PLAYERS) fail(`"players" must contain at most ${MAX_PLAYERS} entries`);

  return players.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`players[${index}] must be an object`);
    }
    const player = entry as Record<string, unknown>;
    const parsed: PlayerPosition = {
      name: requireString(player.name, `players[${index}].name`, MAX_NAME_LENGTH),
      x: requireCoordinate(player.x, `players[${index}].x`),
      y: requireCoordinate(player.y, `players[${index}].y`),
      z: requireCoordinate(player.z, `players[${index}].z`),
      dimension: normaliseDimension(
        requireString(player.dimension, `players[${index}].dimension`, MAX_DIMENSION_LENGTH),
      ),
    };
    if (player.id !== undefined) {
      parsed.id = requireString(player.id, `players[${index}].id`, MAX_ID_LENGTH);
    }
    return parsed;
  });
}

export class PlayerStore {
  readonly timeoutMs: number;

  #players: PlayerPosition[] = [];
  #updatedAt: number | null = null;
  #now: () => number;
  #updateCount = 0;

  constructor(timeoutMs: number, now: () => number = Date.now) {
    this.timeoutMs = timeoutMs;
    this.#now = now;
  }

  get updateCount(): number {
    return this.#updateCount;
  }

  /** Replaces the whole list; there is no merging with the previous update. */
  replace(players: PlayerPosition[]): void {
    this.#players = players;
    this.#updatedAt = this.#now();
    this.#updateCount++;
  }

  isStale(): boolean {
    if (this.#updatedAt === null) return true;
    return this.#now() - this.#updatedAt > this.timeoutMs;
  }

  /**
   * Latest state. Stale data reports no players, so markers disappear instead
   * of freezing in place, while `updatedAt` still says when it was last heard.
   */
  snapshot(dimension?: string): PlayerSnapshot {
    const stale = this.isStale();
    const wanted = dimension ? normaliseDimension(dimension) : null;
    const players = stale
      ? []
      : wanted
        ? this.#players.filter((player) => player.dimension === wanted)
        : [...this.#players];
    return {
      players,
      updatedAt: this.#updatedAt === null ? null : new Date(this.#updatedAt).toISOString(),
      stale,
      ageMs: this.#updatedAt === null ? null : this.#now() - this.#updatedAt,
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Turns a stream of player reports into the handful of events worth logging.
 *
 * The BDS addon posts every few seconds forever, so logging updates as they
 * arrive would fill a terminal with nothing. What an operator actually wants to
 * see is: the addon started reporting, someone joined or left, reports stopped
 * arriving, reports came back.
 */

import type { Logger } from '../log.ts';
import type { PlayerPosition } from './store.ts';

export type PlayerEvent =
  | { kind: 'started'; online: number; names: string[] }
  | { kind: 'changed'; joined: string[]; left: string[]; online: number }
  | { kind: 'stale'; ageMs: number; lastUpdate: string }
  | { kind: 'resumed'; online: number; downMs: number };

function namesOf(players: readonly PlayerPosition[]): string[] {
  return [...new Set(players.map((player) => player.name))].sort();
}

export class PlayerActivity {
  readonly timeoutMs: number;
  #names: string[] | null = null;
  #lastUpdate: number | null = null;
  #stale = false;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  /** Records an accepted report and returns what should be logged, if anything. */
  record(players: readonly PlayerPosition[], at: number = Date.now()): PlayerEvent[] {
    const names = namesOf(players);
    const events: PlayerEvent[] = [];

    if (this.#names === null) {
      events.push({ kind: 'started', online: names.length, names });
    } else if (this.#stale) {
      events.push({ kind: 'resumed', online: names.length, downMs: at - (this.#lastUpdate ?? at) });
    }

    const previous = this.#names ?? [];
    const joined = names.filter((name) => !previous.includes(name));
    const left = previous.filter((name) => !names.includes(name));
    // A join or leave next to the "started"/"resumed" line would repeat it.
    if ((joined.length || left.length) && this.#names !== null && !this.#stale) {
      events.push({ kind: 'changed', joined, left, online: names.length });
    }

    this.#names = names;
    this.#lastUpdate = at;
    this.#stale = false;
    return events;
  }

  /**
   * Called on a timer: notices that reports stopped arriving. Only ever fires
   * once per outage, and never before the first report.
   */
  poll(at: number = Date.now()): PlayerEvent[] {
    if (this.#lastUpdate === null || this.#stale) return [];
    const ageMs = at - this.#lastUpdate;
    if (ageMs <= this.timeoutMs) return [];
    this.#stale = true;
    return [{ kind: 'stale', ageMs, lastUpdate: new Date(this.#lastUpdate).toISOString() }];
  }
}

/** Writes the handful of player events worth seeing to the server log. */
export function logPlayerEvent(log: Logger, event: PlayerEvent): void {
  switch (event.kind) {
    case 'started':
      log.info('players.online', { count: event.online, names: event.names.join(',') || '(none)' });
      break;
    case 'changed':
      log.info('players.changed', {
        joined: event.joined.join(',') || undefined,
        left: event.left.join(',') || undefined,
        count: event.online,
      });
      break;
    case 'stale':
      log.warn('players.stale', { ageMs: event.ageMs, lastUpdate: event.lastUpdate });
      break;
    case 'resumed':
      log.info('players.resumed', { count: event.online, downMs: event.downMs });
      break;
  }
}

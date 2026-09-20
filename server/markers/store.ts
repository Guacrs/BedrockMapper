/**
 * JSON-backed marker store under MAP_CACHE.
 *
 * File layout: `<cacheDir>/markers.json`
 *
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave a
 * half-parsed document. The public surface is {@link MarkerStore} so a later
 * SQLite backend can drop in without touching routes or the browser.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MapMarker, MarkerCreateInput, MarkerPatchInput, MarkerStore } from './types.ts';
import { MarkerValidationError } from './validate.ts';

const STORE_VERSION = 1;
const FILE_NAME = 'markers.json';

interface MarkerFile {
  version: number;
  markers: MapMarker[];
}

export function markersFilePath(cacheDir: string): string {
  return path.join(cacheDir, FILE_NAME);
}

function emptyFile(): MarkerFile {
  return { version: STORE_VERSION, markers: [] };
}

export class MarkerNotFoundError extends Error {
  constructor(id: string) {
    super(`marker "${id}" not found`);
    this.name = 'MarkerNotFoundError';
  }
}

export class MarkerConflictError extends Error {
  constructor(id: string) {
    super(`marker id "${id}" already exists`);
    this.name = 'MarkerConflictError';
  }
}

export class JsonMarkerStore implements MarkerStore {
  readonly filePath: string;
  #markers = new Map<string, MapMarker>();
  #loaded = false;
  #now: () => number;

  constructor(cacheDir: string, now: () => number = Date.now) {
    this.filePath = markersFilePath(cacheDir);
    this.#now = now;
  }

  /** Loads from disk if needed (idempotent). */
  async ready(): Promise<void> {
    if (this.#loaded) return;
    await this.#reload();
  }

  async list(): Promise<MapMarker[]> {
    await this.ready();
    return [...this.#markers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<MapMarker | null> {
    await this.ready();
    return this.#markers.get(id) ?? null;
  }

  async create(input: MarkerCreateInput): Promise<MapMarker> {
    await this.ready();
    const id = input.id ?? randomUUID();
    if (this.#markers.has(id)) throw new MarkerConflictError(id);

    const stamp = new Date(this.#now()).toISOString();
    const marker: MapMarker = {
      id,
      name: input.name,
      x: input.x,
      z: input.z,
      category: input.category,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.description !== undefined) marker.description = input.description;
    if (input.color !== undefined) marker.color = input.color;

    this.#markers.set(id, marker);
    await this.#persist();
    return { ...marker };
  }

  async update(id: string, patch: MarkerPatchInput): Promise<MapMarker> {
    await this.ready();
    const existing = this.#markers.get(id);
    if (!existing) throw new MarkerNotFoundError(id);

    const next: MapMarker = { ...existing, updatedAt: new Date(this.#now()).toISOString() };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.x !== undefined) next.x = patch.x;
    if (patch.z !== undefined) next.z = patch.z;
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.description !== undefined) {
      if (patch.description === null) delete next.description;
      else next.description = patch.description;
    }
    if (patch.color !== undefined) {
      if (patch.color === null) delete next.color;
      else next.color = patch.color;
    }

    this.#markers.set(id, next);
    await this.#persist();
    return { ...next };
  }

  async delete(id: string): Promise<boolean> {
    await this.ready();
    if (!this.#markers.has(id)) return false;
    this.#markers.delete(id);
    await this.#persist();
    return true;
  }

  /** Force a re-read from disk (used by tests). */
  async reloadFromDisk(): Promise<void> {
    await this.#reload();
  }

  async #reload(): Promise<void> {
    const raw = await fs.readFile(this.filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });

    this.#markers.clear();
    if (!raw) {
      this.#loaded = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MarkerValidationError(`marker store at ${this.filePath} is not valid JSON`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new MarkerValidationError(`marker store at ${this.filePath} must be a JSON object`);
    }
    const file = parsed as Partial<MarkerFile>;
    if (!Array.isArray(file.markers)) {
      throw new MarkerValidationError(`marker store at ${this.filePath} is missing a "markers" array`);
    }

    for (const entry of file.markers) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
      this.#markers.set(entry.id, entry as MapMarker);
    }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: MarkerFile = {
      version: STORE_VERSION,
      markers: [...this.#markers.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const tempPath = `${this.filePath}.${process.pid}.${this.#now()}.tmp`;
    const bytes = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.writeFile(tempPath, bytes, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }
}

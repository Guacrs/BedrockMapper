/**
 * Validation for marker create / patch bodies.
 */

import {
  MARKER_CATEGORIES,
  type MarkerCategory,
  type MarkerCreateInput,
  type MarkerPatchInput,
} from './types.ts';

export class MarkerValidationError extends Error {}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ID_LENGTH = 64;
/** Well outside any reachable Bedrock coordinate. */
const COORDINATE_LIMIT = 100_000_000;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function fail(message: string): never {
  throw new MarkerValidationError(message);
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') fail(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (!trimmed) fail(`"${field}" must not be empty`);
  if (trimmed.length > maxLength) fail(`"${field}" must be at most ${maxLength} characters`);
  return trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) fail(`"${field}" must be at most ${maxLength} characters`);
  return trimmed;
}

function requireCoordinate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${field}" must be a finite number`);
  if (!Number.isInteger(value)) fail(`"${field}" must be an integer block coordinate`);
  if (Math.abs(value) > COORDINATE_LIMIT) fail(`"${field}" is out of range`);
  return value;
}

function requireCategory(value: unknown, field: string): MarkerCategory {
  if (typeof value !== 'string') fail(`"${field}" must be a string`);
  if (!(MARKER_CATEGORIES as readonly string[]).includes(value)) {
    fail(`"${field}" must be one of: ${MARKER_CATEGORIES.join(', ')}`);
  }
  return value as MarkerCategory;
}

function optionalColor(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!COLOR_PATTERN.test(trimmed)) fail(`"${field}" must be a #RRGGBB colour`);
  return trimmed.toUpperCase();
}

function optionalId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const id = requireString(value, 'id', MAX_ID_LENGTH);
  if (!ID_PATTERN.test(id)) fail('"id" may only contain letters, digits, "_" and "-"');
  return id;
}

/** Validates a POST /api/markers body. */
export function parseMarkerCreate(body: unknown): MarkerCreateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;
  const input: MarkerCreateInput = {
    name: requireString(raw.name, 'name', MAX_NAME_LENGTH),
    x: requireCoordinate(raw.x, 'x'),
    z: requireCoordinate(raw.z, 'z'),
    category: requireCategory(raw.category, 'category'),
  };
  const description = optionalString(raw.description, 'description', MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) input.description = description;
  const color = optionalColor(raw.color, 'color');
  if (color !== undefined) input.color = color;
  const id = optionalId(raw.id);
  if (id !== undefined) input.id = id;
  return input;
}

/** Validates a PATCH /api/markers/:id body. At least one field must be present. */
export function parseMarkerPatch(body: unknown): MarkerPatchInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;
  const patch: MarkerPatchInput = {};

  if ('name' in raw) patch.name = requireString(raw.name, 'name', MAX_NAME_LENGTH);
  if ('description' in raw) {
    if (raw.description === null) patch.description = null;
    else patch.description = optionalString(raw.description, 'description', MAX_DESCRIPTION_LENGTH) ?? null;
  }
  if ('x' in raw) patch.x = requireCoordinate(raw.x, 'x');
  if ('z' in raw) patch.z = requireCoordinate(raw.z, 'z');
  if ('category' in raw) patch.category = requireCategory(raw.category, 'category');
  if ('color' in raw) {
    if (raw.color === null) patch.color = null;
    else patch.color = optionalColor(raw.color, 'color') ?? null;
  }

  if (Object.keys(patch).length === 0) fail('patch must include at least one field');
  return patch;
}

export function isMarkerCategory(value: string): value is MarkerCategory {
  return (MARKER_CATEGORIES as readonly string[]).includes(value);
}

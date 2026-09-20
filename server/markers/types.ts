/**
 * Persistent shared map markers (bases, farms, POIs, …).
 *
 * Separate from live player positions: markers are stored on disk and are
 * visible to every visitor; players are ephemeral reports from the BDS addon.
 */

export const MARKER_CATEGORIES = [
  'base',
  'village',
  'portal',
  'farm',
  'shop',
  'poi',
  'warning',
  'custom',
] as const;

export type MarkerCategory = (typeof MARKER_CATEGORIES)[number];

export interface MapMarker {
  id: string;
  name: string;
  description?: string;
  x: number;
  z: number;
  category: MarkerCategory;
  /** Optional `#RRGGBB` override for the marker icon. */
  color?: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields a client may send when creating a marker. `id` is optional; the store assigns one when omitted. */
export interface MarkerCreateInput {
  id?: string;
  name: string;
  description?: string;
  x: number;
  z: number;
  category: MarkerCategory;
  color?: string;
}

/** Partial update; omitted fields are left unchanged. */
export interface MarkerPatchInput {
  name?: string;
  description?: string | null;
  x?: number;
  z?: number;
  category?: MarkerCategory;
  color?: string | null;
}

/** Persistence backend. JSON today; SQLite could implement the same surface later. */
export interface MarkerStore {
  list(): Promise<MapMarker[]>;
  get(id: string): Promise<MapMarker | null>;
  create(input: MarkerCreateInput): Promise<MapMarker>;
  update(id: string, patch: MarkerPatchInput): Promise<MapMarker>;
  delete(id: string): Promise<boolean>;
}

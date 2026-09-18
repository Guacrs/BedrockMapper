/**
 * Comparing two world scans.
 *
 * Chunk-level granularity is deliberate: a digest per chunk is cheap to compute
 * while scanning and is enough to decide which map tiles have to be drawn again.
 * Nothing here decodes block data.
 */

import type { ChunkPos } from './keys.ts';

/** Chunk id ("x,z") -> digest of the chunk's block data. */
export type ChunkDigests = Map<string, string>;

export interface ChunkDiff {
  /** Chunks that now have block data and had none before. */
  added: ChunkPos[];
  /** Chunks whose block data changed. */
  changed: ChunkPos[];
  /** Chunks that had block data and have none now. */
  removed: ChunkPos[];
  /** Every chunk in the three lists above. */
  all: ChunkPos[];
}

export function chunkId(x: number, z: number): string {
  return `${x},${z}`;
}

export function parseChunkId(id: string): ChunkPos {
  const comma = id.indexOf(',');
  return { x: Number(id.slice(0, comma)), z: Number(id.slice(comma + 1)) };
}

export function diffChunkDigests(previous: ChunkDigests, next: ChunkDigests): ChunkDiff {
  const added: ChunkPos[] = [];
  const changed: ChunkPos[] = [];
  const removed: ChunkPos[] = [];

  for (const [id, digest] of next) {
    const before = previous.get(id);
    if (before === undefined) added.push(parseChunkId(id));
    else if (before !== digest) changed.push(parseChunkId(id));
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) removed.push(parseChunkId(id));
  }

  return { added, changed, removed, all: [...added, ...changed, ...removed] };
}

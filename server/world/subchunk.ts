/**
 * Adapter turning a raw SubChunkPrefix record into a compact typed subchunk.
 *
 * The decoding itself is done by `mcbe-leveldb`, which handles every
 * SubChunkPrefix version up to 9 (the version BDS 1.26 writes: a leading
 * format byte, a storage/layer count, a *signed* subchunk index, then one
 * bit-packed block-index array plus little-endian NBT palette per layer).
 */

import { entryContentTypeToFormatMap } from 'mcbe-leveldb';
import { BLOCKS_PER_SUBCHUNK } from './keys.ts';

export type BlockStateValue = string | number | boolean | bigint;

export interface BlockState {
  /** Namespaced block name, e.g. `minecraft:grass_block`. */
  name: string;
  states: Record<string, BlockStateValue>;
}

export interface SubChunkLayer {
  /** Distinct block states used by this layer. */
  palette: BlockState[];
  /** 4096 palette indices, addressed with `blockIndex(x, y, z)`. */
  indices: ArrayLike<number>;
}

export interface SubChunk {
  /** Signed subchunk index; -4 is the y = -64..-49 slice of the Overworld. */
  index: number;
  /** SubChunkPrefix format version byte. */
  version: number;
  /**
   * Block layers. Layer 0 is the terrain; layer 1, when present, holds the
   * waterlogging/liquid overlay.
   */
  layers: SubChunkLayer[];
}

/**
 * A subchunk stored in a pre-1.2.13 format, which addresses blocks by numeric
 * ID instead of a palette. Modern BDS rewrites these on save, so rather than
 * guessing at legacy numeric IDs the reader reports them and skips them.
 */
export class LegacySubChunkError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(
      `Subchunk uses pre-palette format version ${version}; ` +
        'only palette formats (version 1 and 8-9) are supported',
    );
    this.name = 'LegacySubChunkError';
    this.version = version;
  }
}

interface NbtValue<T> {
  value: T;
}
interface RawLayer {
  palette: NbtValue<Record<string, NbtValue<Record<string, NbtValue<unknown>>>>>;
  block_indices: NbtValue<NbtValue<number[]>>;
}
interface RawSubChunk {
  value: {
    version: NbtValue<number>;
    subChunkIndex?: NbtValue<number>;
    layers?: NbtValue<NbtValue<RawLayer[]>>;
  };
}

function toBlockState(entry: NbtValue<Record<string, NbtValue<unknown>>>): BlockState {
  const name = entry.value.name?.value;
  const rawStates = (entry.value.states?.value ?? {}) as Record<string, NbtValue<BlockStateValue>>;
  const states: Record<string, BlockStateValue> = {};
  for (const [key, state] of Object.entries(rawStates)) states[key] = state.value;
  return { name: typeof name === 'string' ? name : 'minecraft:unknown', states };
}

/**
 * Decodes a SubChunkPrefix value.
 *
 * @param fallbackIndex subchunk index from the database key, used for formats
 *   older than version 9 which do not store the index in the value.
 */
export async function decodeSubChunk(value: Buffer, fallbackIndex: number): Promise<SubChunk> {
  const parsed = (await entryContentTypeToFormatMap.SubChunkPrefix.parse(value)) as RawSubChunk;
  const version = parsed.value.version.value;
  const rawLayers = parsed.value.layers?.value?.value;
  if (!rawLayers) throw new LegacySubChunkError(version);

  const layers: SubChunkLayer[] = rawLayers.map((layer) => {
    const palette = Object.values(layer.palette.value).map(toBlockState);
    const indices = layer.block_indices.value.value;
    if (indices.length !== BLOCKS_PER_SUBCHUNK) {
      throw new Error(`Subchunk layer has ${indices.length} blocks, expected ${BLOCKS_PER_SUBCHUNK}`);
    }
    return { palette, indices };
  });

  return { index: subChunkIndex(parsed, fallbackIndex), version, layers };
}

/**
 * The subchunk index stored in a version 9 record is signed (-4 is the lowest
 * Overworld slice) but is decoded as an unsigned byte, so 0xFC arrives as 252.
 * The index from the database key is authoritative; the stored one is only
 * used to sanity-check it.
 */
function subChunkIndex(parsed: RawSubChunk, fallbackIndex: number): number {
  const stored = parsed.value.subChunkIndex?.value;
  if (stored === undefined) return fallbackIndex;
  const signed = (stored << 24) >> 24;
  if (signed !== fallbackIndex) {
    throw new Error(
      `Subchunk index mismatch: key says ${fallbackIndex}, record says ${signed}`,
    );
  }
  return fallbackIndex;
}

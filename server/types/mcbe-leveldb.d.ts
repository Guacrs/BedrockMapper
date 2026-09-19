/**
 * Minimal ambient types for the part of `mcbe-leveldb` this project uses.
 *
 * The package ships its own (much larger) types, but they are written as
 * `.ts` sources with syntax our compiler options reject, and we re-shape the
 * parsed result into our own types in server/world/subchunk.ts anyway.
 */

declare module 'mcbe-leveldb' {
  export const entryContentTypeToFormatMap: {
    SubChunkPrefix: { parse(data: Buffer): Promise<unknown> };
    Data3D: { parse(data: Buffer): Promise<unknown> };
  };

  export interface BiomePalette {
    values: number[] | null;
    palette: number[];
  }

  export function readData3dValue(rawvalue: Uint8Array | null): {
    heightMap: number[][];
    biomes: BiomePalette[];
  } | null;

  export function getBiomeTypeFromID(id: number): string | undefined;
  export function getBiomeIDFromType(name: string): number | undefined;
}

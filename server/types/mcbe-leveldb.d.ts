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
}

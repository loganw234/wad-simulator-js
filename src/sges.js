// sges block compression and decompression.
//
// Faithful port of mercs2_formats::sges. The Rust source states the fidelity contract this
// port inherits verbatim:
//
//   "the deflate bitstream is not byte-identical to Python's zlib — a different deflate
//    implementation packs the same data differently. Correctness is defined by round-trip
//    and engine load, NOT by byte-matching. The container framing (header, table, offsets,
//    flags, alignment) IS byte-faithful."
//
// So the CONTAINER FRAMING here is byte-for-byte the Rust output; the compressed payload is
// valid raw-DEFLATE (via fflate) that decompresses identically. That is the exact standard
// the Rust tool holds itself to — it is not byte-identical to the Python reference either.

import { deflateSync, inflateSync } from '../vendor/fflate.js';
import { u16, u32, putU16, putU32, align16 } from './bytes.js';

const DEFAULT_SEGMENT_SIZE = 65536;
const DEFAULT_LEVEL = 6;

/**
 * Decompress an sges block back to raw bytes.
 *
 * The per-segment u16 compressed-size is unreliable for large/incompressible segments (it
 * can wrap or read 0), so for a COMPRESSED segment we hand the inflater the span from this
 * segment's offset up to the next (capped at 128 KB) and let it consume exactly the deflate
 * stream — the same tactic as the Rust and the original Python.
 */
export function decompressSges(block) {
  if (block.length < 16) throw new Error('Block too small for sges header');
  if (String.fromCharCode(block[0], block[1], block[2], block[3]) !== 'sges') {
    throw new Error('Bad sges magic');
  }
  const segCount = u16(block, 6);
  const totalU = u32(block, 8);
  const tableStart = 16;
  if (block.length < tableStart + segCount * 8) throw new Error('Block too small for segment table');

  const segs = [];
  for (let i = 0; i < segCount; i++) {
    const base = tableStart + i * 8;
    const rawU = u16(block, base + 2);
    const flagged = u32(block, base + 4);
    segs.push({
      compSize: u16(block, base),
      uncompSize: rawU === 0 ? DEFAULT_SEGMENT_SIZE : rawU,
      offset: flagged & 0xfffffffe,
      isCompressed: (flagged & 1) !== 0,
    });
  }

  const end = block.length;
  const out = new Uint8Array(totalU);
  let written = 0;
  for (let i = 0; i < segs.length && written < totalU; i++) {
    const seg = segs[i];
    if (seg.offset >= end) break;
    if (seg.isCompressed) {
      const nextOff = i + 1 < segs.length ? segs[i + 1].offset : end;
      const readEnd = Math.min(nextOff, seg.offset + 131072, end);
      if (readEnd <= seg.offset) break;
      let dec;
      try {
        dec = inflateSync(block.subarray(seg.offset, readEnd), { out: new Uint8Array(seg.uncompSize) });
      } catch {
        break; // a corrupt stream stops the block, matching the reference (page count flags truncation)
      }
      out.set(dec.subarray(0, Math.min(dec.length, totalU - written)), written);
      written += Math.min(dec.length, totalU - written);
    } else {
      const actual = seg.compSize > 0 ? seg.compSize : seg.uncompSize;
      const readSz = Math.min(actual, totalU - written);
      const readEnd = Math.min(seg.offset + readSz, end);
      if (readEnd > seg.offset) {
        out.set(block.subarray(seg.offset, readEnd), written);
        written += readEnd - seg.offset;
      }
    }
  }
  return written === totalU ? out : out.subarray(0, written);
}

/**
 * Compress raw block bytes into an sges block. Container framing is byte-faithful to the
 * Rust; the deflate payload is fflate raw-deflate. Round-trips through decompressSges and
 * loads in-engine, which is the whole fidelity requirement.
 */
export function compressSges(uncompressed, { segmentSize = DEFAULT_SEGMENT_SIZE, level = DEFAULT_LEVEL, major = 4 } = {}) {
  if (!uncompressed.length) throw new Error('Cannot compress empty data');

  const totalU = uncompressed.length;
  const segments = [];
  for (let off = 0; off < totalU; off += segmentSize) {
    const chunk = uncompressed.subarray(off, Math.min(off + segmentSize, totalU));
    const compressed = deflateSync(chunk, { level });
    // Fall back to raw storage when deflate overflows the u16 comp-size limit or fails to shrink.
    if (compressed.length > 65535 || compressed.length >= chunk.length) {
      segments.push({ stored: chunk, uncompSize: chunk.length, isCompressed: false });
    } else {
      segments.push({ stored: compressed, uncompSize: chunk.length, isCompressed: true });
    }
  }

  const n = segments.length;
  const dataStart = align16(16 + n * 8);

  // Lay out each segment at a 16-byte-aligned offset.
  const segOffsets = [];
  let pos = dataStart;
  for (const seg of segments) {
    segOffsets.push(pos);
    pos = align16(pos + seg.stored.length);
  }
  const lastEnd = segOffsets[n - 1] + segments[n - 1].stored.length;
  const totalC = align16(lastEnd);

  const block = new Uint8Array(totalC);
  block[0] = 0x73; block[1] = 0x67; block[2] = 0x65; block[3] = 0x73; // "sges"
  putU16(block, 4, major);
  putU16(block, 6, n);
  putU32(block, 8, totalU);
  putU32(block, 12, totalC);

  for (let i = 0; i < n; i++) {
    const seg = segments[i];
    const base = 16 + i * 8;
    // comp_sz: full-size raw segments (>65535) overflow u16, so store 0 (= default).
    const compSz = !seg.isCompressed && seg.stored.length > 65535 ? 0 : seg.stored.length;
    // uncomp field: 0 for a full-size segment, actual size for the short last one.
    const uncompField = seg.uncompSize === segmentSize ? 0 : seg.uncompSize;
    putU16(block, base, compSz);
    putU16(block, base + 2, uncompField);
    putU32(block, base + 4, (segOffsets[i] >>> 0) | (seg.isCompressed ? 1 : 0));
    block.set(seg.stored, segOffsets[i]);
  }
  return block;
}

/** Is this a raw (uncompressed) container rather than an sges block? Merge/delete move
 *  blocks verbatim, so they never need to know — but inspection does. */
export const isSges = (b) => b.length >= 4 && b[0] === 0x73 && b[1] === 0x67 && b[2] === 0x65 && b[3] === 0x73;
export const isUcfx = (b) => b.length >= 4 && b[0] === 0x55 && b[1] === 0x43 && b[2] === 0x46 && b[3] === 0x58;

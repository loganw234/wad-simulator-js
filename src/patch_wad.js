// FFCS patch-WAD read / build / merge.
//
// Faithful port of mercs2_formats::patch_wad. A PC `vz-patch.wad` is: a 256-byte FFCS header
// with five chunk rows (INDX/DATA/CSUM/ASET/PTHS) + a fixed 144-byte certificate, an INDX
// table of N×12-byte block records, an ASET table of 16-byte asset records, a
// null-terminated PTHS path list + a 258-byte trailer, and page-aligned DATA at 0x208000.
//
// The one subtlety worth stating up front: the ASET record's `u32_2` low 16 bits are the
// `sub` field (the block a model's finer LOD rungs live in) and the HIGH 16 bits are the
// block index — and the WRITER assigns the high half from output position while carrying the
// low half through untouched. So a block's output order matters, and `sub` is an ABSOLUTE
// index that a merge shifts. Both the character clone and the two-block vehicle clone ride
// on exactly this.

import { u32, putU32, alignUp } from './bytes.js';

export const PAGE_SIZE = 0x8000; // 32 KB

// PTHS trailer (258 ASCII bytes), appended after the per-block path strings.
const PTHS_TRAILER = new TextEncoder().encode(
  'xa37dd45ffe100bfffcc9753aabac325f07cb3fa231144fe2e33ae4783feead2' +
  'b8a73ff021fac326df0ef9753ab9cdf6573ddff0312fab0b0ff39779eaff312' +
  'a4f5de65892ffee33a44569bebf21f66d22e54a22347efd375981188743afd9' +
  '9baacc342d88a99321235798725fedcbf43252669dade32415fee89da543bf23' +
  'd4ex');

// Canonical 144-byte FFCS certificate blob written at header offset 0x48.
export const FFCS_CERT_BLOB = new Uint8Array([
  0xa8, 0xd8, 0x46, 0xfa, 0x28, 0x87, 0x0e, 0x14, 0x9a, 0xd3, 0x31, 0x71, 0xe2, 0x54, 0x0a, 0x8f,
  0xf8, 0xab, 0x0a, 0x3b, 0x3e, 0xf1, 0x5e, 0x66, 0xd0, 0xf6, 0x53, 0xf7, 0x78, 0xe9, 0xe5, 0x39,
  0x5a, 0x54, 0x22, 0xc1, 0x54, 0x1a, 0xb8, 0xe6, 0x87, 0x4d, 0xdf, 0xe8, 0xc7, 0x59, 0x73, 0x20,
  0x4e, 0x90, 0x0b, 0x60, 0x14, 0x3c, 0x27, 0xe5, 0x61, 0x2d, 0x98, 0xde, 0xce, 0x7a, 0xe7, 0x99,
  0x55, 0x65, 0x16, 0x18, 0x5d, 0xc3, 0x47, 0x56, 0xbc, 0x8d, 0x0b, 0xfa, 0x50, 0x42, 0x72, 0x5b,
  0x86, 0x2f, 0x61, 0x34, 0x10, 0xca, 0x8b, 0x9f, 0x5c, 0x81, 0x02, 0x16, 0x20, 0x83, 0x0e, 0xfe,
  0xf2, 0x47, 0xce, 0xac, 0xc4, 0x30, 0x7d, 0x4d, 0xd5, 0x29, 0x48, 0xea, 0x7a, 0x15, 0x11, 0xf0,
  0x14, 0x63, 0xfe, 0xbc, 0x5a, 0xbd, 0x08, 0x56, 0x7f, 0x80, 0x10, 0x63, 0x6a, 0xdf, 0xb9, 0x59,
  0x07, 0x93, 0x56, 0x7c, 0x71, 0x03, 0xe7, 0xec, 0xbb, 0x49, 0xf6, 0x1c, 0x80, 0x86, 0x49, 0x42,
]);

/** One ASET asset record. `u32_1` defaults to 0xFFFFFFFF when unset. */
export class AsetEntry {
  constructor(assetHash, u1, u2, u3) {
    this.assetHash = assetHash >>> 0;
    this.u32_1 = u1 >>> 0;
    this.u32_2 = u2 >>> 0;
    this.u32_3 = u3 >>> 0;
  }
}

/** One block destined for a patch WAD. Defaults match the Rust dataclass. */
export class PatchBlock {
  constructor(compressedData, pathString, asetEntries) {
    this.compressedData = compressedData;
    this.pathString = pathString;
    this.asetEntries = asetEntries || [];
    this.packedField = 1;
    this.flags = 0x8000;
  }
}

/**
 * Build a PC FFCS patch WAD from one or more blocks.
 *
 * @param {PatchBlock[]} blocks
 * @param {number} csumValue  the CSUM chunk's offset field (0 for a from-scratch build)
 * @param {number|null} csumMeta  CSUM meta; when null, auto-detected from the resident block's ASET count
 * @param {Uint8Array} certBlob
 */
export function buildPatchWadMulti(blocks, csumValue = 0, csumMeta = null, certBlob = FFCS_CERT_BLOB) {
  const numBlocks = blocks.length;

  const indxOffset = 0x8000;
  const indxSize = numBlocks * 12;
  const asetOffset = indxOffset + indxSize;

  // (block index, entry) flattened in block order.
  const allAset = [];
  blocks.forEach((blk, bi) => { for (const e of blk.asetEntries) allAset.push([bi, e]); });
  const totalAset = allAset.length;
  const asetSize = totalAset * 16;

  const pthsOffset = asetOffset + asetSize;
  const pthsChunks = [];
  const enc = new TextEncoder();
  for (const blk of blocks) { pthsChunks.push(enc.encode(blk.pathString), Uint8Array.of(0)); }
  pthsChunks.push(PTHS_TRAILER, Uint8Array.of(0));
  let pthsLen = 0;
  for (const c of pthsChunks) pthsLen += c.length;

  // DATA: page-aligned blocks from 0x208000.
  const dataOffset = 0x208000;
  const dataPageStart = dataOffset / PAGE_SIZE;
  const layouts = [];
  let currentPage = dataPageStart;
  for (const blk of blocks) {
    const pages = alignUp(blk.compressedData.length, PAGE_SIZE) / PAGE_SIZE;
    layouts.push({ page: currentPage, pages });
    currentPage += pages;
  }
  const fileSize = currentPage * PAGE_SIZE;

  // CSUM meta = resident block's ASET entry count (path ends resident_p000_q3.block).
  let meta = csumMeta;
  if (meta === null) {
    meta = 0;
    for (const blk of blocks) {
      if (blk.pathString.toLowerCase().replace(/\//g, '\\').endsWith('\\resident_p000_q3.block')) {
        meta = blk.asetEntries.length;
        break;
      }
    }
  }

  const out = new Uint8Array(fileSize);

  // FFCS header (256 bytes).
  out[0] = 0x46; out[1] = 0x46; out[2] = 0x43; out[3] = 0x53; // "FFCS"
  putU32(out, 4, 2);
  putU32(out, 8, 7);
  const cr = 0x0c;
  const row = (at, tag, offset, m) => {
    out[at] = tag.charCodeAt(0); out[at + 1] = tag.charCodeAt(1);
    out[at + 2] = tag.charCodeAt(2); out[at + 3] = tag.charCodeAt(3);
    putU32(out, at + 4, offset); putU32(out, at + 8, m);
  };
  row(cr, 'INDX', indxOffset, numBlocks);
  row(cr + 12, 'DATA', dataOffset, 36);
  row(cr + 24, 'CSUM', csumValue, meta);
  row(cr + 36, 'ASET', asetOffset, totalAset);
  row(cr + 48, 'PTHS', pthsOffset, numBlocks);
  out.set(certBlob.subarray(0, 144), 0x48);

  // INDX entries.
  layouts.forEach((L, i) => {
    const off = indxOffset + i * 12;
    putU32(out, off, L.page);
    putU32(out, off + 4, blocks[i].packedField);
    putU32(out, off + 8, ((blocks[i].flags >>> 0) << 16) | L.pages);
  });

  // ASET entries — remap block index into u32_2 high bits, carry the low 16 (the sub) through.
  allAset.forEach(([bi, e], i) => {
    const off = asetOffset + i * 16;
    putU32(out, off, e.assetHash);
    putU32(out, off + 4, e.u32_1);
    putU32(out, off + 8, ((bi >>> 0) << 16) | (e.u32_2 & 0xffff));
    putU32(out, off + 12, e.u32_3);
  });

  // PTHS.
  let p = pthsOffset;
  for (const c of pthsChunks) { out.set(c, p); p += c.length; }

  // DATA.
  layouts.forEach((L, i) => { out.set(blocks[i].compressedData, L.page * PAGE_SIZE); });

  return out;
}

/** Parse an existing patch WAD into blocks (for merge / delete / inspect). */
export function readPatchWad(raw) {
  if (raw.length < 0x48 || String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'FFCS') {
    throw new Error('Not an FFCS WAD');
  }
  const chunks = {};
  for (let i = 0; i < 5; i++) {
    const off = 0x0c + i * 12;
    const tag = String.fromCharCode(raw[off], raw[off + 1], raw[off + 2], raw[off + 3]);
    chunks[tag] = [u32(raw, off + 4), u32(raw, off + 8)];
  }
  if (!chunks.INDX || !chunks.ASET || !chunks.PTHS) throw new Error('missing INDX/ASET/PTHS chunk');
  const [indxOff, indxCount] = chunks.INDX;
  const [asetOff, asetCount] = chunks.ASET;
  const [pthsOff, pthsCount] = chunks.PTHS;
  const csumVal = chunks.CSUM ? chunks.CSUM[0] : 0;

  const indx = [];
  for (let i = 0; i < indxCount; i++) {
    const off = indxOff + i * 12;
    indx.push([u32(raw, off), u32(raw, off + 4), u32(raw, off + 8)]);
  }

  // ASET grouped by block index (u2 high 16 bits).
  const asetByBlock = new Map();
  for (let i = 0; i < asetCount; i++) {
    const off = asetOff + i * 16;
    const u0 = u32(raw, off), u1 = u32(raw, off + 4), u2 = u32(raw, off + 8), u3 = u32(raw, off + 12);
    const bi = (u2 >>> 16) & 0xffff;
    if (!asetByBlock.has(bi)) asetByBlock.set(bi, []);
    asetByBlock.get(bi).push(new AsetEntry(u0, u1, u2, u3));
  }

  // PTHS (null-separated, excluding trailer).
  const paths = [];
  let pos = pthsOff;
  const dec = new TextDecoder();
  for (let i = 0; i < pthsCount; i++) {
    let nul = pos;
    while (nul < raw.length && raw[nul] !== 0) nul++;
    if (nul >= raw.length) break;
    paths.push(dec.decode(raw.subarray(pos, nul)));
    pos = nul + 1;
  }

  const blocks = indx.map(([pageIdx, packed, flagsPages], i) => {
    const pages = flagsPages & 0xffff;
    const flags = (flagsPages >>> 16) & 0xffff;
    const blkOff = pageIdx * PAGE_SIZE;
    const end = Math.min(blkOff + pages * PAGE_SIZE, raw.length);
    let actualEnd = end;
    while (actualEnd > blkOff + 4 && raw[actualEnd - 1] === 0) actualEnd--;
    actualEnd = Math.min(alignUp(actualEnd - blkOff, 4) + blkOff, end);
    const b = new PatchBlock(
      raw.slice(blkOff, actualEnd),
      paths[i] !== undefined ? paths[i] : `block_${String(i).padStart(5, '0')}`,
      asetByBlock.get(i) || [],
    );
    b.packedField = packed;
    b.flags = flags;
    return b;
  });

  return { blocks, csumValue: csumVal };
}

/** Read an existing patch WAD and append (or replace-by-path) blocks. */
export function mergePatchWads(existing, newBlocks, replace = false) {
  const { blocks, csumValue } = readPatchWad(existing);
  const merged = blocks.slice();
  for (const nb of newBlocks) {
    if (replace) {
      const idx = merged.findIndex((old) => old.pathString === nb.pathString);
      if (idx >= 0) { merged[idx] = nb; continue; }
    }
    merged.push(nb);
  }
  return buildPatchWadMulti(merged, csumValue, null, FFCS_CERT_BLOB);
}

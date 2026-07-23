// Block-level operations: mint a new asset block, and read what an existing one contains.
//
// A "block" in a patch WAD is one sges-compressed unit. Inside its decompressed bytes is an
// entry table — `[u32 count][count × 16B (name_hash, type_hash, field_c, chunk_size)]`
// followed by the chunk payloads — so one block can hold several assets. The extra/inject
// blocks this tool mints hold exactly one.

import { PatchBlock, AsetEntry } from './patch_wad.js';
import { compressSges, decompressSges, isSges, isUcfx } from './sges.js';
import { pandemicHashM2, hex8 } from './hash.js';
import { u32 } from './bytes.js';

// type_id -> the type-name hash the engine keys asset resolution on (pandemic_hash_m2 of the
// LoadAsset type string). Ported from mercs2_smuggler::type_hash_for_type_id.
export const TYPE = {
  19: { hash: 0x5b724250, label: 'model' },
  23: { hash: 0xfe0e8320, label: 'ui movie' },
  27: { hash: 0xf011157a, label: 'texture' },
  35: { hash: 0x42498680, label: 'script' },
};
export const typeLabel = (hash) => {
  for (const id in TYPE) if (TYPE[id].hash === (hash >>> 0)) return TYPE[id].label;
  return null;
};

/** `[u32 count][count × 16B]` entry table at the head of a decompressed block. */
export function parseBlockEntryTable(decompressed) {
  if (decompressed.length < 4) return { count: 0, entries: [] };
  const count = u32(decompressed, 0);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 4 + i * 16;
    if (base + 16 > decompressed.length) break;
    entries.push({
      nameHash: u32(decompressed, base),
      typeHash: u32(decompressed, base + 4),
      fieldC: u32(decompressed, base + 8),
      chunkSize: u32(decompressed, base + 12),
    });
  }
  return { count, entries };
}

/**
 * Mint a NEW single-asset block from a raw UCFX container, exactly as
 * mercs2_smuggler's `build_extra`: a block is
 *   [u32 1][name_hash][type_hash][field_c=0][container_len][container...]
 * compressed with sges, carrying one ASET row (`u32_2 = 0x0000FFFF` = no sub block).
 *
 * @param {Uint8Array} container  a UCFX container (a .ucfx from an export bundle, or an
 *                                encoded texture)
 * @param {number} hash           the new asset's name hash
 * @param {number} typeId         19 model / 27 texture / 35 script
 * @returns {PatchBlock}
 */
export function makeExtraBlock(container, hash, typeId, pathHint) {
  const t = TYPE[typeId];
  if (!t) throw new Error(`unsupported type_id ${typeId} (need 19 model / 23 ui movie / 27 texture / 35 script)`);
  if (!isUcfx(container)) throw new Error('not a UCFX container (must start with the UCFX magic)');

  const inner = new Uint8Array(20 + container.length);
  const dv = new DataView(inner.buffer);
  dv.setUint32(0, 1, true);
  dv.setUint32(4, hash >>> 0, true);
  dv.setUint32(8, t.hash >>> 0, true);
  dv.setUint32(12, 0, true); // field_c
  dv.setUint32(16, container.length, true);
  inner.set(container, 20);

  const pages = Math.ceil(inner.length / 0x8000);
  const block = new PatchBlock(
    compressSges(inner),
    pathHint || `blocks\\VZ\\inject_${hex8(hash).slice(2).toLowerCase()}.block`,
    [new AsetEntry(hash, 0xffffffff, 0x0000ffff, typeId)],
  );
  block.packedField = pages;
  return block;
}

/**
 * Describe a block for the UI: its assets, their types, and its decompressed size.
 *
 * Decompression is only for the summary; merge/delete never touch it. `deep=false` reads
 * just enough to get the entry table (cheap on a many-MB block).
 */
export function describeBlock(block, { deep = false } = {}) {
  const data = block.compressedData;
  let decomp = null;
  let kind = 'raw';
  try {
    if (isSges(data)) { kind = 'sges'; decomp = decompressSges(data); }
    else if (isUcfx(data)) { kind = 'ucfx'; decomp = data; }
    else decomp = data;
  } catch {
    decomp = null;
  }

  const info = {
    path: block.pathString,
    kind,
    compressedBytes: data.length,
    decompressedBytes: decomp ? decomp.length : null,
    asetHashes: block.asetEntries.map((e) => ({
      hash: hex8(e.assetHash),
      hashNum: e.assetHash >>> 0,
      sub: (e.u32_2 & 0xffff) === 0xffff ? null : (e.u32_2 & 0xffff),
      typeId: e.u32_3,
      typeLabel: TYPE[e.u32_3] ? TYPE[e.u32_3].label : String(e.u32_3),
    })),
    assets: [],
  };

  if (decomp && (deep || info.asetHashes.length === 0)) {
    const { entries } = parseBlockEntryTable(decomp);
    info.assets = entries.map((e) => ({
      hash: hex8(e.nameHash),
      type: typeLabel(e.typeHash) || hex8(e.typeHash),
      chunkBytes: e.chunkSize,
    }));
  }
  return info;
}

// A patch WAD you can manage: the add / merge / delete verbs the UI drives.
//
// Everything here is a thin, honest wrapper over patch_wad.js. The one rule it enforces that
// the low-level writer does not is the `sub`-index correction: a block's `sub` field is an
// ABSOLUTE block index, and the writer only rewrites the high half of the ASET record, so
// appending blocks ahead of a sub-referencing block would leave it pointing at the wrong
// place. readPatchWad already re-groups ASET rows by block, so a block loaded from an
// existing WAD keeps its OWN sub relative to the merged layout — the danger is only when
// ADDING a new multi-block asset, which addAsset handles explicitly.

import { readPatchWad, buildPatchWadMulti, PatchBlock, AsetEntry, FFCS_CERT_BLOB } from './patch_wad.js';
import { makeExtraBlock, describeBlock, TYPE } from './block.js';
import { pandemicHashM2, hex8 } from './hash.js';

export class WadDoc {
  /** @param {{blocks: PatchBlock[], csumValue: number}} contents */
  constructor(contents) {
    this.blocks = contents.blocks;
    this.csumValue = contents.csumValue;
  }

  /** Empty patch, or parse existing bytes. */
  static empty() { return new WadDoc({ blocks: [], csumValue: 0 }); }
  static fromBytes(raw) { return new WadDoc(readPatchWad(raw)); }

  /** Serialize back to WAD bytes. Byte-faithful framing; see sges.js on the payload. */
  toBytes() {
    return buildPatchWadMulti(this.blocks, this.csumValue, null, FFCS_CERT_BLOB);
  }

  list() {
    return this.blocks.map((b, i) => ({ index: i, ...describeBlock(b) }));
  }

  /** Every asset hash this WAD publishes, and which block owns it — for collision checks. */
  assetIndex() {
    const map = new Map();
    this.blocks.forEach((b, bi) => {
      for (const e of b.asetEntries) map.set(e.assetHash >>> 0, { block: bi, typeId: e.u32_3 });
    });
    return map;
  }

  /**
   * Add a single-asset block from a UCFX container under a NEW name.
   *
   * @param {{name?, hash?, typeId, container: Uint8Array, sub?: PatchBlock}} o
   *   sub — an optional finer-LOD block to ship alongside (the two-block vehicle/character
   *   case). When present, the primary's ASET row is pointed at it and it is appended with
   *   no ASET row of its own, matching how the base game stores finer rungs.
   * @returns {{hash, index, warnings: string[]}}
   */
  addAsset({ name, hash, typeId, container, sub = null }) {
    const h = hash !== undefined ? (hash >>> 0) : pandemicHashM2(name);
    if (!TYPE[typeId]) throw new Error(`unsupported type_id ${typeId}`);
    const warnings = [];

    const existing = this.assetIndex();
    if (existing.has(h)) {
      warnings.push(`0x${h.toString(16).toUpperCase()} already exists in this WAD (block ${existing.get(h).block}); it will be shadowed by load order, not replaced. Rename to avoid ambiguity.`);
    }

    const primary = makeExtraBlock(container, h, typeId,
      name ? `blocks\\VZ\\${name}_P000.block` : undefined);

    if (sub) {
      // The sub block is added FIRST so its index is known, then referenced. Its own ASET
      // rows are dropped: a finer rung is reached only through the parent's sub.
      const subIndex = this.blocks.length + 1; // primary goes at length, sub right after
      primary.asetEntries[0] = new AsetEntry(h, 0xffffffff, subIndex & 0xffff, typeId);
      const subBlock = new PatchBlock(sub.compressedData,
        name ? `blocks\\VZ\\${name}_P001.block` : `blocks\\VZ\\sub_${hex8(h).slice(2).toLowerCase()}.block`,
        []);
      subBlock.packedField = sub.packedField;
      this.blocks.push(primary, subBlock);
      return { hash: h, index: this.blocks.length - 2, warnings };
    }

    this.blocks.push(primary);
    return { hash: h, index: this.blocks.length - 1, warnings };
  }

  /** Add an already-framed PatchBlock (e.g. one carved out of another WAD). */
  addBlock(block) {
    this.blocks.push(block);
    return { index: this.blocks.length - 1 };
  }

  /**
   * Merge another patch WAD's blocks in.
   *
   * @param {Uint8Array} otherBytes
   * @param {{replace?: boolean}} opts  replace matches by path, else append
   * @returns {{added: number, replaced: number, warnings: string[]}}
   */
  merge(otherBytes, { replace = false } = {}) {
    const other = readPatchWad(otherBytes);
    const warnings = [];
    const mineByHash = this.assetIndex();
    let added = 0, replaced = 0;

    for (const nb of other.blocks) {
      // Collision surfacing: a merged block that publishes a hash we already have.
      for (const e of nb.asetEntries) {
        if (mineByHash.has(e.assetHash >>> 0)) {
          warnings.push(`Both WADs publish ${hex8(e.assetHash)} — after merge, load order decides which wins.`);
        }
      }
      if (replace) {
        const idx = this.blocks.findIndex((old) => old.pathString === nb.pathString);
        if (idx >= 0) { this.blocks[idx] = nb; replaced++; continue; }
      }
      this.blocks.push(nb);
      added++;
    }
    return { added, replaced, warnings };
  }

  /** Remove a block by index. Returns the removed block's summary, or null. */
  deleteBlock(index) {
    if (index < 0 || index >= this.blocks.length) return null;
    const [removed] = this.blocks.splice(index, 1);
    // A block that some other block's `sub` pointed at is now gone. Flag it rather than
    // silently producing a WAD that references a missing rung.
    const orphaned = [];
    this.blocks.forEach((b, bi) => {
      for (const e of b.asetEntries) {
        const sub = e.u32_2 & 0xffff;
        if (sub !== 0xffff && sub === index) orphaned.push(hex8(e.assetHash));
      }
    });
    return { removed: describeBlock(removed), orphaned };
  }

  /** Remove every block that publishes `hash` (and warn if it leaves a dangling sub). */
  deleteAsset(hash) {
    const h = hash >>> 0;
    const idx = this.blocks.findIndex((b) => b.asetEntries.some((e) => (e.assetHash >>> 0) === h));
    if (idx < 0) return null;
    return this.deleteBlock(idx);
  }
}

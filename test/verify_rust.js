// Cross-check the JS port against the actual Rust reader + the engine loader, on real game
// data. This is the fidelity proof the byte-level unit tests cannot give: a WAD that passes
// every JS assertion but that the engine rejects is still broken.
//
//   node test/verify_rust.js <a-real-vz-patch.wad>
//
// It (1) reads the WAD in JS, (2) writes it back out, (3) writes a version with one new
// texture asset added, and prints what it did. The shell wrapper (verify_rust.sh) then runs
// the workshop loader over the outputs and diffs the asset counts.

import { readFileSync, writeFileSync } from 'node:fs';
import { WadDoc } from '../src/wad.js';
import { hex8, pandemicHashM2 } from '../src/hash.js';

const src = process.argv[2];
const outDir = process.argv[3] || '.';
if (!src) { console.error('usage: node verify_rust.js <wad> [outdir]'); process.exit(2); }

const raw = new Uint8Array(readFileSync(src));
console.log(`read ${src}  (${(raw.length / 1e6).toFixed(1)} MB)`);

const doc = WadDoc.fromBytes(raw);
console.log(`  blocks: ${doc.blocks.length}`);
console.log(`  distinct assets: ${doc.assetIndex().size}`);

// (1) rewrite unchanged — must reproduce a loadable WAD with the same asset set
const rewritten = doc.toBytes();
writeFileSync(`${outDir}/js_rewrite.wad`, rewritten);
console.log(`  wrote js_rewrite.wad (${(rewritten.length / 1e6).toFixed(1)} MB, ${doc.blocks.length} blocks)`);

// framing invariants that must hold for the engine
const dv = new DataView(rewritten.buffer);
const magic = String.fromCharCode(rewritten[0], rewritten[1], rewritten[2], rewritten[3]);
if (magic !== 'FFCS') { console.error('  FAIL: output is not FFCS'); process.exit(1); }
// first DATA block must start at 0x208000
const dataOff = dv.getUint32(0x0c + 12 + 4, true);
if (dataOff !== 0x208000) { console.error(`  FAIL: DATA offset ${hex8(dataOff)} != 0x208000`); process.exit(1); }
console.log('  framing OK: FFCS magic, DATA @ 0x208000');

// (2) add one new texture asset from a container carved out of the WAD itself, so we do not
// need any external file. Reuse the first texture-typed block's inner container.
const list = doc.list();
const texBlock = list.find((b) => b.asetHashes.some((a) => a.typeId === 27));
if (texBlock) {
  // pull the raw container back out of that block to reuse as our new asset's bytes
  const { decompressSges, isSges } = await import('../src/sges.js');
  const { parseBlockEntryTable } = await import('../src/block.js');
  const blk = doc.blocks[texBlock.index];
  const inner = isSges(blk.compressedData) ? decompressSges(blk.compressedData) : blk.compressedData;
  const { entries } = parseBlockEntryTable(inner);
  // the container is the first chunk after the entry table
  const tableEnd = 4 + entries.length * 16;
  const container = inner.slice(tableEnd, tableEnd + entries[0].chunkSize);
  const name = 'wadjs_probe_tex';
  const res = doc.addAsset({ name, typeId: 27, container });
  console.log(`  added ${name} = ${hex8(res.hash)}${res.warnings.length ? '  [' + res.warnings.join('; ') + ']' : ''}`);
  const withAdd = doc.toBytes();
  writeFileSync(`${outDir}/js_added.wad`, withAdd);
  console.log(`  wrote js_added.wad (${doc.blocks.length} blocks)  probe asset ${hex8(res.hash)} name=${name}`);
} else {
  console.log('  (no texture block found to reuse; skipped the add test)');
}

// The load-bearing test: a WAD this JS code writes must be byte-faithful in its framing and
// must load through the Rust reader and the engine. This suite covers the pure-JS half
// (round-trips, framing, the sges contract); test/verify_rust.js does the cross-check against
// the actual Rust tool and the workshop loader on real game data.

import { compressSges, decompressSges } from '../src/sges.js';
import { pandemicHashM2, crc32Mercs2, hex8 } from '../src/hash.js';
import { readPatchWad, buildPatchWadMulti, mergePatchWads, PatchBlock, AsetEntry } from '../src/patch_wad.js';
import { makeExtraBlock, parseBlockEntryTable, describeBlock } from '../src/block.js';
import { WadDoc } from '../src/wad.js';

function ucfx(body) {
  // A minimal but structurally valid UCFX container: magic + a small entry table.
  const b = new Uint8Array(20 + body);
  b[0] = 0x55; b[1] = 0x43; b[2] = 0x46; b[3] = 0x58; // UCFX
  for (let i = 20; i < b.length; i++) b[i] = (i * 7) & 0xff;
  return b;
}

export function run(t) {
  // ---- hashes: pinned values, so a refactor that breaks them is caught
  t.eq('pandemicHashM2("script")', hex8(pandemicHashM2('script')), '0x42498680');
  t.eq('pandemicHashM2 empty', pandemicHashM2(''), 0);
  t.eq('pandemicHashM2 is case-insensitive',
    pandemicHashM2('MyMod') === pandemicHashM2('mymod'), true);
  // crc32 of "123456789" is the ISO-HDLC check value 0xCBF43926
  t.eq('crc32 check value', hex8(crc32Mercs2(new TextEncoder().encode('123456789'))), '0xCBF43926');

  // ---- sges round-trips, including the tricky layouts the Rust suite pins
  const cases = {
    small: new TextEncoder().encode('hello sges world, the quick brown fox jumps over the lazy dog'),
    compressible: new Uint8Array(200000).fill(0xab),
    multiSegment: (() => {
      const d = new Uint8Array(270000);
      for (let i = 0; i < 200000; i++) d[i] = (Math.imul(i, 2654435761) >>> 13) & 0xff;
      return d; // > 4 full 64 KB segments + a compressible tail
    })(),
    incompressible: (() => {
      const d = new Uint8Array(100000);
      let x = 0x12345678 >>> 0;
      for (let i = 0; i < d.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; d[i] = x & 0xff; }
      return d; // xorshift noise -> deflate can't shrink it -> stored raw
    })(),
  };
  for (const [name, data] of Object.entries(cases)) {
    const block = compressSges(data);
    t.eq(`sges magic (${name})`, String.fromCharCode(block[0], block[1], block[2], block[3]), 'sges');
    const back = decompressSges(block);
    let same = back.length === data.length;
    for (let i = 0; same && i < data.length; i++) same = back[i] === data[i];
    t.ok(`sges round-trip (${name}, ${data.length}B)`, same);
  }

  // ---- sges framing byte-faithfulness: header layout and 16-byte alignment
  {
    const block = compressSges(cases.multiSegment);
    const dv = new DataView(block.buffer, block.byteOffset);
    const segCount = dv.getUint16(6, true);
    t.eq('sges major version is 4', dv.getUint16(4, true), 4);
    t.ok('sges segment count matches 65536-chunking', segCount === Math.ceil(cases.multiSegment.length / 65536));
    t.eq('sges total_uncompressed field', dv.getUint32(8, true), cases.multiSegment.length);
    // every segment offset is 16-byte aligned (bit 0 is the compressed flag, so mask it)
    let aligned = true;
    for (let i = 0; i < segCount; i++) {
      const off = dv.getUint32(16 + i * 8 + 4, true) & 0xfffffffe;
      if (off % 16 !== 0) aligned = false;
    }
    t.ok('all sges segment offsets are 16-byte aligned', aligned);
  }

  // ---- patch WAD build -> read round-trip (mirrors the Rust build_then_read test)
  {
    const b0 = new PatchBlock(new Uint8Array(24).fill(0xab),
      'blocks\\dlc01\\resident_p000_q3.block',
      [new AsetEntry(0x11111111, 0xffffffff, 0x1234, 0xaa), new AsetEntry(0x22222222, 1, 2, 3)]);
    const b1 = new PatchBlock(new Uint8Array(32).fill(0xcd),
      'blocks\\dlc01\\speedcity\\foo.block',
      [new AsetEntry(0x33333333, 0xffffffff, 0x5678, 0xbb)]);
    const wad = buildPatchWadMulti([b0, b1], 0, null);
    t.eq('WAD magic', String.fromCharCode(wad[0], wad[1], wad[2], wad[3]), 'FFCS');

    const parsed = readPatchWad(wad);
    t.eq('block count survives', parsed.blocks.length, 2);
    t.eq('path 0 survives', parsed.blocks[0].pathString, b0.pathString);
    t.eq('path 1 survives', parsed.blocks[1].pathString, b1.pathString);
    // the compressed payloads come back byte-identical (trailing-zero trim + 4-byte realign)
    let p0ok = parsed.blocks[0].compressedData.length === 24;
    for (let i = 0; p0ok && i < 24; i++) p0ok = parsed.blocks[0].compressedData[i] === 0xab;
    t.ok('block 0 payload survives', p0ok);
    // ASET grouping by block index
    t.eq('block 0 has 2 ASET rows', parsed.blocks[0].asetEntries.length, 2);
    t.eq('block 1 has 1 ASET row', parsed.blocks[1].asetEntries.length, 1);
    // ★ the sub field (u32_2 low 16) survives the block-index remap
    t.eq('sub field survives on block 0', parsed.blocks[0].asetEntries[0].u32_2 & 0xffff, 0x1234);
    t.eq('block-index high half is reassigned', (parsed.blocks[1].asetEntries[0].u32_2 >>> 16) & 0xffff, 1);
  }

  // ---- makeExtraBlock: the container framing the engine reads
  {
    const c = ucfx(200);
    const blk = makeExtraBlock(c, pandemicHashM2('mytex'), 27);
    const inner = decompressSges(blk.compressedData);
    const dv = new DataView(inner.buffer, inner.byteOffset);
    t.eq('extra block: entry count = 1', dv.getUint32(0, true), 1);
    t.eq('extra block: name hash', dv.getUint32(4, true) >>> 0, pandemicHashM2('mytex'));
    t.eq('extra block: texture type hash', hex8(dv.getUint32(8, true)), '0xF011157A');
    t.eq('extra block: container length', dv.getUint32(16, true), c.length);
    const { entries } = parseBlockEntryTable(inner);
    t.eq('extra block parses back to 1 asset', entries.length, 1);
    t.eq('single ASET row, no sub', blk.asetEntries[0].u32_2 & 0xffff, 0xffff);
  }

  // ---- WadDoc: add / merge / delete
  {
    const doc = WadDoc.empty();
    const r1 = doc.addAsset({ name: 'skin_alpha', typeId: 27, container: ucfx(100) });
    const r2 = doc.addAsset({ name: 'skin_beta', typeId: 27, container: ucfx(120) });
    t.eq('two assets added', doc.blocks.length, 2);
    t.ok('distinct hashes', r1.hash !== r2.hash);

    // round-trip the whole doc through bytes
    const bytes = doc.toBytes();
    const reload = WadDoc.fromBytes(bytes);
    t.eq('doc survives a byte round-trip', reload.blocks.length, 2);
    t.eq('asset index finds both', reload.assetIndex().size, 2);

    // collision warning on re-adding the same name
    const r3 = doc.addAsset({ name: 'skin_alpha', typeId: 27, container: ucfx(100) });
    t.ok('collision is warned, not silently dropped', r3.warnings.length > 0);

    // delete by asset hash
    const del = doc.deleteAsset(r2.hash);
    t.ok('delete removes the block', del !== null);
    t.eq('one block gone', doc.blocks.length, 2); // was 3 after the dup add
  }

  // ---- two-block add: the sub-pointer is set to the appended sub block
  {
    const doc = WadDoc.empty();
    doc.addAsset({ name: 'filler', typeId: 27, container: ucfx(40) }); // shift indices
    const subBlk = makeExtraBlock(ucfx(500), pandemicHashM2('veh_detail'), 19);
    const res = doc.addAsset({ name: 'veh_clone', typeId: 19, container: ucfx(300), sub: subBlk });
    const primary = doc.blocks[res.index];
    const subIndex = res.index + 1;
    t.eq('primary sub points at the appended sub block', primary.asetEntries[0].u32_2 & 0xffff, subIndex);
    t.eq('sub block carries no ASET row', doc.blocks[subIndex].asetEntries.length, 0);

    // and it survives serialization with the sub intact
    const reload = WadDoc.fromBytes(doc.toBytes());
    t.eq('sub survives round-trip', reload.blocks[res.index].asetEntries[0].u32_2 & 0xffff, subIndex);
  }

  // ---- mergePatchWads low-level parity with WadDoc.merge
  {
    const a = WadDoc.empty();
    a.addAsset({ name: 'a1', typeId: 27, container: ucfx(60) });
    const b = WadDoc.empty();
    b.addAsset({ name: 'b1', typeId: 27, container: ucfx(60) });
    const mergedBytes = mergePatchWads(a.toBytes(), readPatchWad(b.toBytes()).blocks, false);
    t.eq('low-level merge yields 2 blocks', readPatchWad(mergedBytes).blocks.length, 2);

    const doc = WadDoc.fromBytes(a.toBytes());
    const rep = doc.merge(b.toBytes());
    t.eq('WadDoc.merge yields 2 blocks', doc.blocks.length, 2);
    t.eq('WadDoc.merge reports 1 added', rep.added, 1);
  }
}

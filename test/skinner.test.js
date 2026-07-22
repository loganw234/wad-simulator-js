// The "pack a skinner export" path: unzip, read install.bat, produce ready-to-pack blocks.
// Uses the bundled sample zip, so this also proves the sample is intact and parseable.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseSkinnerZip, assetsToBlocks } from '../src/skinner_import.js';
import { WadDoc } from '../src/wad.js';
import { readPatchWad } from '../src/patch_wad.js';
import { hex8 } from '../src/hash.js';
import { zipSync } from '../vendor/fflate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function run(t) {
  // ---- a hand-built zip with a %~dp0-style install.bat, so the path parse is exercised
  const bat = [
    '@echo off',
    '"%SM%" --source-wad "%WAD%" --extra-only ^',
    '    --inject-extra 0x98BAA068:27:"%~dp0my_skin_body.ucfx" ^',
    '    --inject-extra 0x4C868C8D:19:"%~dp0my_skin.ucfx" ^',
    '    -o "%~dp0my_skin-patch.wad"',
  ].join('\r\n');
  const ucfx = (n) => { const b = new Uint8Array(40); b.set([0x55, 0x43, 0x46, 0x58]); for (let i = 20; i < 40; i++) b[i] = (i * n) & 0xff; return b; };
  const zip = zipSync({
    'my_skin.ucfx': ucfx(3),
    'my_skin_body.ucfx': ucfx(7),
    'install.bat': new TextEncoder().encode(bat),
  });

  const parsed = parseSkinnerZip(zip);
  t.eq('reads from the install script', parsed.source.includes('install'), true);
  t.eq('no warnings on a clean export', parsed.warnings.length, 0);
  t.eq('finds 2 assets', parsed.assets.length, 2);

  const model = parsed.assets.find((a) => a.typeId === 19);
  const tex = parsed.assets.find((a) => a.typeId === 27);
  t.ok('the %~dp0 prefix is stripped from the model filename', model && model.name === 'my_skin');
  t.eq('model hash comes from install.bat, not the filename', hex8(model.hash), '0x4C868C8D');
  t.ok('the texture is typed 27', tex && tex.name === 'my_skin_body');
  t.eq('texture hash from install.bat', hex8(tex.hash), '0x98BAA068');

  // ---- pack into a WAD and read it back
  const doc = WadDoc.empty();
  for (const { block } of assetsToBlocks(parsed.assets)) doc.addBlock(block);
  t.eq('two blocks packed', doc.blocks.length, 2);
  const back = readPatchWad(doc.toBytes());
  t.eq('WAD round-trips to 2 blocks', back.blocks.length, 2);
  const hashes = back.blocks.flatMap((b) => b.asetEntries.map((e) => e.assetHash >>> 0));
  t.ok('both asset hashes present after packing',
    hashes.includes(0x4c868c8d) && hashes.includes(0x98baa068));
  // model listed first (assetsToBlocks orders type-19 ahead)
  t.eq('model block is first', hex8(back.blocks[0].asetEntries[0].assetHash), '0x4C868C8D');

  // ---- a zip with no .ucfx is rejected clearly
  const notSkin = zipSync({ 'readme.txt': new TextEncoder().encode('hello') });
  t.throws('a zip with no containers is rejected', () => parseSkinnerZip(notSkin), /ucfx/i);

  // ---- the bundled sample parses (also proves samples/ is intact). It is deliberately a
  // SYNTHETIC texture with no game art — the public repo must not ship extracted geometry.
  const samplePath = resolve(ROOT, 'samples/demo-texture-assets.zip');
  if (existsSync(samplePath)) {
    const s = parseSkinnerZip(new Uint8Array(readFileSync(samplePath)));
    t.ok('bundled sample has at least one asset', s.assets.length >= 1);
    t.eq('bundled sample, no warnings', s.warnings.length, 0);
    t.ok('bundled sample is texture-only (no game model geometry)',
      s.assets.every((a) => a.typeId === 27));
  } else {
    t.info('samples/demo-texture-assets.zip absent — skipped the bundled-sample check');
  }
}

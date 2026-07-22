// Add a real UCFX container into a real WAD via the JS lib, then write both a plain rewrite
// and the added version, so the shell wrapper can load them through the workshop.
//   node test/addprobe.js <wad> <container.ucfx> <outdir>
import { readFileSync, writeFileSync } from 'node:fs';
import { WadDoc } from '../src/wad.js';
import { hex8 } from '../src/hash.js';

const [wadPath, ucfxPath, outDir] = process.argv.slice(2);
const wad = new Uint8Array(readFileSync(wadPath));
const container = new Uint8Array(readFileSync(ucfxPath));

writeFileSync(`${outDir}/js_rewrite.wad`, WadDoc.fromBytes(wad).toBytes());

const doc = WadDoc.fromBytes(wad);
const before = doc.blocks.length;
const res = doc.addAsset({ name: 'wadjs_probe_tex', typeId: 27, container });
writeFileSync(`${outDir}/js_added.wad`, doc.toBytes());
console.log(`rewrite: ${before} blocks`);
console.log(`added wadjs_probe_tex = ${hex8(res.hash)}  ->  ${doc.blocks.length} blocks`);
if (res.warnings.length) console.log('warnings: ' + res.warnings.join('; '));

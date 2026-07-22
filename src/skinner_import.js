// Read a skinner "-assets.zip" and turn it into ready-to-pack blocks.
//
// The skinner's new-asset export is a zip of:
//   <model>.ucfx            the model container (type 19)
//   <model>_<part>.ucfx     one texture container each (type 27)
//   install.bat             the packing recipe
//
// install.bat is the AUTHORITATIVE manifest: it carries the exact
// `--inject-extra <HASH>:<TYPEID>:"...<file>"` line per asset. Parsing it means we never
// have to guess a hash or a type from a filename — we use precisely what the skinner
// intended, so a WAD packed here is identical in identity to one packed by the smuggler the
// .bat would have called. This is the whole point of the "pack a skinner export" path: the
// zip already knows everything; the tool just does what the .bat says without a shell.

import { unzipSync } from '../vendor/fflate.js';
import { makeExtraBlock, TYPE } from './block.js';
import { pandemicHashM2, hex8 } from './hash.js';
import { isUcfx } from './sges.js';

const basename = (p) => p.replace(/\\/g, '/').split('/').pop();

/** Strip a `.bat`/`.sh` path expression down to a bare filename: drops a surrounding quote,
 *  a `%~dp0` / `$(dirname …)` prefix, and any directory part. */
function cleanFilename(raw) {
  let f = raw.trim().replace(/^["']|["']$/g, '');
  // %~dp0 is `%~` + modifier letters + the arg digit. Match exactly that, or `[a-z]+` would
  // greedily eat into the filename (%~dp0merc… -> stripped to _test…).
  f = f.replace(/^%~[a-z]+\d/i, '');
  f = f.replace(/^\$\{?[^}\s/]*\}?\//, '');     // ${DIR}/ or $DIR/
  return basename(f);
}

/** Pull the `--inject-extra HASH:TYPEID:file` lines out of an install.bat / .sh. */
function parseInstallScript(text) {
  const out = [];
  // The file field runs from the third colon to `.ucfx`, and may carry a quote and a
  // %~dp0-style prefix — captured whole here, cleaned to a basename by cleanFilename.
  const re = /--inject-extra\s+(0x[0-9a-fA-F]+)\s*:\s*(\d+)\s*:\s*("?[^"\n]*?\.ucfx"?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ hash: parseInt(m[1], 16) >>> 0, typeId: Number(m[2]), file: cleanFilename(m[3]) });
  }
  return out;
}

/**
 * @param {Uint8Array} zipBytes
 * @returns {{assets: Array<{name, hash, typeId, file, container}>, source: string, warnings: string[]}}
 */
export function parseSkinnerZip(zipBytes) {
  let files;
  try {
    files = unzipSync(zipBytes);
  } catch (e) {
    throw new Error(`Could not read the zip: ${e.message}`);
  }

  // index every entry by basename (skinner zips are flat, but be forgiving)
  const byBase = new Map();
  const ucfxNames = [];
  for (const path of Object.keys(files)) {
    const b = basename(path);
    byBase.set(b.toLowerCase(), files[path]);
    if (/\.ucfx$/i.test(b)) ucfxNames.push(b);
  }
  if (!ucfxNames.length) {
    throw new Error('No .ucfx containers in this zip. Is it a skinner "new asset" export? '
      + '(The modkit export has PNGs and a mod.json instead — that route packs itself.)');
  }

  const warnings = [];

  // Prefer the install script: it is the authoritative hash/type map.
  const scriptName = Object.keys(files).map(basename)
    .find((n) => /^install\.(bat|sh)$|^build\.(bat|sh)$/i.test(n));
  const recipe = scriptName
    ? parseInstallScript(new TextDecoder().decode(byBase.get(scriptName.toLowerCase())))
    : [];

  const assets = [];
  const used = new Set();

  for (const r of recipe) {
    const container = byBase.get(r.file.toLowerCase());
    if (!container) {
      warnings.push(`${r.file} is named in install.bat but not present in the zip — skipped.`);
      continue;
    }
    if (!isUcfx(container)) {
      warnings.push(`${r.file} is not a UCFX container — skipped.`);
      continue;
    }
    if (!TYPE[r.typeId]) {
      warnings.push(`${r.file} has an unknown type ${r.typeId} — skipped.`);
      continue;
    }
    used.add(r.file.toLowerCase());
    assets.push({ name: r.file.replace(/\.ucfx$/i, ''), hash: r.hash, typeId: r.typeId, file: r.file, container });
  }

  // Any .ucfx the script did not mention: fall back to inferring from the filename. The
  // skinner names each file after its asset, so the hash is the name hashed; the type is
  // guessed from the naming convention (a bare model name = model, a suffixed one = texture).
  for (const name of ucfxNames) {
    if (used.has(name.toLowerCase())) continue;
    const base = name.replace(/\.ucfx$/i, '');
    const container = byBase.get(name.toLowerCase());
    if (!isUcfx(container)) continue;
    // `_nm`/`_sm`/`_dm` or any `_part` suffix ⇒ texture; otherwise assume a model.
    const looksTexture = /_(ub|lb|head|hair|eyes|body|dm|nm|sm|[a-z]+)$/i.test(base) && base.includes('_');
    const typeId = looksTexture ? 27 : 19;
    warnings.push(`${name} was not in install.bat; guessed ${TYPE[typeId].label} from its name.`);
    assets.push({ name: base, hash: pandemicHashM2(base) >>> 0, typeId, file: name, container });
  }

  if (!assets.length) throw new Error('The zip had .ucfx files but none could be resolved to an asset.');

  return { assets, source: scriptName ? `install script (${scriptName})` : 'filenames', warnings };
}

/** Turn parsed assets into blocks ready to append. Model first, so a viewer reads it first. */
export function assetsToBlocks(assets) {
  const order = [...assets].sort((a, b) => (a.typeId === 19 ? 0 : 1) - (b.typeId === 19 ? 0 : 1));
  return order.map((a) => ({
    asset: a,
    block: makeExtraBlock(a.container, a.hash, a.typeId, `blocks\\VZ\\${a.name}.block`),
  }));
}

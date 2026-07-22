// wad-simulator-js UI.
//
// A patch WAD is otherwise a 100 MB binary blob nobody can see inside. This opens one, shows
// every block and the assets it publishes, and lets you add / merge / delete — then hands
// back a WAD the game loads. The whole engine is the byte-faithful port in src/; this file
// is only wiring.
//
// It keeps the skinner's shape on purpose: a card to choose what you're doing, one guided
// panel at a time, and a verdict after anything you drop, so "did it work?" is answered where
// you're looking instead of being inferred from silence.

import { $, el, fmtBytes, wireDrop, readFileBytes, downloadBytes, verdict } from './dom.js';
import { Rail } from './rail.js';
import { WadDoc } from '../wad.js';
import { hex8, pandemicHashM2, sanitizeAssetName } from '../hash.js';
import { isUcfx } from '../sges.js';
import { TYPE } from '../block.js';
import { parseSkinnerZip, assetsToBlocks } from '../skinner_import.js';

const S = { doc: null, name: 'my-patch.wad' };

export function boot() {
  renderStart();
}

// ---------------------------------------------------------------- start
function renderStart() {
  const root = $('#app');
  root.innerHTML = '';
  root.appendChild(el('div', 'lead',
    'Open a patch WAD to see and change what is inside it, or start an empty one. '
    + 'Everything happens in your browser — nothing is uploaded.'));

  const cards = el('div', 'cards');

  const openCard = el('button', 'card');
  openCard.appendChild(el('div', 'card-icon', '📂'));
  openCard.appendChild(el('div', 'card-t', 'Open a WAD'));
  openCard.appendChild(el('div', 'card-s', 'Drop an existing vz-patch.wad to inspect, add to, or trim it.'));
  const openInput = el('input');
  openInput.type = 'file';
  openInput.accept = '.wad';
  openInput.style.display = 'none';
  openCard.appendChild(openInput);
  openCard.addEventListener('click', () => openInput.click());
  openInput.addEventListener('change', (e) => { if (e.target.files[0]) openWad(e.target.files[0]); });
  cards.appendChild(openCard);

  const packCard = el('button', 'card feature');
  packCard.appendChild(el('div', 'card-icon', '🎨'));
  packCard.appendChild(el('div', 'card-t', 'Pack a skinner export'));
  packCard.appendChild(el('div', 'card-s', 'Drop the .zip the skinner gave you and get a ready-to-install WAD. No command line.'));
  packCard.addEventListener('click', () => renderPack());
  cards.appendChild(packCard);

  const newCard = el('button', 'card');
  newCard.appendChild(el('div', 'card-icon', '✨'));
  newCard.appendChild(el('div', 'card-t', 'Start empty'));
  newCard.appendChild(el('div', 'card-s', 'Build a fresh patch from scratch by adding assets one at a time.'));
  newCard.addEventListener('click', () => { S.doc = WadDoc.empty(); S.name = 'my-patch.wad'; renderManager(); });
  cards.appendChild(newCard);

  root.appendChild(cards);

  // A drop zone spanning both, so dragging a WAD anywhere works.
  const drop = el('label', 'drop');
  drop.appendChild(el('b', null, '…or drop a .wad here'));
  drop.appendChild(el('span', 'hint', 'Windows: your game\'s data\\vz-patch.wad'));
  const dropInput = el('input');
  dropInput.type = 'file';
  dropInput.accept = '.wad';
  drop.appendChild(dropInput);
  wireDrop(drop, dropInput, (files) => { if (files[0]) openWad(files[0]); });
  root.appendChild(drop);

  root.appendChild(el('div', 'note',
    'New to this? A patch WAD is a mod file the game loads on top of its own data — it '
    + 'never changes the base game. This tool reads and writes them; it does not make skins. '
    + 'For that, use the skinner and bring its output here to pack.'));
}

async function openWad(file) {
  const root = $('#app');
  try {
    const bytes = await readFileBytes(file);
    S.doc = WadDoc.fromBytes(bytes);
    S.name = file.name || 'patch.wad';
    renderManager();
  } catch (e) {
    const box = el('div');
    box.appendChild(verdict({
      ok: false, title: 'That is not a patch WAD',
      lines: [{ k: 'file', v: file.name, ok: false }, { k: 'reason', v: e.message }],
      hint: 'A patch WAD starts with the bytes "FFCS". This looks like something else — '
        + 'a base vz.wad, a texture, or an unrelated file.',
    }));
    root.appendChild(box);
  }
}

// ---------------------------------------------------------------- pack a skinner export
// The guided path. A skinner "-assets.zip" already contains everything — the model, the
// textures, and an install.bat that says exactly what each asset is called and what type it
// is. This walks it in one rail: drop it (or try the sample), see what's inside, pick where
// it goes, and out comes a WAD the game loads. The install.bat the zip carries would have
// run mercs2_smuggler; this does the same packing with no shell and no download of a tool.
function renderPack() {
  const root = $('#app');
  root.innerHTML = '';
  root.appendChild(el('div', 'lead',
    'The skinner\'s "new asset" export is a .zip. Drop it here and this packs it into a '
    + 'patch WAD for you — the same result its install.bat would produce, without a command line.'));

  const railRoot = el('div');
  root.appendChild(railRoot);
  const back = el('button', 'btn ghost', '← Back');
  back.style.marginTop = '14px';
  back.addEventListener('click', renderStart);
  root.appendChild(back);

  const P = { parsed: null };
  const rail = new Rail(railRoot);

  rail.add('drop', 'Drop your skinner export', (body) => {
    body.appendChild(el('p', null,
      'The file the skinner downloaded, named something like my_skin-assets.zip. It holds '
      + 'the model, the textures and an install.bat — you do not need to unzip it.'));

    const zone = el('label', 'drop');
    zone.appendChild(el('b', null, 'Drop the -assets.zip'));
    zone.appendChild(el('span', 'hint', 'or click to choose it'));
    const input = el('input');
    input.type = 'file';
    input.accept = '.zip';
    zone.appendChild(input);
    wireDrop(zone, input, (files) => { if (files[0]) tryZip(files[0]); });
    body.appendChild(zone);

    const sampleRow = el('div', 'sample-row');
    sampleRow.appendChild(el('span', 'dim', 'Never done this? '));
    const sample = el('button', 'btn ghost', 'Try a ready-made example');
    sample.addEventListener('click', () => loadSample(sample));
    sampleRow.appendChild(sample);
    sampleRow.appendChild(el('div', 'note',
      'A small synthetic texture — no game art — packaged like a skinner export. Pack it and '
      + 'watch the whole flow work before you make your own.'));
    body.appendChild(sampleRow);

    const out = el('div');
    out.id = 'pack-out';
    body.appendChild(out);

    async function tryZip(file) {
      out.innerHTML = '';
      let bytes;
      try { bytes = await readFileBytes(file); } catch (e) { return; }
      handleZipBytes(bytes, file.name, out);
    }
    async function loadSample(btn) {
      btn.disabled = true; btn.textContent = 'loading…';
      out.innerHTML = '';
      try {
        const bytes = await fetchSample();
        handleZipBytes(bytes, 'demo-texture-assets.zip', out);
      } catch (e) {
        out.appendChild(verdict({
          ok: false, title: 'Sample unavailable',
          lines: [{ k: 'reason', v: e.message, ok: false }],
          hint: 'The offline single-file build does not carry the sample. Use the hosted '
            + 'version for the example, or drop your own export.',
        }));
      }
      btn.disabled = false; btn.textContent = 'Try a ready-made example';
    }
    function handleZipBytes(bytes, fname, out) {
      try {
        P.parsed = parseSkinnerZip(bytes);
      } catch (e) {
        return out.appendChild(verdict({
          ok: false, title: 'That is not a skinner export',
          lines: [{ k: 'file', v: fname, ok: false }, { k: 'reason', v: e.message }],
          hint: 'Drop the -assets.zip from the skinner\'s "new asset" export. The modkit '
            + 'export (PNGs + mod.json) packs itself and does not come here.',
        }));
      }
      P.name = sanitizeAssetName(fname.replace(/-assets\.zip$/i, '').replace(/\.zip$/i, '')) || 'my_skin';
      const models = P.parsed.assets.filter((a) => a.typeId === 19);
      const texes = P.parsed.assets.filter((a) => a.typeId === 27);
      out.appendChild(verdict({
        ok: true,
        title: `Read ${P.parsed.assets.length} asset${P.parsed.assets.length === 1 ? '' : 's'} from ${fname}`,
        lines: [
          { k: 'models', v: models.map((a) => `${a.name} ${hex8(a.hash)}`).join(', ') || 'none' },
          { k: 'textures', v: texes.map((a) => a.name).join(', ') || 'none' },
          { k: 'read from', v: P.parsed.source },
        ],
        hint: P.parsed.warnings.length ? P.parsed.warnings.join(' ') : undefined,
      }));
      const act = el('div', 'step-actions');
      const go = el('button', 'btn', 'Use these →');
      go.addEventListener('click', () => rail.complete('drop'));
      act.appendChild(go);
      out.appendChild(act);
    }
  }, () => (P.parsed ? `${P.parsed.assets.length} assets` : ''));

  rail.add('target', 'Where should it go?', (body) => {
    body.appendChild(el('p', null,
      'A fresh patch is simplest. Merge into an existing one only if you already have a '
      + 'vz-patch.wad you want these to join.'));
    const cards = el('div', 'cards');

    const fresh = el('button', 'card');
    fresh.appendChild(el('div', 'card-icon', '✨'));
    fresh.appendChild(el('div', 'card-t', 'A fresh patch'));
    fresh.appendChild(el('div', 'card-s', 'Just these assets, in a new WAD.'));
    fresh.addEventListener('click', () => { S.doc = WadDoc.empty(); finishPack(P); });
    cards.appendChild(fresh);

    const into = el('label', 'card');
    into.appendChild(el('div', 'card-icon', '⤵'));
    into.appendChild(el('div', 'card-t', 'Into an existing WAD'));
    into.appendChild(el('div', 'card-s', 'Drop a vz-patch.wad; these are appended to it.'));
    const inp = el('input');
    inp.type = 'file'; inp.accept = '.wad'; inp.style.display = 'none';
    into.appendChild(inp);
    into.addEventListener('click', (e) => { if (e.target !== inp) inp.click(); });
    inp.addEventListener('change', async (e) => {
      if (!e.target.files[0]) return;
      try {
        S.doc = WadDoc.fromBytes(await readFileBytes(e.target.files[0]));
        S.name = e.target.files[0].name;
        finishPack(P, true);
      } catch (err) {
        flashInto(body, verdict({ ok: false, title: 'Not a WAD', lines: [{ k: 'reason', v: err.message, ok: false }] }));
      }
    });
    cards.appendChild(into);
    body.appendChild(cards);
  });

  rail.draw();
}

function finishPack(P, merged = false) {
  const warnings = [];
  for (const { asset, block } of assetsToBlocks(P.parsed.assets)) {
    if (S.doc.assetIndex().has(asset.hash >>> 0)) {
      warnings.push(`${asset.name} (${hex8(asset.hash)}) already exists in that WAD — it will be shadowed by load order.`);
    }
    S.doc.addBlock(block);
  }
  if (!merged) S.name = `${P.name || 'my_skin'}-patch.wad`;
  renderManager();
  const model = P.parsed.assets.find((a) => a.typeId === 19);
  flash(verdict({
    ok: true,
    title: `Packed ${P.parsed.assets.length} asset${P.parsed.assets.length === 1 ? '' : 's'}`,
    lines: [
      { k: 'blocks now', v: String(S.doc.blocks.length) },
      ...(warnings.length ? [{ k: 'collisions', v: String(warnings.length), ok: false }] : []),
    ],
    hint: (warnings.length ? warnings.join(' ') + '  ' : '')
      + 'Press Save WAD, then drop it in your game as data\\vz-patch.wad (back up any '
      + 'existing patch first)'
      + (model ? `. Wear it in game with:  Player.SetOutfit(Player.GetLocalCharacter(), "${model.name}")` : '.'),
  }));
}

function flashInto(el2, node) { el2.appendChild(node); }

// The offline single-file build may inline the sample as base64; the dev/hosted build fetches
// it. Try the global first so file:// works when it is present.
async function fetchSample() {
  if (typeof window !== 'undefined' && window.__WADSIM_SAMPLE_B64__) {
    const bin = atob(window.__WADSIM_SAMPLE_B64__);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  const res = await fetch('samples/demo-texture-assets.zip');
  if (!res.ok) throw new Error(`sample fetch failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------- manager
function renderManager() {
  const root = $('#app');
  root.innerHTML = '';

  // header: name + summary + save/close
  const bar = el('div', 'bar');
  const idx = S.doc.assetIndex();
  bar.appendChild(el('div', 'bar-title', S.name));
  bar.appendChild(el('div', 'bar-sub',
    `${S.doc.blocks.length} block${S.doc.blocks.length === 1 ? '' : 's'} · ${idx.size} asset${idx.size === 1 ? '' : 's'}`));
  const spacer = el('div');
  spacer.style.flex = '1';
  bar.appendChild(spacer);

  const save = el('button', 'btn', 'Save WAD');
  save.disabled = !S.doc.blocks.length;
  save.addEventListener('click', () => {
    const bytes = S.doc.toBytes();
    downloadBytes(S.name, bytes);
    flash(verdict({
      ok: true, title: 'Saved',
      lines: [{ k: 'file', v: S.name }, { k: 'size', v: fmtBytes(bytes.length) }, { k: 'blocks', v: String(S.doc.blocks.length) }],
      hint: 'Drop this in your game as data\\vz-patch.wad, or import it in the modkit to '
        + 'merge with your other mods. Back up any existing patch first.',
    }));
  });
  bar.appendChild(save);

  const close = el('button', 'btn ghost', 'Close');
  close.addEventListener('click', () => { S.doc = null; renderStart(); });
  bar.appendChild(close);
  root.appendChild(bar);

  // action row: add / merge
  const actions = el('div', 'actions');

  const addZone = el('label', 'drop small');
  addZone.appendChild(el('b', null, '＋ Add an asset'));
  addZone.appendChild(el('span', 'hint', 'drop a .ucfx container, or a skinner -assets.zip'));
  const addInput = el('input');
  addInput.type = 'file';
  addInput.accept = '.ucfx,.bin,.zip';
  addInput.multiple = true;
  addZone.appendChild(addInput);
  wireDrop(addZone, addInput, (files) => addAssets(files));
  actions.appendChild(addZone);

  const mergeZone = el('label', 'drop small');
  mergeZone.appendChild(el('b', null, '⤵ Merge another WAD'));
  mergeZone.appendChild(el('span', 'hint', 'drop a second .wad; its blocks are appended'));
  const mergeInput = el('input');
  mergeInput.type = 'file';
  mergeInput.accept = '.wad';
  mergeZone.appendChild(mergeInput);
  wireDrop(mergeZone, mergeInput, (files) => { if (files[0]) mergeWad(files[0]); });
  actions.appendChild(mergeZone);

  root.appendChild(actions);

  const out = el('div');
  out.id = 'op-out';
  root.appendChild(out);

  // block table
  root.appendChild(renderTable());
}

function renderTable() {
  const wrap = el('div', 'table-wrap');
  if (!S.doc.blocks.length) {
    wrap.appendChild(el('div', 'empty', 'No blocks yet. Add an asset above, or merge another WAD.'));
    return wrap;
  }
  const table = el('table', 'blocks');
  const head = el('tr');
  for (const h of ['#', 'kind', 'assets', 'path', 'size', '']) head.appendChild(el('th', null, h));
  table.appendChild(head);

  for (const b of S.doc.list()) {
    const tr = el('tr');
    tr.appendChild(el('td', 'mono dim', String(b.index)));
    const kindTd = el('td');
    kindTd.appendChild(kindChip(b));
    tr.appendChild(kindTd);

    const assets = el('td');
    if (b.asetHashes.length) {
      for (const a of b.asetHashes) {
        const chip = el('span', 'asset-chip');
        chip.appendChild(el('span', 'asset-h', a.hash));
        chip.appendChild(el('span', 'asset-t', a.typeLabel));
        if (a.sub !== null) chip.appendChild(el('span', 'asset-sub', `→ block ${a.sub}`));
        assets.appendChild(chip);
      }
    } else {
      assets.appendChild(el('span', 'dim', 'none (reached via a sub-pointer)'));
    }
    tr.appendChild(assets);

    tr.appendChild(el('td', 'mono path', b.path));
    tr.appendChild(el('td', 'mono dim', fmtBytes(b.compressedBytes)));

    const act = el('td');
    const del = el('button', 'btn tiny danger', 'Delete');
    del.addEventListener('click', () => deleteBlock(b.index));
    act.appendChild(del);
    tr.appendChild(act);

    table.appendChild(tr);
  }
  wrap.appendChild(table);
  return wrap;
}

function kindChip(b) {
  const span = el('span', 'kind-chip ' + b.kind);
  span.textContent = b.kind;
  return span;
}

// ---------------------------------------------------------------- operations
async function addAssets(files) {
  const results = [];

  // A skinner -assets.zip is handled whole: unzip, read its install.bat, add every asset with
  // the exact name/hash/type it declares. No per-file prompting — the zip already knows.
  for (const f of files.filter((x) => /\.zip$/i.test(x.name))) {
    try {
      const parsed = parseSkinnerZip(await readFileBytes(f));
      for (const { asset, block } of assetsToBlocks(parsed.assets)) {
        const collide = S.doc.assetIndex().has(asset.hash >>> 0);
        S.doc.addBlock(block);
        results.push({ ok: true, name: asset.name, hash: hex8(asset.hash),
          warnings: collide ? ['already present — shadowed by load order'] : [] });
      }
      for (const w of parsed.warnings) results.push({ ok: false, name: '(zip)', msg: w });
    } catch (e) {
      results.push({ ok: false, name: f.name, msg: e.message });
    }
  }

  const containers = files.filter((f) => /\.(ucfx|bin)$/i.test(f.name));
  if (!containers.length && !results.length) {
    return flash(verdict({
      ok: false, title: 'Nothing to add',
      lines: [{ k: 'dropped', v: `${files.length} file(s)`, ok: false }],
      hint: 'Add a .ucfx container, or a skinner -assets.zip. If you have a PNG, encode it '
        + 'to a texture container in the skinner first.',
    }));
  }
  for (const f of containers) {
    const bytes = await readFileBytes(f);
    if (!isUcfx(bytes)) {
      results.push({ ok: false, name: f.name, msg: 'not a UCFX container (wrong magic)' });
      continue;
    }
    const base = sanitizeAssetName(f.name.replace(/\.(ucfx|bin)$/i, ''));
    const { name, typeId } = await promptNameAndType(base);
    if (!name) { results.push({ ok: false, name: f.name, msg: 'cancelled' }); continue; }
    try {
      const res = S.doc.addAsset({ name, typeId, container: bytes });
      results.push({ ok: true, name, hash: hex8(res.hash), warnings: res.warnings });
    } catch (e) {
      results.push({ ok: false, name: f.name, msg: e.message });
    }
  }
  renderManager();
  const okc = results.filter((r) => r.ok).length;
  flash(verdict({
    ok: okc > 0,
    title: okc ? `Added ${okc} asset${okc === 1 ? '' : 's'}` : 'Nothing added',
    lines: results.map((r) => r.ok
      ? { k: r.name, v: r.hash + (r.warnings.length ? '  ⚠' : '') }
      : { k: r.name, v: r.msg, ok: false }),
    hint: results.some((r) => r.ok && r.warnings.length)
      ? 'A ⚠ marks a name whose hash already exists in this WAD — rename it, or it will be '
        + 'shadowed by load order rather than added.' : undefined,
  }));
}

async function mergeWad(file) {
  try {
    const bytes = await readFileBytes(file);
    const rep = S.doc.merge(bytes);
    renderManager();
    flash(verdict({
      ok: true, title: `Merged ${file.name}`,
      lines: [
        { k: 'blocks added', v: String(rep.added) },
        ...(rep.replaced ? [{ k: 'replaced', v: String(rep.replaced) }] : []),
        ...(rep.warnings.length ? [{ k: 'collisions', v: String(rep.warnings.length), ok: false }] : []),
      ],
      hint: rep.warnings.length
        ? rep.warnings[0] + (rep.warnings.length > 1 ? ` (+${rep.warnings.length - 1} more)` : '')
        : 'Every block appended cleanly with no asset-hash collisions.',
    }));
  } catch (e) {
    flash(verdict({ ok: false, title: 'Merge failed', lines: [{ k: file.name, v: e.message, ok: false }] }));
  }
}

function deleteBlock(index) {
  const res = S.doc.deleteBlock(index);
  renderManager();
  if (!res) return;
  flash(verdict({
    ok: res.orphaned.length === 0,
    title: `Deleted block ${index}`,
    lines: res.removed.asetHashes.length
      ? res.removed.asetHashes.map((a) => ({ k: 'removed', v: `${a.hash} (${a.typeLabel})` }))
      : [{ k: 'removed', v: res.removed.path }],
    hint: res.orphaned.length
      ? `⚠ ${res.orphaned.join(', ')} pointed at this block for detail and now dangles. `
        + 'Their model will fail to resolve its finer LOD. Delete or re-add them too.'
      : undefined,
  }));
}

// ---------------------------------------------------------------- little modal
function promptNameAndType(base) {
  return new Promise((resolve) => {
    const back = el('div', 'modal-back');
    const box = el('div', 'modal');
    box.appendChild(el('div', 'modal-t', 'Name the new asset'));
    box.appendChild(el('div', 'note',
      'The name IS the asset — it is hashed into the game\'s flat namespace, and that hash '
      + 'is how anything refers to it. Keep it distinctive and lowercase.'));

    const nameWrap = el('label', 'field');
    nameWrap.appendChild(el('span', null, 'asset name'));
    const name = el('input');
    name.type = 'text';
    name.value = base;
    name.spellcheck = false;
    nameWrap.appendChild(name);
    box.appendChild(nameWrap);

    const hashLine = el('div', 'mono dim hashline');
    const upd = () => { hashLine.textContent = sanitizeAssetName(name.value) + '  =  ' + hex8(pandemicHashM2(sanitizeAssetName(name.value))); };
    name.addEventListener('input', upd); upd();
    box.appendChild(hashLine);

    const typeWrap = el('label', 'field');
    typeWrap.appendChild(el('span', null, 'type'));
    const type = el('select');
    for (const id of [27, 19, 35]) {
      const o = el('option', null, `${id} — ${TYPE[id].label}`);
      o.value = String(id);
      type.appendChild(o);
    }
    typeWrap.appendChild(type);
    box.appendChild(typeWrap);

    const row = el('div', 'modal-actions');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.addEventListener('click', () => { back.remove(); resolve({}); });
    const ok = el('button', 'btn', 'Add');
    ok.addEventListener('click', () => {
      back.remove();
      resolve({ name: sanitizeAssetName(name.value), typeId: Number(type.value) });
    });
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row);

    back.appendChild(box);
    document.body.appendChild(back);
    name.focus(); name.select();
  });
}

function flash(node) {
  const out = $('#op-out');
  if (!out) return;
  out.innerHTML = '';
  out.appendChild(node);
}

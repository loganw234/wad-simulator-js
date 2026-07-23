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
import { describeAsset, typeInfo, hashName } from '../labels.js';
import { sniffMovie } from '../gfx.js';
import { groupBlocks } from '../mods.js';

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

  const gfxCard = el('button', 'card');
  gfxCard.appendChild(el('div', 'card-icon', '🎬'));
  gfxCard.appendChild(el('div', 'card-t', 'Pack a UI movie'));
  gfxCard.appendChild(el('div', 'card-s', 'Made a menu/HUD in GFXForge? Drop its .gfx and get an installable WAD.'));
  const gfxInput = el('input');
  gfxInput.type = 'file'; gfxInput.accept = '.gfx,.cfx,.swf'; gfxInput.style.display = 'none';
  gfxCard.appendChild(gfxInput);
  gfxCard.addEventListener('click', () => gfxInput.click());
  gfxInput.addEventListener('change', (e) => {
    if (!e.target.files[0]) return;
    S.doc = WadDoc.empty(); S.name = 'my-ui-patch.wad';
    renderManager();
    addAssets([e.target.files[0]]);
  });
  cards.appendChild(gfxCard);

  const newCard = el('button', 'card');
  newCard.appendChild(el('div', 'card-icon', '✨'));
  newCard.appendChild(el('div', 'card-t', 'Start empty'));
  newCard.appendChild(el('div', 'card-s', 'Build a fresh patch from scratch by adding assets one at a time.'));
  newCard.addEventListener('click', () => { S.doc = WadDoc.empty(); S.name = 'my-patch.wad'; renderManager(); });
  cards.appendChild(newCard);

  root.appendChild(cards);
  root.appendChild(howItWorks());

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

// A collapsible three-box picture of where this tool sits. Beginners land here with no
// mental model at all — this is the one-glance version.
function howItWorks() {
  const d = el('details', 'how');
  const sum = el('summary', null, 'New here? How modding Mercenaries 2 fits together');
  d.appendChild(sum);
  const flow = el('div', 'how-flow');
  const box = (icon, t, s) => {
    const b = el('div', 'how-box');
    b.appendChild(el('div', 'how-icon', icon));
    b.appendChild(el('div', 'how-t', t));
    b.appendChild(el('div', 'how-s', s));
    return b;
  };
  flow.appendChild(box('🛠️', 'Make the piece', 'A skin in the skinner, a menu in GFXForge, a model, a script. Each exports a small file.'));
  flow.appendChild(el('div', 'how-arrow', '→'));
  flow.appendChild(box('📦', 'Pack it here', 'This tool wraps those pieces into one vz-patch.wad — the format the game reads.'));
  flow.appendChild(el('div', 'how-arrow', '→'));
  flow.appendChild(box('🎮', 'Install & play', 'Drop the WAD in your game\'s data\\ folder and restart. It overlays the base game; nothing original is changed.'));
  d.appendChild(flow);
  d.appendChild(el('div', 'note',
    'Two things a block can do: 🔁 REPLACE something the game already has (an override — safe, '
    + 'reversible by removing the patch), or ✨ ADD something brand-new (which needs a script or '
    + 'template that asks for it). This tool labels every block as one or the other.'));
  const modkit = el('div', 'note callout');
  modkit.appendChild(el('b', null, 'Heads up: '));
  modkit.appendChild(document.createTextNode(
    'the Modkit will eventually handle all of this end-to-end. Until then, this is the '
    + 'easy-to-use version of the command-line packer — same result, no terminal — so new '
    + 'users can build and install a patch WAD without touching the CLI.'));
  d.appendChild(modkit);
  return d;
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
      ok: true, title: 'Saved — now install it',
      lines: [{ k: 'file', v: S.name }, { k: 'size', v: fmtBytes(bytes.length) }, { k: 'blocks', v: String(S.doc.blocks.length) }],
      hint: 'To install:  1) rename it to  vz-patch.wad   2) put it in your game\'s  data\\  folder '
        + '(back up any vz-patch.wad already there — or use “Back up” above first)   3) restart the game. '
        + 'Prefer keeping your other mods? Import this in the modkit to merge instead of replace.',
    }));
  });
  bar.appendChild(save);

  const backup = el('button', 'btn ghost', 'Back up');
  backup.title = 'Download a copy of this WAD as-is, before you change it';
  backup.disabled = !S.doc.blocks.length;
  backup.addEventListener('click', () => {
    downloadBytes(S.name.replace(/\.wad$/i, '') + '.backup.wad', S.doc.toBytes());
    flash(verdict({ ok: true, title: 'Backup saved', lines: [{ k: 'file', v: S.name.replace(/\.wad$/i, '') + '.backup.wad' }],
      hint: 'Keep this somewhere safe. If a change goes wrong, open this file to get back.' }));
  });
  bar.appendChild(backup);

  const tag = el('button', 'btn ghost', S.doc.mods().some((g) => g.name) ? 'Edit mod name' : 'Name this mod');
  tag.title = 'Give the whole patch a mod name so tools list it as one mod';
  tag.disabled = !S.doc.blocks.length;
  tag.addEventListener('click', promptTagMod);
  bar.appendChild(tag);

  const close = el('button', 'btn ghost', 'Close');
  close.addEventListener('click', () => { S.doc = null; renderStart(); });
  bar.appendChild(close);
  root.appendChild(bar);

  // action row: add / merge
  const actions = el('div', 'actions');

  const addZone = el('label', 'drop small');
  addZone.appendChild(el('b', null, '＋ Add an asset'));
  addZone.appendChild(el('span', 'hint', 'a skinner .zip, a .ucfx container, or a .gfx UI movie'));
  const addInput = el('input');
  addInput.type = 'file';
  addInput.accept = '.ucfx,.bin,.zip,.gfx,.cfx,.swf';
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
    wrap.appendChild(el('div', 'empty',
      'No blocks yet — that is normal for a new patch. Add an asset above (a skinner .zip, a '
      + '.ucfx container, or a .gfx UI movie), or merge another WAD.'));
    return wrap;
  }

  const rows = S.doc.list();
  const groups = groupBlocks(S.doc.blocks);
  const manifestIdx = new Set(groups.filter((g) => g.manifestIndex !== null).map((g) => g.manifestIndex));

  // One section per mod. A single unnamed "other" group renders without a header.
  const onlyOther = groups.length === 1 && groups[0].name === null;
  for (const g of groups) {
    if (!onlyOther) wrap.appendChild(modHeader(g));
    const table = el('table', 'blocks');
    const head = el('tr');
    for (const h of ['#', 'what it is', 'name', 'in the patch', 'size', '']) head.appendChild(el('th', null, h));
    table.appendChild(head);
    for (const bi of g.indices) {
      // The manifest block itself is shown as the mod header, not as a data row.
      if (manifestIdx.has(bi) && !onlyOther) continue;
      table.appendChild(blockRow(rows[bi], bi === g.manifestIndex));
    }
    wrap.appendChild(table);
  }
  return wrap;
}

function modHeader(g) {
  const head = el('div', 'mod-head');
  if (g.name === null) {
    head.appendChild(el('span', 'mod-name', 'Loose blocks'));
    head.appendChild(el('span', 'mod-meta', `${g.indices.length} block${g.indices.length === 1 ? '' : 's'} not part of a named mod`));
    return head;
  }
  head.classList.add('named');
  head.appendChild(el('span', 'mod-badge', 'MOD'));
  head.appendChild(el('span', 'mod-name', g.name));
  const meta = [];
  if (g.author) meta.push(`by ${g.author}`);
  if (g.version) meta.push(`v${g.version}`);
  meta.push(`${g.indices.length} block${g.indices.length === 1 ? '' : 's'}`);
  head.appendChild(el('span', 'mod-meta', meta.join(' · ')));
  const rm = el('button', 'btn tiny danger', 'Remove mod');
  rm.title = 'Delete this mod and all its blocks';
  rm.addEventListener('click', () => removeMod(g));
  head.appendChild(rm);
  if (g.description) head.appendChild(el('div', 'mod-desc', g.description));
  return head;
}

function blockRow(b, isManifest) {
  const tr = el('tr');
  tr.appendChild(el('td', 'mono dim', String(b.index)));

  // "what it is" — friendly type + the override/new verdict per asset.
  const whatTd = el('td');
  const nameTd = el('td');
  if (isManifest) {
    whatTd.appendChild(el('span', 'kind-chip note', 'mod info'));
    whatTd.appendChild(el('span', 'blurb', 'names this mod (invisible to the game)'));
    nameTd.appendChild(el('span', 'dim', '—'));
  } else if (b.asetHashes.length) {
    for (const a of b.asetHashes) {
      const d = describeAsset(a.hashNum, a.typeId);
      const line = el('div', 'asset-line');
      line.appendChild(el('span', 'type-chip t' + a.typeId, d.typeLabel));
      const badge = el('span', 'verdict-badge ' + d.verdict);
      badge.textContent = d.verdict === 'override' ? '🔁 replaces' : '✨ new';
      badge.title = d.sentence;
      line.appendChild(badge);
      if (a.sub !== null) line.appendChild(el('span', 'asset-sub', `+ detail → block ${a.sub}`));
      whatTd.appendChild(line);

      const nm = el('div', 'asset-name');
      nm.appendChild(el('span', d.name ? 'known-name' : 'mono dim', d.name || a.hash));
      nm.appendChild(el('span', 'blurb', d.blurb));
      nameTd.appendChild(nm);
    }
  } else {
    whatTd.appendChild(el('span', 'dim', 'detail data'));
    whatTd.appendChild(el('span', 'blurb', 'a finer version reached through another asset'));
    nameTd.appendChild(el('span', 'dim', '—'));
  }
  tr.appendChild(whatTd);
  tr.appendChild(nameTd);

  tr.appendChild(el('td', 'mono path', b.path));
  tr.appendChild(el('td', 'mono dim', fmtBytes(b.compressedBytes)));

  const act = el('td');
  const del = el('button', 'btn tiny danger', 'Delete');
  del.addEventListener('click', () => deleteBlock(b.index));
  act.appendChild(del);
  tr.appendChild(act);
  return tr;
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

  // Scaleform UI movies (.gfx/.cfx from GFXForge) — wrap + name, then add.
  for (const f of files.filter((x) => /\.(gfx|cfx|swf)$/i.test(x.name))) {
    const bytes = await readFileBytes(f);
    if (!sniffMovie(bytes)) {
      results.push({ ok: false, name: f.name, msg: 'no GFX/CFX/FWS/CWS header — not a real Scaleform movie' });
      continue;
    }
    const base = f.name.replace(/\.(gfx|cfx|swf)$/i, '');
    const name = await promptMovieName(base);
    if (!name) { results.push({ ok: false, name: f.name, msg: 'cancelled' }); continue; }
    try {
      const res = S.doc.addMovie({ movie: bytes, name });
      results.push({ ok: true, name, hash: hex8(res.hash), warnings: res.warnings, movie: true });
    } catch (e) {
      results.push({ ok: false, name: f.name, msg: e.message });
    }
  }

  const containers = files.filter((f) => /\.(ucfx|bin)$/i.test(f.name));
  if (!containers.length && !results.length) {
    return flash(verdict({
      ok: false, title: 'Nothing to add',
      lines: [{ k: 'dropped', v: `${files.length} file(s)`, ok: false }],
      hint: 'Add a skinner -assets.zip, a .ucfx container, or a .gfx UI movie from GFXForge. '
        + 'If you have a PNG, encode it to a texture container in the skinner first.',
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
    for (const id of [27, 19, 35, 23]) {
      const o = el('option', null, `${id} — ${typeInfo(id).label} (${typeInfo(id).blurb})`);
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

// A movie needs a NAME: the game movie it replaces, or a new one you load from Lua.
function promptMovieName(base) {
  return new Promise((resolve) => {
    const back = el('div', 'modal-back');
    const box = el('div', 'modal');
    box.appendChild(el('div', 'modal-t', 'Name this UI movie'));
    box.appendChild(el('div', 'note',
      'To REPLACE a game menu/HUD, use its exact name (this tool will show 🔁). '
      + 'For a NEW overlay, pick any name and load it in Lua with SetSwfFile("<name>.gfx").'));
    const nameWrap = el('label', 'field');
    nameWrap.appendChild(el('span', null, 'movie name'));
    const name = el('input');
    name.type = 'text'; name.value = base; name.spellcheck = false;
    nameWrap.appendChild(name);
    box.appendChild(nameWrap);

    const verdictLine = el('div', 'mono dim hashline');
    const upd = () => {
      const clean = String(name.value || '').trim().replace(/\.(gfx|cfx|swf)$/i, '');
      if (!clean) { verdictLine.textContent = ''; return; }
      const d = describeAsset(pandemicHashM2(clean), 23);
      verdictLine.textContent = (d.verdict === 'override' ? '🔁 ' : '✨ ') + d.sentence;
    };
    name.addEventListener('input', upd); upd();
    box.appendChild(verdictLine);

    const row = el('div', 'modal-actions');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.addEventListener('click', () => { back.remove(); resolve(null); });
    const ok = el('button', 'btn', 'Add movie');
    ok.addEventListener('click', () => { back.remove(); resolve(String(name.value || '').trim()); });
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row);
    back.appendChild(box);
    document.body.appendChild(back);
    name.focus(); name.select();
  });
}

function removeMod(g) {
  // Delete highest index first so earlier indices stay valid.
  const all = [...g.indices, ...(g.manifestIndex !== null ? [g.manifestIndex] : [])];
  for (const i of [...new Set(all)].sort((a, b) => b - a)) S.doc.blocks.splice(i, 1);
  renderManager();
  flash(verdict({
    ok: true, title: `Removed ${g.name ? `“${g.name}”` : 'loose blocks'}`,
    lines: [{ k: 'blocks removed', v: String(new Set(all).size) }, { k: 'blocks left', v: String(S.doc.blocks.length) }],
    hint: 'Save the WAD to write the change.',
  }));
}

// Stamp the whole patch as one named mod (adds an invisible manifest block).
function promptTagMod() {
  const existing = S.doc.mods().find((g) => g.name !== null);
  const back = el('div', 'modal-back');
  const box = el('div', 'modal');
  box.appendChild(el('div', 'modal-t', existing ? 'Edit mod details' : 'Name this mod'));
  box.appendChild(el('div', 'note',
    'This tags the whole patch as one named mod so tools list it as "Your Mod (N blocks)" '
    + 'instead of raw blocks. It adds a tiny info block the game ignores.'));
  const mk = (label, val) => {
    const w = el('label', 'field');
    w.appendChild(el('span', null, label));
    const i = el('input'); i.type = 'text'; i.value = val || ''; i.spellcheck = false;
    w.appendChild(i); box.appendChild(w); return i;
  };
  const name = mk('mod name', existing?.name);
  const author = mk('author (optional)', existing?.author);
  const version = mk('version (optional)', existing?.version);
  const row = el('div', 'modal-actions');
  const cancel = el('button', 'btn ghost', 'Cancel');
  cancel.addEventListener('click', () => back.remove());
  const ok = el('button', 'btn', 'Save');
  ok.addEventListener('click', () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    S.doc.tagMod({ name: n, author: author.value.trim() || null, version: version.value.trim() || null });
    back.remove();
    renderManager();
    flash(verdict({ ok: true, title: `Tagged as “${n}”`, lines: [{ k: 'blocks in mod', v: String(S.doc.blocks.length - 1) }],
      hint: 'The patch now carries its name. Save the WAD to keep it.' }));
  });
  row.appendChild(cancel); row.appendChild(ok);
  box.appendChild(row);
  back.appendChild(box);
  document.body.appendChild(back);
  name.focus();
}

function flash(node) {
  const out = $('#op-out');
  if (!out) return;
  out.innerHTML = '';
  out.appendChild(node);
}

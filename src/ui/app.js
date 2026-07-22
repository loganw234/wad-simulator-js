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
import { WadDoc } from '../wad.js';
import { hex8, pandemicHashM2, sanitizeAssetName } from '../hash.js';
import { isUcfx } from '../sges.js';
import { TYPE } from '../block.js';

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
  addZone.appendChild(el('span', 'hint', 'drop a .ucfx container (a model or texture)'));
  const addInput = el('input');
  addInput.type = 'file';
  addInput.accept = '.ucfx,.bin';
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
  const containers = files.filter((f) => /\.(ucfx|bin)$/i.test(f.name));
  if (!containers.length) {
    return flash(verdict({
      ok: false, title: 'Nothing to add',
      lines: [{ k: 'dropped', v: `${files.length} file(s)`, ok: false }],
      hint: 'Add a .ucfx container — a model or texture asset. If you have a PNG, encode it '
        + 'to a texture container in the skinner first.',
    }));
  }
  const results = [];
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

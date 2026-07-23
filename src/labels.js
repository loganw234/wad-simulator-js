// Beginner-facing identification: what a block IS, in plain language.
//
// Three layers, all offline:
//  - TYPE_INFO: every ASET type_id we can identify, with a short human label + blurb.
//  - hashName(): reverse the asset hash to a real name, from a bundled dictionary of
//    VERIFIED names (each one hashes to an actual base-WAD ASET hash; strings only).
//  - inBaseGame(): membership test against a bloom fingerprint of every base ASET hash
//    (vz.wad + shell.wad) — this is what tells "🔁 replaces a game asset" apart from
//    "✨ adds something brand-new". ~2% false-positive, zero false-negative.
import { inflateSync } from '../vendor/fflate.js';
import { pandemicHashM2 } from './hash.js';
import { NAMES_DEFLATE_B64, BLOOM_B64, BLOOM_M, BLOOM_K, MOVIE_NAMES } from './data/reference.js';

export { MOVIE_NAMES };

/** type_id -> friendly label + one-line blurb. `mint` = this tool can create one. */
export const TYPE_INFO = {
  19: { label: 'Model',      blurb: '3D shape (a vehicle, prop, character…)', mint: true },
  27: { label: 'Texture',    blurb: 'image — what things look like',          mint: true },
  35: { label: 'Script',     blurb: 'Lua code the game runs',                 mint: true },
  23: { label: 'UI movie',   blurb: 'Scaleform menu/HUD art (.gfx)',          mint: true },
  9:  { label: 'Layer',      blurb: 'a set of world placements the game streams in' },
  16: { label: 'Animation',  blurb: 'movement data' },
  5:  { label: 'FaceFX',     blurb: 'facial animation set' },
  6:  { label: 'Wave bank',  blurb: 'sound effect audio data' },
  21: { label: 'Sound bank', blurb: 'sound cue definitions' },
  13: { label: 'Sound DB',   blurb: 'sound lookup table' },
  7:  { label: 'String DB',  blurb: 'text the game displays' },
  11: { label: 'Anim table', blurb: 'animation lookup table' },
  8:  { label: 'World entity', blurb: 'spawnable template definitions' },
  10: { label: 'Guid map',   blurb: 'name-to-id directory' },
  20: { label: 'Level',      blurb: 'level definition' },
  15: { label: 'Font',       blurb: 'typeface' },
  29: { label: 'Effect',     blurb: 'particle/visual effect' },
  14: { label: 'Material',   blurb: 'surface parameters' },
};

export const typeInfo = (typeId) =>
  TYPE_INFO[typeId] || { label: `type ${typeId}`, blurb: 'an asset type this tool has no notes on' };

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

let nameMap = null;
function initNames() {
  if (nameMap) return;
  nameMap = new Map();
  const txt = new TextDecoder().decode(inflateSync(b64ToBytes(NAMES_DEFLATE_B64)));
  for (const n of txt.split('\n')) if (n) nameMap.set(pandemicHashM2(n) >>> 0, n);
}

/** Real asset name for a hash, if the bundled dictionary knows it. */
export function hashName(hash) {
  initNames();
  return nameMap.get(hash >>> 0) || null;
}

let bloomBits = null;
/** Is this hash an asset that exists in the BASE game (vz.wad/shell.wad)? ~2% FP. */
export function inBaseGame(hash) {
  if (!bloomBits) bloomBits = b64ToBytes(BLOOM_B64);
  const g1 = hash >>> 0;
  const g2 = ((Math.imul(g1, 0x9e3779b9) >>> 0) | 1) >>> 0;
  for (let i = 0; i < BLOOM_K; i++) {
    const idx = (g1 + i * g2) % BLOOM_M;
    if (!((bloomBits[idx >> 3] >> (idx & 7)) & 1)) return false;
  }
  return true;
}

/**
 * Everything the UI needs to explain one asset row:
 * name (if known), type label/blurb, and the override/new verdict sentence.
 */
export function describeAsset(hash, typeId) {
  const t = typeInfo(typeId);
  const name = hashName(hash);
  const base = inBaseGame(hash);
  const sentence = base
    ? `replaces ${name ? `the game's “${name}”` : 'an asset that exists in the base game'}`
    : 'adds a brand-new asset the base game does not have';
  return { name, typeLabel: t.label, blurb: t.blurb, mintable: !!t.mint, inBase: base, verdict: base ? 'override' : 'new', sentence };
}

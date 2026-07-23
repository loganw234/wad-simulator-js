// Scaleform movie (.gfx/.cfx) packing — lets GFXForge users ship UI mods.
//
// A movie asset in the WAD is the movie file wrapped in the simplest possible UCFX
// container: a fixed 40-byte header (UCFX magic, data area at 0x28, ONE `data`
// descriptor whose body_size is the movie length), the movie bytes, then a CSUM
// trailer. That container sits in a normal single-entry block with type_hash
// 0xFE0E8320 (type_id 23). Byte-identical to the community gfx_tool's known-good
// containers and to the modkit's cfx_pack fix (verified against both).
import { makeExtraBlock } from './block.js';
import { crc32Mercs2, pandemicHashM2, hex8 } from './hash.js';

export const MOVIE_TYPE_ID = 23;
export const MOVIE_TYPE_HASH = 0xfe0e8320;

/** Identify a Scaleform/SWF movie by magic. Returns {kind, version} or null. */
export function sniffMovie(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (magic === 'GFX' || magic === 'CFX' || magic === 'FWS' || magic === 'CWS') {
    return { kind: magic, version: bytes[3] };
  }
  return null;
}

/** Wrap a bare movie file in the canonical single-`data` UCFX container (+CSUM). */
export function wrapMovieContainer(movie) {
  const header = new Uint8Array([
    0x55, 0x43, 0x46, 0x58, 0x28, 0x00, 0x00, 0x00, // 'UCFX', data_area_off=0x28
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x64, 0x61, 0x74, 0x61, // n_desc=1, 'data'
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // offset=0, body_size (patched)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  new DataView(header.buffer).setUint32(28, movie.length, true);
  const body = new Uint8Array(header.length + movie.length + 8);
  body.set(header, 0);
  body.set(movie, header.length);
  const crc = crc32Mercs2(body.subarray(0, header.length + movie.length));
  body.set([0x43, 0x53, 0x55, 0x4d], header.length + movie.length); // 'CSUM'
  new DataView(body.buffer).setUint32(header.length + movie.length + 4, crc, true);
  return body;
}

/**
 * Build a patch block that ships a movie under `name` — override an existing game
 * movie by using its exact name (e.g. "AllCon001_briefing"), or pick a new name and
 * load it from Lua via SetSwfFile("<name>.gfx").
 */
export function makeMovieBlock(movie, name) {
  if (!sniffMovie(movie)) {
    throw new Error('not a Scaleform/SWF movie (no GFX/CFX/FWS/CWS magic) — export a .gfx from GFXForge');
  }
  const clean = String(name || '').trim().replace(/\.(gfx|cfx|swf)$/i, '');
  if (!clean) throw new Error('the movie needs a name (the game movie to replace, or a new name)');
  const hash = pandemicHashM2(clean);
  const container = wrapMovieContainer(movie);
  const block = makeExtraBlock(container, hash, MOVIE_TYPE_ID,
    `blocks\\VZ\\gfx_${hex8(hash).slice(2).toLowerCase()}.block`);
  return { block, hash, name: clean };
}

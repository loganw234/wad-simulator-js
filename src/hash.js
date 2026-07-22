// The two hashes the WAD format is built on.
//
// Ported from mercs2_formats::hash and mercs2_formats::crc32. Both are tiny and fully
// deterministic, so this port is byte-exact by construction — verified against the recovered
// bone/name pairs and against the CSUM trailers of real containers.

/** pandemic_hash_m2 — FNV-1a 32-bit, case-folded with `| 0x20`, finalised `^ 0x2A` then one
 *  more multiply by the FNV prime. This is the asset-name hash: every asset in the game is
 *  keyed by it, so a new asset's identity is entirely its name hashed through here.
 *  Case-insensitive by design — "MyMod" and "mymod" collide. */
export function pandemicHashM2(text) {
  if (!text.length) return 0;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ (text.charCodeAt(i) | 0x20)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = (h ^ 0x2a) >>> 0;
  return Math.imul(h, 0x01000193) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (reflected, 0xEDB88320), final XOR 0xFFFFFFFF — the value a UCFX
 *  container stores in its trailing CSUM chunk. `crc32(bytes[:-8])` reproduces the stored
 *  trailer, which is how a repoint re-signs a container it edited. */
export function crc32Mercs2(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

export const hex8 = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Asset names hash case-insensitively into a flat namespace, so keep them distinctive and
 *  lowercase. Mirrors the skinner's sanitizer. */
export function sanitizeAssetName(s) {
  return (String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'asset').slice(0, 64);
}

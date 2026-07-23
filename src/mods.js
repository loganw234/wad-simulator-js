// The mod layer: beginners install MODS, not blocks.
//
// A mod manifest is a tiny JSON (name/author/version/description + the block paths it
// owns) carried INSIDE the patch WAD as a zero-entry block: `[u32 0][json bytes]`,
// sges-compressed, with NO ASET rows. The engine's loader only ever visits blocks that
// an ASET row points at, and a zero-entry table consumes nothing anyway, so the block
// is inert in-game — but any tool can read it back and show "Jen outfit (12 blocks)"
// instead of raw hex. Convention spec: docs/mod-manifest.md.
import { PatchBlock } from './patch_wad.js';
import { compressSges, decompressSges, isSges } from './sges.js';
import { u32, putU32 } from './bytes.js';

export const MANIFEST_PATH_PREFIX = 'blocks\\VZ\\mod.';
export const MANIFEST_PATH_SUFFIX = '.manifest.block';

export function manifestPath(slug) {
  const clean = String(slug || 'mod').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mod';
  return `${MANIFEST_PATH_PREFIX}${clean}${MANIFEST_PATH_SUFFIX}`;
}

/** Normalize + validate a manifest object. Throws with a beginner-readable message. */
export function normalizeManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest must be a JSON object');
  const name = String(m.name || '').trim();
  if (!name) throw new Error('manifest needs a "name"');
  return {
    name,
    author: m.author ? String(m.author).trim() : null,
    version: m.version ? String(m.version).trim() : null,
    description: m.description ? String(m.description).trim() : null,
    blocks: Array.isArray(m.blocks) ? m.blocks.map(String) : [],
  };
}

/** Build the zero-entry manifest block for a mod. */
export function makeManifestBlock(manifest) {
  const man = normalizeManifest(manifest);
  const json = new TextEncoder().encode(JSON.stringify(man));
  const inner = new Uint8Array(4 + json.length);
  putU32(inner, 0, 0); // entry_count = 0 -> the engine consumes nothing
  inner.set(json, 4);
  const block = new PatchBlock(compressSges(inner), manifestPath(man.name), []);
  block.packedField = Math.ceil(inner.length / 0x8000);
  return block;
}

/** If this block is a manifest block, parse it; else null. */
export function readManifestBlock(block) {
  const p = block.pathString || '';
  if (!p.startsWith(MANIFEST_PATH_PREFIX) || !p.endsWith(MANIFEST_PATH_SUFFIX)) return null;
  try {
    const d = isSges(block.compressedData) ? decompressSges(block.compressedData) : block.compressedData;
    if (u32(d, 0) !== 0) return null;
    return normalizeManifest(JSON.parse(new TextDecoder().decode(d.subarray(4))));
  } catch {
    return null;
  }
}

/**
 * Group a patch's blocks into mods. Manifest blocks claim their listed paths;
 * everything unclaimed lands in one "other" group. Returns
 * [{ name, author, version, description, indices, manifestIndex|null }].
 */
export function groupBlocks(blocks) {
  const groups = [];
  const claimed = new Set();
  blocks.forEach((b, i) => {
    const man = readManifestBlock(b);
    if (!man) return;
    claimed.add(i);
    const indices = [];
    const want = new Set(man.blocks.map((s) => s.toLowerCase()));
    blocks.forEach((ob, oi) => {
      if (oi !== i && want.has((ob.pathString || '').toLowerCase())) {
        indices.push(oi);
        claimed.add(oi);
      }
    });
    groups.push({ ...man, indices, manifestIndex: i });
  });
  const rest = blocks.map((_, i) => i).filter((i) => !claimed.has(i));
  if (rest.length) {
    groups.push({ name: null, author: null, version: null, description: null, indices: rest, manifestIndex: null });
  }
  return groups;
}

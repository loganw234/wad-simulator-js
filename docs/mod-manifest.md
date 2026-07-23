# Mod manifest — a tiny convention so tools can show "a mod", not "raw blocks"

A patch WAD is a flat list of blocks. That is all the game needs, but it means a tool opening
someone's `vz-patch.wad` cannot tell that *these twelve blocks are one skin* and *that block is a
menu*. Beginners install **mods**, not blocks — so we carry a small manifest **inside the WAD**
that names the mod and lists the blocks it owns.

## The block

The manifest is a normal patch block with:

- **path**: `blocks\VZ\mod.<slug>.manifest.block` (slug = the mod name, lowercased, non-alnum → `-`)
- **body** (before sges compression): `[u32 entry_count = 0]` followed by the manifest JSON (UTF-8)
- **no ASET rows**

Because `entry_count` is `0` and it has no ASET row, the engine's loader never visits it — it is
inert in-game. Any tool, though, can read the JSON back and group the patch.

## The JSON

```json
{
  "name": "Jen Outfit Recolor",
  "author": "Logan",
  "version": "1.0",
  "description": "A magenta recolor of Jennifer's default outfit.",
  "blocks": [
    "blocks\\VZ\\pmc_hum_jennifer_v2_ub.block",
    "blocks\\VZ\\custom_ac8db4cb.block"
  ]
}
```

- `name` — required. Everything else is optional.
- `blocks` — the block **paths** this mod owns. A tool groups a block under this mod when its path
  is listed here. Blocks not claimed by any manifest are shown as "loose blocks".

## Rules

- **One manifest per mod.** A WAD may hold several manifests (one per mod) after merging.
- A manifest **claims by path**, so keep block paths stable across a mod's exports.
- Unknown JSON fields are ignored — safe to extend later (icons, links, dependencies).
- Removing a mod = deleting its manifest block **and** every block it lists.

## Producers

- **wad-simulator-js**: "Name this mod" stamps the current patch; `WadDoc.tagMod({name, author,
  version, blocks?})`. `blocks` defaults to every non-manifest block present.
- **skinner / GFXForge / future exporters**: SHOULD embed a manifest in their export so a packed
  mod arrives already named. Emit the block above with the mod's name and the paths it ships.

## Reference implementation

`src/mods.js` — `makeManifestBlock`, `readManifestBlock`, `groupBlocks`, `manifestPath`.
Round-trip + grouping are covered in `test/beginner.test.js`.

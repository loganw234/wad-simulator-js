# Credits

**This project is a port. It exists only because of
[mercs2-wad-simulator](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator).**

Every hard part — figuring out the Mercenaries 2 WAD container, the FFCS patch-WAD header,
the sges block compression, the UCFX asset framing, the ASET directory and its packed
block/LOD references — was done by the **Mercenaries-Fan-Build / mercs2-wad-simulator**
project. Years of reverse engineering sit behind the format layer this repo leans on.

What `wad-simulator-js` adds is narrow and mechanical: it re-expresses that project's
read/write logic (`mercs2_formats`) in JavaScript so the packing step can run in a browser,
and it wraps a small UI around it. None of the format knowledge is original here. When this
tool gets something right, it is because the reference implementation got it right first —
this port was verified *against* that project's own Rust reader and the game engine, and it
holds itself to the exact fidelity contract that project states for itself.

If you find this useful, the credit belongs upstream. Please support and contribute to
**mercs2-wad-simulator** rather than treating this as a replacement — it is a convenience
front end, not a new implementation of anything.

## Specifically ported from `mercs2_formats`

| here | ← upstream |
|---|---|
| `src/patch_wad.js` | `patch_wad.rs` — the FFCS serializer, `read`/`build`/`merge` |
| `src/sges.js` | `sges.rs` — block compression / decompression |
| `src/block.js` | `mercs2_smuggler`'s `build_extra` + `ucfx.rs`'s entry-table parse |
| `src/hash.js` | `hash.rs` (`pandemic_hash_m2`) + `crc32.rs` |

The fidelity note in `src/sges.js` is quoted directly from the upstream Rust source.

## Other

- **[fflate](https://github.com/101arrowz/fflate)** by Arjun Barrett (MIT) — the DEFLATE and
  unzip codec, vendored at `vendor/fflate.js`. The one external algorithm this port does not
  re-implement.

Not affiliated with or endorsed by EA or Pandemic Studios. Mercenaries 2 is their property;
this is a fan tool for content people make themselves.

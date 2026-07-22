# wad-simulator-js

Manage Mercenaries 2 patch WADs in your browser — **add, merge, delete** assets, then save a
WAD the game loads. A byte-faithful JavaScript port of the community WAD packing tools, so
nobody needs the Rust toolchain or a command line for the packing step.

Open [`dist/wad-simulator-js.html`](dist/wad-simulator-js.html) — one self-contained file, no
install, no network, no server. Or run the dev version with any static server.

> Prototype, standing in while the launcher is built. It does the packing; it does not make
> skins — pair it with the skinner, which produces the `.ucfx` containers you add here.

## What it does

- **Open** a `vz-patch.wad` and see every block: its assets, their hashes and types, the LOD
  sub-pointer, and sizes.
- **Add** a new asset from a `.ucfx` container (a model or texture). The name is hashed live
  so you see the identity before you commit, and a name that collides with something already
  in the WAD is flagged rather than silently shadowed.
- **Merge** another patch WAD in — its blocks are appended, and any asset-hash collision
  between the two is surfaced.
- **Delete** a block, with a warning if something else pointed at it for its finer LOD.
- **Save** the result back to a `.wad`.

## Why it's trustworthy

The one thing a format port has to get right is that the game still loads the output. This is
a port of `mercs2_formats` (the community project's format crate), and it is verified the same
way that crate verifies itself — **not** by byte-matching, which is impossible across two
deflate implementations, but by:

1. **Container framing is byte-faithful.** The FFCS header, the INDX/ASET/PTHS tables, the
   sges segment table, every offset, flag and alignment is written exactly as the Rust does.
2. **Round-trip correctness.** `decompress(compress(x)) === x`, and read-then-write of a real
   WAD reproduces its asset set exactly.
3. **The engine loads it.** A WAD written by this code, opened through the actual
   `mercs2_workshop` loader on real game data, reports the identical asset set; an asset added
   by this code is visible to the loader's overlay-aware listing; and a 699,196-byte texture
   container survives compress → write → read → decompress → unwrap **byte-identical**.

The Rust source states this contract itself: *"the deflate bitstream is not byte-identical…
Correctness is defined by round-trip and engine load, NOT by byte-matching. The container
framing IS byte-faithful."* This port inherits it verbatim.

## Layout

```
src/
  hash.js        pandemic_hash_m2 + CRC-32 (the two hashes the format uses)
  bytes.js       shared little-endian helpers
  sges.js        block compression / decompression (deflate via fflate)
  patch_wad.js   FFCS read / build / merge — the serializer
  block.js       mint a new asset block; inspect an existing one
  wad.js         WadDoc: the add / merge / delete verbs the UI drives
  ui/            the browser front end
vendor/fflate.js the one external dependency: a raw-DEFLATE codec (MIT)
test/            44 assertions + a cross-check against the Rust loader
```

## Tests

```
npm test          # 44 assertions: hashes, sges round-trips, framing, add/merge/delete
node test/verify_rust.js <a-real.wad> <outdir>   # writes WADs to cross-check with the Rust loader
```

## Fidelity note on compression

`sges` blocks are raw-DEFLATE segments. This port uses [fflate](https://github.com/101arrowz/fflate)
for the deflate itself; the surrounding container is written byte-for-byte as the reference
does. Two valid deflate encoders produce different bitstreams for the same input, so a WAD
from this tool is not byte-identical to one from the Rust tool — but both decompress to the
same bytes and both load in the engine, which is the whole requirement.

## Credits

The Mercenaries 2 WAD format, the `mercs2_formats` reference implementation and the packing
logic all come from the community
[mercs2-wad-simulator](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator) project.
This is a front end and a faithful JS port of their work. Not affiliated with EA or Pandemic.

# wad-simulator-js

> ### A browser port of [mercs2-wad-simulator](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator)
> **All the format work — the WAD container, the FFCS patch header, sges compression, UCFX
> framing, the ASET directory — is the [Mercenaries-Fan-Build / mercs2-wad-simulator](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator)
> project's, and it is MIT-licensed. This repo only re-expresses their read/write logic in
> JavaScript so it runs in a browser, and adds a UI. If this is useful, the credit is theirs —
> please support and contribute upstream.** Full attribution in [CREDITS.md](CREDITS.md).

Manage Mercenaries 2 patch WADs in your browser — **add, merge, delete** assets, then save a
WAD the game loads. A byte-faithful JavaScript port of the community WAD packing tools, so
nobody needs the Rust toolchain or a command line for the packing step.

**Use it now: <https://wad.mercs2.tools/>** — or open
[`dist/wad-simulator-js.html`](dist/wad-simulator-js.html) locally: one self-contained file, no
install, no network, no server. (The hosted page is the same single file; you can save it from
[`/wad-simulator-js.html`](https://wad.mercs2.tools/wad-simulator-js.html)
for offline use.) Or run the dev version with any static server.

> Prototype, standing in while the launcher is built. It does the packing; it does not make
> skins — pair it with the skinner, which produces the `.ucfx` containers you add here.

## What it does

- **Pack a skinner export** — the guided path. Drop the `-assets.zip` the skinner gave you
  and out comes a ready-to-install WAD. It reads the `install.bat` inside the zip for the
  exact asset names, hashes and types, so it packs precisely what the skinner intended — the
  same result its `install.bat` would produce by calling `mercs2_smuggler`, with no command
  line. There's a bundled example — a small synthetic texture, no game art — to try the flow
  before making your own.
- **Open** a `vz-patch.wad` and see every block: its assets, their hashes and types, the LOD
  sub-pointer, and sizes.
- **Add** a new asset from a `.ucfx` container (a model or texture), or a whole skinner
  `-assets.zip` at once. A single `.ucfx` prompts for a name, hashed live so you see the
  identity before you commit; a zip is unpacked and added wholesale from its manifest. A name
  that collides with something already in the WAD is flagged rather than silently shadowed.
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
  hash.js          pandemic_hash_m2 + CRC-32 (the two hashes the format uses)
  bytes.js         shared little-endian helpers
  sges.js          block compression / decompression (deflate via fflate)
  patch_wad.js     FFCS read / build / merge — the serializer
  block.js         mint a new asset block; inspect an existing one
  wad.js           WadDoc: the add / merge / delete verbs the UI drives
  skinner_import.js  unzip a skinner -assets.zip, read its install.bat, make blocks
  ui/              the browser front end (card start, guided pack rail, block table)
samples/           a ready-made skinner export (bundled as the "try it" example)
vendor/fflate.js   the one external dependency: raw DEFLATE + unzip (MIT)
test/              59 assertions + a cross-check against the Rust loader
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

**The entire format layer — and every hard part of it — is the
[Mercenaries-Fan-Build / mercs2-wad-simulator](https://github.com/Mercenaries-Fan-Build/mercs2-wad-simulator)
project's work.** The WAD container, the FFCS patch-WAD header, sges compression, UCFX
framing, the ASET directory and its packed block/LOD references were all reverse-engineered
there, and its `mercs2_formats` crate is the reference this repo ports. When this tool is
correct, it is because that project was correct first — the port is verified *against* their
Rust reader and the game engine, and holds itself to the fidelity contract their own source
states. It is MIT-licensed; so is this.

This repository is a convenience front end, not a reimplementation. **If it is useful, please
support and contribute to mercs2-wad-simulator upstream.** Full attribution, the exact
file-by-file mapping, and the fflate (Arjun Barrett, MIT) notice are in
[CREDITS.md](CREDITS.md) and [LICENSE](LICENSE).

Not affiliated with or endorsed by EA or Pandemic Studios.

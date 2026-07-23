// New-user layer: gfx packing, plain-language labels, mod manifests.
import { makeMovieBlock, wrapMovieContainer, sniffMovie, MOVIE_TYPE_HASH } from '../src/gfx.js';
import { hashName, inBaseGame, describeAsset, TYPE_INFO, MOVIE_NAMES } from '../src/labels.js';
import { makeManifestBlock, readManifestBlock, groupBlocks, manifestPath } from '../src/mods.js';
import { pandemicHashM2, crc32Mercs2, hex8 } from '../src/hash.js';
import { decompressSges } from '../src/sges.js';
import { buildPatchWadMulti, readPatchWad, mergePatchWads } from '../src/patch_wad.js';
import { makeExtraBlock } from '../src/block.js';
import { u32 } from '../src/bytes.js';

export async function run(t) {
  // ---- gfx packing --------------------------------------------------------
  const movie = new Uint8Array(64);
  movie.set([0x43, 0x46, 0x58, 0x08]); // 'CFX' v8
  for (let i = 4; i < 64; i++) movie[i] = i;

  t.eq('sniffMovie identifies CFX v8', JSON.stringify(sniffMovie(movie)), '{"kind":"CFX","version":8}');
  t.eq('sniffMovie rejects junk', sniffMovie(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);

  const cont = wrapMovieContainer(movie);
  t.eq('container size = 40 header + movie + 8 CSUM', cont.length, 40 + movie.length + 8);
  t.eq('container magic', String.fromCharCode(...cont.subarray(0, 4)), 'UCFX');
  t.eq('data_area_off = 0x28', u32(cont, 4), 0x28);
  t.eq('n_desc = 1', u32(cont, 16), 1);
  t.eq('descriptor tag = data', String.fromCharCode(...cont.subarray(20, 24)), 'data');
  t.eq('body_size = movie length', u32(cont, 28), movie.length);
  t.eq('CSUM tag present', String.fromCharCode(...cont.subarray(cont.length - 8, cont.length - 4)), 'CSUM');
  t.eq('CSUM verifies', u32(cont, cont.length - 4), crc32Mercs2(cont.subarray(0, cont.length - 8)));

  const { block, hash, name } = makeMovieBlock(movie, 'MyForgeMenu.gfx');
  t.eq('movie name strips extension', name, 'MyForgeMenu');
  t.eq('movie hash = pandemicHashM2(name)', hash, pandemicHashM2('MyForgeMenu'));
  const inner = decompressSges(block.compressedData);
  t.eq('block entry count 1', u32(inner, 0), 1);
  t.eq('block entry name_hash', u32(inner, 4), hash);
  t.eq('block entry type_hash = 0xFE0E8320', u32(inner, 8), MOVIE_TYPE_HASH >>> 0);
  t.eq('block entry field_c = 0', u32(inner, 12), 0);
  t.eq('aset row: sub none + type 23', (block.asetEntries[0].u32_2 & 0xffff) === 0xffff && block.asetEntries[0].u32_3 === 23, true);
  t.throws('non-movie bytes rejected', () => makeMovieBlock(new Uint8Array(32), 'x'), /Scaleform/);
  t.throws('empty name rejected', () => makeMovieBlock(movie, '  '), /name/);

  // ---- labels -------------------------------------------------------------
  const briefing = pandemicHashM2('AllCon001_briefing');
  t.eq('hashName reverses a movie hash', hashName(briefing), 'AllCon001_briefing');
  t.eq('bloom: base asset detected', inBaseGame(briefing), true);
  t.eq('bloom: fresh name not in base', inBaseGame(pandemicHashM2('my_totally_new_mod_asset_2026')), false);
  const dOver = describeAsset(briefing, 23);
  t.eq('describeAsset override verdict', dOver.verdict, 'override');
  t.ok('describeAsset names the asset', dOver.sentence.includes('AllCon001_briefing'), dOver.sentence);
  const dNew = describeAsset(pandemicHashM2('my_totally_new_mod_asset_2026'), 27);
  t.eq('describeAsset new verdict', dNew.verdict, 'new');
  t.ok('TYPE_INFO covers ui movies', TYPE_INFO[23].label === 'UI movie');
  t.ok('bundled movie-name list is present', Array.isArray(MOVIE_NAMES) && MOVIE_NAMES.length >= 40, String(MOVIE_NAMES.length));

  // ---- mod manifests ------------------------------------------------------
  const texture = makeExtraBlock(cont, pandemicHashM2('my_mod_tex'), 27, 'blocks\\VZ\\my_mod_tex.block');
  const man = makeManifestBlock({ name: 'Test Mod', author: 'Logan', version: '1.0', blocks: ['blocks\\VZ\\my_mod_tex.block'] });
  t.eq('manifest path convention', man.pathString, manifestPath('Test Mod'));
  const parsed = readManifestBlock(man);
  t.eq('manifest round-trips', parsed && parsed.name, 'Test Mod');
  t.eq('manifest has zero aset rows', man.asetEntries.length, 0);
  t.eq('non-manifest block reads as null', readManifestBlock(texture), null);

  // survives a full patch-WAD round trip (the critical zero-row-block case)
  const wad = buildPatchWadMulti([texture, man], 0, null);
  const { blocks } = readPatchWad(wad);
  t.eq('wad round-trip keeps both blocks', blocks.length, 2);
  const back = readManifestBlock(blocks[1]);
  t.eq('manifest survives wad round-trip', back && back.author, 'Logan');
  t.eq('asset block keeps its row', blocks[0].asetEntries.length, 1);

  // merge keeps grouping intact
  const merged = readPatchWad(mergePatchWads(wad, [makeMovieBlock(movie, 'extra_movie').block]));
  const groups = groupBlocks(merged.blocks);
  const named = groups.find((g) => g.name === 'Test Mod');
  t.ok('groupBlocks finds the named mod', !!named && named.indices.length === 1, JSON.stringify(groups.map(g => [g.name, g.indices])));
  const other = groups.find((g) => g.name === null);
  t.ok('unclaimed blocks fall into the other group', !!other && other.indices.length === 1, JSON.stringify(other));
}

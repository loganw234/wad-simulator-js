// Build dist/wad-simulator-js.html — one self-contained file users can double-click.
//
//   node tools/bundle.js
//
// ES modules cannot be loaded from file:// (CORS blocks the sub-requests), so the module
// graph is concatenated into one inline `<script type="module">`, which file:// does allow.
// The vendored fflate is inlined ahead of it.
//
// This is a naive concatenating bundler and it relies on top-level names being unique across
// modules. That assumption is CHECKED below — the build fails loudly rather than emitting a
// file where one module silently shadows another's function. (Adapted from the skinner's.)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /^\s*import\s+[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/;

const seen = new Map();
const order = [];
// fflate is inlined separately (verbatim), so imports of it are dropped, not followed.
const VENDOR = resolve(ROOT, 'vendor/fflate.js');

function load(absPath) {
  if (seen.has(absPath)) return;
  seen.set(absPath, true);
  const src = readFileSync(absPath, 'utf8');
  const kept = [];
  const deps = [];
  let pending = null;
  for (const line of src.split(/\r?\n/)) {
    const probe = pending === null ? line : pending + '\n' + line;
    if (/^\s*import\b/.test(probe)) {
      const m = probe.match(IMPORT_RE);
      if (m) {
        const target = m[1].startsWith('.') ? resolve(dirname(absPath), m[1]) : null;
        if (target && target !== VENDOR) deps.push(target);
        pending = null;
        continue;
      }
      if (!/\bfrom\b/.test(probe)) { pending = probe; continue; }
      throw new Error(`${absPath}: cannot parse import:\n${probe}`);
    }
    pending = null;
    kept.push(line.replace(/^(\s*)export\s+(?=(?:const|let|var|function|class)\b)/, '$1'));
  }
  const code = kept.join('\n').replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  for (const d of deps) load(d);
  order.push({ path: absPath, code });
}

load(resolve(ROOT, 'src/ui/app.js'));

// ---- collision check ----
const owner = new Map();
const collisions = [];
for (const mod of order) {
  for (const line of mod.code.split('\n')) {
    if (/^\s/.test(line)) continue; // top level only
    const m = line.match(DECL_RE);
    if (!m) continue;
    if (owner.has(m[1]) && owner.get(m[1]) !== mod.path) {
      collisions.push(`${m[1]}: ${relative(ROOT, owner.get(m[1]))} and ${relative(ROOT, mod.path)}`);
    } else owner.set(m[1], mod.path);
  }
}
if (collisions.length) {
  console.error('BUNDLE ABORTED — duplicate top-level names would shadow each other:\n  ' +
    collisions.join('\n  ') + '\n\nMove the shared name into src/bytes.js and import it.');
  process.exit(1);
}

// fflate declares its own top-level helpers (u16, etc.) that would collide with ours, so it
// is isolated in an IIFE that exposes ONLY the two functions we call. `export function foo`
// becomes a plain scoped `function foo`; the IIFE returns the pair.
const fflateSrc = readFileSync(VENDOR, 'utf8')
  .replace(/^(\s*)export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '$1')
  .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
const fflate =
  '// --- vendored fflate (MIT), scoped so its internals cannot collide ---\n' +
  'const { deflateSync, inflateSync } = (() => {\n' + fflateSrc +
  '\nreturn { deflateSync, inflateSync };\n})();';

const body = order.map((m) => `// ===== ${relative(ROOT, m.path).replace(/\\/g, '/')} =====\n${m.code}`).join('\n\n');

let html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const scriptRe = /<script type="module">[\s\S]*?<\/script>/;
if (!scriptRe.test(html)) throw new Error('index.html: no <script type="module"> entry point');
html = html.replace(scriptRe,
  '<script type="module">\n' + fflate + '\n\n' +
  '// --- wad-simulator-js ---\n' + body + '\n\nboot();\n' +
  '</script>');

// Guard the two things that silently break a file:// build.
const codeOnly = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
if (/import\.meta/.test(codeOnly)) throw new Error('bundle contains import.meta — would throw inline');
if (/fetch\(['"]\.?\//.test(codeOnly)) throw new Error('bundle fetches a local file — would fail under file://');

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
writeFileSync(resolve(ROOT, 'dist/wad-simulator-js.html'), html);
console.log(`bundled ${order.length} modules + fflate -> dist/wad-simulator-js.html (${(html.length / 1024).toFixed(0)} KB)`);

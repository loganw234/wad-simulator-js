// Shared DOM helpers + a file/drop utility for the WAD and container inputs.

export const $ = (s) => document.querySelector(s);

export const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

export const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** Wire a drop zone + hidden file input to one handler(files: File[]). */
export function wireDrop(zone, input, handler) {
  input.addEventListener('change', (e) => handler([...e.target.files]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    handler([...e.dataTransfer.files]);
  });
}

export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function downloadBytes(name, bytes) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A verdict card — same idea as the skinner's: answer "did it work?" on screen. */
export function verdict({ ok, title, lines = [], hint }) {
  const box = el('div', `verdict ${ok ? 'ok' : 'bad'}`);
  const h = el('div', 'verdict-h');
  h.appendChild(el('span', 'verdict-i', ok ? '✓' : '✕'));
  h.appendChild(el('span', null, title));
  box.appendChild(h);
  for (const l of lines) {
    const row = el('div', `verdict-row${l.ok === false ? ' bad' : ''}`);
    row.appendChild(el('span', 'verdict-k', l.k));
    row.appendChild(el('span', 'verdict-v', l.v));
    box.appendChild(row);
  }
  if (hint) box.appendChild(el('div', 'verdict-hint', hint));
  return box;
}

// A rail: one step open at a time, finished ones collapsed to a tick, later ones locked.
// Same design as the skinner's — a beginner is never left facing every choice at once, and
// never able to skip ahead of a step that has to happen first.

import { el } from './dom.js';

export class Rail {
  constructor(root) {
    this.root = root;
    this.steps = [];
    this.open = 0;
    this.onFinish = null;
  }

  add(id, title, render, summary) {
    this.steps.push({ id, title, render, summary, done: false });
    return this;
  }

  complete(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.steps[i].done = true;
    if (this.open === i) this.open = i + 1;
    this.draw();
    if (this.open >= this.steps.length && this.onFinish) this.onFinish();
  }

  reopen(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.open = i;
    for (let k = i; k < this.steps.length; k++) this.steps[k].done = false;
    this.draw();
  }

  draw() {
    this.root.innerHTML = '';
    this.steps.forEach((s, i) => {
      const locked = i > this.open;
      const isOpen = i === this.open;
      const wrap = el('div', `step${isOpen ? ' open' : ''}${locked ? ' locked' : ''}${s.done && !isOpen ? ' done' : ''}`);
      const head = el('button', 'step-head');
      head.type = 'button';
      head.appendChild(el('span', 'step-n', s.done && !isOpen ? '✓' : String(i + 1)));
      head.appendChild(el('span', 'step-t', s.title));
      if (s.done && !isOpen && s.summary) head.appendChild(el('span', 'step-sum', s.summary() || ''));
      if (locked) head.appendChild(el('span', 'step-lock', 'locked'));
      if (s.done && !isOpen) {
        head.addEventListener('click', () => this.reopen(s.id));
        head.classList.add('clickable');
      } else head.disabled = true;
      wrap.appendChild(head);
      if (isOpen) {
        const body = el('div', 'step-body');
        wrap.appendChild(body);
        s.render(body, this);
      }
      this.root.appendChild(wrap);
    });
  }
}

// Examples gallery: every built-in example grouped by category, each with
// a thumbnail drawn by the board renderer itself (so it matches the board
// and the theme) a short way into its run.

import { networkBounds, Simulation } from '../../engine';
import { EXAMPLE_CATEGORIES, EXAMPLES, scheduleDemo, type Example } from '../../examples';
import type { App } from '../app';
import { Camera, fitView } from '../camera';
import { h } from '../dom';
import { icons } from '../icons';
import { indexNetwork } from '../netops';
import { Renderer } from '../renderer';
import { EMPTY_SELECTION } from '../store';

/** Simulated seconds to run before taking a thumbnail (digits show values, demos have played). */
const THUMB_SECONDS = 30;
const THUMB_W = 320;
const THUMB_H = 180;

export class Gallery {
  readonly el: HTMLDialogElement;
  private body = h('div', { class: 'modal-body' });
  private search = h('input', { type: 'search', placeholder: 'Search examples', 'aria-label': 'Search examples', autocomplete: 'off' });
  private cards = new Map<string, HTMLButtonElement>();
  private sections: { el: HTMLElement; ids: string[] }[] = [];
  private empty = h('div', { class: 'no-results', text: 'No examples match your search.', hidden: true });
  /** Theme the thumbnails were drawn in (null until first drawn). */
  private thumbTheme: string | null = null;

  constructor(private readonly app: App) {
    const close = h('button', { class: 'btn', type: 'button', html: icons.close, 'aria-label': 'Close examples', onclick: () => this.el.close() });
    this.el = h(
      'dialog',
      { class: 'modal gallery', 'aria-labelledby': 'gallery-title' },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { id: 'gallery-title', text: 'Examples' }),
        h('span', { class: 'muted grow', text: `${EXAMPLES.length} networks to explore` }),
        h('label', { class: 'search' }, h('span', { html: icons.search }), this.search),
        close,
      ),
      this.body,
    );
    this.search.addEventListener('input', () => this.filter());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.build();
  }

  open(): void {
    const current = this.app.store.doc.exampleId;
    for (const [id, card] of this.cards) {
      card.classList.toggle('current', id === current);
      card.querySelector('.current-badge')?.toggleAttribute('hidden', id !== current);
    }
    this.el.showModal();
    this.search.value = '';
    this.filter();
    if (matchMedia('(pointer: fine)').matches) this.search.focus();
    else (this.cards.get(current ?? '') ?? this.cards.values().next().value)?.focus();
    if (this.thumbTheme !== this.app.settings.theme) {
      this.thumbTheme = this.app.settings.theme;
      this.renderThumbs();
    }
  }

  private build(): void {
    for (const category of EXAMPLE_CATEGORIES) {
      const list = EXAMPLES.filter((e) => e.category === category);
      if (!list.length) continue;
      const grid = h('div', { class: 'gallery-grid' });
      for (const ex of list) grid.append(this.card(ex));
      const el = h('section', { class: 'gallery-cat', 'aria-label': category }, h('h3', {}, category, h('span', { text: `${list.length}` })), grid);
      this.sections.push({ el, ids: list.map((e) => e.id) });
      this.body.append(el);
    }
    this.body.append(this.empty);
  }

  private card(ex: Example): HTMLButtonElement {
    const notes = ex.network.neurons.some((n) => n.kind === 'note');
    const badges = h(
      'div',
      { class: 'badges' },
      h('span', { class: 'badge accent current-badge', text: 'Open now', hidden: true }),
      ex.demo?.length ? h('span', { class: 'badge accent', text: 'Demo' }) : null,
      notes ? h('span', { class: 'badge', text: '♪ Sound' }) : null,
      h('span', { class: 'badge', text: `${ex.network.neurons.length} neurons` }),
    );
    const card = h(
      'button',
      {
        class: 'ex-card',
        type: 'button',
        onclick: () => {
          this.el.close();
          this.app.loadExample(ex);
        },
      },
      h('div', { class: 'thumb' }, h('img', { alt: '' })),
      h('div', { class: 'ex-card-body' }, h('div', { class: 'ex-card-title', text: ex.title }), h('div', { class: 'ex-card-sum', text: ex.summary }), badges),
    );
    this.cards.set(ex.id, card);
    return card;
  }

  /** Render thumbnails one per task so opening the dialog stays smooth. */
  private renderThumbs(): void {
    const canvas = h('canvas');
    const renderer = new Renderer(canvas);
    renderer.setPalette(this.app.palette);
    renderer.resize(THUMB_W, THUMB_H, 2);
    const queue = [...EXAMPLES];
    const next = () => {
      const ex = queue.shift();
      if (!ex) return;
      const img = this.cards.get(ex.id)?.querySelector('img');
      if (img) img.src = thumbnail(renderer, canvas, ex);
      setTimeout(next, 0);
    };
    setTimeout(next, 30);
  }

  private filter(): void {
    const q = this.search.value.trim().toLowerCase();
    let any = false;
    for (const section of this.sections) {
      let visible = 0;
      for (const id of section.ids) {
        const ex = EXAMPLES.find((e) => e.id === id)!;
        const hit = !q || `${ex.title} ${ex.summary} ${ex.category} ${ex.description}`.toLowerCase().includes(q);
        this.cards.get(id)!.hidden = !hit;
        if (hit) visible++;
      }
      section.el.hidden = visible === 0;
      if (visible) any = true;
    }
    this.empty.hidden = any;
  }
}

/** Draw an example a short way into its run and return it as an image URL. */
function thumbnail(renderer: Renderer, canvas: HTMLCanvasElement, ex: Example): string {
  const sim = new Simulation(ex.network);
  if (ex.demo?.length) scheduleDemo(sim, ex.demo);
  sim.runSeconds(THUMB_SECONDS);
  const b = networkBounds(ex.network);
  const camera = new Camera();
  camera.set(fitView({ minX: b.minX - 0.3, minY: b.minY - 0.3, maxX: b.maxX + 0.3, maxY: b.maxY + 0.3 }, THUMB_W, THUMB_H, 12, 40));
  renderer.clearEffects();
  renderer.draw(
    {
      network: ex.network,
      index: indexNetwork(ex.network),
      selection: EMPTY_SELECTION,
      tool: 'select',
      kind: 'normal',
      hover: null,
      preview: null,
      pendingSource: null,
      pointer: null,
      sim,
      tick: sim.tick,
      camera,
      handleFor: null,
    },
    0,
  );
  return canvas.toDataURL('image/png');
}

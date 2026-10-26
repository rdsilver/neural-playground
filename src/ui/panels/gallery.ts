// Examples gallery: a wide featured card for "Start here", then every
// category in EXAMPLE_CATEGORIES order with a one-line blurb and a grid of
// cards. Chips jump to a category; search filters by title, summary and
// write-up. Thumbnails are drawn by the board renderer itself (so they match
// the board and the theme) a short way into each example's run.

import { networkBounds, Simulation } from '../../engine';
import { EXAMPLE_CATEGORIES, EXAMPLES, scheduleDemo, type Example, type ExampleCategory } from '../../examples';
import type { App } from '../app';
import { Camera, fitView } from '../camera';
import { h, prefersReducedMotion } from '../dom';
import { icons } from '../icons';
import { indexNetwork } from '../netops';
import { Renderer } from '../renderer';
import { EMPTY_SELECTION } from '../store';

/** Simulated seconds to run before taking a thumbnail (digits show values, demos have played). */
const THUMB_SECONDS = 30;
const THUMB = { w: 320, h: 180 };
const FEATURED_THUMB = { w: 560, h: 315 };

const BLURBS: Record<ExampleCategory, string> = {
  'Start here': 'Small circuits, one idea each. The best place to begin.',
  Calculators: 'Arithmetic done entirely with spikes. Press the keys!',
  Counting: 'Counters, clocks and carries.',
  Music: 'Note neurons turn activity into melody. Turn the sound on.',
  Patterns: 'Loops, cascades and rhythms that emerge from simple rules.',
  Classics: 'The six networks that shipped with the original 2016 playground.',
};

export class Gallery {
  readonly el: HTMLDialogElement;
  // Gets focus on touch screens (autofocus), so opening never pops up the keyboard.
  private body = h('div', { class: 'modal-body gallery-body', tabindex: -1, autofocus: true });
  private nav = h('nav', { class: 'cat-nav', 'aria-label': 'Categories' });
  private search = h('input', { type: 'search', placeholder: 'Search examples', 'aria-label': 'Search examples', autocomplete: 'off' });
  private cards = new Map<string, { card: HTMLButtonElement; img: HTMLImageElement; featured: boolean }>();
  private sections: { el: HTMLElement; chip: HTMLButtonElement; ids: string[] }[] = [];
  private empty = h('div', { class: 'no-results', text: 'No examples match your search.', hidden: true });
  /** Theme the thumbnails were drawn in (null until first drawn). */
  private thumbTheme: string | null = null;

  constructor(private readonly app: App) {
    const close = h('button', { class: 'btn icon-btn', type: 'button', html: icons.close, 'aria-label': 'Close examples', onclick: () => this.el.close() });
    this.el = h(
      'dialog',
      { class: 'modal gallery', 'aria-labelledby': 'gallery-title' },
      h(
        'div',
        { class: 'modal-head gallery-head' },
        h(
          'div',
          { class: 'gallery-heading' },
          h('h2', { id: 'gallery-title', text: 'Examples' }),
          h('p', { class: 'muted', text: `${EXAMPLES.length} networks to explore. Opening one keeps your own work one undo away.` }),
        ),
        h('label', { class: 'search' }, h('span', { html: icons.search }), this.search),
        close,
      ),
      this.nav,
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
    for (const [id, { card }] of this.cards) {
      card.classList.toggle('current', id === current);
      card.querySelector('.current-badge')?.toggleAttribute('hidden', id !== current);
      this.updateTried(id);
    }
    this.el.showModal();
    this.search.value = '';
    this.filter();
    this.body.scrollTop = 0;
    if (matchMedia('(pointer: fine)').matches) this.search.focus();
    else this.body.focus({ preventScroll: true });
    if (this.thumbTheme !== this.app.settings.theme) {
      this.thumbTheme = this.app.settings.theme;
      this.renderThumbs();
    }
  }

  private build(): void {
    for (const category of EXAMPLE_CATEGORIES) {
      const list = EXAMPLES.filter((e) => e.category === category);
      if (!list.length) continue;
      const featured = category === EXAMPLE_CATEGORIES[0];
      const grid = h('div', { class: `gallery-grid${featured ? ' featured' : ''}` });
      for (const ex of list) grid.append(this.card(ex, featured));
      const id = `cat-${category.toLowerCase().replace(/\W+/g, '-')}`;
      const el = h(
        'section',
        { class: 'gallery-cat', 'aria-labelledby': id },
        h('div', { class: 'cat-head' }, h('h3', { id }, category, h('span', { class: 'count', text: `${list.length}` })), h('p', { text: BLURBS[category] })),
        grid,
      );
      const chip = h(
        'button',
        { class: 'cat-chip', type: 'button', onclick: () => el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }) },
        category,
        h('span', { class: 'count', text: `${list.length}` }),
      );
      this.nav.append(chip);
      this.sections.push({ el, chip, ids: list.map((e) => e.id) });
      this.body.append(el);
    }
    this.body.append(this.empty);
  }

  private card(ex: Example, featured: boolean): HTMLButtonElement {
    const notes = ex.network.neurons.some((n) => n.kind === 'note');
    const img = h('img', { alt: '', width: featured ? FEATURED_THUMB.w : THUMB.w, height: featured ? FEATURED_THUMB.h : THUMB.h, decoding: 'async' });
    const overlay = h(
      'div',
      { class: 'badges' },
      ex.demo?.length ? h('span', { class: 'badge accent' }, h('span', { html: icons.play }), 'Demo') : null,
      notes ? h('span', { class: 'badge' }, h('span', { html: icons.soundOn }), 'Sound') : null,
    );
    const meta = h('div', { class: 'ex-card-meta' }, h('span', { class: 'tried', hidden: true }), h('span', { text: `${ex.network.neurons.length} neurons` }));
    const card = h(
      'button',
      {
        class: `ex-card${featured ? ' featured' : ''}`,
        type: 'button',
        onclick: () => {
          this.el.close();
          this.app.loadExample(ex);
        },
      },
      h('div', { class: 'thumb' }, img, h('span', { class: 'badge current-badge', text: 'Open now', hidden: true }), overlay),
      h(
        'div',
        { class: 'ex-card-body' },
        featured ? h('div', { class: 'eyebrow', text: ex.category }) : null,
        h('div', { class: 'ex-card-title', text: ex.title }),
        h('div', { class: 'ex-card-sum', text: ex.summary }),
        meta,
      ),
    );
    this.cards.set(ex.id, { card, img, featured });
    return card;
  }

  /** "2 of 3 tried" (or "Explored") from the card's checklist progress. */
  private updateTried(id: string): void {
    const ex = EXAMPLES.find((e) => e.id === id);
    const el = this.cards.get(id)?.card.querySelector<HTMLElement>('.tried');
    if (!ex || !el) return;
    const total = ex.tryThis?.length ?? 0;
    const done = this.app.settings.tried[id]?.length ?? 0;
    el.hidden = !total || !done;
    el.innerHTML = `${icons.check}<span>${done >= total ? 'Explored' : `${done} of ${total} tried`}</span>`;
    el.classList.toggle('all', done >= total);
  }

  /** Render thumbnails one per task so opening the dialog stays smooth. */
  private renderThumbs(): void {
    const canvas = h('canvas');
    const renderer = new Renderer(canvas);
    renderer.setPalette(this.app.palette);
    // Featured first: it is the biggest and the first thing in view.
    const queue = [...this.cards.entries()].sort((a, b) => Number(b[1].featured) - Number(a[1].featured));
    const next = () => {
      const item = queue.shift();
      if (!item) return;
      const [id, { img, featured }] = item;
      const ex = EXAMPLES.find((e) => e.id === id);
      if (ex) {
        img.src = thumbnail(renderer, canvas, ex, featured ? FEATURED_THUMB : THUMB);
        img.classList.add('ready');
      }
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
        this.cards.get(id)!.card.hidden = !hit;
        if (hit) visible++;
      }
      section.el.hidden = visible === 0;
      section.chip.disabled = visible === 0;
      if (visible) any = true;
    }
    this.empty.hidden = any;
  }
}

/** Draw an example a short way into its run and return it as an image URL. */
function thumbnail(renderer: Renderer, canvas: HTMLCanvasElement, ex: Example, size: { w: number; h: number }): string {
  renderer.resize(size.w, size.h, 2);
  const sim = new Simulation(ex.network);
  if (ex.demo?.length) scheduleDemo(sim, ex.demo);
  sim.runSeconds(THUMB_SECONDS);
  const b = networkBounds(ex.network);
  const camera = new Camera();
  camera.set(fitView({ minX: b.minX - 0.3, minY: b.minY - 0.3, maxX: b.maxX + 0.3, maxY: b.maxY + 0.3 }, size.w, size.h, size.w / 26, size.w / 8));
  renderer.clearEffects();
  renderer.draw(
    {
      network: ex.network,
      index: indexNetwork(ex.network),
      selection: EMPTY_SELECTION,
      tool: 'select',
      kind: 'normal',
      hover: null,
      keyCursor: null,
      preview: null,
      pendingSource: null,
      pointer: null,
      sim,
      tick: sim.tick,
      camera,
      handleFor: null,
      upcomingTaps: [],
      tapLead: 1,
    },
    0,
  );
  return canvas.toDataURL('image/png');
}

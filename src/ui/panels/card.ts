// The notes card that floats under the title island: what the open example
// is (category, title, summary, the full write-up behind "Read more"), a
// "Try this" checklist whose ticks are remembered per example, demo replay,
// the next example, and the network's stats folded away at the bottom.
// For your own networks it shows the stats and a few tips instead.
// Collapses to a slim pill (a one-line bar on phones).

import { KIND_INFO, NEURON_KINDS, type NeuronKind } from '../../engine';
import { EXAMPLES, type Example } from '../../examples';
import type { App } from '../app';
import { h } from '../dom';
import { icons } from '../icons';
import { tipped } from './tooltip';

/** Write-ups longer than this start folded behind "Read more". */
const LONG_DESCRIPTION = 240;

export class ExampleCard {
  readonly el: HTMLElement;
  private panel = h('section', { class: 'card island', 'aria-label': 'About this network' });
  private scroll = h('div', { class: 'card-scroll' });
  private footer = h('div', { class: 'card-actions' });
  private pill: HTMLButtonElement;
  private pillEyebrow = h('span', { class: 'pill-eyebrow' });
  private pillText = h('span', { class: 'pill-text' });
  private pillCount = h('span', { class: 'pill-count' });
  private open = true;
  /** Which document the card was last rendered for (re-render on change). */
  private shownDoc: object | null = null;
  private expanded = false;
  private statsOpen = false;
  private liveStats: (() => void) | null = null;
  private readonly phone = matchMedia('(max-width: 760px)');
  private readonly coarse = matchMedia('(pointer: coarse)');

  constructor(private readonly app: App) {
    // detail === 0: a click from the keyboard, so focus follows into the card.
    this.pill = h('button', { class: 'card-pill island', type: 'button', 'aria-expanded': 'false', onclick: (e: MouseEvent) => this.setOpen(true, e.detail === 0) }, this.pillEyebrow, this.pillText, this.pillCount, h('span', { class: 'pill-chevron', html: icons.chevronDown }));
    tipped(this.pill, 'Show the notes');
    this.panel.append(this.scroll, this.footer);
    this.el = h('div', { class: 'card-wrap' }, this.pill, this.panel);
    app.store.on('network', ({ docChanged }) => {
      if (docChanged) this.reset();
      else this.render();
    });
  }

  /** Is there anything to show (an example, or a non-empty network)? */
  get available(): boolean {
    const net = this.app.store.network;
    return !!this.app.currentExample || net.neurons.length > 0 || (net.texts?.length ?? 0) > 0;
  }

  get isOpen(): boolean {
    return this.available && this.open;
  }

  /** The card or its pill, whichever is showing (for zoom-to-fit). */
  rect(): DOMRect | null {
    if (!this.available) return null;
    return (this.open ? this.panel : this.pill).getBoundingClientRect();
  }

  /**
   * A new document: start open for examples (unless this one was collapsed
   * before, or on a phone), folded for your own networks.
   */
  reset(): void {
    const ex = this.app.currentExample;
    this.open = !!ex && !this.phone.matches && !this.app.settings.dismissedNotes.includes(ex.id);
    this.expanded = false;
    this.render();
  }

  toggle(focus = false): void {
    this.setOpen(!this.open, focus);
  }

  /** Open or fold the card; `focus` moves keyboard focus along with it. */
  setOpen(open: boolean, focus = false): void {
    if (!this.available) return;
    this.open = open;
    const ex = this.app.currentExample;
    if (ex) {
      if (open) this.app.restoreNotes(ex.id);
      else this.app.dismissNotes(ex.id);
    }
    this.sync();
    if (!focus) return;
    if (open) this.scroll.querySelector<HTMLElement>('.card-collapse')?.focus({ preventScroll: true });
    else this.pill.focus({ preventScroll: true });
  }

  /** Refresh the live numbers in the stats section (a few times a second). */
  live(): void {
    if (this.open && this.statsOpen) this.liveStats?.();
  }

  private sync(): void {
    const available = this.available;
    this.el.hidden = !available;
    this.panel.hidden = !this.open;
    this.pill.hidden = this.open;
    this.pill.setAttribute('aria-expanded', String(this.open));
    this.app.onCardChange();
  }

  render(): void {
    const doc = this.app.store.doc;
    const docChanged = doc !== this.shownDoc;
    this.shownDoc = doc;
    const scrollTop = docChanged ? 0 : this.scroll.scrollTop;
    const ex = this.app.currentExample;
    this.liveStats = null;
    if (ex) this.renderExample(ex);
    else this.renderOwn();
    this.scroll.scrollTop = scrollTop;
    this.sync();
  }

  private header(eyebrow: string, title: string): HTMLElement {
    const collapse = tipped(
      h('button', { class: 'btn icon-btn card-collapse', type: 'button', html: icons.chevronUp, onclick: (e: MouseEvent) => this.setOpen(false, e.detail === 0) }),
      'Fold the notes away',
    );
    return h('header', { class: 'card-head' }, h('div', { class: 'card-heading' }, h('div', { class: 'eyebrow', text: eyebrow }), h('h2', { class: 'card-title', text: title })), collapse);
  }

  private renderExample(ex: Example): void {
    const app = this.app;
    const tried = new Set(app.settings.tried[ex.id] ?? []);
    const total = ex.tryThis?.length ?? 0;

    this.pillEyebrow.textContent = ex.category;
    this.pillText.textContent = this.phone.matches ? ex.summary : ex.title;
    this.pillCount.textContent = total ? `${tried.size}/${total}` : '';
    this.pillCount.hidden = !total;

    // The write-up: summary up front, the rest folded when long.
    const paragraphs = ex.description.split(/\n\s*\n/).map((p) => p.trim());
    const long = ex.description.length > LONG_DESCRIPTION || paragraphs.length > 2;
    const desc = h('div', { class: `card-desc${long && !this.expanded ? ' clamped' : ''}`, id: 'card-desc' }, ...paragraphs.map((p) => h('p', { text: p })));
    const more = long
      ? h('button', {
          class: 'link-btn',
          type: 'button',
          'aria-expanded': String(this.expanded),
          'aria-controls': 'card-desc',
          text: this.expanded ? 'Show less' : 'Read more',
          onclick: () => {
            this.expanded = !this.expanded;
            this.render();
          },
        })
      : null;

    const parts: (HTMLElement | null)[] = [this.header(ex.category, ex.title), h('p', { class: 'card-summary', text: ex.summary }), desc, more];
    if (total) parts.push(this.checklist(ex, tried));
    parts.push(this.stats());
    this.scroll.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));

    const next = EXAMPLES[(EXAMPLES.indexOf(ex) + 1) % EXAMPLES.length]!;
    const nextBtn = tipped(
      h('button', { class: 'btn ghost next-btn', type: 'button', onclick: () => app.loadExample(next) }, h('span', {}, 'Next', h('span', { class: 'next-long', text: ' example' })), h('span', { html: icons.arrowRight })),
      `Next: ${next.title}`,
      undefined,
      next.summary,
    );
    const primary = ex.demo?.length
      ? h('button', { class: 'btn primary', type: 'button', onclick: () => app.replayDemo() }, h('span', { html: icons.replay }), 'Replay demo')
      : h('button', { class: 'btn outline', type: 'button', onclick: () => app.restart() }, h('span', { html: icons.reset }), 'Restart');
    const more2 = tipped(h('button', { class: 'btn icon-btn', type: 'button', html: icons.examples, onclick: () => app.openGallery() }), 'More examples', app.keysFor('examples'));
    this.footer.replaceChildren(primary, more2, h('span', { class: 'grow' }), nextBtn);
  }

  private checklist(ex: Example, tried: Set<number>): HTMLElement {
    const total = ex.tryThis!.length;
    const count = h('span', { class: 'try-count', text: `${tried.size} of ${total}` });
    const list = h('ul', { class: 'try-list' });
    ex.tryThis!.forEach((text, i) => {
      const box = h('input', { type: 'checkbox', checked: tried.has(i), 'aria-label': `Done: ${text}` });
      box.addEventListener('change', () => this.app.setTried(ex, i, box.checked));
      list.append(h('li', {}, h('label', { class: tried.has(i) ? 'done' : '' }, box, h('span', { class: 'check', html: icons.check, 'aria-hidden': 'true' }), h('span', { class: 'try-text', text }))));
    });
    const bar = h('span', { class: 'try-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(100 * tried.size) / total}%` }));
    return h('section', { class: 'try', 'aria-label': 'Try this' }, h('div', { class: 'try-head' }, h('h3', { text: 'Try this' }), count), bar, list);
  }

  private renderOwn(): void {
    const app = this.app;
    const net = app.store.network;
    const doc = app.store.doc;
    this.pillEyebrow.textContent = 'Network';
    this.pillText.textContent = doc.title;
    this.pillCount.textContent = `${net.neurons.length}`;
    this.pillCount.hidden = false;
    const tip = (keys: string[], text: string) => h('li', {}, h('span', { class: 'tip-keys' }, ...keys.map((k) => h('kbd', { text: k }))), h('span', { text }));
    const mod = app.isMac ? '⌘' : 'Ctrl';
    // Touch screens get gestures; keyboards and mice get their shortcuts.
    const tips = this.coarse.matches
      ? [
          tip(['Tap'], 'a neuron while it runs to poke it (+1 charge)'),
          tip(['Hold'], 'a neuron to inspect it'),
          tip(['Kind'], 'pick one in the dock, then tap the grid'),
          tip(['Drag'], 'from a neuron’s handle to connect it'),
        ]
      : [
          tip(['Click'], 'a neuron while it runs to poke it (+1 charge)'),
          tip(['⇧', 'Click'], 'or right-click to inspect it'),
          tip(['1', '–', '6'], 'pick a neuron kind, then click the grid'),
          tip(['Drag'], 'from a neuron’s handle to connect it'),
          tip([mod, 'K'], 'search every command'),
        ];
    this.scroll.replaceChildren(
      this.header('Your network', doc.title),
      h('p', { class: 'card-summary', text: 'Saved in this browser as you work. Share a link to it, or export it as JSON, from the top right.' }),
      h('ul', { class: 'tips' }, ...tips),
      this.stats(),
    );
    this.footer.replaceChildren(h('button', { class: 'btn outline', type: 'button', onclick: () => app.openGallery() }, h('span', { html: icons.examples }), 'Browse examples'));
  }

  /** Network stats, folded by default. */
  private stats(): HTMLElement {
    const app = this.app;
    const net = app.store.network;
    const counts = new Map<NeuronKind, number>();
    for (const n of net.neurons) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    const pulses = h('b', { text: '0' });
    const fires = h('b', { text: '0' });
    this.liveStats = () => {
      const sim = app.runner.sim;
      pulses.textContent = sim.pulses().length.toLocaleString('en-US');
      let total = 0;
      for (const n of net.neurons) total += sim.state(n.id)?.fireCount ?? 0;
      fires.textContent = total.toLocaleString('en-US');
    };
    const bars = h('div', { class: 'kind-bars', 'aria-hidden': 'true' });
    const legend = h('div', { class: 'legend-inline' });
    for (const kind of NEURON_KINDS) {
      const c = counts.get(kind);
      if (!c) continue;
      bars.append(h('span', { style: `width:${(100 * c) / net.neurons.length}%;background:${app.palette.kinds[kind]}` }));
      legend.append(h('span', {}, h('i', { style: `background:${app.palette.kinds[kind]}` }), `${c} ${KIND_INFO[kind].name}`));
    }
    const fmt = (n: number) => n.toLocaleString('en-US');
    const details = h(
      'details',
      { class: 'card-stats', open: this.statsOpen },
      h('summary', {}, h('span', { html: icons.stats }), h('span', { class: 'grow', text: 'Network' }), h('span', { class: 'muted', text: `${fmt(net.neurons.length)} neurons · ${fmt(net.connections.length)} links` }), h('span', { class: 'summary-chevron', html: icons.chevronDown })),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: fmt(net.neurons.length) }), h('span', { text: 'neurons' })),
        h('div', { class: 'stat' }, h('b', { text: fmt(net.connections.length) }), h('span', { text: 'connections' })),
        h('div', { class: 'stat' }, pulses, h('span', { text: 'pulses in flight' })),
        h('div', { class: 'stat' }, fires, h('span', { text: 'fires since reset' })),
      ),
      net.neurons.length ? bars : null,
      net.neurons.length ? legend : null,
    );
    details.addEventListener('toggle', () => {
      this.statsOpen = details.open;
      if (details.open) this.liveStats?.();
    });
    if (this.statsOpen) this.liveStats();
    return details;
  }
}

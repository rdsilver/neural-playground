// Text just above the transport: an example demo's captions (prominent,
// like subtitles, with a progress bar and a stop button) or, when no demo is
// talking, one quiet line about what a click or drag does right now. The
// hint fades out when it has been up unchanged for a while, so it can simply
// be ignored.

import { KIND_INFO } from '../../engine';
import type { App } from '../app';
import { h } from '../dom';
import { icons } from '../icons';
import { selectionSize } from '../store';
import { tipped } from './tooltip';

/** Captions this short (sums like "47 + 85") get a big monospace style. */
const SHORT_CAPTION = 18;
/** An unchanged hint fades away after this long. */
const HINT_IDLE_MS = 9000;

export class Hud {
  readonly el: HTMLElement;
  private caption: HTMLElement;
  private captionText = h('span', { class: 'caption-text' });
  private progress = h('span', { class: 'caption-progress', 'aria-hidden': 'true' });
  private hint = h('div', { class: 'hint', 'aria-hidden': 'true' });
  private shownCaption: string | undefined;
  private shownFraction = -1;
  private shownHint = '';
  private hintSince = 0;
  private readonly coarse = matchMedia('(pointer: coarse)');

  constructor(private readonly app: App) {
    const stop = tipped(
      h('button', { class: 'btn icon-btn caption-stop', type: 'button', html: icons.close, onclick: () => app.stopDemo() }),
      'Stop the demo',
      undefined,
      'The simulation keeps running',
    );
    this.caption = h(
      'div',
      { class: 'caption', role: 'status', 'aria-live': 'polite', hidden: true },
      h('span', { class: 'caption-tag' }, h('span', { class: 'caption-tag-dot', 'aria-hidden': 'true' }), 'Demo'),
      this.captionText,
      stop,
      this.progress,
    );
    this.el = h('div', { class: 'hud', 'data-tip-side': 'top' }, this.caption, this.hint);
  }

  /** True while a demo caption is on screen. */
  get captionShown(): boolean {
    return this.shownCaption !== undefined;
  }

  /** Every frame: caption text and progress (cheap when nothing changed). */
  update(now: number): void {
    const r = this.app.runner;
    const text = r.demoLive ? r.caption : undefined;
    if (text !== this.shownCaption) {
      this.shownCaption = text;
      this.caption.hidden = text === undefined;
      if (text !== undefined) {
        this.captionText.textContent = text;
        this.caption.classList.toggle('short', text.length <= SHORT_CAPTION);
        // Replay the entrance for each new caption.
        this.caption.classList.remove('enter');
        void this.caption.offsetWidth;
        this.caption.classList.add('enter');
      }
      this.updateHint(now, true);
    }
    if (text !== undefined) {
      const f = Math.round(r.demoFraction * 1000) / 1000;
      if (f !== this.shownFraction) {
        this.shownFraction = f;
        this.progress.style.transform = `scaleX(${f})`;
      }
    }
  }

  /** A few times a second: the contextual hint. */
  updateHint(now: number, force = false): void {
    const text = this.captionShown ? '' : this.contextualHint();
    if (text !== this.shownHint || force) {
      if (text !== this.shownHint) this.hintSince = now;
      this.shownHint = text;
      this.hint.textContent = text;
      this.hint.hidden = !text;
    }
    this.hint.classList.toggle('idle', now - this.hintSince > HINT_IDLE_MS);
  }

  private contextualHint(): string {
    const { app } = this;
    const { store, runner, input } = app;
    const touch = this.coarse.matches;
    const click = touch ? 'Tap' : 'Click';
    const lower = click.toLowerCase();
    const kind = KIND_INFO[store.kind].name;
    if (app.keyCursorShown) return 'Arrows move the cursor · 1–6 place a neuron · Enter selects or places · N jumps to the next neuron';
    // An empty board has its own card, except while placing.
    if (!store.network.neurons.length && !store.network.texts?.length && store.tool !== 'place') return '';
    if (runner.overloaded) return 'Paused: this network multiplies pulses without limit · R resets it';
    const preview = input.preview;
    if (preview?.type === 'connect') {
      if (preview.removing) return 'Release to remove this connection';
      if (preview.target) return touch ? 'Release to connect' : 'Release to connect · hold Shift for two-way';
      if (preview.newCell) return `Release to add a ${kind} here, already connected`;
      return 'Drop on another neuron to connect';
    }
    if (preview?.type === 'move') return preview.valid ? 'Release to move' : 'Something is in the way';
    if (preview?.type === 'marquee') return 'Release to select everything in the box';
    switch (store.tool) {
      case 'place':
        return `${click} an empty cell to place a ${kind} · drag from a neuron to grow a connected one · Esc to stop`;
      case 'connect':
        return input.pendingSource
          ? `Now ${lower} the target neuron${touch ? '' : ' · Shift for two-way'} · Esc to cancel`
          : `${click} a source neuron, then its target, or drag between them`;
      case 'text':
        return `${click} anywhere to add a note`;
      case 'hand':
        return `Drag to pan · ${lower} neurons to poke them`;
      default:
        break;
    }
    const hover = input.hover;
    if (hover?.type === 'handle') return 'Drag to another neuron to connect, or to an empty cell to grow a new one';
    if (hover?.type === 'connection') return `${click} to select this connection`;
    if (hover?.type === 'text') return 'Double-click to edit · drag to move';
    if (hover?.type === 'neuron') {
      if (!runner.playing) return 'Click to inspect · drag to move · drag the handle to connect';
      return store.index.byId.get(hover.id)?.kind === 'timer'
        ? 'Timers fire on their own · Shift-click or right-click to inspect'
        : 'Click to poke (+1 charge) · Shift-click or right-click to inspect';
    }
    if (selectionSize(store.selection)) return touch ? 'Tap empty space to deselect' : 'Arrows move it · Delete removes it · Esc deselects';
    if (runner.playing) return touch ? 'Tap a neuron to poke it · drag to pan · long-press to inspect' : 'Click a neuron to poke it · Shift-click to inspect · Space pauses';
    return touch ? 'Paused · tap a neuron to select it, then drag to move it' : 'Paused · Space to run · click a neuron to inspect it';
  }
}

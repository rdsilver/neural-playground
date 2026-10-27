// A small live readout that appears above a neuron after hovering it for a
// moment: kind, charge against threshold (or a timer's countdown), fire
// count, and what clicking will do (poke while running, inspect while
// paused). Mouse only.

import { KIND_INFO, noteName, TICKS_PER_SECOND } from '../../engine';
import type { App } from '../app';
import { h } from '../dom';

const DELAY_MS = 450;

export class HoverCard {
  readonly el = h('div', { class: 'hover-card', 'aria-hidden': 'true' });
  private title = h('b');
  private detail = h('span');
  private hint = h('span', { class: 'muted' });
  private id: string | null = null;
  private since = 0;
  private text = '';

  constructor(private readonly app: App) {
    this.el.append(this.title, this.detail, this.hint);
  }

  update(now: number): void {
    const { input, store, camera, runner } = this.app;
    const hover = input.hover;
    let id = hover?.type === 'neuron' && !input.busy ? hover.id : null;
    // The open inspector already shows the selected neuron (and the card
    // would slide under it when the neuron sits next to the panel).
    if (id && this.app.inspector.isOpen && store.selection.neurons.has(id)) id = null;
    if (id !== this.id) {
      this.id = id;
      this.since = now;
      this.el.classList.remove('show');
    }
    const n = id ? store.index.byId.get(id) : undefined;
    if (!n || now - this.since < DELAY_MS) return;

    const sim = runner.sim;
    const st = sim.state(n.id);
    const info = KIND_INFO[n.kind];
    let detail: string;
    if (n.kind === 'timer') {
      const times = n.times ?? -1;
      const done = !!st && times >= 0 && st.timerFires >= times;
      const left = st ? Math.max(0, st.nextTimerTick - sim.tick) / TICKS_PER_SECOND : 0;
      detail = done ? `finished · fired ${st?.timerFires ?? 0}×` : `every ${n.interval}s · next in ${left.toFixed(1)}s`;
    } else {
      detail = `charge ${st?.charge ?? 0} / ${n.threshold} · fired ${st?.fireCount ?? 0}×`;
      if (n.kind === 'note') detail = `${noteName(n.note ?? 60)} · ${detail}`;
      if (n.kind === 'lamp') detail = `${(st?.charge ?? 0) > 0 ? 'lit' : 'dark'} · ${detail}`;
    }
    // What a click does here: poke while running (Shift-click or right-click
    // to inspect instead), inspect while paused.
    let hint = '';
    if (store.tool === 'hand') hint = n.kind === 'timer' ? 'Timers fire on their own' : 'Click to poke (+1)';
    else if (runner.playing) hint = n.kind === 'timer' ? 'Fires on its own · Shift-click to inspect' : 'Click to poke (+1) · Shift-click to inspect';
    else if (store.tool === 'select') hint = 'Click to inspect · drag to move';
    const title = `${info.name}${n.label ? ` “${n.label}”` : ''}`;
    const text = `${title}|${detail}|${hint}`;
    if (text !== this.text) {
      this.text = text;
      this.title.textContent = title;
      this.detail.textContent = detail;
      this.hint.textContent = hint;
      this.hint.hidden = !hint;
    }
    const at = camera.toScreen(n.x + 0.5, n.y);
    this.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - 8)}px) translate(-50%, -100%)`;
    this.el.classList.add('show');
  }
}

// Bottom transport bar: play/pause, step, reset, speed, simulated clock,
// run status (with demo progress and replay) and zoom controls.

import { KIND_INFO } from '../../engine';
import type { App } from '../app';
import { DEFAULT_SCALE } from '../camera';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { formatSimTime, formatSpeed, SPEEDS } from '../runner';
import { tipped } from './tooltip';

export class Transport {
  readonly el: HTMLElement;
  private play: HTMLButtonElement;
  private speed = h('select', { 'aria-label': 'Simulation speed' });
  private time = h('span', { class: 'clock-time', text: '0:00.0' });
  private ticks = h('span', { class: 'clock-sub' });
  private dot = h('span', { class: 'live-dot', 'aria-hidden': 'true' });
  private status = h('span', { class: 'tp-status-text' });
  private demoChip = h('span', { class: 'badge accent demo-chip', hidden: true });
  private replay: HTMLButtonElement;
  private zoomVal: HTMLButtonElement;
  private cursor = h('span', { class: 'cursor-pos', 'aria-hidden': 'true' });
  private last = '';

  constructor(private readonly app: App) {
    const btn = (icon: IconName, title: string, command: string, run: () => void, cls = '') =>
      tipped(h('button', { class: `btn ${cls}`, type: 'button', html: icons[icon], onclick: run }), title, app.keysFor(command));

    this.play = btn('play', 'Play', 'play', () => app.togglePlay(), 'tp-play');
    for (const s of SPEEDS) this.speed.append(h('option', { value: s, text: formatSpeed(s) }));
    this.speed.addEventListener('change', () => {
      app.setSpeed(Number(this.speed.value));
      // Hand focus back so Space means play/pause again.
      this.speed.blur();
    });
    tipped(this.speed, 'Speed', '[ ]');
    this.replay = tipped(
      h('button', { class: 'btn small', type: 'button', onclick: () => app.replayDemo() }, h('span', { html: icons.replay }), 'Replay'),
      'Replay demo',
      undefined,
      'Reset and play the scripted demo again',
    );
    this.replay.hidden = true;
    this.zoomVal = tipped(h('button', { class: 'zoom-val', type: 'button', onclick: () => app.zoomTo(DEFAULT_SCALE) }), 'Zoom to 100%', app.keysFor('zoom-reset'));

    this.el = h(
      'footer',
      { class: 'transport', 'aria-label': 'Simulation controls', 'data-tip-side': 'top' },
      h(
        'div',
        { class: 'tp-group' },
        this.play,
        btn('step', 'Step one tick', 'step', () => app.step()),
        btn('fire', 'Step to next fire', 'step-fire', () => app.step(true), 'tp-step-fire'),
        btn('reset', 'Reset', 'reset', () => app.reset()),
      ),
      h(
        'div',
        { class: 'speed' },
        btn('minus', 'Slower', 'slower', () => app.nudgeSpeed(-1), 'small'),
        this.speed,
        btn('plus', 'Faster', 'faster', () => app.nudgeSpeed(1), 'small'),
      ),
      h('div', { class: 'clock', 'aria-label': 'Simulated time' }, this.time, this.ticks),
      h('div', { class: 'tp-status' }, this.dot, this.demoChip, this.status, this.replay),
      this.cursor,
      h(
        'div',
        { class: 'zoom' },
        btn('zoomOut', 'Zoom out', 'zoom-out', () => app.zoomBy(0.8), 'zoom-step'),
        this.zoomVal,
        btn('zoomIn', 'Zoom in', 'zoom-in', () => app.zoomBy(1.25), 'zoom-step'),
        btn('fit', 'Zoom to fit', 'fit', () => app.zoomToFit()),
      ),
    );
    app.canvas.addEventListener('pointermove', () => this.updateCursor());
    app.canvas.addEventListener('pointerleave', () => (this.cursor.textContent = ''));
  }

  /** Refresh readouts (called a few times a second and after actions). */
  update(): void {
    const { runner, store, camera } = this.app;
    const sim = runner.sim;
    const pulses = sim.pulses().length;
    const demo = runner.demoProgress;
    const demoLive = demo && runner.demoSeconds <= runner.demoEndsAt + 6;
    const hint = this.toolHint();
    const key = [runner.playing, runner.overloaded, runner.speed, sim.tick, pulses, demo?.done, demoLive, Math.round(camera.scale), store.network.neurons.length, hint].join('|');
    if (key === this.last) return;
    this.last = key;

    this.play.innerHTML = runner.playing ? icons.pause : icons.play;
    this.play.dataset.tip = runner.playing ? 'Pause' : 'Play';
    this.play.setAttribute('aria-label', runner.playing ? 'Pause' : 'Play');
    // An example may suggest a speed that is not in the list: show it anyway.
    this.speed.querySelector('[data-custom]')?.remove();
    if (!(SPEEDS as readonly number[]).includes(runner.speed)) {
      const custom = h('option', { value: runner.speed, text: formatSpeed(runner.speed), 'data-custom': true });
      const after = [...this.speed.options].find((o) => Number(o.value) > runner.speed);
      this.speed.insertBefore(custom, after ?? null);
    }
    this.speed.value = String(runner.speed);
    this.time.textContent = formatSimTime(sim.seconds);
    this.ticks.textContent = `tick ${sim.tick.toLocaleString('en-US')}`;
    this.dot.classList.toggle('on', runner.playing);

    const hasDemo = !!this.app.currentExample?.demo?.length;
    this.demoChip.hidden = !demoLive;
    if (demo) this.demoChip.textContent = `Demo ${demo.done}/${demo.total}`;
    this.replay.hidden = !hasDemo;

    const pulseText = `${pulses} pulse${pulses === 1 ? '' : 's'} in flight`;
    let state: string;
    if (!store.network.neurons.length) state = 'Empty board';
    else if (runner.overloaded) state = `Paused · runaway network (${pulseText})`;
    else if (runner.playing) state = `Running · ${pulseText}`;
    else state = sim.tick ? `Paused · ${pulseText}` : 'Ready · Space to run';
    this.status.textContent = `${state} · ${hint}`;
    this.zoomVal.textContent = `${Math.round((camera.scale / DEFAULT_SCALE) * 100)}%`;
  }

  /** What a click does right now, for the status line. */
  private toolHint(): string {
    const { store, runner, input } = this.app;
    switch (store.tool) {
      case 'place':
        return `click an empty cell to place a ${KIND_INFO[store.kind].name}, drag from a neuron to wire up a new one`;
      case 'connect':
        return input.pendingSource ? 'now click the target neuron (Shift: both ways)' : 'click a source neuron, then its target';
      case 'text':
        return 'click to add a note';
      case 'hand':
        return 'drag to pan, click neurons to poke them';
      default:
        return runner.playing ? 'click a neuron to poke it' : 'click to select, drag to move';
    }
  }

  private updateCursor(): void {
    const p = this.app.input.pointer;
    this.cursor.textContent = p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : '';
  }
}

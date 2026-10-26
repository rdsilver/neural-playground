// The floating transport pill at the bottom centre: reset, a big play /
// pause, single steps, speed, the simulated clock and the demo's progress
// (or a replay button once it is over). On phones it is the dock's lower
// row and also carries zoom-to-fit.

import type { App } from '../app';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { formatSimTime, formatSpeed, SPEEDS } from '../runner';
import { tipped } from './tooltip';

export class Transport {
  readonly el: HTMLElement;
  private play: HTMLButtonElement;
  private speed = h('select', { class: 'speed-select', 'aria-label': 'Simulation speed' });
  private time = h('span', { class: 'clock' });
  private demoChip = h('span', { class: 'demo-chip', hidden: true });
  private replay: HTMLButtonElement;
  private last = '';

  constructor(private readonly app: App) {
    const btn = (icon: IconName, title: string, command: string, run: () => void, cls = '') =>
      tipped(h('button', { class: `btn icon-btn ${cls}`, type: 'button', html: icons[icon], onclick: run }), title, app.keysFor(command));

    this.play = btn('play', 'Play', 'play', () => app.togglePlay(), 'play-btn');
    for (const s of SPEEDS) this.speed.append(h('option', { value: s, text: formatSpeed(s) }));
    this.speed.addEventListener('change', () => {
      app.setSpeed(Number(this.speed.value));
      // Hand focus back so Space means play/pause again.
      this.speed.blur();
    });
    tipped(this.speed, 'Speed', '[ ]');
    this.replay = btn('replay', 'Replay demo', 'replay', () => app.replayDemo(), 'replay-btn');
    this.replay.dataset.tipDesc = 'Reset and play the scripted demo again';
    this.replay.hidden = true;
    tipped(this.time, 'Simulated time');

    this.el = h(
      'footer',
      { class: 'transport island', role: 'toolbar', 'aria-label': 'Simulation controls', 'data-tip-side': 'top' },
      btn('reset', 'Reset', 'reset', () => app.reset()),
      this.play,
      btn('step', 'Step one tick', 'step', () => app.step()),
      btn('fire', 'Step to next fire', 'step-fire', () => app.step(true), 'wide-only'),
      h('span', { class: 'island-sep', 'aria-hidden': 'true' }),
      this.speed,
      this.time,
      this.demoChip,
      this.replay,
      btn('fit', 'Zoom to fit', 'fit', () => app.zoomToFit(), 'phone-only'),
    );
  }

  /** Refresh readouts (called a few times a second and after actions). */
  update(): void {
    const { runner } = this.app;
    const sim = runner.sim;
    const demo = runner.demoProgress;
    const live = runner.demoLive;
    const hasDemo = !!this.app.currentExample?.demo?.length;
    const key = [runner.playing, runner.speed, sim.tick, demo?.done, live, hasDemo].join('|');
    if (key === this.last) return;
    this.last = key;

    this.play.innerHTML = runner.playing ? icons.pause : icons.play;
    this.play.classList.toggle('running', runner.playing);
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
    this.time.dataset.tipDesc = `Tick ${sim.tick.toLocaleString('en-US')} · 60 ticks per simulated second`;

    this.demoChip.hidden = !live;
    if (demo) this.demoChip.textContent = `Demo ${demo.done}/${demo.total}`;
    this.replay.hidden = !hasDemo || live;
  }
}

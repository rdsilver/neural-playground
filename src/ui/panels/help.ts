// Help overlay: the model in three steps (collect, fire, travel), a legend
// of neuron kinds, and every mouse, touch and keyboard control.

import { KIND_INFO, NEURON_KINDS } from '../../engine';
import type { App } from '../app';
import { h, isMac } from '../dom';
import { icons } from '../icons';
import { drawKindIcon } from '../renderer';
import { formatKeys } from '../shortcuts';

const SHORTCUTS = [
  'play',
  'step',
  'step-tick',
  'step-fire',
  'reset',
  'faster',
  'slower',
  'next-neuron',
  'prev-neuron',
  'poke',
  'fire',
  'select',
  'connect',
  'text',
  'hand',
  'undo',
  'redo',
  'delete',
  'duplicate',
  'fit',
  'zoom-in',
  'zoom-out',
  'mute',
  'examples',
  'export',
  'import',
  'palette',
];

/** The whole model, in three steps. */
const MODEL: [string, string][] = [
  ['Collect', 'Every pulse that arrives adds 1 charge to a neuron. A pulse from an Inhibitor takes 1 away.'],
  ['Fire', 'When its charge reaches its threshold, the neuron fires: the charge resets to zero and a pulse leaves along every outgoing arrow.'],
  ['Travel', 'Pulses travel four cells per second, so the distance between two neurons is a delay: the layout of a circuit is its timing.'],
];

export class HelpDialog {
  readonly el: HTMLDialogElement;
  private legend = h('div', { class: 'legend' });

  constructor(private readonly app: App) {
    const close = h('button', { class: 'btn', type: 'button', html: icons.close, 'aria-label': 'Close help', onclick: () => this.el.close() });
    const keys = h('dl', { class: 'keys' });
    /** One row: alternative shortcuts joined by "/", or a key range like 1–7 joined by "–". */
    const row = (label: string, specs: string[], joiner = ' / ') => {
      const dd = h('dd');
      specs.forEach((spec, i) => {
        if (i) dd.append(h('span', { class: 'muted', text: joiner }));
        for (const k of formatKeys(spec, isMac)) dd.append(h('kbd', { text: k }));
      });
      keys.append(h('dt', { text: label }), dd);
    };
    const lastKind = String(NEURON_KINDS.length);
    row('Place a neuron kind', ['1', lastKind], ' – ');
    for (const id of SHORTCUTS) {
      const c = app.commands.find((x) => x.id === id);
      if (c?.keys) row(c.title, c.keys.split(' ').slice(0, 2));
    }
    row('Move selection, or the cell cursor', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], ' ');
    row('At the cell cursor: place a kind', ['1', lastKind], ' – ');
    row('At the cell cursor: select or place', ['enter']);
    row('Context menu', ['shift+f10']);
    row('Cancel / deselect', ['escape']);

    const mouse = h('dl', { class: 'keys gestures' });
    const pair = (a: string, b: string) => mouse.append(h('dt', { text: a }), h('dd', { class: 'muted', text: b }));
    pair('Poke', 'click (tap) a neuron while it runs: +1 charge, like pressing a key');
    pair('Inspect', 'click it while paused, or Shift-click, right-click or long-press it any time');
    pair('Place', 'pick a kind, click an empty cell');
    pair('Connect', 'drag from a neuron’s handle (or with the Connect tool)');
    pair('Two-way', 'hold Shift while connecting');
    pair('Move', 'drag a neuron; Shift-drag empty space to box-select');
    pair('Pan', 'drag empty space, right or middle mouse, or Space + drag');
    pair('Zoom', 'scroll, pinch, or the buttons bottom left');
    pair('Menu', 'right-click a neuron, wire or empty cell (long-press empty board on touch)');
    pair('Step', 'Step runs to the next pulse or fire; Shift-click it for one tick');

    this.el = h(
      'dialog',
      { class: 'modal help', 'aria-labelledby': 'help-title' },
      h('div', { class: 'modal-head' }, h('h2', { id: 'help-title', class: 'grow', text: 'How Neural Playground works' }), close),
      h(
        'div',
        // Focus lands on the (scrollable) body, not the close button.
        { class: 'modal-body', tabindex: -1, autofocus: true },
        h(
          'div',
          { class: 'help-grid' },
          h(
            'div',
            {},
            h('h3', { text: 'The model' }),
            h(
              'ol',
              { class: 'model-steps' },
              ...MODEL.map(([title, text], i) => h('li', { class: 'model-step' }, h('span', { class: 'model-num', text: String(i + 1), 'aria-hidden': 'true' }), h('b', { text: title }), h('span', { text }))),
            ),
            h('p', { class: 'muted', text: 'Timers fire on their own, and you can poke any neuron yourself by clicking it while the simulation runs. From these few rules come counters, clocks, melodies and calculators.' }),
            h('h3', { text: 'Neuron kinds' }),
            this.legend,
          ),
          h('div', {}, h('h3', { text: 'Mouse & touch' }), mouse, h('h3', { text: 'Keyboard' }), keys),
        ),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(): void {
    this.legend.replaceChildren(
      ...NEURON_KINDS.map((kind, i) => {
        const icon = h('canvas', { 'aria-hidden': 'true' });
        drawKindIcon(icon, kind, this.app.palette, 32);
        return h('div', { class: 'legend-item' }, icon, h('div', {}, h('b', {}, `${KIND_INFO[kind].name} `, h('kbd', { text: String(i + 1) })), h('span', { text: KIND_INFO[kind].description })));
      }),
    );
    this.el.showModal();
  }
}

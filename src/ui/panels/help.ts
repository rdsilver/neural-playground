// Help overlay: how the model works, a legend of neuron kinds, and every
// mouse, touch and keyboard control.

import { KIND_INFO, NEURON_KINDS } from '../../engine';
import type { App } from '../app';
import { h, isMac } from '../dom';
import { icons } from '../icons';
import { drawKindIcon } from '../renderer';
import { formatKeys } from '../shortcuts';

const SHORTCUTS = ['play', 'step', 'step-fire', 'reset', 'faster', 'slower', 'select', 'connect', 'text', 'hand', 'poke', 'fire', 'undo', 'redo', 'delete', 'duplicate', 'fit', 'zoom-in', 'zoom-out', 'mute', 'examples', 'export', 'import', 'palette'];

export class HelpDialog {
  readonly el: HTMLDialogElement;
  private legend = h('div', { class: 'legend' });

  constructor(private readonly app: App) {
    const close = h('button', { class: 'btn', type: 'button', html: icons.close, 'aria-label': 'Close help', onclick: () => this.el.close() });
    const keys = h('dl', { class: 'keys' });
    /** One row: alternative shortcuts joined by "/", or a key range like 1–6 joined by "–". */
    const row = (label: string, specs: string[], joiner = ' / ') => {
      const dd = h('dd');
      specs.forEach((spec, i) => {
        if (i) dd.append(h('span', { class: 'muted', text: joiner }));
        for (const k of formatKeys(spec, isMac)) dd.append(h('kbd', { text: k }));
      });
      keys.append(h('dt', { text: label }), dd);
    };
    row('Place a neuron kind', ['1', '6'], ' – ');
    for (const id of SHORTCUTS) {
      const c = app.commands.find((x) => x.id === id);
      if (c?.keys) row(c.title, c.keys.split(' ').slice(0, 2));
    }
    row('Move selection / pan', ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], ' ');
    row('Context menu', ['shift+f10']);
    row('Cancel / deselect', ['escape']);

    const mouse = h('dl', { class: 'keys' });
    const pair = (a: string, b: string) => mouse.append(h('dt', { text: a }), h('dd', { class: 'muted', text: b }));
    pair('Place', 'pick a kind, click an empty cell');
    pair('Poke', 'click a neuron while running');
    pair('Connect', 'drag from a neuron’s handle (or with the Connect tool)');
    pair('Two-way', 'hold Shift while connecting');
    pair('Move', 'drag a neuron; Shift-drag empty space to box-select');
    pair('Pan', 'drag empty space, right or middle mouse, or Space + drag');
    pair('Zoom', 'scroll, pinch, or the buttons bottom right');
    pair('Menu', 'right-click (or long-press) a neuron, wire or empty cell');
    pair('Touch', 'tap to place or poke, drag to pan, pinch to zoom');

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
            h('p', { text: 'Each neuron collects charge. When its charge reaches its threshold it fires: its charge resets to zero and it sends a pulse down every outgoing connection (the arrows).' }),
            h('p', { text: 'Pulses are not instant. They travel at four cells per second, so the distance between two neurons is a delay: layout is timing. When a pulse arrives it adds +1 charge to its target, or −1 if it came from an Inhibitor.' }),
            h('p', { text: 'Timers fire on their own, and you can poke any neuron yourself by clicking it while the simulation runs. From these few rules you can build counters, clocks, melodies and calculators.' }),
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

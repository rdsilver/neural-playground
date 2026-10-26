// Left tool rail: editing tools on top, the six neuron kinds as a palette
// below (picking a kind switches to placing it). Becomes a horizontal strip
// on phones.

import { KIND_INFO, NEURON_KINDS, type NeuronKind } from '../../engine';
import type { App } from '../app';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { drawKindIcon } from '../renderer';
import type { Tool } from '../store';
import { tipped } from './tooltip';

const TOOLS: { tool: Tool; icon: IconName; title: string; desc: string }[] = [
  { tool: 'select', icon: 'select', title: 'Select & move', desc: 'Click to select (and poke while running). Drag to move; drag the handle to connect; Shift-drag to box-select.' },
  { tool: 'connect', icon: 'connect', title: 'Connect', desc: 'Drag from one neuron to another, or click both. Connecting an existing pair removes it; hold Shift for two-way.' },
  { tool: 'text', icon: 'text', title: 'Text', desc: 'Click anywhere to add a note. Double-click a note to edit it.' },
  { tool: 'hand', icon: 'hand', title: 'Hand', desc: 'Drag to pan. Click neurons to poke them, without selecting.' },
];

export class ToolRail {
  readonly el: HTMLElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private kindButtons = new Map<NeuronKind, { button: HTMLButtonElement; icon: HTMLCanvasElement }>();

  constructor(private readonly app: App) {
    this.el = h('nav', { class: 'rail', 'aria-label': 'Tools', 'data-tip-side': 'right' });
    const tools = h('div', { class: 'rail-group', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    for (const t of TOOLS) {
      const button = tipped(
        h('button', { class: 'btn tool-btn', type: 'button', html: icons[t.icon], 'aria-label': t.title, onclick: () => app.setTool(t.tool) }),
        t.title,
        app.keysFor(t.tool),
        t.desc,
      );
      this.toolButtons.set(t.tool, button);
      tools.append(button);
    }

    const kinds = h('div', { class: 'rail-group', role: 'toolbar', 'aria-label': 'Neuron kinds', 'aria-orientation': 'vertical' });
    NEURON_KINDS.forEach((kind, i) => {
      const info = KIND_INFO[kind];
      const icon = h('canvas', { class: 'kind-icon', 'aria-hidden': 'true' });
      const button = tipped(
        h(
          'button',
          { class: 'kind-btn', type: 'button', 'aria-label': `Place ${info.name}`, onclick: () => app.store.setKind(kind) },
          icon,
          h('span', { class: 'kind-name', text: info.name }),
          h('span', { class: 'kind-key', text: String(i + 1) }),
        ),
        info.name,
        String(i + 1),
        info.description,
      );
      this.kindButtons.set(kind, { button, icon });
      kinds.append(button);
    });

    const clear = tipped(
      h('button', { class: 'btn tool-btn danger', type: 'button', html: icons.trash, onclick: () => app.clearCanvas() }),
      'Clear canvas',
      undefined,
      'Removes everything. You can undo it.',
    );

    this.el.append(
      h('div', { class: 'rail-label', text: 'Tools' }),
      tools,
      h('div', { class: 'rail-sep' }),
      h('div', { class: 'rail-label', text: 'Neurons' }),
      kinds,
      h('div', { class: 'rail-foot' }, clear),
    );
    for (const group of [tools, kinds]) group.style.display = 'contents';

    app.store.on('tool', () => this.sync());
    this.refresh();
  }

  /** Redraw kind icons (theme change) and sync pressed states. */
  refresh(): void {
    for (const [kind, { icon }] of this.kindButtons) drawKindIcon(icon, kind, this.app.palette, 26);
    this.sync();
  }

  private sync(): void {
    const { tool, kind } = this.app.store;
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(t === tool));
    for (const [k, { button }] of this.kindButtons) {
      button.setAttribute('aria-pressed', String(tool === 'place' && k === kind));
      button.classList.toggle('current', k === kind);
    }
  }
}

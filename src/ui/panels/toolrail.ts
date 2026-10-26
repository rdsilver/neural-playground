// The tool panel. On wide screens a floating vertical island on the left:
// labelled editing tools on top, the six labelled neuron kinds below
// (picking a kind switches to placing it). On phones it becomes the top row
// of the bottom dock: icon tools, one button that opens a sheet of the six
// labelled kinds, and undo / redo.

import { KIND_INFO, NEURON_KINDS, type NeuronKind } from '../../engine';
import type { App } from '../app';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { drawKindIcon } from '../renderer';
import type { Tool } from '../store';
import { attachPopover, closePopover } from './popover';
import { tipped } from './tooltip';
import { historyButtons } from './viewcontrols';

const TOOLS: { tool: Tool; icon: IconName; label: string; title: string; desc: string }[] = [
  { tool: 'select', icon: 'select', label: 'Select', title: 'Select & move', desc: 'Click a neuron to poke it while running, or to inspect it while paused (Shift-click inspects any time). Drag to move; drag the handle to connect; Shift-drag to box-select.' },
  { tool: 'connect', icon: 'connect', label: 'Connect', title: 'Connect', desc: 'Drag from one neuron to another, or click both. Connecting an existing pair removes it; hold Shift for two-way.' },
  { tool: 'text', icon: 'text', label: 'Text', title: 'Text', desc: 'Click anywhere to add a note. Double-click a note to edit it.' },
  { tool: 'hand', icon: 'hand', label: 'Hand', title: 'Hand', desc: 'Drag to pan. Click neurons to poke them, without selecting.' },
];

interface KindButton {
  button: HTMLButtonElement;
  icon: HTMLCanvasElement;
}

export class ToolRail {
  readonly el: HTMLElement;
  /** The phone's kind sheet (mounted at the root, see App.build). */
  readonly sheet: HTMLElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private kindButtons = new Map<NeuronKind, KindButton>();
  private sheetButtons = new Map<NeuronKind, KindButton>();
  private trigger: HTMLButtonElement;
  private triggerIcon = h('canvas', { class: 'kind-icon', 'aria-hidden': 'true' });

  constructor(private readonly app: App) {
    const tools = h('div', { class: 'rail-group rail-tools', role: 'group', 'aria-label': 'Tools' });
    for (const t of TOOLS) {
      const button = tipped(
        h(
          'button',
          { class: 'rail-btn tool-btn', type: 'button', 'aria-label': t.title, onclick: () => app.setTool(t.tool) },
          h('span', { class: 'rail-icon', html: icons[t.icon] }),
          h('span', { class: 'rail-label', text: t.label }),
        ),
        t.title,
        app.keysFor(t.tool),
        t.desc,
      );
      this.toolButtons.set(t.tool, button);
      tools.append(button);
    }

    const kinds = h('div', { class: 'rail-group rail-kinds', role: 'group', 'aria-label': 'Neuron kinds' });
    const sheetList = h('div', { class: 'kind-sheet-list' });
    NEURON_KINDS.forEach((kind, i) => {
      const info = KIND_INFO[kind];
      const icon = h('canvas', { class: 'kind-icon', 'aria-hidden': 'true' });
      const button = tipped(
        h('button', { class: 'rail-btn kind-btn', type: 'button', 'aria-label': `Place ${info.name}`, onclick: () => app.store.setKind(kind) }, icon, h('span', { class: 'rail-label', text: info.name })),
        info.name,
        String(i + 1),
        info.description,
      );
      this.kindButtons.set(kind, { button, icon });
      kinds.append(button);

      const rowIcon = h('canvas', { class: 'kind-icon', 'aria-hidden': 'true' });
      const row = h(
        'button',
        {
          class: 'kind-row',
          type: 'button',
          onclick: () => {
            closePopover(this.sheet);
            app.store.setKind(kind);
          },
        },
        rowIcon,
        h('span', { class: 'kind-row-text' }, h('b', { text: info.name }), h('span', { text: info.description })),
        h('kbd', { text: String(i + 1) }),
      );
      this.sheetButtons.set(kind, { button: row, icon: rowIcon });
      sheetList.append(row);
    });

    // Phone only: one button for the current kind, opening the sheet.
    this.trigger = h('button', { class: 'rail-btn kind-trigger phone-only', type: 'button' }, this.triggerIcon, h('span', { class: 'trigger-chevron', html: icons.chevronUp }));
    this.sheet = h('div', { class: 'popover kind-sheet', role: 'dialog', 'aria-label': 'Place a neuron' }, h('div', { class: 'popover-title', text: 'Place a neuron' }), sheetList);
    attachPopover(this.trigger, this.sheet, 'above');

    this.el = h(
      'nav',
      { class: 'rail island', 'aria-label': 'Tools', 'data-tip-side': 'right' },
      tools,
      h('span', { class: 'rail-sep', 'aria-hidden': 'true' }),
      kinds,
      this.trigger,
      h('span', { class: 'rail-sep phone-only', 'aria-hidden': 'true' }),
      h('div', { class: 'rail-group rail-history phone-only', role: 'group', 'aria-label': 'History' }, ...historyButtons(app)),
    );

    app.store.on('tool', () => this.sync());
    this.refresh();
  }

  /** Redraw kind icons (theme change) and sync pressed states. */
  refresh(): void {
    const palette = this.app.palette;
    for (const [kind, { icon }] of this.kindButtons) drawKindIcon(icon, kind, palette, 24);
    for (const [kind, { icon }] of this.sheetButtons) drawKindIcon(icon, kind, palette, 30);
    this.sync();
  }

  private sync(): void {
    const { tool, kind } = this.app.store;
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(t === tool));
    for (const [k, { button }] of this.kindButtons) {
      button.setAttribute('aria-pressed', String(tool === 'place' && k === kind));
      button.classList.toggle('current', k === kind);
    }
    for (const [k, { button }] of this.sheetButtons) button.setAttribute('aria-pressed', String(tool === 'place' && k === kind));
    drawKindIcon(this.triggerIcon, kind, this.app.palette, 26);
    this.trigger.setAttribute('aria-pressed', String(tool === 'place'));
    this.trigger.setAttribute('aria-label', `Neuron kind: ${KIND_INFO[kind].name}. Choose a kind to place`);
  }
}

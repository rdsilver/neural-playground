// Command palette (Ctrl/⌘+K): fuzzy-search every command and example.

import type { App } from '../app';
import { filterCommands, type Command } from '../commands';
import { h, isMac } from '../dom';
import { icons } from '../icons';
import { formatKeys } from '../shortcuts';

export class CommandPalette {
  readonly el: HTMLDialogElement;
  private input = h('input', {
    type: 'text',
    placeholder: 'Type a command or an example…',
    'aria-label': 'Command',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  private list = h('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Commands' });
  private results: Command[] = [];
  private active = 0;

  constructor(private readonly app: App) {
    const hint = (keys: string[], text: string) => h('span', {}, ...keys.map((k) => h('kbd', { text: k })), text);
    this.el = h(
      'dialog',
      { class: 'palette', 'aria-label': 'Command palette' },
      h('div', { class: 'palette-input' }, h('span', { html: icons.search }), this.input),
      this.list,
      h('div', { class: 'palette-foot' }, hint(['↑', '↓'], 'move'), hint(['Enter'], 'run'), hint(['Esc'], 'close')),
    );
    this.input.addEventListener('input', () => {
      this.active = 0;
      this.update();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.results.length;
        if (n) this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = this.results[this.active];
        if (c) this.run(c);
      }
    });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(): void {
    if (this.el.open) return;
    this.input.value = '';
    this.active = 0;
    this.update();
    this.el.showModal();
    this.input.focus();
  }

  private run(c: Command): void {
    if (c.enabled && !c.enabled()) return;
    this.el.close();
    c.run();
  }

  private update(): void {
    this.results = filterCommands(this.app.commands, this.input.value).slice(0, 60);
    this.list.replaceChildren(
      ...this.results.map((c, i) => {
        const disabled = !!c.enabled && !c.enabled();
        const keys = h('span', { class: 'row' });
        if (c.keys) for (const k of formatKeys(c.keys.split(' ')[0]!, isMac)) keys.append(h('kbd', { text: k }));
        const li = h(
          'li',
          { class: `palette-item${disabled ? ' disabled' : ''}`, id: `cmd-${i}`, role: 'option', 'aria-disabled': String(disabled) },
          h('span', { class: 'grow', text: c.title }),
          h('span', { class: 'group', text: c.group }),
          keys,
        );
        li.addEventListener('pointermove', () => {
          if (this.active !== i) {
            this.active = i;
            this.highlight();
          }
        });
        li.addEventListener('click', () => this.run(c));
        return li;
      }),
    );
    if (!this.results.length) this.list.append(h('li', { class: 'palette-item disabled', text: 'No matching commands' }));
    this.highlight();
  }

  private highlight(): void {
    [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active)));
    const current = this.list.children[this.active];
    if (current) {
      this.input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    }
  }
}

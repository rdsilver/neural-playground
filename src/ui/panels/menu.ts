// Popup menu used for the board's right-click menu and the phone overflow
// menu: keyboard navigable (arrows, Home/End, Enter, Escape), closes on an
// outside press, shows each item's shortcut.

import { h, isMac } from '../dom';
import { icons, type IconName } from '../icons';
import { formatKeys } from '../shortcuts';

export type MenuEntry =
  | { label: string; icon?: IconName; keys?: string; danger?: boolean; disabled?: boolean; run: () => void }
  | 'separator';

export class Menu {
  readonly el = h('div', { class: 'menu', role: 'menu', tabindex: -1, hidden: true });
  private opener: HTMLElement | null = null;

  constructor(label: string) {
    this.el.setAttribute('aria-label', label);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && e.target instanceof Node && !this.el.contains(e.target) && !this.opener?.contains(e.target)) this.close(false);
    });
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /**
   * Show the menu with its top-left (or, with alignRight, top-right) corner
   * at a viewport point, nudged to stay on screen. Opened from the keyboard,
   * focus goes to the first item; opened with a pointer, to the menu itself
   * (arrow keys still work). `opener` gets focus back when it closes.
   */
  show(x: number, y: number, entries: MenuEntry[], opts: { opener?: HTMLElement; alignRight?: boolean; keyboard?: boolean } = {}): void {
    const { opener = null, alignRight = false, keyboard = false } = opts;
    this.opener = opener;
    this.el.replaceChildren(
      ...entries.map((entry) => {
        if (entry === 'separator') return h('hr', { role: 'separator' });
        const keys = h('span', { class: 'menu-keys' });
        if (entry.keys) for (const k of formatKeys(entry.keys.split(' ')[0]!, isMac)) keys.append(h('kbd', { text: k }));
        return h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: entry.danger ? 'danger' : undefined,
            disabled: entry.disabled,
            onclick: () => {
              this.close(true);
              entry.run();
            },
          },
          h('span', { class: 'menu-icon', html: entry.icon ? icons[entry.icon] : '' }),
          h('span', { class: 'menu-label', text: entry.label }),
          keys,
        );
      }),
    );
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    const left = alignRight ? x - r.width : x;
    this.el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, left))}px`;
    this.el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y))}px`;
    if (keyboard) this.items()[0]?.focus();
    else this.el.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    if (restoreFocus) this.opener?.focus({ preventScroll: true });
  }

  private items(): HTMLButtonElement[] {
    return [...this.el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  }

  private onKey(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') this.close(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}

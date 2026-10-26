// Transient notifications ("Link copied", "Canvas cleared · Undo").

import { h } from '../dom';

export interface ToastOptions {
  error?: boolean;
  action?: { label: string; run: () => void };
  /** Milliseconds before it fades (default 3200, errors 5000). */
  duration?: number;
  /** A new toast with the same key replaces the old one (e.g. repeated undo). */
  key?: string;
}

export class Toasts {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(message: string, options: ToastOptions = {}): void {
    const toast = h('div', { class: `toast${options.error ? ' error' : ''}` }, h('span', { text: message }));
    if (options.action) {
      const { label, run } = options.action;
      toast.append(
        h('button', {
          class: 'btn small',
          text: label,
          onclick: () => {
            run();
            toast.remove();
          },
        }),
      );
    }
    if (options.key) {
      toast.dataset.key = options.key;
      this.el.querySelector(`[data-key="${options.key}"]`)?.remove();
    }
    // Keep at most three on screen.
    while (this.el.children.length >= 3) this.el.firstElementChild!.remove();
    this.el.append(toast);
    window.setTimeout(() => toast.remove(), options.duration ?? (options.error ? 5000 : 3200));
  }

  /** Remove the toast shown with this key, if it is still up. */
  dismiss(key: string): void {
    this.el.querySelector(`[data-key="${key}"]`)?.remove();
  }
}

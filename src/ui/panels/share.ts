// Fallback when the clipboard is unavailable: show the share link in a
// dialog, pre-selected, with a copy button.

import { h } from '../dom';
import { icons } from '../icons';

export class ShareDialog {
  readonly el: HTMLDialogElement;
  private input = h('input', { class: 'input mono', readonly: true, 'aria-label': 'Share link' });
  private status = h('span', { class: 'muted', 'aria-live': 'polite' });

  constructor() {
    const copy = h('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Copy',
      onclick: () => {
        this.input.select();
        const ok = document.execCommand?.('copy');
        this.status.textContent = ok ? 'Copied.' : 'Press Ctrl+C (⌘C) to copy.';
      },
    });
    this.el = h(
      'dialog',
      { class: 'modal', style: 'width:min(560px, calc(100vw - 32px))', 'aria-labelledby': 'share-title' },
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { id: 'share-title', class: 'grow', text: 'Share link' }),
        h('button', { class: 'btn', type: 'button', html: icons.close, 'aria-label': 'Close', onclick: () => this.el.close() }),
      ),
      h('div', { class: 'modal-body' }, h('p', { class: 'muted', style: 'margin-top:0', text: 'Anyone with this link opens exactly this network.' }), h('div', { class: 'row' }, this.input, copy), this.status),
    );
  }

  open(url: string): void {
    this.input.value = url;
    this.status.textContent = '';
    this.el.showModal();
    this.input.select();
  }
}

// Rich tooltips: any element with data-tip="Title" (plus optional
// data-keys="mod+z" and data-tip-desc="…") gets a styled tooltip with its
// shortcut. One shared element, positioned next to the target; shown on
// mouse hover (after a delay) and on keyboard focus, never on touch.

import { h, isMac } from '../dom';
import { formatKeys } from '../shortcuts';

const DELAY = 450;
const WARM_MS = 400;

export function installTooltips(root: HTMLElement): void {
  const tip = h('div', { class: 'tip', role: 'tooltip', 'aria-hidden': 'true' });
  root.append(tip);
  let target: HTMLElement | null = null;
  let timer = 0;
  let lastHidden = 0;

  const show = (el: HTMLElement) => {
    const title = el.dataset.tip;
    if (!title) return;
    const head = h('div', { class: 'tip-head' }, h('span', { text: title }));
    if (el.dataset.keys) {
      const keys = h('span', { class: 'keys-inline' });
      for (const spec of el.dataset.keys.split(' ')) for (const k of formatKeys(spec, isMac)) keys.append(h('kbd', { text: k }));
      head.append(keys);
    }
    tip.replaceChildren(head);
    if (el.dataset.tipDesc) tip.append(h('div', { class: 'tip-desc', text: el.dataset.tipDesc }));
    tip.classList.add('show');
    place(el);
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const side = el.closest<HTMLElement>('[data-tip-side]')?.dataset.tipSide ?? 'bottom';
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.bottom + 8;
    if (side === 'right') {
      x = r.right + 10;
      y = r.top + r.height / 2 - t.height / 2;
    } else if (side === 'top' || y + t.height > innerHeight - 4) {
      y = r.top - t.height - 8;
    }
    x = Math.max(6, Math.min(innerWidth - t.width - 6, x));
    y = Math.max(6, Math.min(innerHeight - t.height - 6, y));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const hide = () => {
    clearTimeout(timer);
    if (tip.classList.contains('show')) lastHidden = performance.now();
    tip.classList.remove('show');
    target = null;
  };

  const tipTarget = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null);

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = tipTarget(e);
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    const warm = performance.now() - lastHidden < WARM_MS;
    timer = window.setTimeout(() => target === el && el.isConnected && show(el), warm ? 0 : DELAY);
  });
  document.addEventListener('focusin', (e) => {
    const el = tipTarget(e);
    if (el && el.matches(':focus-visible')) {
      hide();
      target = el;
      show(el);
    }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') hide();
  });
  window.addEventListener('blur', hide);
}

/** Attach tooltip data to an element. */
export function tipped<T extends HTMLElement>(el: T, title: string, keys?: string, desc?: string): T {
  el.dataset.tip = title;
  if (keys) el.dataset.keys = keys;
  if (desc) el.dataset.tipDesc = desc;
  if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
  return el;
}

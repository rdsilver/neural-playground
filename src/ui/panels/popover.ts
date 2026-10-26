// Small anchored popovers (volume, the phone's neuron-kind sheet) built on
// the native popover API: the browser handles light dismiss, Escape and
// stacking. The anchor button toggles it through `popoverTargetElement`, so
// a click on the anchor while open closes it instead of reopening it.

export type Placement = 'below-end' | 'above';

export function attachPopover(anchor: HTMLButtonElement, pop: HTMLElement, placement: Placement): void {
  pop.setAttribute('popover', 'auto');
  anchor.popoverTargetElement = pop;
  anchor.setAttribute('aria-expanded', 'false');
  pop.addEventListener('beforetoggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    anchor.setAttribute('aria-expanded', String(open));
    if (open) place(anchor, pop, placement);
  });
  pop.addEventListener('toggle', (e) => {
    // Opened from the keyboard: move focus in, so its controls are next.
    if ((e as ToggleEvent).newState === 'open' && anchor.matches(':focus-visible')) {
      pop.querySelector<HTMLElement>('[aria-pressed="true"], input, button')?.focus({ preventScroll: true });
    }
  });
}

/**
 * Position without measuring the popover (it is not laid out yet before it
 * opens): pin the edge nearest the anchor and let CSS size the rest.
 */
function place(anchor: HTMLElement, pop: HTMLElement, placement: Placement): void {
  const a = anchor.getBoundingClientRect();
  const s = pop.style;
  if (placement === 'below-end') {
    s.top = `${Math.round(a.bottom + 8)}px`;
    s.right = `${Math.max(8, Math.round(innerWidth - a.right))}px`;
    s.left = s.bottom = 'auto';
  } else {
    s.bottom = `${Math.round(innerHeight - a.top + 8)}px`;
    s.top = 'auto';
  }
}

export function closePopover(pop: HTMLElement): void {
  if (pop.matches(':popover-open')) pop.hidePopover();
}

// Where the board is actually free: the floating islands cover parts of it,
// so zoom-to-fit measures them from the DOM and frames the network in what
// is left (beside or below the example card, above the captions and dock).

import type { Insets } from './camera';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Edges of the floating chrome, in board (stage) pixels. */
export interface Chrome {
  width: number;
  height: number;
  /** Lowest bottom edge of the chrome along the top (title and action islands). */
  top: number;
  /** Right edge of chrome along the left side (the tool rail), or 0. */
  left: number;
  /** Left edge of chrome along the right side (an open inspector), or `width`. */
  right: number;
  /** Highest top edge of the chrome along the bottom (dock, captions, hint). */
  bottom: number;
  /** A floating panel near the top-left corner (the example card), if shown. */
  card?: Rect;
}

/** Breathing room between the network and the chrome around it. */
export const FIT_GAP = 20;

/**
 * Ways to frame the free part of the board. With a card showing there are
 * two: beside it (full height) and below it (full width); the caller keeps
 * whichever shows the network biggest.
 */
export function insetOptions(c: Chrome, gap = FIT_GAP): Insets[] {
  const base: Insets = {
    top: c.top + gap,
    left: c.left + gap,
    bottom: Math.max(0, c.height - c.bottom) + gap,
    right: Math.max(0, c.width - c.right) + gap,
  };
  if (!c.card) return [base];
  return [
    { ...base, left: Math.max(base.left, c.card.right + gap) },
    { ...base, top: Math.max(base.top, c.card.bottom + gap) },
  ];
}

// How each wire is drawn, decided without touching the canvas (so it is
// tested): wires into Lamps stay faint, so a display fed by hundreds of
// wires still reads as a clean screen, until you point at the lamp or at
// the wire's source; and the screen of lamp tiles itself, with rounded
// corners only where a tile has no neighbouring lamp.

/**
 * - out:    leaves a focused (hovered or selected) neuron
 * - in:     arrives at a focused neuron
 * - faint:  ends at a Lamp (pulses on it are still drawn, like a beam)
 * - active: carries a pulse right now
 * - base:   everything else
 */
export type WireStyle = 'out' | 'in' | 'faint' | 'active' | 'base';

export function wireStyle(from: string, to: string, toLamp: boolean, focus: ReadonlySet<string>, active: boolean): WireStyle {
  if (focus.has(from)) return 'out';
  if (focus.has(to)) return 'in';
  if (toLamp) return 'faint';
  return active ? 'active' : 'base';
}

/** How a wire looks when nothing is focused and no pulse is on it. */
export const restingStyle = (toLamp: boolean): WireStyle => (toLamp ? 'faint' : 'base');

/** Corner bits for a lamp tile: which corners are rounded (no lamp on either side of them). */
export const CORNER_TL = 1;
export const CORNER_TR = 2;
export const CORNER_BR = 4;
export const CORNER_BL = 8;

/**
 * Rounded corners for each lamp tile in a set of lamp cells. Lamps on
 * neighbouring cells merge into one continuous screen: a corner is rounded
 * only when neither of the two cells beside it (orthogonally) holds a lamp.
 * Returns a bit mask per input cell (CORNER_*).
 */
export function lampCorners(cells: readonly { x: number; y: number }[]): number[] {
  const taken = new Set(cells.map((c) => `${c.x},${c.y}`));
  const has = (x: number, y: number) => taken.has(`${x},${y}`);
  return cells.map(({ x, y }) => {
    const up = has(x, y - 1);
    const down = has(x, y + 1);
    const left = has(x - 1, y);
    const right = has(x + 1, y);
    let mask = 0;
    if (!up && !left) mask |= CORNER_TL;
    if (!up && !right) mask |= CORNER_TR;
    if (!down && !right) mask |= CORNER_BR;
    if (!down && !left) mask |= CORNER_BL;
    return mask;
  });
}

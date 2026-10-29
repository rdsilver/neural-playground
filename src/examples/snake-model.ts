import { travelTicks, type Network } from '../engine';
import { BITS, DIRECTIONS, keyTiming, type BitName, type ControlUnit, type Direction } from './snake-control';

/**
 * Reference models of the Neural Snake, shared by the tests (no test code
 * here): the press model of the control unit (which direction strobe fires
 * each frame, given key presses at arbitrary ticks) and the snake itself
 * (which lamps are lit after each frame, given the strobes).
 */

// ---- bit model ---------------------------------------------------------------

/** A press reaching one bit's SET (set = true) or RST source at tick t. */
export interface Press {
  t: number;
  set: boolean;
  /** Which bit (for disambiguate()). */
  bit?: BitName;
}

/** A press the model cannot decide: it hits a gate exactly as news arrives. */
export class Ambiguous extends Error {
  constructor(readonly press: Press) {
    super('ambiguous press');
  }
}

/**
 * Exact model of one bit (starting at `initial`, its hole already dug): a
 * press poked at tick t reaches its gate at t+30; it gets through iff that
 * gate is open (the other gate's last change has been news for 15 ticks).
 * A change lands on the register 34 (SET) or 30 (RST) ticks after the gate.
 * Returns, per read tick, whether G fires, plus the register charge just
 * before each read. Throws Ambiguous if a press hits a gate exactly as news
 * arrives (a tie the model does not decide).
 */
export function bitModel(presses: Press[], reads: number[], initial: 0 | 1 = 0) {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  let bit = initial;
  // tick from which each gate is open
  const open = initial ? { set: Infinity, reset: -Infinity } : { set: -Infinity, reset: Infinity };
  const changes: Array<{ at: number; d: number; set: boolean }> = [];
  for (const p of sorted) {
    const a = p.t + 30;
    const gate = p.set ? 'set' : 'reset';
    if (open[gate] === a) throw new Ambiguous(p);
    if (open[gate] < a && (p.set ? bit === 0 : bit === 1)) {
      bit = p.set ? 1 : 0;
      open[gate] = Infinity;
      open[p.set ? 'reset' : 'set'] = a + 15;
      changes.push({ at: a + (p.set ? 34 : 30), d: p.set ? 1 : -1, set: p.set });
    }
  }
  // Sweep the (time-ordered) changes past the (ascending) reads.
  changes.sort((a, b) => a.at - b.at);
  let i = 0;
  let value: number = initial;
  return reads.map((T) => {
    while (i < changes.length && changes[i]!.at < T) value += changes[i++]!.d;
    let setNow = false;
    for (let j = i; j < changes.length && changes[j]!.at === T; j++) setNow ||= changes[j]!.set;
    return { fires: value + (setNow ? 1 : 0) === 1, before: value };
  });
}

// ---- control unit model --------------------------------------------------------

/** A key poked at tick t. */
export interface KeyPress {
  t: number;
  key: Direction;
}

/** Which bit inputs each key drives (AXIS, then its own axis's bit), and how many ticks later that input fires. */
export type KeyWiring = Record<Direction, Array<{ bit: BitName; set: boolean; delay: number }>>;

/** The facts the press model needs about a built control unit. */
export interface ControlFacts {
  F: number;
  /** Ticks from a frame clock fire (tick 1 + kF) to the read of each register (H and V are read only on their axis). */
  reads: Record<BitName, number>;
  /** reads.axis: the frame's sample of the direction. */
  readOffset: number;
  axisOne: 'vertical' | 'horizontal';
  initial: Record<BitName, 0 | 1>;
  wiring: KeyWiring;
  /**
   * Ticks from a key press to the frame AXIS read from which each of its
   * changes counts: AXIS, and its own axis's bit (never later than AXIS).
   */
  counts: Record<Direction, { axis: number; own: number }>;
  /** Of two presses at least this many ticks apart, the later always wins (no reordering, no closed gate). */
  gap: number;
}

/** Read a control unit's key wiring off a built network: each wire's travel through its relays. */
export function controlFacts(net: Network, ctl: ControlUnit): ControlFacts {
  const at = new Map(net.neurons.map((n) => [n.id, n]));
  const tt = (a: string, c: string) => travelTicks(at.get(a)!, at.get(c)!);
  const { keys } = keyTiming(tt, ctl);
  const wiring = Object.fromEntries(DIRECTIONS.map((d) => [d, keys[d].map((w) => ({ bit: w.bit, set: w.set, delay: w.delay }))])) as KeyWiring;
  const counts = Object.fromEntries(DIRECTIONS.map((d) => [d, { axis: keys[d][0]!.counts, own: keys[d][1]!.counts }])) as Record<Direction, { axis: number; own: number }>;
  const all = DIRECTIONS.flatMap((d) => keys[d]);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  // A gate opens 15 ticks after the other gate's news (per bit); and a later press's changes must count no
  // earlier than any change of the press before it.
  const gates = Math.max(...BITS.map((n) => spread(all.filter((w) => w.bit === n).map((w) => w.gate))));
  const gap = Math.max(15 + gates, spread(all.map((w) => w.counts))) + 1;
  return { F: ctl.F, reads: ctl.reads, readOffset: ctl.reads.axis, axisOne: ctl.axisOne, initial: ctl.initial, wiring, counts, gap };
}

const vertical = (d: Direction) => d === 'down' || d === 'up';

/**
 * The player's view of the control unit, independent of the bit model: for
 * presses at least facts.gap ticks apart, each frame's strobe is the key of
 * the latest press that counts by that frame's read (RIGHT before any). A
 * press counts when its own axis's bit does if it turns along the axis the
 * snake is on (◀ after ▶), else when AXIS does.
 */
export function intentModel(frames: number, presses: KeyPress[], facts: ControlFacts): Direction[] {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  const changes: Array<{ at: number; key: Direction }> = [];
  let prev: Direction = 'right';
  sorted.forEach((p, i) => {
    if (i > 0 && p.t - sorted[i - 1]!.t < facts.gap) throw new Error(`intentModel: presses at ${sorted[i - 1]!.t} and ${p.t} are closer than ${facts.gap} ticks`);
    if (p.key !== prev) changes.push({ at: p.t + (vertical(p.key) === vertical(prev) ? facts.counts[p.key].own : facts.counts[p.key].axis), key: p.key });
    prev = p.key;
  });
  return Array.from({ length: frames }, (_, k) => {
    const read = 1 + k * facts.F + facts.readOffset;
    return changes.filter((c) => c.at <= read).at(-1)?.key ?? 'right';
  });
}

/** Expected strobe direction per frame (throws Ambiguous on an undecided tie). */
export function controlModel(frames: number, presses: KeyPress[], facts: ControlFacts): Direction[] {
  const per: Record<BitName, Press[]> = { axis: [], h: [], v: [] };
  for (const p of presses) for (const w of facts.wiring[p.key]) per[w.bit].push({ t: p.t + w.delay, set: w.set, bit: w.bit });
  const frame = Array.from({ length: frames }, (_, k) => 1 + k * facts.F);
  const [a, h, v] = BITS.map((n) => bitModel(per[n], frame.map((c) => c + facts.reads[n]), facts.initial[n]));
  return frame.map((_, k) => {
    const isVertical = a![k]!.fires === (facts.axisOne === 'vertical');
    return isVertical ? (v![k]!.fires ? 'up' : 'down') : h![k]!.fires ? 'left' : 'right';
  });
}

/** Drop presses until the model is unambiguous. */
export function disambiguate(frames: number, presses: KeyPress[], facts: ControlFacts): KeyPress[] {
  for (;;) {
    try {
      controlModel(frames, presses, facts);
      return presses;
    } catch (e) {
      if (!(e instanceof Ambiguous)) throw e;
      const bad = e.press;
      const i = presses.findIndex((p) => facts.wiring[p.key].some((w) => w.bit === bad.bit && p.t + w.delay === bad.t && w.set === bad.set));
      presses = presses.filter((_, j) => j !== i);
    }
  }
}

// ---- snake model --------------------------------------------------------------

export const STEP: Record<Direction, { dx: number; dy: number }> = {
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
};

/**
 * The snake on a w x h torus (y grows downward), length L. Frame k moves the
 * head one step in dirs[k], from `start` before frame 0. After frame k the
 * lit lamps are the last min(k + 1, L) head positions, counted with
 * multiplicity (a snake crossing itself stacks charge on a lamp).
 */
export function snakeModel(dirs: readonly Direction[], start: { x: number; y: number }, w = 10, h = 8, L = 4) {
  const heads: Array<{ x: number; y: number }> = [];
  let { x, y } = start;
  for (const d of dirs) {
    x = (x + STEP[d].dx + w) % w;
    y = (y + STEP[d].dy + h) % h;
    heads.push({ x, y });
  }
  /** lamps[y][x]: how many of the last min(k + 1, L) head positions are (x, y). */
  const lit = (k: number) => {
    const grid = Array.from({ length: h }, () => Array<number>(w).fill(0));
    for (let i = Math.max(0, k - L + 1); i <= k; i++) grid[heads[i]!.y]![heads[i]!.x]!++;
    return grid;
  };
  /** Where the tail ring stands after frame k: the head of L frames earlier (start before that). */
  const tail = (k: number) => (k < L ? start : heads[k - L]!);
  return { heads, lit, tail };
}

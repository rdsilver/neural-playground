import { travelTicks, type Network } from '../engine';
import { DIRECTIONS, keyTiming, type ControlUnit, type Direction } from './snake-control';

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
}

/** A press the model cannot decide: it hits a gate exactly as news arrives. */
export class Ambiguous extends Error {
  constructor(readonly press: Press) {
    super('ambiguous press');
  }
}

/**
 * Exact model of one bit: a press poked at tick t reaches its gate at t+30;
 * it gets through iff that gate is open (the other gate's last change has
 * been news for 15 ticks). A change lands on the register 34 (SET) or 30
 * (RST) ticks after the gate. Returns, per read tick, whether G fires, plus
 * the register charge just before each read. Throws Ambiguous if a press
 * hits a gate exactly as news arrives (a tie the model does not decide).
 */
export function bitModel(presses: Press[], reads: number[]) {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  let bit = 0;
  const open = { set: -Infinity, reset: Infinity }; // tick from which each gate is open
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
  let value = 0;
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

/** Which bit inputs each key drives, and how many ticks later that input fires. */
export type KeyWiring = Record<Direction, Array<{ bit: 'axis' | 'sign'; set: boolean; delay: number }>>;

/** The facts the press model needs about a built control unit. */
export interface ControlFacts {
  F: number;
  /** Ticks from a frame clock fire (tick 1 + kF) to the read of both registers. */
  readOffset: number;
  wiring: KeyWiring;
  /**
   * Ticks from a key press to the first read it counts at: both of a key's
   * bit changes count from the same read on (buildControl's key timing).
   */
  counts: Record<Direction, number>;
  /** Of two presses at least this many ticks apart, the later always wins (no reordering, no closed gate). */
  gap: number;
}

/** Read a control unit's key wiring off a built network: each wire's travel through its relays. */
export function controlFacts(net: Network, ctl: ControlUnit): ControlFacts {
  const at = new Map(net.neurons.map((n) => [n.id, n]));
  const ticks = (path: string[]) => path.slice(1).reduce((s, id, i) => s + travelTicks(at.get(path[i]!)!, at.get(id)!), 0);
  const wiring = Object.fromEntries(Object.entries(ctl.wiring).map(([d, wires]) => [d, wires.map((w) => ({ bit: w.bit, set: w.set, delay: ticks(w.path) }))])) as KeyWiring;
  const tt = (a: string, c: string) => travelTicks(at.get(a)!, at.get(c)!);
  const { keys } = keyTiming(tt, ctl.power, ctl.bits, ctl.wiring);
  const counts = Object.fromEntries(DIRECTIONS.map((d) => [d, keys[d][0]!.counts])) as Record<Direction, number>;
  const all = DIRECTIONS.flatMap((d) => keys[d]);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  // A gate opens 15 ticks after the other gate's news; and a later press must count no earlier.
  const gap = Math.max(15 + spread(all.map((w) => w.gate)), spread(Object.values(counts))) + 1;
  return { F: ctl.F, readOffset: ctl.readOffset, wiring, counts, gap };
}

/**
 * The player's view of the control unit, independent of the bit model: for
 * presses at least facts.gap ticks apart, each frame's strobe is the key of
 * the latest press that counts by that frame's read (RIGHT before any).
 */
export function intentModel(frames: number, presses: KeyPress[], facts: ControlFacts): Direction[] {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  sorted.forEach((p, i) => {
    if (i > 0 && p.t - sorted[i - 1]!.t < facts.gap) throw new Error(`intentModel: presses at ${sorted[i - 1]!.t} and ${p.t} are closer than ${facts.gap} ticks`);
  });
  return Array.from({ length: frames }, (_, k) => {
    const read = 1 + k * facts.F + facts.readOffset;
    return sorted.filter((p) => p.t + facts.counts[p.key] <= read).at(-1)?.key ?? 'right';
  });
}

/** Expected strobe direction per frame (throws Ambiguous on an undecided tie). */
export function controlModel(frames: number, presses: KeyPress[], facts: ControlFacts): Direction[] {
  const per = { axis: [] as Press[], sign: [] as Press[] };
  for (const p of presses) for (const w of facts.wiring[p.key]) per[w.bit].push({ t: p.t + w.delay, set: w.set });
  const reads = Array.from({ length: frames }, (_, k) => 1 + k * facts.F + facts.readOffset);
  const a = bitModel(per.axis, reads);
  const s = bitModel(per.sign, reads);
  return reads.map((_, k) => (a[k]!.fires ? (s[k]!.fires ? 'up' : 'down') : s[k]!.fires ? 'left' : 'right'));
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
      const i = presses.findIndex((p) => facts.wiring[p.key].some((w) => p.t + w.delay === bad.t && w.set === bad.set));
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

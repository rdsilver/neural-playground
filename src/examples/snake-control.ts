import { NetworkBuilder, travelTicks } from '../engine';

/**
 * Control unit of the Neural Snake: four direction keys, a two-bit
 * direction register (AXIS and SIGN flip-flops), a synchronous read-out
 * and a 2-to-4 decoder that fires exactly one direction strobe per frame.
 * See buildControl() for the public API and the frame schedule.
 */

export interface Cell {
  x: number;
  y: number;
}

/** Placement of a block: local (x, y) -> absolute cell, optionally mirrored. */
export interface Place {
  x0: number;
  y0: number;
  sx: 1 | -1;
  sy?: 1 | -1;
}
export const at = (f: Place, x: number, y: number): Cell => ({ x: f.x0 + f.sx * x, y: f.y0 + (f.sy ?? 1) * y });

/** Neuron ids of one bit (flip-flop + register). */
export interface BitIds {
  /** Fire to SET the bit (store 1). Keys connect here. */
  setSource: string;
  /** Fire to RESET the bit (store 0). Keys connect here. */
  resetSource: string;
  setGate: string;
  resetGate: string;
  /** The -1 half of RST's pair: power-on pokes it once to dig the first hole. */
  resetMinus: string;
  /** Register: threshold 2, its charge IS the bit (0 or 1) between reads. */
  register: string;
  /** Read pair source: fire it so its +1/-1 pair lands on the register at the read tick. */
  readSource: string;
  /** Relay from the read source to the register (+1 half of the pair). */
  readPlus: string;
  /** Inhibitor driven by the register: sends -1 wherever the bit means "not this rail". */
  registerMinus: string;
}

/**
 * One bit. The flip-flop is the hole-gate design of basics.ts: two gates
 * share one "hole" of -1 charge, so repeated presses are ignored and only
 * real changes get through. Each change lands on the register G
 * (threshold 2): SET adds +1 (straight from the SET gate), RST adds -1
 * (through an Inhibitor). So G's charge is the bit itself.
 *
 * Reading G without destroying it: a tight +1/-1 pair lands on G. If G
 * holds 1, the +1 makes 2 and G fires; the -1 leaves -1 and two restore
 * relays add +2, back to 1. If G holds 0, the pair just adds up to 0.
 *
 * Local layout (x right, y down; the SIGN bit is mirrored left-right):
 *
 *        x: 0     1     2     3
 *   y=-2              Sc              read pair: Sc -> Pc, Mc -> G
 *   y=-1        Mc    Gm    Pc        Gm: G's Inhibitor (the "bit is 1" -1 rail)
 *   y= 0  Sr    Pr    G     R1
 *   y= 1  Mr    RST   Ir    R2        Ir: RST's -1 onto G; R1, R2 restore G
 *   y= 2  Ms    SET
 *   y= 3  Ss    Ps
 */
export function buildBit(b: NetworkBuilder, f: Place, name: string): BitIds {
  const id = (s: string) => `${name}-${s}`;
  const n = (s: string, x: number, y: number, threshold = 1, label?: string) => {
    const c = at(f, x, y);
    return b.normal(c.x, c.y, threshold, { id: id(s), ...(label ? { label } : {}) });
  };
  const inh = (s: string, x: number, y: number, label = '−1') => {
    const c = at(f, x, y);
    return b.inhibitor(c.x, c.y, 1, { id: id(s), label });
  };
  // Flip-flop: two hole gates, each fed by a tight pair square (basics.ts).
  const resetSource = n('reset', 0, 0, 1, 'RST');
  const resetPlus = n('reset-plus', 1, 0, 1, '+1');
  const resetMinus = inh('reset-minus', 0, 1);
  const resetGate = n('reset-gate', 1, 1);
  const setMinus = inh('set-minus', 0, 2);
  const setGate = n('set-gate', 1, 2);
  const setSource = n('set', 0, 3, 1, 'SET');
  const setPlus = n('set-plus', 1, 3, 1, '+1');
  b.connect(resetSource, [resetPlus, resetMinus]).connect(resetPlus, resetGate).connect(resetMinus, resetGate);
  b.connect(setSource, [setPlus, setMinus]).connect(setPlus, setGate).connect(setMinus, setGate);
  b.both(setGate, resetGate);

  // Register. SET's +1 takes 34 ticks, RST's -1 takes 30 (15 + 15): a RST
  // always lands before a following SET (at least 15 + 34 ticks later), so
  // G only ever sees +1, -1, +1, ... and its charge stays 0 or 1.
  const g = n('register', 2, 0, 2, 'G');
  const ir = inh('reset-register', 2, 1);
  b.connect(setGate, g).connect(resetGate, ir).connect(ir, g);

  // Read pair (a diagonal square: 22 ticks per side) and restore relays.
  // On a tie at the read tick, SET's +1 (sent 34 ticks earlier) lands
  // before the pair and counts now; RST's -1 (sent 15 ticks earlier) lands
  // after it and counts at the next read. Either way G stays consistent.
  const readSource = n('read', 2, -2);
  const readPlus = n('read-plus', 3, -1);
  const readMinus = inh('read-minus', 1, -1);
  b.connect(readSource, [readPlus, readMinus]).connect(readPlus, g).connect(readMinus, g);
  const r1 = n('restore-1', 3, 0);
  const r2 = n('restore-2', 3, 1);
  b.connect(g, [r1, r2]).connect(r1, g).connect(r2, g);

  const gm = inh('register-minus', 2, -1);
  b.connect(g, gm);
  return { setSource, resetSource, setGate, resetGate, resetMinus, register: g, readSource, readPlus, registerMinus: gm };
}

// ---- control unit ------------------------------------------------------------

export type Direction = 'right' | 'left' | 'down' | 'up';
export const DIRECTIONS: readonly Direction[] = ['right', 'left', 'down', 'up'];

export interface ControlOptions {
  /** Frame period in ticks (the frame Timer's interval). */
  F: number;
  /** Prefix for every neuron id (default 'ctl'). */
  prefix?: string;
}

/** One wire from a key to a bit input: the neurons it passes (key, relays..., SET or RST source). */
export interface KeyWire {
  bit: 'axis' | 'sign';
  /** true: the key SETs the bit; false: it RSTs it. */
  set: boolean;
  path: string[];
}

export interface ControlUnit {
  /** Key neurons (poke = press). */
  keys: Record<Direction, string>;
  /** Each key's two wires to the bit inputs (see buildControl: both of a key's bit changes land together). */
  wiring: Record<Direction, [KeyWire, KeyWire]>;
  /** Strobe neurons: exactly one fires per frame, at `strobeOffset`. */
  strobes: Record<Direction, string>;
  /** The frame Timer (fires at tick 1 + k*F) and the one-shot power-on Timer (tick 1). */
  clock: string;
  power: string;
  bits: { axis: BitIds; sign: BitIds };
  F: number;
  /** Ticks from a frame Timer fire to the read of both registers (the sample). */
  readOffset: number;
  /** Ticks from a frame Timer fire to its strobe. */
  strobeOffset: number;
}

/**
 * A delay line from `a` to `to` of exactly `total` ticks through 1-3 relays
 * in free cells near `near`; among the fewest-relay lines, the shortest
 * wiring wins. Deterministic.
 */
export function findDelay(a: Cell, to: Cell, total: number, near: Cell, taken: (c: Cell) => boolean): Cell[] | undefined {
  const cells: Cell[] = [];
  for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) if (!taken({ x: near.x + dx, y: near.y + dy })) cells.push({ x: near.x + dx, y: near.y + dy });
  const dist = (p: Cell, q: Cell) => Math.hypot(p.x - q.x, p.y - q.y);
  // reach[i]: ticks-from-a -> best path (cells) ending at cells[i]
  let layer = cells.map((c) => new Map<number, { path: Cell[]; len: number }>([[travelTicks(a, c), { path: [c], len: dist(a, c) }]]));
  for (let hops = 1; hops <= 3; hops++) {
    let best: { path: Cell[]; len: number } | undefined;
    cells.forEach((c, i) => {
      const e = layer[i]!.get(total - travelTicks(c, to));
      if (e && (!best || e.len + dist(c, to) < best.len)) best = { path: e.path, len: e.len + dist(c, to) };
    });
    if (best) return best.path;
    const next = cells.map(() => new Map<number, { path: Cell[]; len: number }>());
    cells.forEach((c, i) =>
      layer[i]!.forEach((e, t0) =>
        cells.forEach((d, j) => {
          if (e.path.includes(d)) return;
          const t = t0 + travelTicks(c, d);
          if (t >= total) return;
          const len = e.len + dist(c, d);
          const old = next[j]!.get(t);
          if (!old || len < old.len) next[j]!.set(t, { path: [...e.path, d], len });
        }),
      ),
    );
    layer = next;
  }
  return undefined;
}

/** AXIS: 1 = vertical. SIGN: 1 = negative (left/up). What each key stores. */
const KEY_BITS: Record<Direction, { axis: boolean; sign: boolean }> = {
  up: { axis: true, sign: true },
  left: { axis: false, sign: true },
  down: { axis: true, sign: false },
  right: { axis: false, sign: false },
};
const KEY_LABELS: Record<Direction, string> = { left: '◀', up: '▲', down: '▼', right: '▶' };
/** Key cells (relative to the origin), left to right with a free cell between: ◀ ▲ ▼ ▶. */
const KEY_CELLS: Record<Direction, Cell> = { left: { x: -3, y: -1 }, up: { x: -1, y: -1 }, down: { x: 1, y: -1 }, right: { x: 3, y: -1 } };
/**
 * Relay cells on each key's wire to the AXIS input and to the SIGN input:
 * found by a search for the timing below with no wire over another key
 * (buildControl checks the timing from the cells).
 */
const KEY_RELAYS: Record<Direction, Record<'axis' | 'sign', Cell[]>> = {
  left: { axis: [{ x: -1, y: 0 }], sign: [{ x: -5, y: 0 }] },
  up: { axis: [{ x: 2, y: 0 }], sign: [{ x: -4, y: 0 }] },
  down: { axis: [{ x: 2, y: -1 }, { x: 3, y: 0 }], sign: [{ x: 0, y: -1 }, { x: -1, y: 2 }] },
  right: { axis: [{ x: 4, y: 0 }], sign: [] },
};

/**
 * Build the control unit. `origin` is the cell between the two flip-flops'
 * SET inputs; the keys sit in a row just above the flip-flops.
 *
 * Layout (cells relative to origin; the SIGN bit is the AXIS bit mirrored;
 * k = relays on the key wires):
 *
 *     x: -5  -4  -3  -2  -1   0   1   2   3   4
 *   y=-1          ◀       ▲   k   ▼   k   ▶          keys
 *   y=0    k   k  SIGN    k   AXIS    k   k   k      ▲ = SET both, ▶ = RST both,
 *   y=1           flip-       flip-                  ◀ = RST AXIS + SET SIGN,
 *   y=2           flop    k   flop                   ▼ = SET AXIS + RST SIGN
 *   y=3     + reg G           + reg G
 *   y=4                   R
 *   y=5                D  K  L                       decoder: K = strobe clock
 *   y=6                X2 U  X1                      X1, X2 = cleanup Inhibitors
 *   y=8                   T                          frame Timer
 *
 * Key timing. A key that changes both bits (◀ after ▼, ▼ after ◀, ▲ after
 * ▶, ▶ after ▲) must change them on the same side of a read: otherwise the
 * decoder sees, for one frame, a direction nobody pressed (▶ between ◀ and
 * ▼, say). A change counts at a read at tick T if a SET's +1 lands on the
 * register at or before T, a RST's -1 strictly before T (see buildBit). SET
 * lands 34 ticks after its gate, RST 30, so a key's two changes count at the
 * same reads exactly when each of its RST wires is 3 ticks longer than its
 * SET wires (▲, ▶: two equal wires). The relay paths in KEY_RELAYS do that,
 * and the keys are about equally fast (78 to 97 ticks to a bit input), so
 * of two presses far enough apart the later one wins. No key wire passes
 * over another key. Every wire is slow enough that a press at tick 0
 * reaches its gate after power-on has dug the hole. buildControl checks
 * the timing from the cells.
 */
export function buildControl(b: NetworkBuilder, origin: Cell, opts: ControlOptions): ControlUnit {
  const F = opts.F;
  const pre = opts.prefix ?? 'ctl';
  const P = (x: number, y: number): Cell => ({ x: origin.x + x, y: origin.y + y });
  const axis = buildBit(b, { x0: origin.x, y0: origin.y + 3, sx: 1, sy: -1 }, `${pre}-axis`);
  const sign = buildBit(b, { x0: origin.x - 2, y0: origin.y + 3, sx: -1, sy: -1 }, `${pre}-sign`);

  const keys = {} as Record<Direction, string>;
  for (const d of ['left', 'up', 'down', 'right'] as const) {
    const c = P(KEY_CELLS[d].x, KEY_CELLS[d].y);
    keys[d] = b.normal(c.x, c.y, 1, { id: `${pre}-key-${d}`, label: KEY_LABELS[d] });
  }
  const wiring = {} as Record<Direction, [KeyWire, KeyWire]>;
  for (const d of ['up', 'left', 'down', 'right'] as const) {
    const wire = (bit: 'axis' | 'sign'): KeyWire => {
      const set = KEY_BITS[d][bit];
      const ids = bit === 'axis' ? axis : sign;
      const relays = KEY_RELAYS[d][bit].map((r, i) => b.normal(P(r.x, r.y).x, P(r.x, r.y).y, 1, { id: `${pre}-wire-${d}-${bit}-${i + 1}` }));
      const path = [keys[d], ...relays, set ? ids.setSource : ids.resetSource];
      b.chain(path);
      return { bit, set, path };
    };
    wiring[d] = [wire('axis'), wire('sign')];
  }

  // Decoder branches (threshold 1). Resting charges: right 0, left -1,
  // down -1, up -2: the "bit is 0" rails are folded in as a bias.
  const node = (s: string, x: number, y: number, label?: string) => b.normal(P(x, y).x, P(x, y).y, 1, { id: `${pre}-${s}`, ...(label ? { label } : {}) });
  const strobes: Record<Direction, string> = {
    right: node('right', -1, 4, 'R'),
    left: node('left', 0, 5, 'L'),
    down: node('down', -2, 5, 'D'),
    up: node('up', -1, 6, 'U'),
  };
  const k = node('strobe-clock', -1, 5, 'K');
  const x1 = b.inhibitor(P(0, 6).x, P(0, 6).y, 1, { id: `${pre}-cleanup-1`, label: '−1' });
  const x2 = b.inhibitor(P(-2, 6).x, P(-2, 6).y, 1, { id: `${pre}-cleanup-2`, label: '−1' });
  b.connect(axis.register, [strobes.down, strobes.up]).connect(axis.registerMinus, [strobes.right, strobes.left]);
  b.connect(sign.register, [strobes.left, strobes.up]).connect(sign.registerMinus, [strobes.right, strobes.down]);
  b.connect(k, [strobes.right, strobes.left, strobes.down, strobes.up, x1, x2]);
  b.connect(x1, [strobes.left, strobes.down, strobes.up]).connect(x2, strobes.up);
  b.both(strobes.right, strobes.up).both(strobes.left, strobes.down);

  // Clock and power-on.
  const clock = b.timer(P(-1, 8).x, P(-1, 8).y, { id: `${pre}-clock`, interval: F / 60, label: 'CLK' });
  b.connect(clock, [axis.readSource, sign.readSource]);
  const power = b.timer(P(0, 4).x, P(0, 4).y, { id: `${pre}-power`, interval: 1, times: 1, label: 'ON' });
  b.connect(power, [axis.resetMinus, sign.resetMinus, x1, x2]);

  const net = () => b.build().neurons;
  const cell = (id: string) => net().find((n) => n.id === id)!;
  const tt = (a: string, c: string) => travelTicks(cell(a), cell(c));
  const readOffset = tt(clock, axis.readSource) + tt(axis.readSource, axis.readPlus) + tt(axis.readPlus, axis.register);
  // The strobe clock K must land after the last decoder input (read + 68):
  // the earliest such tick a short delay line from the read source can hit.
  const taken = (c: Cell) => net().some((n) => n.x === c.x && n.y === c.y);
  const fromRead = tt(clock, axis.readSource);
  let kFire = readOffset + 69 - tt(k, strobes.right);
  let path: Cell[] | undefined;
  for (; !path; kFire++) path = findDelay(cell(axis.readSource), cell(k), kFire - fromRead, P(1, 7), taken);
  kFire--;
  const delay = path.map((c, i) => b.normal(c.x, c.y, 1, { id: `${pre}-strobe-delay-${i + 1}` }));
  b.chain([axis.readSource, ...delay, k]);
  const strobeOffset = kFire + tt(k, strobes.right);
  checkKeyTiming(tt, power, { axis, sign }, wiring);
  return { keys, wiring, strobes, clock, power, bits: { axis, sign }, F, readOffset, strobeOffset };
}

/** Ticks from a press to the read at which it counts, and from power-on to the hole, measured on the cells (see buildControl). */
export function keyTiming(tt: (a: string, c: string) => number, power: string, bits: { axis: BitIds; sign: BitIds }, wiring: Record<Direction, [KeyWire, KeyWire]>) {
  const pathTicks = (path: string[]) => path.slice(1).reduce((s, id, i) => s + tt(path[i]!, id), 0);
  /** Source to gate: the +1 and -1 halves of the pair arrive together. */
  const gateLag = (src: string, gate: string, half: string) => tt(src, half) + tt(half, gate);
  const lags = Object.fromEntries((['axis', 'sign'] as const).map((bit) => {
    const ids = bits[bit];
    const name = ids.register.slice(0, -'-register'.length);
    const setGate = gateLag(ids.setSource, ids.setGate, `${name}-set-plus`);
    const resetGate = gateLag(ids.resetSource, ids.resetGate, `${name}-reset-plus`);
    if (setGate !== gateLag(ids.setSource, ids.setGate, `${name}-set-minus`) || resetGate !== gateLag(ids.resetSource, ids.resetGate, ids.resetMinus)) throw new Error('control: a press pair splits');
    // A SET counts at reads at or after its landing; a RST's -1 at reads strictly after.
    const counts = { set: setGate + tt(ids.setGate, ids.register), reset: resetGate + tt(ids.resetGate, `${name}-reset-register`) + tt(`${name}-reset-register`, ids.register) + 1 };
    const hole = 1 + tt(power, ids.resetMinus) + tt(ids.resetMinus, ids.resetGate);
    return [bit, { setGate, resetGate, counts, hole }];
  })) as Record<'axis' | 'sign', { setGate: number; resetGate: number; counts: { set: number; reset: number }; hole: number }>;
  const keys = Object.fromEntries(DIRECTIONS.map((d) => {
    const wires = wiring[d].map((w) => {
      const l = lags[w.bit];
      const delay = pathTicks(w.path);
      return { ...w, delay, counts: delay + (w.set ? l.counts.set : l.counts.reset), gate: delay + (w.set ? l.setGate : l.resetGate) };
    });
    return [d, wires];
  })) as Record<Direction, Array<KeyWire & { delay: number; counts: number; gate: number }>>;
  return { lags, keys };
}

function checkKeyTiming(...args: Parameters<typeof keyTiming>): void {
  const { lags, keys } = keyTiming(...args);
  for (const d of DIRECTIONS) {
    const [a, s] = keys[d];
    if (a!.counts !== s!.counts) throw new Error(`control: key ${d} changes AXIS at read +${a!.counts} but SIGN at +${s!.counts}`);
    for (const w of keys[d]) if (w.gate <= lags[w.bit].hole) throw new Error(`control: a ${d} press at tick 0 reaches the ${w.bit} gate before power-on's hole`);
  }
}

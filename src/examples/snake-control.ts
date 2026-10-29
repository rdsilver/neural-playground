import { NetworkBuilder, travelTicks } from '../engine';

/**
 * Control unit of the Neural Snake: four arrow keys, a three-bit direction
 * register (AXIS: horizontal or vertical; H: right or left; V: down or up),
 * a synchronous read-out that reads H only when AXIS says horizontal and V
 * only when it says vertical, and a decoder that fires exactly one direction
 * strobe per frame. See buildControl() for the public API, the frame
 * schedule and the layout.
 */

export interface Cell {
  x: number;
  y: number;
}

/** Placement of a block: local (x, y) -> absolute cell, optionally transposed (t: local x and y swap), then mirrored. */
export interface Place {
  x0: number;
  y0: number;
  sx: 1 | -1;
  sy?: 1 | -1;
  t?: boolean;
}
export const at = (f: Place, x: number, y: number): Cell => {
  const [u, v] = f.t ? [y, x] : [x, y];
  return { x: f.x0 + f.sx * u, y: f.y0 + (f.sy ?? 1) * v };
};

/** Neuron ids of one bit (flip-flop + register). */
export interface BitIds {
  /** Fire to SET the bit (store 1). Keys connect here. */
  setSource: string;
  /** Fire to RESET the bit (store 0). Keys connect here. */
  resetSource: string;
  setGate: string;
  resetGate: string;
  /** The -1 half of RST's pair: power-on pokes it once to dig the first hole (the bit starts at 0). */
  resetMinus: string;
  /** The -1 half of SET's pair: power-on pokes it instead for a bit that starts at 1 (with a +1 onto G). */
  setMinus: string;
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
 * Local layout (x right, y down; the control unit places its three bits
 * mirrored or transposed, which keeps every distance):
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
  return { setSource, resetSource, setGate, resetGate, resetMinus, setMinus, register: g, readSource, readPlus, registerMinus: gm };
}

// ---- control unit ------------------------------------------------------------

export type Direction = 'right' | 'left' | 'down' | 'up';
export const DIRECTIONS: readonly Direction[] = ['right', 'left', 'down', 'up'];
/** The three bits: AXIS (1 = vertical), H (1 = left), V (1 = up). */
export type BitName = 'axis' | 'h' | 'v';
export const BITS: readonly BitName[] = ['axis', 'h', 'v'];

/** One wire from a key to a bit input: the neurons it passes (key, relays..., SET or RST source). */
export interface KeyWire {
  bit: BitName;
  /** true: the key SETs the bit; false: it RSTs it. */
  set: boolean;
  path: string[];
}

export interface ControlUnit {
  /** The shortest frame period the read-out allows (a NOT strobe's -1 lands after the frame before's +1; a register is restored before its next read). */
  minF: number;
  /** Key neurons (poke = press). */
  keys: Record<Direction, string>;
  /** Each key's two wires: to AXIS, and to its own axis's bit (H for ◀ ▶, V for ▲ ▼). */
  wiring: Record<Direction, [KeyWire, KeyWire]>;
  /** Strobe neurons: exactly one fires per frame, at `strobeOffset`. */
  strobes: Record<Direction, string>;
  /** The frame Timer (fires at tick 1 + k*F) and the one-shot power-on Timer (tick 1). */
  clock: string;
  power: string;
  bits: Record<BitName, BitIds>;
  F: number;
  /** Ticks from a frame Timer fire to the read of each register (H is read only when AXIS = 0, V only when AXIS = 1). */
  reads: Record<BitName, number>;
  /** reads.axis: the frame's sample of the direction. */
  readOffset: number;
  /** Ticks from a frame Timer fire to its strobe. */
  strobeOffset: number;
  /** Timers at the unit's edge for the other blocks to wire from: a one-shot that fires with `power` (tick 1), a frame Timer that fires with `clock`. */
  ports: { power: string; clock: string };
  /** Ticks after the frame Timer by which every neuron of the unit is back at rest (if no key is pressed meanwhile). */
  restOffset: number;
  /** Every neuron the unit placed (relays included). */
  ids: string[];
  /** What AXIS = 1 means (the layout's choice). */
  axisOne: 'vertical' | 'horizontal';
  /** Each bit's value after power-on: the unit starts moving RIGHT. */
  initial: Record<BitName, 0 | 1>;
  /** Power-on's line to the Inhibitor that digs each bit's first hole (RST's for a bit starting at 0, SET's for 1): power, relays..., Inhibitor. */
  powerWiring: Record<BitName, string[]>;
}

/** Distance from point p to segment a-b. */
export function segmentDistance(a: Cell, b: Cell, p: Cell): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** No wire passes closer than this to a key's centre (a cell is 1 wide). */
export const KEY_CLEARANCE = 0.5;
/** A wire "passes over" a neuron whose centre is closer than this. */
const OVER = 0.45;
/** Longest hop of a line inside the unit, in cells. */
const MAX_HOP = 6.5;
const cellKey = (c: Cell) => `${c.x},${c.y}`;

/**
 * Exact delay lines inside the control unit: relays (threshold 1) in free
 * cells of the unit's area, never next to a key, no wire over a key, hops
 * of at most MAX_HOP cells; cheapest first (length, plus 3 per relay and 6
 * per neuron a hop passes over). Deterministic.
 */
class Router {
  private taken = new Set<string>();
  /** Spread allowed among the counts of one bit's writers (ticks). */
  static readonly TOLERANCE = 12;
  constructor(
    private b: NetworkBuilder,
    private area: Cell[],
    private keys: Cell[],
  ) {}

  private neurons(): Cell[] {
    return this.b.build().neurons.map((n) => ({ x: n.x, y: n.y }));
  }

  /** Cells a relay may take: in the area, empty, not next to a key, not claimed by a trial route. */
  private nodes(occupied: Set<string>): Cell[] {
    return this.area.filter((c) => !occupied.has(cellKey(c)) && !this.taken.has(cellKey(c)) && !this.keys.some((k) => Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y)) <= 1));
  }

  /** Hop cost, or Infinity if the hop passes over a key or is too long. */
  private hop(p: Cell, q: Cell, cells: Cell[]): number {
    const len = Math.hypot(p.x - q.x, p.y - q.y);
    if (len > MAX_HOP) return Infinity;
    const ends = (c: Cell) => (c.x === p.x && c.y === p.y) || (c.x === q.x && c.y === q.y);
    if (this.keys.some((k) => !ends(k) && segmentDistance(p, q, k) < KEY_CLEARANCE)) return Infinity;
    const over = cells.filter((c) => !ends(c) && segmentDistance(p, q, c) < OVER).length;
    return len + 6 * over;
  }

  /**
   * The cheapest line of relays from one of `starts` (a cell that fires at
   * t0) to `to`, landing exactly at tick `total`; relay cells are claimed
   * (see release/build). Returns the start's index and the relay cells.
   */
  exact(starts: Array<{ cell: Cell; t0: number }>, to: Cell, total: number): { start: number; relays: Cell[] } | undefined {
    const placed = this.neurons();
    const occupied = new Set(placed.map(cellKey));
    const all = [...placed, ...[...this.taken].map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }))];
    const nodes = this.nodes(occupied);
    const n = nodes.length;
    // best[i].get(t): cheapest cost to reach relay i at tick t, its previous node (-1 - s for start s) and that node's tick.
    const best = nodes.map(() => new Map<number, { cost: number; prev: number; pt: number }>());
    let done: { cost: number; prev: number; pt: number } | undefined;
    const reach = (i: number, t: number, cost: number, prev: number, pt: number) => {
      if (t + travelTicks(nodes[i]!, to) > total) return;
      const old = best[i]!.get(t);
      if (!old || cost < old.cost) best[i]!.set(t, { cost, prev, pt });
    };
    starts.forEach((s, si) => {
      if (s.t0 + travelTicks(s.cell, to) === total) {
        const c = this.hop(s.cell, to, all);
        if (c < Infinity && (!done || c < done.cost)) done = { cost: c, prev: -1 - si, pt: s.t0 };
      }
      for (let i = 0; i < n; i++) {
        const c = this.hop(s.cell, nodes[i]!, all);
        if (c < Infinity) reach(i, s.t0 + travelTicks(s.cell, nodes[i]!), c + 3, -1 - si, s.t0);
      }
    });
    const hops = new Map<number, number>();
    const hopCost = (i: number, j: number) => {
      const k = i * n + j;
      let c = hops.get(k);
      if (c === undefined) hops.set(k, (c = this.hop(nodes[i]!, nodes[j]!, all)));
      return c;
    };
    const t0 = Math.min(...starts.map((s) => s.t0));
    for (let t = t0; t <= total; t++)
      for (let i = 0; i < n; i++) {
        const e = best[i]!.get(t);
        if (!e) continue;
        if (t + travelTicks(nodes[i]!, to) === total) {
          const c = e.cost + this.hop(nodes[i]!, to, all);
          if (c < Infinity && (!done || c < done.cost)) done = { cost: c, prev: i, pt: t };
        }
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const c = hopCost(i, j);
          if (c < Infinity) reach(j, t + travelTicks(nodes[i]!, nodes[j]!), e.cost + c + 3, i, t);
        }
      }
    if (!done) return undefined;
    const relays: Cell[] = [];
    let cur = done;
    while (cur.prev >= 0) {
      relays.unshift(nodes[cur.prev]!);
      cur = best[cur.prev]!.get(cur.pt)!;
    }
    // A path may visit a cell twice in principle: refuse it.
    if (new Set(relays.map(cellKey)).size < relays.length) return undefined;
    relays.forEach((c) => this.taken.add(cellKey(c)));
    return { start: -1 - cur.prev, relays };
  }

  /** The cheapest exact line landing at any tick in [lo, hi] (claims its cells); undefined if none. */
  within(starts: Array<{ cell: Cell; t0: number }>, to: Cell, lo: number, hi: number): { start: number; relays: Cell[]; total: number } | undefined {
    let best: { start: number; relays: Cell[]; total: number; cost: number } | undefined;
    const claimed = new Set(this.taken);
    for (let t = lo; t <= hi; t++) {
      const r = this.exact(starts, to, t);
      if (!r) continue;
      const pts = [starts[r.start]!.cell, ...r.relays, to];
      const all = [...this.neurons(), ...[...claimed].map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }))];
      const cost = pts.slice(1).reduce((c, q, i) => c + this.hop(pts[i]!, q, all) + 3, 0) + (t - lo) * 0.05;
      if (!best || cost < best.cost) best = { ...r, total: t, cost };
      this.taken = new Set(claimed);
    }
    best?.relays.forEach((c) => this.taken.add(cellKey(c)));
    return best && { start: best.start, relays: best.relays, total: best.total };
  }

  /** Forget every claimed cell (a trial failed), or just these. */
  release(cells?: Cell[]): void {
    if (cells) cells.forEach((c) => this.taken.delete(cellKey(c)));
    else this.taken.clear();
  }

  /** Build claimed relays (named `${name}-1`, ...) and wire start -> relays -> to; returns the path's ids. */
  build(start: string, relays: Cell[], to: string, name: string): string[] {
    const ids = relays.map((c, i) => this.b.normal(c.x, c.y, 1, { id: `${name}-${i + 1}` }));
    const path = [start, ...ids, to];
    this.b.chain(path);
    relays.forEach((c) => this.taken.delete(cellKey(c)));
    return path;
  }
}

/** H: 1 = left. V: 1 = up. AXIS: 1 = the layout's axisOne. Each key writes AXIS and its own axis's bit. */
export function keyBits(axisOne: 'vertical' | 'horizontal'): Record<Direction, [{ bit: BitName; set: boolean }, { bit: BitName; set: boolean }]> {
  const v = axisOne === 'vertical';
  return {
    right: [{ bit: 'axis', set: !v }, { bit: 'h', set: false }],
    left: [{ bit: 'axis', set: !v }, { bit: 'h', set: true }],
    down: [{ bit: 'axis', set: v }, { bit: 'v', set: false }],
    up: [{ bit: 'axis', set: v }, { bit: 'v', set: true }],
  };
}
const KEY_LABELS: Record<Direction, string> = { left: '◀', up: '▲', down: '▼', right: '▶' };

/** Where the unit's parts go, relative to its origin (the AXIS register). */
export interface ControlLayout {
  bits: Record<BitName, Place>;
  keys: Record<Direction, Cell>;
  /** What AXIS = 1 means. The other bit (H if 'vertical') is read through a NOT gate on AXIS's Inhibitor rail. */
  axisOne: 'vertical' | 'horizontal';
  /**
   * How the AXIS = 1 bit's read source fires only when AXIS = 1: fired by AXIS's register or one of its
   * restore relays, or ('zero-minus') a NOT gate on the other bit's read-minus Inhibitor (which fires
   * when AXIS = 0), then a +1 line from the clock.
   */
  trigger: 'register' | 'restore-1' | 'restore-2' | 'zero-minus';
  /** Where the unit's neurons may go: per row, the columns [from, to]. */
  area: Record<number, [number, number]>;
  /** Fixed cells for the strobes (default: next to the neurons that drive them). */
  strobes?: Record<Direction, Cell>;
  /** Cells of the ports (default: the unit's own power and clock Timers serve as ports). */
  ports?: { power: Cell; clock: Cell };
}

/** The layout the snake uses: see buildControl() for the picture. */
export const CONTROL_LAYOUT: ControlLayout = {
  bits: {
    axis: { x0: 0, y0: -2, sx: 1, t: true },
    h: { x0: -5, y0: -3, sx: -1, t: true },
    v: { x0: -4, y0: -3, sx: 1, sy: -1 },
  },
  keys: { left: { x: 1, y: -4 }, up: { x: 2, y: -4 }, down: { x: 3, y: -4 }, right: { x: 4, y: -4 } },
  axisOne: 'horizontal',
  trigger: 'zero-minus',
  area: { [-7]: [-10, 3], [-6]: [-10, 4], [-5]: [-10, 4], [-4]: [-10, 5], [-3]: [-10, 5], [-2]: [-10, 5], [-1]: [-10, 5], 0: [-10, 4], 1: [-10, 4], 2: [-10, 3] },
  ports: { power: { x: -9, y: -4 }, clock: { x: -9, y: -6 } },
};

export interface ControlOptions {
  /** Frame period in ticks (the frame Timer's interval). */
  F: number;
  /** Prefix for every neuron id (default 'ctl'). */
  prefix?: string;
  /** Default CONTROL_LAYOUT. */
  layout?: ControlLayout;
}

/**
 * Build the control unit. `origin` is the cell of the AXIS register (G of
 * the AXIS bit); every other part is placed relative to it by the layout.
 *
 * Why three bits. A key writes AXIS and its own axis's bit (◀ ▶: AXIS =
 * horizontal and H; ▲ ▼: AXIS = vertical and V), and each bit is a hole-gate
 * flip-flop that takes only real changes. Two keys pressed close together
 * can lose or reorder a change on a bit they both write; with AXIS + H + V
 * the bits a key writes always describe that key, so whichever changes
 * survive, the register holds a key that was pressed (or the direction it
 * had): never a third direction. (With two bits, LEFT and DOWN pressed on
 * one tick while moving RIGHT could leave UP.) The unit starts moving RIGHT.
 *
 * Read-out, every frame (ticks after the frame Timer's fire, CONTROL_LAYOUT):
 * - the clock reads AXIS (reads.axis = 59);
 * - V, the bit of AXIS = 0 (vertical), is read through a NOT gate: AXIS's
 *   Inhibitor rail (-1 when AXIS = 1) lands on V's read source one tick
 *   before a +1 line from the clock (reads.v = 141);
 * - H is read through a NOT gate on V's read-minus Inhibitor (which fires
 *   exactly when V is read), again one tick before a +1 line from the clock
 *   (reads.h = 180). (A layout may instead fire that bit's read source from
 *   AXIS's register or a restore relay, which fire only when AXIS = 1.)
 * - strobes, all at strobeOffset (238): L and U are relayed from H's and
 *   V's registers; R and D are NOT gates (the register's Inhibitor rail
 *   lands first, then a +1 line from the read source), so exactly one strobe
 *   fires, and every read-out neuron is back at 0 afterwards (restOffset).
 *
 * Key timing. A change counts at a register's read if a SET's +1 lands at or
 * before it, a RST's -1 strictly before (see buildBit). Measured against the
 * frame's AXIS read, the four keys' changes of one bit count within
 * Router.TOLERANCE (12) ticks of each other, so presses reach each bit in
 * the order they were made; and a key's own-bit change counts no later than
 * its AXIS change (else the frame between would show the other key of that
 * axis). No wire passes over a key, no other neuron sits next to one, and a
 * press at tick 0 reaches its gate after power-on has dug the hole.
 * buildControl checks all of it (checkKeyTiming).
 *
 * CONTROL_LAYOUT (x, y relative to the origin; 80 neurons, 109 connections):
 * A, H, V: the three bits (16 neurons each: flip-flop, register, read pair,
 * restore relays, rail); ◀ ▲ ▼ ▶ the keys; R L D U the strobes; C the frame
 * Timer (y=0) and the clock port (y=-6); O the power-on Timer (y=0) and the
 * power port (y=-4); relays: w key wires (7), r read lines (5), s strobe
 * lines (6), p power lines (2). The ports are Timers firing with the clock
 * and power-on, at the unit's left edge, for the other blocks to wire from.
 *
 *        x:  -9 -8 -7 -6 -5 -4 -3 -2 -1  0  1  2  3  4
 *   y=-7     .  .  .  .  .  w  .  s  s  .  .  .  .  .
 *   y=-6     C  .  .  .  .  V  V  U  w  w  w  .  .  .
 *   y=-5     .  .  .  .  w  V  V  p  w  .  .  .  .  .
 *   y=-4     O  .  .  .  .  V  V  V  V  .  ◀  ▲  ▼  ▶
 *   y=-3     .  H  H  H  H  V  V  V  V  .  .  .  .  .
 *   y=-2     .  H  H  H  H  H  V  V  V  A  A  A  A  w
 *   y=-1     .  .  .  H  H  H  H  V  A  A  A  A  A  .
 *   y= 0     .  .  L  H  H  H  C  A  A  A  A  O  .  .
 *   y= 1     .  .  s  .  s  R  D  p  A  A  A  .  .  .
 *   y= 2     .  .  .  s  s  r  r  r  r  r  .  .  .  .
 */
export function buildControl(b: NetworkBuilder, origin: Cell, opts: ControlOptions): ControlUnit {
  const F = opts.F;
  const pre = opts.prefix ?? 'ctl';
  const L = opts.layout ?? CONTROL_LAYOUT;
  const before = new Set(b.build().neurons.map((n) => n.id));
  const P = (c: Cell): Cell => ({ x: origin.x + c.x, y: origin.y + c.y });
  const bits = Object.fromEntries(BITS.map((n) => [n, buildBit(b, { ...L.bits[n], x0: origin.x + L.bits[n].x0, y0: origin.y + L.bits[n].y0 }, `${pre}-${n}`)])) as Record<BitName, BitIds>;
  const keys = {} as Record<Direction, string>;
  for (const d of ['left', 'up', 'down', 'right'] as const) keys[d] = b.normal(P(L.keys[d]).x, P(L.keys[d]).y, 1, { id: `${pre}-key-${d}`, label: KEY_LABELS[d] });
  const ports = L.ports && {
    power: b.timer(P(L.ports.power).x, P(L.ports.power).y, { id: `${pre}-power-port`, interval: 1, times: 1, label: 'ON' }),
    clock: b.timer(P(L.ports.clock).x, P(L.ports.clock).y, { id: `${pre}-clock-port`, interval: F / 60, label: 'CLK' }),
  };
  const area = Object.entries(L.area).flatMap(([y, [x0, x1]]) => Array.from({ length: x1 - x0 + 1 }, (_, i) => P({ x: x0 + i, y: Number(y) })));
  const keyCells = DIRECTIONS.map((d) => P(L.keys[d]));
  for (const c of [...b.build().neurons.filter((n) => !before.has(n.id))]) if (!area.some((a) => a.x === c.x && a.y === c.y)) throw new Error(`control: ${c.id} outside the area`);
  const router = new Router(b, area, keyCells);
  const cell = (id: string) => cellOf(b, id);
  const tt = (a: string, c: string) => travelTicks(cell(a), cell(c));
  /** The cheapest exact line from one of `starts` to `to` landing at `total`, or the earliest later tick up to `slack` more. */
  const line = (starts: Array<[string, number]>, to: string, total: number, name: string, slack = 0): { path: string[]; at: number } => {
    for (let t = total; t <= total + slack; t++) {
      const r = router.exact(starts.map(([id, t0]) => ({ cell: cell(id), t0 })), cell(to), t);
      if (r) return { path: router.build(starts[r.start]![0], r.relays, to, name), at: t };
    }
    throw new Error(`control: no line to ${to} at ${total}..${total + slack}`);
  };
  /** The free cell of the area nearest to `id` or one of `also` (Euclid, then row, then column), not next to a key. */
  const near = (id: string, ...also: string[]): Cell => nearest([id, ...also], Math.min);
  /** The free cell whose farthest distance to `ids` is least (then row, then column), not next to a key. */
  const nearest = (ids: string[], pick: (...v: number[]) => number = Math.max): Cell => {
    const used = new Set(b.build().neurons.map((n) => `${n.x},${n.y}`));
    const from = ids.map(cell);
    const d = (c: Cell) => pick(...from.map((f) => Math.hypot(f.x - c.x, f.y - c.y)));
    const free = area.filter((c) => !used.has(`${c.x},${c.y}`) && !keyCells.some((k) => Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y)) <= 1));
    free.sort((p, q) => d(p) - d(q) || p.y - q.y || p.x - q.x);
    if (!free.length) throw new Error('control: no room');
    return free[0]!;
  };
  const pair = (bit: BitIds) => tt(bit.readSource, bit.readPlus) + tt(bit.readPlus, bit.register);
  const rail = (bit: BitIds) => tt(bit.register, bit.registerMinus);
  const restore = (n: BitName, i: 1 | 2) => `${pre}-${n}-restore-${i}`;

  // Clock: next to AXIS's read source. AXIS is read every frame.
  const ck = near(bits.axis.readSource);
  const clock = b.timer(ck.x, ck.y, { id: `${pre}-clock`, interval: F / 60, label: 'CLK' });
  b.connect(clock, bits.axis.readSource);
  const readA = tt(clock, bits.axis.readSource) + pair(bits.axis);
  // The AXIS = 0 bit: a NOT gate on its read source (AXIS's -1 first, then the clock's +1 line).
  const zero: 'h' | 'v' = L.axisOne === 'vertical' ? 'h' : 'v';
  const one: 'h' | 'v' = zero === 'h' ? 'v' : 'h';
  b.connect(bits.axis.registerMinus, bits[zero].readSource);
  const inhibit = readA + rail(bits.axis) + tt(bits.axis.registerMinus, bits[zero].readSource);
  const zLine = line([[clock, 0]], bits[zero].readSource, inhibit + 1, `${pre}-${zero}-read`, 30);
  // The AXIS = 1 bit: fired by AXIS's register (or a restore relay), which fires only when AXIS = 1; or a
  // NOT gate on the other bit's read-minus Inhibitor (which fires only when AXIS = 0).
  let fireOne: number;
  if (L.trigger === 'zero-minus') {
    const zMinus = `${pre}-${zero}-read-minus`;
    b.connect(zMinus, bits[one].readSource);
    const inhibitOne = zLine.at + tt(bits[zero].readSource, zMinus) + tt(zMinus, bits[one].readSource);
    fireOne = line([[clock, 0]], bits[one].readSource, inhibitOne + 1, `${pre}-${one}-read`, 30).at;
  } else {
    const trig = L.trigger === 'register' ? bits.axis.register : restore('axis', L.trigger === 'restore-1' ? 1 : 2);
    b.connect(trig, bits[one].readSource);
    fireOne = readA + (trig === bits.axis.register ? 0 : tt(bits.axis.register, trig)) + tt(trig, bits[one].readSource);
  }
  const fires = { [zero]: zLine.at, [one]: fireOne } as Record<'h' | 'v', number>;
  const reads: Record<BitName, number> = { axis: readA, h: fires.h + pair(bits.h), v: fires.v + pair(bits.v) };

  // Power-on: the unit starts moving RIGHT. Each bit gets its first hole: at the RST gate for a bit that
  // starts at 0, at the SET gate for one that starts at 1 (AXIS, when AXIS = 1 means horizontal), which
  // also gets a +1 onto its register before the first read. Power sits next to AXIS's hole.
  const initial: Record<BitName, 0 | 1> = { axis: L.axisOne === 'horizontal' ? 1 : 0, h: 0, v: 0 };
  const hole = (n: BitName) => (initial[n] ? bits[n].setMinus : bits[n].resetMinus);
  const pw = initial.axis ? nearest([hole('axis'), bits.axis.register]) : near(hole('axis'));
  const power = b.timer(pw.x, pw.y, { id: `${pre}-power`, interval: 1, times: 1, label: 'ON' });
  const powerWiring = Object.fromEntries(BITS.map((n) => [n, line([[power, 0]], hole(n), tt(power, hole(n)), `${pre}-power-${n}`, 120).path])) as Record<BitName, string[]>;
  for (const n of BITS) {
    if (!initial[n]) continue;
    const r = router.within([{ cell: cell(power), t0: 0 }], cell(bits[n].register), tt(power, bits[n].register), reads[n] - 1);
    if (!r) throw new Error(`control: no power line to ${bits[n].register}`);
    router.build(power, r.relays, bits[n].register, `${pre}-power-${n}-g`);
  }
  const lags = bitLags(tt, bits, powerWiring);

  // Key wires. The writers of one bit count within Router.TOLERANCE ticks of each other (`counts`, against
  // the frame's AXIS read), so presses reach each bit in the order they were made; a key's own-bit change counts
  // no later than its AXIS change (else the frame between would show the other key of that axis).
  const KB = keyBits(L.axisOne);
  const wires = DIRECTIONS.flatMap((d) => KB[d].map((w) => ({ d, ...w, src: w.set ? bits[w.bit].setSource : bits[w.bit].resetSource })));
  type Wire = (typeof wires)[number];
  const landOf = (w: Wire) => (w.set ? lags[w.bit].counts.set : lags[w.bit].counts.reset) - (reads[w.bit] - reads.axis);
  const gateLag = (w: Wire) => (w.set ? lags[w.bit].setGate : lags[w.bit].resetGate);
  const TOL = Router.TOLERANCE;
  /** Route each wire with counts in [lo(w), hi(w)] (cheapest), or none (claims released). */
  const group = (ws: Wire[], lo: (w: Wire) => number, hi: (w: Wire) => number): Map<Wire, { relays: Cell[]; delay: number }> | undefined => {
    const got = new Map<Wire, { relays: Cell[]; delay: number }>();
    for (const w of ws) {
      const dLo = Math.max(lo(w) - landOf(w), lags[w.bit].hole - gateLag(w) + 1);
      const r = dLo <= hi(w) - landOf(w) ? router.within([{ cell: cell(keys[w.d]), t0: 0 }], cell(w.src), dLo, hi(w) - landOf(w)) : undefined;
      if (!r) {
        got.forEach((g) => router.release(g.relays));
        return undefined;
      }
      got.set(w, { relays: r.relays, delay: r.total });
    }
    return got;
  };
  const of = (bit: BitName) => wires.filter((w) => w.bit === bit);
  const lowest = (bit: BitName) => Math.min(...of(bit).map((w) => tt(keys[w.d], w.src) + landOf(w)));
  let routes: Map<Wire, { relays: Cell[]; delay: number }> | undefined;
  for (let cA = lowest('axis'); !routes; cA++) {
    if (cA > lowest('axis') + 200) throw new Error('control: no key wiring');
    const axis = group(of('axis'), () => cA, () => cA + TOL);
    if (!axis) continue;
    const axisCount = (d: Direction) => [...axis].find(([w]) => w.d === d)![1].delay + landOf(of('axis').find((w) => w.d === d)!);
    const own = (['h', 'v'] as const).map((bit) => {
      for (let c = lowest(bit); c <= Math.max(...of(bit).map((w) => axisCount(w.d))); c++) {
        const g = group(of(bit), () => c, (w) => Math.min(c + TOL, axisCount(w.d)));
        if (g) return g;
      }
      return undefined;
    });
    if (own.every(Boolean)) routes = new Map([...axis, ...own[0]!, ...own[1]!]);
    else {
      own.forEach((g) => g?.forEach((r) => router.release(r.relays)));
      axis.forEach((r) => router.release(r.relays));
    }
  }
  const paths = new Map(wires.map((w) => [w, router.build(keys[w.d], routes!.get(w)!.relays, w.src, `${pre}-wire-${w.d}-${w.bit}`)]));
  const wiring = Object.fromEntries(DIRECTIONS.map((d) => [d, wires.filter((w) => w.d === d).map((w) => ({ bit: w.bit, set: w.set, path: paths.get(w)! }))])) as Record<Direction, [KeyWire, KeyWire]>;
  return finishControl({ axisOne: L.axisOne, initial, b, pre, F, bits, keys, clock, power, reads, ports: ports ?? { power, clock }, strobeCells: L.strobes && (Object.fromEntries(DIRECTIONS.map((d) => [d, P(L.strobes![d])])) as Record<Direction, Cell>), wiring, powerWiring, before, line, near, tt, rail, restore, fires, router });
}

interface Built {
  axisOne: 'vertical' | 'horizontal';
  initial: Record<BitName, 0 | 1>;
  b: NetworkBuilder;
  pre: string;
  F: number;
  bits: Record<BitName, BitIds>;
  keys: Record<Direction, string>;
  clock: string;
  power: string;
  reads: Record<BitName, number>;
  ports: { power: string; clock: string };
  strobeCells?: Record<Direction, Cell>;
  wiring: Record<Direction, [KeyWire, KeyWire]>;
  powerWiring: Record<BitName, string[]>;
  before: Set<string>;
  line: (starts: Array<[string, number]>, to: string, total: number, name: string, slack?: number) => { path: string[]; at: number };
  near: (id: string, ...also: string[]) => Cell;
  tt: (a: string, c: string) => number;
  rail: (bit: BitIds) => number;
  restore: (n: BitName, i: 1 | 2) => string;
  /** When H's and V's read sources fire (when they do). */
  fires: Record<'h' | 'v', number>;
  router: Router;
}

/** The strobes (all at one tick S, the earliest at which every line exists and both NOT gates' -1 land first), then checks. */
function finishControl(s: Built): ControlUnit {
  const { b, pre, bits, reads, tt, rail, restore, router } = s;
  const LABELS: Record<Direction, string> = { right: 'R', left: 'L', down: 'D', up: 'U' };
  const at: Record<Direction, Cell> = {} as Record<Direction, Cell>;
  const strobes = {} as Record<Direction, string>;
  const place = (d: Direction, c: Cell) => {
    at[d] = c;
    strobes[d] = b.normal(c.x, c.y, 1, { id: `${pre}-${d}`, label: LABELS[d] });
  };
  const fixed = s.strobeCells;
  place('right', fixed?.right ?? s.near(bits.h.registerMinus));
  place('down', fixed?.down ?? s.near(bits.v.registerMinus));
  place('left', fixed?.left ?? s.near(bits.h.register, restore('h', 1), restore('h', 2)));
  place('up', fixed?.up ?? s.near(bits.v.register, restore('v', 1), restore('v', 2)));
  b.connect(bits.h.registerMinus, strobes.right).connect(bits.v.registerMinus, strobes.down);
  const inhibitR = reads.h + rail(bits.h) + tt(bits.h.registerMinus, strobes.right);
  const inhibitD = reads.v + rail(bits.v) + tt(bits.v.registerMinus, strobes.down);
  const fromG = (n: BitName): Array<[string, number]> => [
    [bits[n].register, reads[n]],
    [restore(n, 1), reads[n] + tt(bits[n].register, restore(n, 1))],
    [restore(n, 2), reads[n] + tt(bits[n].register, restore(n, 2))],
  ];
  const fromSource = (n: BitName, fire: number): Array<[string, number]> => [
    [bits[n].readSource, fire],
    [bits[n].readPlus, fire + tt(bits[n].readSource, bits[n].readPlus)],
  ];
  const lines: Array<[Direction, Array<[string, number]>]> = [
    ['right', fromSource('h', s.fires.h)],
    ['down', fromSource('v', s.fires.v)],
    ['left', fromG('h')],
    ['up', fromG('v')],
  ];
  const cellOfId = (id: string) => cellOf(b, id);
  let S = Math.max(inhibitR, inhibitD) + 1;
  for (; ; S++) {
    if (S > inhibitR + 200) throw new Error('control: no strobe tick');
    const ok = lines.every(([d, starts]) => router.exact(starts.map(([id, t0]) => ({ cell: cellOfId(id), t0 })), at[d], S));
    router.release();
    if (ok) break;
  }
  for (const [d, starts] of lines) s.line(starts, strobes[d], S, `${pre}-${d}-line`);
  // A NOT strobe's -1 must land after the frame before's +1, and a register be restored before its next read.
  const minF = Math.max(S - Math.min(inhibitR, inhibitD) + 1, ...BITS.map((n) => 2 * tt(bits[n].register, restore(n, 2)) + 1));
  if (s.F < minF) throw new Error(`control: F = ${s.F} is shorter than the read-out's ${minF} ticks`);
  const restOffset = Math.max(S, ...BITS.map((n) => reads[n] + 2 * tt(bits[n].register, restore(n, 2)))) + 1;
  const ids = b.build().neurons.map((n) => n.id).filter((id) => !s.before.has(id));
  const unit: ControlUnit = { minF, axisOne: s.axisOne, initial: s.initial, keys: s.keys, wiring: s.wiring, strobes, clock: s.clock, power: s.power, bits, F: s.F, reads, readOffset: reads.axis, strobeOffset: S, ports: s.ports, restOffset, ids, powerWiring: s.powerWiring };
  checkKeyTiming(tt, unit);
  checkKeyClearance(b, unit);
  return unit;
}

const cellOf = (b: NetworkBuilder, id: string): Cell => {
  const n = b.build().neurons.find((m) => m.id === id);
  if (!n) throw new Error(`control: no neuron ${id}`);
  return { x: n.x, y: n.y };
};

/** Each bit's timing, from the cells: source to gate, change to counted (a RST one tick later: strictly before the read), power-on's hole. */
function bitLags(tt: (a: string, c: string) => number, bits: Record<BitName, BitIds>, powerWiring: Record<BitName, string[]>) {
  const ticks = (path: string[]) => path.slice(1).reduce((s, id, i) => s + tt(path[i]!, id), 0);
  return Object.fromEntries(BITS.map((n) => {
    const ids = bits[n];
    const name = ids.register.slice(0, -'-register'.length);
    /** Source to gate: the +1 and -1 halves of the pair arrive together. */
    const gateLag = (src: string, gate: string, half: string) => tt(src, half) + tt(half, gate);
    const setGate = gateLag(ids.setSource, ids.setGate, `${name}-set-plus`);
    const resetGate = gateLag(ids.resetSource, ids.resetGate, `${name}-reset-plus`);
    if (setGate !== gateLag(ids.setSource, ids.setGate, `${name}-set-minus`) || resetGate !== gateLag(ids.resetSource, ids.resetGate, ids.resetMinus)) throw new Error('control: a press pair splits');
    const counts = { set: setGate + tt(ids.setGate, ids.register), reset: resetGate + tt(ids.resetGate, `${name}-reset-register`) + tt(`${name}-reset-register`, ids.register) + 1 };
    const minus = powerWiring[n].at(-1)!;
    const hole = 1 + ticks(powerWiring[n]) + tt(minus, minus === ids.setMinus ? ids.setGate : ids.resetGate);
    return [n, { setGate, resetGate, counts, hole }];
  })) as Record<BitName, { setGate: number; resetGate: number; counts: { set: number; reset: number }; hole: number }>;
}

/**
 * Key timing measured on the cells: per key wire, its delay (key to bit
 * input), when the press reaches the gate, and `counts`: ticks from the
 * press to the frame AXIS read from which its change counts.
 */
export function keyTiming(tt: (a: string, c: string) => number, ctl: Pick<ControlUnit, 'bits' | 'wiring' | 'reads' | 'powerWiring'>) {
  const lags = bitLags(tt, ctl.bits, ctl.powerWiring);
  const ticks = (path: string[]) => path.slice(1).reduce((s, id, i) => s + tt(path[i]!, id), 0);
  const keys = Object.fromEntries(DIRECTIONS.map((d) => [d, ctl.wiring[d].map((w) => {
    const l = lags[w.bit];
    const delay = ticks(w.path);
    return { ...w, delay, gate: delay + (w.set ? l.setGate : l.resetGate), counts: delay + (w.set ? l.counts.set : l.counts.reset) - (ctl.reads[w.bit] - ctl.reads.axis) };
  })])) as Record<Direction, Array<KeyWire & { delay: number; gate: number; counts: number }>>;
  return { lags, keys };
}

function checkKeyTiming(tt: (a: string, c: string) => number, ctl: ControlUnit): void {
  const { lags, keys } = keyTiming(tt, ctl);
  for (const bit of BITS) {
    const counts = DIRECTIONS.flatMap((d) => keys[d].filter((w) => w.bit === bit).map((w) => w.counts));
    if (Math.max(...counts) - Math.min(...counts) > Router.TOLERANCE) throw new Error(`control: the keys reach ${bit} too far apart: ${counts}`);
  }
  for (const d of DIRECTIONS) {
    const [axis, own] = keys[d];
    if (own!.counts > axis!.counts) throw new Error(`control: key ${d} changes ${own!.bit} after AXIS`);
    for (const w of keys[d]) if (w.gate <= lags[w.bit].hole) throw new Error(`control: a ${d} press at tick 0 reaches the ${w.bit} gate before power-on's hole`);
  }
  if (!(ctl.reads.h > ctl.reads.axis && ctl.reads.v > ctl.reads.axis)) throw new Error('control: H and V must be read after AXIS');
}

/** No neuron but a key next to a key (so nothing looks like a fifth button). */
function checkKeyClearance(b: NetworkBuilder, ctl: ControlUnit): void {
  const net = b.build().neurons;
  const keys = DIRECTIONS.map((d) => net.find((n) => n.id === ctl.keys[d])!);
  const isKey = new Set(Object.values(ctl.keys));
  const near = net.filter((n) => !isKey.has(n.id) && keys.some((k) => Math.max(Math.abs(k.x - n.x), Math.abs(k.y - n.y)) <= 1));
  if (near.length) throw new Error(`control: ${near.map((n) => n.id).join(', ')} next to a key`);
}

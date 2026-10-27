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
const at = (f: Place, x: number, y: number): Cell => ({ x: f.x0 + f.sx * x, y: f.y0 + (f.sy ?? 1) * y });

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

export interface ControlUnit {
  /** Key neurons (poke = press). */
  keys: Record<Direction, string>;
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
function findDelay(a: Cell, to: Cell, total: number, near: Cell, taken: (c: Cell) => boolean): Cell[] | undefined {
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

/**
 * Build the control unit with its top key (▲) at `origin`.
 *
 * Layout (cells relative to origin; the SIGN bit is the AXIS bit mirrored):
 *
 *     x: -5 ... -2  -1   0 ... 3
 *   y=0   SIGN       ▲   AXIS       keys sit between the two flip-flops:
 *   y=1   flip-      ◀   flip-      ▲ = SET both, ▶ = RST both,
 *   y=2   flop       ▼   flop       ◀ = RST AXIS + SET SIGN, ▼ = SET AXIS + RST SIGN
 *   y=3   + reg G    ▶   + reg G
 *   y=4             R
 *   y=5          D  K  L            decoder: K = strobe clock
 *   y=6          X2 U  X1           X1, X2 = cleanup Inhibitors
 *   y=8              T              frame Timer
 */
export function buildControl(b: NetworkBuilder, origin: Cell, opts: ControlOptions): ControlUnit {
  const F = opts.F;
  const pre = opts.prefix ?? 'ctl';
  const P = (x: number, y: number): Cell => ({ x: origin.x + x, y: origin.y + y });
  const axis = buildBit(b, { x0: origin.x, y0: origin.y + 3, sx: 1, sy: -1 }, `${pre}-axis`);
  const sign = buildBit(b, { x0: origin.x - 2, y0: origin.y + 3, sx: -1, sy: -1 }, `${pre}-sign`);

  const key = (d: Direction, label: string, y: number) => b.normal(P(-1, y).x, P(-1, y).y, 1, { id: `${pre}-key-${d}`, label });
  const keys: Record<Direction, string> = { up: key('up', '▲', 0), left: key('left', '◀', 1), down: key('down', '▼', 2), right: key('right', '▶', 3) };
  // AXIS: 1 = vertical. SIGN: 1 = negative (left/up).
  b.connect(keys.up, [axis.setSource, sign.setSource]);
  b.connect(keys.left, [axis.resetSource, sign.setSource]);
  b.connect(keys.down, [axis.setSource, sign.resetSource]);
  b.connect(keys.right, [axis.resetSource, sign.resetSource]);

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
  return { keys, strobes, clock, power, bits: { axis, sign }, F, readOffset, strobeOffset };
}

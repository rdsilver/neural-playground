import { NetworkBuilder, travelTicks } from '../engine';
import { at, findDelay, type Cell, type Place } from './snake-control';

/**
 * Ring counter of the Neural Snake: a one-hot register of n positions with
 * wrap-around (X: n = 10, Y: n = 8), used for the snake's head position.
 *
 * Design. Position j holds the token as charge 0 in three copies F_j, B_j,
 * R_j (threshold 1); an empty copy rests at -1. Power-on digs those holes.
 * - fwd is a broadcast pair: relay Pf sends +1 to every F_j and, through
 *   F_j's own Inhibitor MF_j (placed on the way), -1 right after it. Empty copies go -1, 0, -1. The
 *   holder goes 0, 1: it fires (resetting to 0) and the -1 leaves it at -1,
 *   empty: no restore needed. Firing, F_i hands the token (+1) to F_{i+1},
 *   B_{i+1}, R_{i+1} and clears its stale copies B_i, R_i (-1) through its
 *   Inhibitor IF_i.
 * - back mirrors it: Pb/MB_j, the B copies, i-1, Inhibitor IB_i.
 * - read is a broadcast pair Pr/Mr to every R_j. The holder fires (its line)
 *   and its relay RR_j gives the token back (+1) 30 ticks later.
 * A token must land on its new copy after that copy's own pair -1 (else it
 * fires twice). With each copy's -1 coming on the straight path from the
 * source, that holds by the triangle inequality wherever the cells are;
 * ringTiming() checks it, and every other timing fact, from the cells.
 */

export interface RingOptions {
  /** Number of positions. */
  n: number;
  /** Frame period in ticks. */
  F: number;
  /** Prefix for every neuron id. */
  prefix: string;
  /** Position the power-on pulse puts the token at (default 0). */
  start?: number;
}

export interface Ring {
  /** Fire at t_k to move the token one position forward (+1 mod n). */
  fwd: string;
  /** Fire at t_k to move the token one position back (-1 mod n). */
  back: string;
  /** Fire every frame at t_k + readLag. */
  read: string;
  /** Fire once, at least a frame before the first move or read. */
  power: string;
  /** Exactly one fires per frame: lines[pos] at t_k + readLag + lineDelay[pos]. */
  lines: string[];
  readLag: number;
  lineDelay: number[];
  /** At t_k + settle every neuron of the block is at rest (restFor) until the read lands. */
  settle: number;
  /** Resting charge of every neuron of the block with the token at `position`. */
  restFor(position: number): Record<string, number>;
  /** Smallest frame period this layout supports. */
  minF: number;
  /** Copy neurons per position: f, b, r (for tests and probes). */
  copies: { f: string[]; b: string[]; r: string[] };
}

export function buildRing(b: NetworkBuilder, place: Place, opts: RingOptions): Ring {
  const { n, F, prefix } = opts;
  const start = opts.start ?? 0;
  const L = ringLayout(n);
  const T = ringTiming(n, L);
  if (F < T.minF) throw new Error(`ring ${prefix}: F=${F} is below this layout's minimum ${T.minF}`);
  const id = (role: string) => `${prefix}-${role}`;
  const cell = (role: string) => at(place, L.cells.get(role)!.x, L.cells.get(role)!.y);
  const labels: Record<string, string> = { fwd: 'FWD', back: 'BACK', read: 'READ', power: 'ON' };
  for (const role of L.cells.keys()) {
    const { x, y } = cell(role);
    const label = labels[role] ?? (/^l\d+$/.test(role) ? role.slice(1) : undefined);
    const o = { id: id(role), ...(label ? { label } : {}) };
    if (/^(rm|power|(if|ib|mf|mb)\d+)$/.test(role)) b.inhibitor(x, y, 1, { label: '−1', ...o });
    else b.normal(x, y, 1, o);
  }
  const ring = (s: string) => Array.from({ length: n }, (_, j) => id(`${s}${j}`));
  const [f, bk, r, rr, inf, inb, mf, mb] = ['f', 'b', 'r', 'rr', 'if', 'ib', 'mf', 'mb'].map(ring) as [string[], string[], string[], string[], string[], string[], string[], string[]];
  b.connect(id('read'), [id('rm'), ...r]).connect(id('rm'), r);
  for (let j = 0; j < n; j++) {
    b.connect(id('fwd'), [f[j]!, mf[j]!]).connect(mf[j]!, f[j]!);
    b.connect(id('back'), [bk[j]!, mb[j]!]).connect(mb[j]!, bk[j]!);
  }
  for (let j = 0; j < n; j++) {
    const nx = (j + 1) % n;
    const pv = (j + n - 1) % n;
    b.connect(f[j]!, [f[nx]!, bk[nx]!, r[nx]!, inf[j]!]).connect(inf[j]!, [bk[j]!, r[j]!]);
    b.connect(bk[j]!, [f[pv]!, bk[pv]!, r[pv]!, inb[j]!]).connect(inb[j]!, [f[j]!, r[j]!]);
    b.connect(r[j]!, rr[j]!).connect(rr[j]!, r[j]!);
    b.chain([r[j]!, ...L.lineRelays[j]!.map(id), id(`l${j}`)]);
    if (j !== start) b.connect(id('power'), [f[j]!, bk[j]!, r[j]!]);
  }
  const all = [...L.cells.keys()].map(id);
  const restFor = (pos: number) => {
    const rest: Record<string, number> = Object.fromEntries(all.map((x) => [x, 0]));
    for (let j = 0; j < n; j++) if (j !== pos) rest[f[j]!] = rest[bk[j]!] = rest[r[j]!] = -1;
    return rest;
  };
  return {
    fwd: id('fwd'), back: id('back'), read: id('read'), power: id('power'),
    lines: ring('l'), readLag: T.readLag, lineDelay: Array<number>(n).fill(T.lineDelay), settle: T.settle, restFor, minF: T.minF,
    copies: { f, b: bk, r },
  };
}

// ---- layout ------------------------------------------------------------------

interface RingLayout {
  /** Local cell of every neuron, by role (fwd, fm, f3, ib7, d2.0, l2, ...). */
  cells: Map<string, Cell>;
  /** Roles of the relays between R_j and its line L_j. */
  lineRelays: string[][];
  /** Ticks from the read source firing to every line. */
  lineDelay: number;
}

const tt = (a: Cell, b: Cell) => travelTicks(a, b);
const ck = (c: Cell) => `${c.x},${c.y}`;

/** Radius of the circle of clusters (cells from the read source). */
export const ringRadius = (n: number) => n / 2;

/**
 * Local layout (y down, read source at the origin). Every cluster is the
 * same horizontal triple F_j R_j B_j, and the sources sit in the same order
 * Pf Pr Pb, so each copy is its source translated by the same vector: all
 * three broadcasts reach a cluster on the same tick, and R_j is exactly as
 * far from F_{j-1} as from B_{j+1} (its two token sources). The clusters
 * stand on a circle (lattice points of one travel time where possible), fwd
 * turning clockwise from the top; IF_j RR_j IB_j are a row just outside the
 * cluster, the local Inhibitors MF_j, MB_j just inside, on the way from the
 * source. The lines are a row under everything.
 *
 *   centre:     Mr            cluster (upper half):  IF RR IB
 *            Pf Pr Pb                                F  R  B
 *               ON                                   (MF, MB inside)
 */
export function ringLayout(n: number): RingLayout {
  const cells = new Map<string, Cell>();
  const taken = (c: Cell) => [...cells.values()].some((q) => q.x === c.x && q.y === c.y);
  const add = (role: string, c: Cell) => {
    if (taken(c)) throw new Error(`ring layout: cell ${ck(c)} taken (${role})`);
    cells.set(role, c);
  };
  add('read', { x: 0, y: 0 });
  add('fwd', { x: -1, y: 0 });
  add('back', { x: 1, y: 0 });
  add('rm', { x: 0, y: -1 });
  add('power', { x: 0, y: 1 });
  const at0 = (role: string) => cells.get(role)!;
  const rho = ringRadius(n);
  const side: number[] = [];
  for (let j = 0; j < n; j++) {
    const th = -Math.PI / 2 + (2 * Math.PI * j) / n;
    const o = Math.sin(th) < -1e-9 || (Math.abs(Math.sin(th)) < 1e-9 && Math.cos(th) > 0) ? -1 : 1; // helper row: above in the upper half
    const ideal = { x: rho * Math.cos(th), y: rho * Math.sin(th) };
    let best: Cell | undefined;
    let bestScore = Infinity;
    for (let x = Math.round(ideal.x) - 1; x <= Math.round(ideal.x) + 1; x++)
      for (let y = Math.round(ideal.y) - 1; y <= Math.round(ideal.y) + 1; y++) {
        const need = [-1, 0, 1].flatMap((dx) => [{ x: x + dx, y }, { x: x + dx, y: y + o }]);
        if (need.some(taken) || need.some((c) => Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1)) continue;
        const score = Math.hypot(x - ideal.x, y - ideal.y);
        if (score < bestScore) [best, bestScore] = [{ x, y }, score];
      }
    const r = best!;
    add(`f${j}`, { x: r.x - 1, y: r.y });
    add(`r${j}`, r);
    add(`b${j}`, { x: r.x + 1, y: r.y });
    add(`if${j}`, { x: r.x - 1, y: r.y + o });
    add(`rr${j}`, { x: r.x, y: r.y + o });
    add(`ib${j}`, { x: r.x + 1, y: r.y + o });
    side.push(o);
  }
  /** The free cell within `reach` of `ideal` with the lowest score. */
  const pick = (ideal: { x: number; y: number }, score: (c: Cell) => number, reach = 1.5): Cell => {
    let best: Cell | undefined;
    let bestScore = Infinity;
    for (let x = Math.floor(ideal.x - reach); x <= Math.ceil(ideal.x + reach); x++)
      for (let y = Math.floor(ideal.y - reach); y <= Math.ceil(ideal.y + reach); y++) {
        const c = { x, y };
        if (Math.hypot(x - ideal.x, y - ideal.y) > reach || taken(c)) continue;
        const sc = score(c) + Math.hypot(x - ideal.x, y - ideal.y);
        if (sc < bestScore) [best, bestScore] = [c, sc];
      }
    if (!best) throw new Error('ring layout: no free cell');
    return best;
  };

  // Local pair Inhibitors MF_j, MB_j: on the way from the source to the copy,
  // so the -1 lands right after the +1 (ideally on the same tick).
  for (let j = 0; j < n; j++)
    for (const [s, src] of [['f', 'fwd'], ['b', 'back']] as const) {
      const [P, X] = [at0(src), at0(`${s}${j}`)];
      const u = Math.hypot(X.x - P.x, X.y - P.y);
      add(`m${s}${j}`, pick({ x: X.x - (X.x - P.x) / u, y: X.y - (X.y - P.y) / u }, (c) => 10 * (tt(P, c) + tt(c, X) - tt(P, X)), 2.5));
    }

  // Lines: a row under the loop, in order, one cell apart. Each R_j drives
  // L_j through 1-3 relays so that every line fires the same number of ticks
  // after the read source.
  const yLine = Math.max(...[...cells.values()].map((c) => c.y)) + 2;
  const x0 = -Math.floor((n - 1) / 2);
  const lines = Array.from({ length: n }, (_, j) => ({ x: x0 + j, y: yLine }));
  const rA = (j: number) => tt(at0('read'), at0(`r${j}`));
  let lineDelay = Math.max(...lines.map((l, j) => rA(j) + tt(at0(`r${j}`), l)));
  for (;; lineDelay++) {
    const trial = new Map(cells);
    const relays: string[][] = [];
    const busy = (c: Cell) => [...trial.values()].some((q) => q.x === c.x && q.y === c.y) || lines.some((l) => l.x === c.x && l.y === c.y);
    const ok = lines.every((l, j) => {
      const R = at0(`r${j}`);
      const path = findDelay(R, l, lineDelay - rA(j), { x: Math.round((R.x + l.x) / 2), y: Math.round((R.y + l.y) / 2) }, busy);
      if (!path) return false;
      relays.push(path.map((c, k) => (trial.set(`d${j}.${k}`, c), `d${j}.${k}`)));
      return true;
    });
    if (!ok) continue;
    lines.forEach((l, j) => trial.set(`l${j}`, l));
    return { cells: trial, lineRelays: relays, lineDelay };
  }
}

/** Arrivals on R_j caused by any move (tokens from F_{j-1}, B_{j+1}; clears via IF_j, IB_j). */
export function arrivalsOnR(n: number, cells: Map<string, Cell>, j: number): number[] {
  const c = (role: string) => cells.get(role)!;
  const pv = (j + n - 1) % n;
  const nx = (j + 1) % n;
  const R = c(`r${j}`);
  return [
    tt(c('fwd'), c(`f${pv}`)) + tt(c(`f${pv}`), R),
    tt(c('back'), c(`b${nx}`)) + tt(c(`b${nx}`), R),
    tt(c('fwd'), c(`f${j}`)) + tt(c(`f${j}`), c(`if${j}`)) + tt(c(`if${j}`), R),
    tt(c('back'), c(`b${j}`)) + tt(c(`b${j}`), c(`ib${j}`)) + tt(c(`ib${j}`), R),
  ];
}

// ---- timing ------------------------------------------------------------------

interface RingTiming {
  readLag: number;
  lineDelay: number;
  settle: number;
  minF: number;
}

/**
 * Every timing fact of the layout, relative to t_k (the tick fwd/back fires),
 * derived from cell distances. Throws if a token could land inside its
 * destination's pair gap or a restore before its read -1.
 *
 * The settled moment t_k + settle comes after every arrival a move causes and
 * before the read: all copies then hold the new position. The read follows at
 * once; it must be over on each R copy before the next move reaches it, and
 * each F/B copy must have seen this move's last arrival before the next pair
 * (these two bound the frame period: minF).
 */
export function ringTiming(n: number, L: RingLayout): RingTiming {
  const c = (role: string) => L.cells.get(role)!;
  const t = (a: string, z: string) => tt(c(a), c(z));
  const mod = (j: number) => (j + n) % n;
  let minF = 0;
  let settle = 0;
  // F and B copies: type s is broadcast by src (+1) and minus (-1); its token moves by step.
  for (const [s, src, step, o, osrc, oinh] of [
    ['f', 'fwd', 1, 'b', 'back', 'ib'],
    ['b', 'back', -1, 'f', 'fwd', 'if'],
  ] as const) {
    for (let j = 0; j < n; j++) {
      const from = mod(j - step);
      const oFrom = mod(j + step);
      const pair = t(src, `${s}${j}`);
      const pairMinus = t(src, `m${s}${j}`) + t(`m${s}${j}`, `${s}${j}`);
      const token = t(src, `${s}${from}`) + t(`${s}${from}`, `${s}${j}`);
      if (token < pairMinus) throw new Error(`ring: token lands on ${s}${j} inside its pair gap`);
      // Own pair -1, own-type token, other-type token, other-type stale clear.
      const otherToken = t(osrc, `${o}${oFrom}`) + t(`${o}${oFrom}`, `${s}${j}`);
      const clear = t(osrc, `${o}${j}`) + t(`${o}${j}`, `${oinh}${j}`) + t(`${oinh}${j}`, `${s}${j}`);
      const last = Math.max(pairMinus, token, otherToken, clear);
      minF = Math.max(minF, last - pair + 1);
      settle = Math.max(settle, last);
    }
  }
  // R copies: a move's arrivals (tokens, clears), then the read (+1, -1, restore).
  const S = Array.from({ length: n }, (_, j) => arrivalsOnR(n, L.cells, j));
  const rA = Array.from({ length: n }, (_, j) => t('read', `r${j}`));
  settle = Math.max(settle, ...S.flat());
  const readLag = settle + 1 - Math.min(...rA);
  for (let j = 0; j < n; j++) {
    const minus = t('read', 'rm') + t('rm', `r${j}`);
    const restore = rA[j]! + 2 * t(`r${j}`, `rr${j}`);
    if (restore < minus) throw new Error(`ring: restore of r${j} lands before the read -1`);
    minF = Math.max(minF, readLag + Math.max(minus, restore) - Math.min(...S[j]!) + 1);
  }
  return { readLag, lineDelay: L.lineDelay, settle, minF };
}

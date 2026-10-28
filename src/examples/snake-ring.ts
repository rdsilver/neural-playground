import { NetworkBuilder, travelTicks } from '../engine';
import { at, type Cell, type Place } from './snake-control';

/**
 * Ring counter of the Neural Snake: a one-hot register of n positions with
 * wrap-around (X: n = 10, Y: n = 8), used for the snake's head position.
 *
 * Design. Position j holds the token as charge 0 in three copies F_j, B_j,
 * R_j (threshold 1); an empty copy rests at -1. Power-on digs those holes.
 * - fwd is a broadcast pair: relay Pf sends +1 to every F_j and, through
 *   F_j's own Inhibitor MF_j (placed on the way), -1 right after it. Empty
 *   copies go -1, 0, -1. The holder goes 0, 1: it fires (resetting to 0)
 *   and the -1 leaves it at -1, empty: no restore needed. Firing, F_i hands
 *   the token (+1) to F_{i+1}, B_{i+1}, R_{i+1} and clears its stale copies
 *   B_i, R_i (-1) through its Inhibitor IF_i.
 * - back mirrors it: Pb/MB_j, the B copies, i-1, Inhibitor IB_i.
 * - read is a broadcast pair Pr/Mr to every R_j. The holder fires (its line)
 *   and its relay RR_j gives the token back (+1) 30 ticks later.
 * A token must land on its new copy after that copy's own pair -1 (else it
 * fires twice). With each copy's -1 coming on the straight path from the
 * source, that holds by the triangle inequality wherever the cells are;
 * ringTiming() checks it, and every other timing fact, from the cells
 * (same-tick arrivals by creation order, the order the engine lands them).
 *
 * Frame schedule, ticks after t_k (fwd or back fires; a hold frame skips the
 * move rows). Asserted in snake-ring.test.ts.
 *
 *   event                                          n = 8      n = 10
 *   pair +1 then -1 on every F_j (or B_j)          60-64      75-81    holder fires
 *   tokens and stale clears land                   ..141      ..152
 *   settled moment: all at rest (restFor)          141        152      settle
 *   read fires                                     82         78       readLag
 *   read +1 on every R_j, holder fires             142-146    153-159
 *   holder's restore lands                         172-176    183-189
 *   line fires (default; lineAt can delay it)      343        385      readLag + lineDelay
 *   line j fires, fastLines (RR_j, 15 after R_j)   157-161    168-174  readLag + lineDelay[j]
 *     (n = 8: even j 157, odd j 161; n = 10: j = 2, 3, 7, 8 at 174, the others 168)
 *   the read may fire instead at r, any of         66..F+4    62..F+4  readEarliest..readLatest
 *     (each frame its own r; every row from the read on shifts by r - readLag;
 *      the settled-moment row holds for reads at readLag)
 *   fastest: fastLines, read at readEarliest       141-145    152-158
 *   smallest frame period                          82         78       minF
 *   power fires at least this long before t_0      21         22       powerLead
 *
 * Moves and reads of consecutive frames overlap when F is short (a frame's
 * copy events span ticks 60..176 after t_k for n = 8, 75..189 for n = 10);
 * the cells keep them apart, which is what minF checks. minF, the read window
 * and powerLead are exact: one tick beyond each breaks a tested scenario.
 * Lines are relays that never interact, so their pulses may be in flight
 * across frames.
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
  /**
   * Ticks after t_k at which the lines should fire (default: as early as
   * possible). Lets the X and Y rings fire their lines on the same tick.
   */
  lineAt?: number;
  /** Swap local x and y before `place`: the line row becomes a column. */
  transpose?: boolean;
  /**
   * Cut latency: lines[j] is R_j's restore relay RR_j (the cell next to R_j,
   * in the cluster's outer row), so it fires 15 ticks after R_j, about 200
   * ticks sooner than the line row. No line row is built; lineDelay differs
   * per position (see the schedule). Not combinable with lineAt.
   */
  fastLines?: boolean;
}

export interface Ring {
  /** Fire at t_k to move the token one position forward (+1 mod n). At most one of fwd/back per frame. */
  fwd: string;
  /** Fire at t_k to move the token one position back (-1 mod n). */
  back: string;
  /**
   * Fire every frame at t_k + readLag; or at t_k + r for any r in
   * [readEarliest, readLatest], which may differ from frame to frame.
   */
  read: string;
  /**
   * Fire once, at least powerLead ticks before t_0, the tick of the first
   * frame's move (or of its hold: its read comes at t_0 + readLag).
   */
  power: string;
  /** Smallest tick gap from power to t_0 (exact: one tick less fails). */
  powerLead: number;
  /** Exactly one fires per frame: lines[pos] at t_k + r + lineDelay[pos] (r = readLag by default). */
  lines: string[];
  readLag: number;
  /** Earliest read offset: the read's +1 lands on every R_j after the move's arrivals. */
  readEarliest: number;
  /** Latest read offset (F + a layout constant): it is done before the next frame's arrivals. */
  readLatest: number;
  /** Per position; all equal unless fastLines. */
  lineDelay: number[];
  /** At t_k + settle every neuron of the block is at rest (restFor) until the read lands (reads at readLag). */
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
  const fast = opts.fastLines ?? false;
  if (fast && opts.lineAt !== undefined) throw new Error(`ring ${prefix}: lineAt needs the line row (no fastLines)`);
  const L = ringLayout(n);
  const T = ringTiming(n, L);
  const tt0 = (a: string, z: string) => tt(L.cells.get(a)!, L.cells.get(z)!);
  // fastLines: line j = RR_j, which fires tt(R_j, RR_j) after R_j fires.
  const lineDelay = fast
    ? Array.from({ length: n }, (_, j) => tt0('read', `r${j}`) + tt0(`r${j}`, `rr${j}`))
    : Array<number>(n).fill(addLines(n, L, (opts.lineAt ?? 0) - T.readLag));
  if (opts.lineAt !== undefined && T.readLag + lineDelay[0]! !== opts.lineAt) throw new Error(`ring ${prefix}: lines cannot fire at ${opts.lineAt}`);
  if (F < T.minF) throw new Error(`ring ${prefix}: F=${F} is below this layout's minimum ${T.minF}`);
  const id = (role: string) => `${prefix}-${role}`;
  const cell = (role: string) => {
    const c = L.cells.get(role)!;
    return opts.transpose ? at(place, c.y, c.x) : at(place, c.x, c.y);
  };
  const labels: Record<string, string> = { fwd: 'FWD', back: 'BACK', read: 'READ', power: 'ON' };
  const lineRole = fast ? /^rr(\d+)$/ : /^l(\d+)$/; // the line neurons are labelled with their position
  for (const role of L.cells.keys()) {
    const { x, y } = cell(role);
    const label = labels[role] ?? role.match(lineRole)?.[1];
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
    if (!fast) b.chain([r[j]!, ...L.lineRelays[j]!.map(id), id(`l${j}`)]);
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
    powerLead: powerLeadFor(n, L.cells, start, T.readEarliest),
    readEarliest: T.readEarliest, readLatest: F + T.readSlack,
    lines: fast ? rr : ring('l'), readLag: T.readLag, lineDelay, settle: T.settle, restFor, minF: T.minF,
    copies: { f, b: bk, r },
  };
}

// ---- layout ------------------------------------------------------------------

interface RingLayout {
  /** Local cell of every neuron, by role (fwd, fm, f3, ib7, d2.0, l2, ...). */
  cells: Map<string, Cell>;
  /** Roles of the relays between R_j and its line L_j (set by addLines). */
  lineRelays: string[][];
}

const tt = (a: Cell, b: Cell) => travelTicks(a, b);
const ck = (c: Cell) => `${c.x},${c.y}`;

/** Radius of the circle of clusters (cells from the read source). */
const ringRadius = (n: number) => n / 2;

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
function ringLayout(n: number): RingLayout {
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

  return { cells, lineRelays: [] };
}

/**
 * Lines: a row under the loop, in order, one cell apart. Each R_j drives L_j
 * through one or two relays (outside the loop, above the line row) so that
 * every line fires the same number of ticks after the read source: the
 * smallest such number that is at least `atLeast`. Returns it.
 */
function addLines(n: number, L: RingLayout, atLeast: number): number {
  const { cells } = L;
  const at0 = (role: string) => cells.get(role)!;
  const all = [...cells.values()];
  const box = { x0: Math.min(...all.map((c) => c.x)), x1: Math.max(...all.map((c) => c.x)), y0: Math.min(...all.map((c) => c.y)), y1: Math.max(...all.map((c) => c.y)) };
  const yLine = box.y1 + 3;
  const x0 = -Math.floor((n - 1) / 2);
  const lines = Array.from({ length: n }, (_, j) => ({ x: x0 + j, y: yLine }));
  const region: Cell[] = [];
  for (let x = box.x0 - 3; x <= box.x1 + 3; x++)
    for (let y = box.y0 - 1; y < yLine; y++) if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) region.push({ x, y });
  const rA = (j: number) => tt(at0('read'), at0(`r${j}`));
  for (let lineDelay = Math.max(atLeast, ...lines.map((l, j) => rA(j) + tt(at0(`r${j}`), l))); ; lineDelay++) {
    const used = new Set<string>();
    const paths = lines.map((l, j) => {
      const path = relayPath(at0(`r${j}`), l, lineDelay - rA(j), region.filter((c) => !used.has(ck(c))));
      path?.forEach((c) => used.add(ck(c)));
      return path;
    });
    if (paths.some((q) => !q)) continue;
    L.lineRelays = paths.map((q, j) => q!.map((c, k) => (cells.set(`d${j}.${k}`, c), `d${j}.${k}`)));
    lines.forEach((l, j) => cells.set(`l${j}`, l));
    return lineDelay;
  }
}

/**
 * Cells of one or two relays leading from `a` to `z` in exactly `ticks`,
 * from `free`, staying as close as possible to the straight line a-z.
 */
function relayPath(a: Cell, z: Cell, ticks: number, free: Cell[]): Cell[] | undefined {
  const off = (c: Cell) => {
    const [dx, dy] = [z.x - a.x, z.y - a.y];
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(c.x - a.x - t * dx, c.y - a.y - t * dy);
  };
  let best: Cell[] | undefined;
  let bestScore = Infinity;
  for (const c of free) if (tt(a, c) + tt(c, z) === ticks && off(c) < bestScore) [best, bestScore] = [[c], off(c)];
  if (best) return best;
  for (const c of free) {
    const rest = ticks - tt(a, c);
    if (rest <= 0) continue;
    for (const d of free) {
      if (d === c || tt(c, d) + tt(d, z) !== rest) continue;
      const score = off(c) + off(d);
      if (score < bestScore) [best, bestScore] = [[c, d], score];
    }
  }
  return best;
}

/** A pulse landing on a cell: [arrival tick, creation tick]. */
type Hit = [number, number];

/**
 * Smallest shift d (ticks, may be negative) such that pulse a, sent d ticks
 * later, lands after pulse b: a later tick, or the same tick and created
 * later (the engine lands the older of two same-tick pulses first).
 */
function minShift(a: Hit, b: Hit): number {
  const d = b[0] - a[0];
  return a[1] + d > b[1] ? d : d + 1;
}

/** Arrivals on R_j a move can cause: tokens (+1) from F_{j-1}, B_{j+1}; clears (-1) via IF_j, IB_j. */
function arrivalsOnR(n: number, cells: Map<string, Cell>, j: number): { tokens: Hit[]; clears: Hit[] } {
  const t = (a: string, z: string) => tt(cells.get(a)!, cells.get(z)!);
  const [pv, nx, R] = [`${(j + n - 1) % n}`, `${(j + 1) % n}`, `r${j}`];
  const via = (src: string, X: string, I: string): Hit => [t(src, X) + t(X, I) + t(I, R), t(src, X) + t(X, I)];
  return {
    tokens: [[t('fwd', `f${pv}`) + t(`f${pv}`, R), t('fwd', `f${pv}`)], [t('back', `b${nx}`) + t(`b${nx}`, R), t('back', `b${nx}`)]],
    clears: [via('fwd', `f${j}`, `if${j}`), via('back', `b${j}`, `ib${j}`)],
  };
}

// ---- timing ------------------------------------------------------------------

interface RingTiming {
  readLag: number;
  readEarliest: number;
  /** readLatest = F + readSlack. */
  readSlack: number;
  settle: number;
  minF: number;
}

/**
 * Every timing fact of the layout, relative to t_k (the tick fwd/back fires),
 * derived from cell distances. Throws if a pulse could land in the wrong
 * order on a copy (a token inside its pair gap, a restore before the read -1).
 *
 * The settled moment t_k + settle comes after every arrival a move causes;
 * the default read (readLag) lands on R copies right after it. The read may
 * come at any offset r in [readEarliest, F + readSlack]: on each R_j, its +1
 * not before this frame's tokens and after its clears, its -1 after both;
 * the next frame's tokens after its -1 (an empty copy must not see +1 +1
 * across ticks), clears after its +1 (the holder must fire first) and read
 * +1 after its restore. The holder's restore and a clear may land in either
 * order: the charge never reaches 1. minF keeps the next
 * frame's first arrival after the settled moment, readLag in the window and
 * the previous read done by the settled moment.
 */
function ringTiming(n: number, L: RingLayout): RingTiming {
  const c = (role: string) => L.cells.get(role)!;
  const t = (a: string, z: string) => tt(c(a), c(z));
  const mod = (j: number) => (j + n) % n;
  /** Throw unless pulse a lands after pulse b. */
  const after = (a: Hit, b: Hit, what: string) => {
    if (minShift(a, b) > 0) throw new Error(`ring: ${what}`);
  };
  let settle = 0;
  const first: number[] = [];
  // F and B copies: type s is broadcast by src (+1) and minus (-1); its token moves by step.
  for (const [s, src, step, o, osrc, oinh] of [
    ['f', 'fwd', 1, 'b', 'back', 'ib'],
    ['b', 'back', -1, 'f', 'fwd', 'if'],
  ] as const) {
    for (let j = 0; j < n; j++) {
      const [X, M, from] = [`${s}${j}`, `m${s}${j}`, `${s}${mod(j - step)}`];
      const oFrom = `${o}${mod(j + step)}`;
      const pair: Hit = [t(src, X), 0];
      const pairMinus: Hit = [t(src, M) + t(M, X), t(src, M)];
      const token: Hit = [t(src, from) + t(from, X), t(src, from)];
      after(pairMinus, pair, `pair -1 lands on ${X} before its +1`);
      after(token, pairMinus, `token lands on ${X} inside its pair gap`);
      // Other-type token, other-type stale clear (a move of the other kind).
      const otherToken = t(osrc, oFrom) + t(oFrom, X);
      const clear = t(osrc, `${o}${j}`) + t(`${o}${j}`, `${oinh}${j}`) + t(`${oinh}${j}`, X);
      const all = [pair[0], pairMinus[0], token[0], otherToken, clear];
      settle = Math.max(settle, ...all);
      first.push(Math.min(...all));
    }
  }
  // R copies: a move's arrivals, then the read: +1, -1 via rm, restore via RR_j (relative to the read).
  let readEarliest = -Infinity;
  let nextArrivals = -Infinity; // r <= F - nextArrivals
  let nextRead = -Infinity; // r_k - r_{k+1} <= F - nextRead
  let readDone = 0;
  const rA = Array.from({ length: n }, (_, j) => t('read', `r${j}`));
  for (let j = 0; j < n; j++) {
    const { tokens, clears } = arrivalsOnR(n, L.cells, j);
    const q = t(`r${j}`, `rr${j}`);
    const plus: Hit = [rA[j]!, 0];
    const minus: Hit = [t('read', 'rm') + t('rm', `r${j}`), t('read', 'rm')];
    const restore: Hit = [rA[j]! + 2 * q, rA[j]! + q];
    after(minus, plus, `read -1 lands on r${j} before its +1`);
    after(restore, minus, `restore of r${j} lands before the read -1`);
    for (const h of [...tokens, ...clears]) {
      settle = Math.max(settle, h[0]);
      first.push(h[0]);
    }
    // A token and the read +1 may land on the empty copy in the same tick, in
    // either order (-1 +1 +1: it fires on that tick); the -1 must come after.
    for (const h of tokens) readEarliest = Math.max(readEarliest, h[0] - plus[0], minShift(minus, h));
    // A clear must land on the old holder before the read +1, or it fires.
    for (const h of clears) readEarliest = Math.max(readEarliest, minShift(plus, h));
    for (const h of tokens) nextArrivals = Math.max(nextArrivals, minShift(h, minus));
    for (const h of clears) nextArrivals = Math.max(nextArrivals, minShift(h, plus));
    nextRead = Math.max(nextRead, minShift(plus, restore));
    readDone = Math.max(readDone, restore[0]);
  }
  const readLag = settle + 1 - Math.min(...rA);
  const readSlack = Math.min(-nextArrivals, readEarliest - nextRead);
  if (readLag < readEarliest) throw new Error('ring: the default read is too early');
  const minF = Math.max(settle + 1 - Math.min(...first), readLag - readSlack, readLag + readDone - settle);
  return { readLag, readEarliest, readSlack, settle, minF };
}

/**
 * Smallest lead from power (tick p) to t_0. Power's -1 must land on every
 * empty copy no later than the first +1 that copy can get: its own pair
 * (first move), a token from the start position, or the earliest read. On a
 * tie it lands first: it is older (p < t_0).
 */
function powerLeadFor(n: number, cells: Map<string, Cell>, start: number, readEarliest: number): number {
  const t = (a: string, z: string) => tt(cells.get(a)!, cells.get(z)!);
  const [s, nx, pv] = [start, (start + 1) % n, (start + n - 1) % n];
  let lead = 1;
  for (let j = 0; j < n; j++) {
    if (j === s) continue;
    const plus = {
      [`f${j}`]: [t('fwd', `f${j}`), ...(j === pv ? [t('back', `b${s}`) + t(`b${s}`, `f${j}`)] : [])],
      [`b${j}`]: [t('back', `b${j}`), ...(j === nx ? [t('fwd', `f${s}`) + t(`f${s}`, `b${j}`)] : [])],
      [`r${j}`]: [readEarliest + t('read', `r${j}`), ...(j === nx ? [t('fwd', `f${s}`) + t(`f${s}`, `r${j}`)] : []), ...(j === pv ? [t('back', `b${s}`) + t(`b${s}`, `r${j}`)] : [])],
    };
    for (const [X, ticks] of Object.entries(plus)) lead = Math.max(lead, t('power', X) - Math.min(...ticks));
  }
  return lead;
}

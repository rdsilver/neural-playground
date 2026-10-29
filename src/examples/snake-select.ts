import { NetworkBuilder, travelTicks } from '../engine';
import { at, type Cell, type Place } from './snake-control';

/**
 * Select plane of the Neural Snake: coincident pixel selection, as in the
 * address decoder of magnetic core memory. The head plane (polarity +1)
 * lights the head pixel, the tail plane (polarity -1) erases the tail pixel.
 * Design, layout and frame schedule: see the comment above buildSelect().
 */

const tt = (a: Cell, b: Cell) => travelTicks(a, b);
const key = (c: Cell) => `${c.x},${c.y}`;

/** Plane rows per column group (group 0, next to the screen, is fed by the column input itself). */
const GROUP_ROWS = 2;
/** Rows of the row inputs below the column inputs. */
const ROW_LINE_DROP = 6;
/** Largest minF the layout may have: the hold length is tuned down until minF fits. */
const MAX_MIN_F = 240;

interface Layout {
  w: number;
  h: number;
  polarity: 1 | -1;
  /** Local cell of every neuron, by role (see selectLayout). */
  cells: Map<string, Cell>;
  /** Plane rows of each column group. */
  groups: number[][];
}

// ---- layout ------------------------------------------------------------------

/**
 * Local layout (x right, y away from the screen, which is at y < 0):
 *
 *   y 0..h-1   plane: Q(i,j) at (2i, j), its partner K(i,j) at (2i+1, j): the
 *              restore relay (polarity +1) or the gate (polarity -1)
 *   y h        partners M(i,0) of the column inputs
 *   y h+1      column inputs C_i, pitch 1, under the middle of the plane
 *   below      feeders F(i,g) with partners M(i,g); row inputs R_j (pitch 1,
 *              ROW_LINE_DROP rows lower); row relays S, row Inhibitors Z; power
 *
 * The relays are placed by small searches so that each kind of pulse lands
 * on all its Qs at nearly the same tick: that keeps a frame short (selectTiming).
 */
function selectLayout(w: number, h: number, polarity: 1 | -1): Layout {
  const cells = new Map<string, Cell>();
  const add = (role: string, c: Cell) => {
    if ([...cells.values()].some((q) => q.x === c.x && q.y === c.y)) throw new Error(`select layout: cell ${key(c)} taken (${role})`);
    cells.set(role, c);
  };
  const cell = (role: string) => cells.get(role)!;
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) {
      add(`q${i}.${j}`, { x: 2 * i, y: j });
      add(`k${i}.${j}`, { x: 2 * i + 1, y: j });
    }
  const cx0 = Math.floor(w / 2);
  for (let i = 0; i < w; i++) add(`c${i}`, { x: cx0 + i, y: h + 1 });
  const groups: number[][] = [];
  for (let j0 = 0; j0 < h; j0 += GROUP_ROWS) groups.push(Array.from({ length: Math.min(GROUP_ROWS, h - j0) }, (_, k) => j0 + k));
  // Group 0 (the rows next to the screen, farthest from C) sets the range the
  // column pulse must land in on every Q: the other groups are fed through a
  // feeder placed so that their longer path lands inside the same range.
  const direct = groups[0]!.flatMap((j) => Array.from({ length: w }, (_, i) => tt(cell(`c${i}`), cell(`q${i}.${j}`))));
  const [aMin, aMax] = [Math.min(...direct), Math.max(...direct)];
  const box = { x0: -8, x1: 2 * w + 7, y0: h, y1: h + 14 };
  const used = () => new Set([...cells.values()].map(key));
  /**
   * How late the partner m of a group's source S (fired at `fire`) acts, or
   * Infinity if it is out of order. Polarity +1: an Inhibitor whose -1 must
   * land after the +1 and before the selected Q's restore. Polarity -1: a
   * relay that fires the gates, after the selected Q has closed its gate.
   */
  const lateness = (i: number, g: number, S: Cell, fire: number, m: Cell) => {
    let worst = 0;
    for (const j of groups[g]!) {
      const [q, k] = [cell(`q${i}.${j}`), cell(`k${i}.${j}`)];
      const a = fire + tt(S, q);
      const late = polarity === 1 ? fire + tt(S, m) + tt(m, q) - a : fire + tt(S, m) + tt(m, k) - (a + tt(q, k));
      if (polarity === 1 ? late < 0 || late >= 2 * tt(q, k) : late <= 0) return Infinity;
      worst = Math.max(worst, late);
    }
    return worst;
  };
  const bestPartner = (i: number, g: number, S: Cell, fire: number, taken: Set<string>) => {
    let best: { m: Cell; cost: number } | undefined;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const m = { x: S.x + dx, y: S.y + dy };
        if (m.y < h || taken.has(key(m))) continue;
        const cost = 10 * lateness(i, g, S, fire, m) + Math.abs(dx) + Math.abs(dy);
        if (cost < (best?.cost ?? Infinity)) best = { m, cost };
      }
    return best;
  };
  for (let i = 0; i < w; i++) {
    const p = bestPartner(i, 0, cell(`c${i}`), 0, used());
    if (!p) throw new Error(`select layout: no partner for column ${i}`);
    add(`m${i}.0`, p.m);
  }
  // Group by group, column by column: a feeder and its partner, jointly.
  for (let g = 1; g < groups.length; g++)
    for (let i = 0; i < w; i++) {
      const C = cell(`c${i}`);
      const taken = used();
      let best: { f: Cell; m: Cell; cost: number } | undefined;
      for (let y = box.y0; y <= box.y1; y++)
        for (let x = box.x0; x <= box.x1; x++) {
          const f = { x, y };
          if (taken.has(key(f))) continue;
          const arr = groups[g]!.map((j) => tt(C, f) + tt(f, cell(`q${i}.${j}`)));
          const base = 1000 * Math.max(0, ...arr.map((a) => a - aMax), ...arr.map((a) => aMin - a)) + Math.abs(f.x - 2 * i) + f.y - h;
          if (base >= (best?.cost ?? Infinity)) continue;
          const p = bestPartner(i, g, f, tt(C, f), new Set([...taken, key(f)]));
          if (p && base + p.cost < (best?.cost ?? Infinity)) best = { f, m: p.m, cost: base + p.cost };
        }
      if (!best) throw new Error(`select layout: no feeder for column ${i}, group ${g}`);
      add(`f${i}.${g}`, best.f);
      add(`m${i}.${g}`, best.m);
    }
  return { w, h, polarity, cells, groups };
}

/** The 5 (w/2) Qs of one half of plane row j. */
const halfOf = (L: Layout, j: number, side: number) =>
  Array.from({ length: L.w }, (_, i) => i).filter((i) => (side === 0 ? i < L.w / 2 : i >= L.w / 2)).map((i) => L.cells.get(`q${i}.${j}`)!);

/** Free cells for row relays: below the plane, off the row inputs' approach strip. */
function rowCells(L: Layout, y1: number): Cell[] {
  const used = new Set([...L.cells.values()].map(key));
  const r0 = L.cells.get('r0')!;
  const out: Cell[] = [];
  for (let y = L.h; y <= y1; y++)
    for (let x = -14; x <= 2 * L.w + 14; x++) {
      const c = { x, y };
      if (!used.has(key(c)) && !(y > r0.y && x >= r0.x && x < r0.x + L.h)) out.push(c);
    }
  return out;
}

/**
 * One relay per half row, chosen from `cands` (distinct cells), fed by
 * `from(j, side)` (a cell and the tick it fires): every pulse it sends must
 * land on its half's Qs as close as possible to one common tick T, scanned
 * over [T0, T1]. Hardest halves pick first. Returns T and the worst miss.
 */
function assignRelays(L: Layout, role: string, from: (j: number, side: number) => { cell: Cell; t: number }, cands: Cell[], T0: number, T1: number) {
  const halves: Array<{ j: number; side: number; opts: Array<{ c: Cell; lo: number; hi: number }> }> = [];
  for (let j = 0; j < L.h; j++)
    for (const side of [0, 1]) {
      const { cell: src, t } = from(j, side);
      const qs = halfOf(L, j, side);
      halves.push({ j, side, opts: cands.map((c) => {
        const arr = qs.map((q) => t + tt(src, c) + tt(c, q));
        return { c, lo: Math.min(...arr), hi: Math.max(...arr) };
      }) });
    }
  const dev = (o: { lo: number; hi: number }, T: number) => Math.max(T - o.lo, o.hi - T);
  // Coarse: the best T ignoring that relays need distinct cells.
  let T = T0;
  let dFree = Infinity;
  for (let t = T0; t <= T1; t++) {
    const d = Math.max(...halves.map((hv) => Math.min(...hv.opts.map((o) => dev(o, t)))));
    if (d < dFree) [T, dFree] = [t, d];
  }
  // Fine: distinct cells, hardest halves first; the earliest T within 4 ticks of the best miss.
  const tries: Array<{ T: number; d: number; picks: Cell[] }> = [];
  for (let t = Math.max(T0, T - 30); t <= Math.min(T1, T + 30); t++) {
    const ranked = halves.map((hv) => [...hv.opts].sort((p, q) => dev(p, t) - dev(q, t) || p.c.y - q.c.y || p.c.x - q.c.x));
    const order = ranked.map((_, n) => n).sort((p, q) => dev(ranked[q]![0]!, t) - dev(ranked[p]![0]!, t) || p - q);
    const taken = new Set<string>();
    const picks: Cell[] = [];
    let d = 0;
    for (const n of order) {
      const o = ranked[n]!.find((x) => !taken.has(key(x.c)))!;
      taken.add(key(o.c));
      picks[n] = o.c;
      d = Math.max(d, dev(o, t));
    }
    tries.push({ T: t, d, picks });
  }
  const dMin = Math.min(...tries.map((x) => x.d));
  const best = tries.find((x) => x.d <= dMin + 4)!;
  halves.forEach((hv, n) => L.cells.set(`${role}${hv.j}.${hv.side}`, best.picks[n]!));
  return best;
}

/** Row inputs and the row-half relays S (hold start, +1). Returns the common hold-start tick. */
function addRowInputs(L: Layout): number {
  const { w, h, cells } = L;
  const yR = h + 1 + ROW_LINE_DROP;
  for (let j = 0; j < h; j++) cells.set(`r${j}`, { x: Math.floor(w / 2) + Math.floor((w - h) / 2) + j, y: yR });
  const from = (j: number) => ({ cell: cells.get(`r${j}`)!, t: 0 });
  const cands = rowCells(L, yR + 8);
  return assignRelays(L, 's', from, cands, 0, 900).T;
}

/** Row-half Inhibitors Z (hold end, -1), fed by S, aimed at tick `T`. */
function addRowInhibitors(L: Layout, T: number): void {
  for (const role of [...L.cells.keys()]) if (role.startsWith('z') || role === 'power') L.cells.delete(role);
  const from = (j: number, side: number) => {
    const s = L.cells.get(`s${j}.${side}`)!;
    return { cell: s, t: tt(L.cells.get(`r${j}`)!, s) };
  };
  assignRelays(L, 'z', from, rowCells(L, L.h + ROW_LINE_DROP + 24), T, T);
  // Power-on digs every Q's hole (-1) by firing the row Inhibitors once.
  const r0 = L.cells.get('r0')!;
  const used = new Set([...L.cells.values()].map(key));
  let x = r0.x - 2;
  while (used.has(key({ x, y: r0.y }))) x--;
  L.cells.set('power', { x, y: r0.y });
}

// ---- timing ------------------------------------------------------------------

/** One Q's pulses. Column side relative to the column fire, row side to the row fire. */
interface PixelTiming {
  /** Column +1 lands at a; its sender fired at aSent. */
  a: number;
  aSent: number;
  /** Row +1 (hold start) lands at b, sent at bSent; row -1 (hold end) lands at c, sent at cSent. */
  b: number;
  bSent: number;
  c: number;
  cSent: number;
  /** Last column-side arrival on an internal neuron of this pixel (selected or not). */
  colLast: number;
}

interface SelectTiming {
  px: PixelTiming[][]; // [i][j], plane indices
  lo: number;
  hi: number;
  /** Ticks after the row fire by which every internal neuron is at rest (whatever the skew). */
  settle: number;
  minF: number;
  powerLead: number;
}

/**
 * Every timing fact of a layout, from its cells. Skew s = row fire - column
 * fire; the column fires at 0. Throws if a pulse pair is out of order.
 *
 * Pixel (i, j) works for s in [lo_p, hi_p]: the row's +1 must land before
 * the column's +1 (Q then fires on the column pulse) and the row's -1 after
 * it. On a tie the pulse sent earlier lands first (engine rule): that decides
 * whether the edge tick itself is in. The plane's window is the intersection.
 *
 * Frames: rows fire F apart, the column at row - s. A frame's last internal
 * event comes max(maxC, colLast - s) after its row fire, the next frame's
 * first one F + min(minB, minA - s') after it: minF keeps them apart for all
 * s, s' in the window, so every frame starts from rest.
 */
function selectTiming(L: Layout): SelectTiming {
  const { w, h, cells, groups, polarity } = L;
  const t = (p: string, q: string) => tt(cells.get(p)!, cells.get(q)!);
  const px: PixelTiming[][] = [];
  let [lo, hi, colLast, maxC, minB, minA, maxA] = [-Infinity, Infinity, 0, -Infinity, Infinity, Infinity, 0];
  for (let i = 0; i < w; i++) {
    px.push([]);
    for (let j = 0; j < h; j++) {
      const g = groups.findIndex((rows) => rows.includes(j));
      const src = g === 0 ? `c${i}` : `f${i}.${g}`;
      const fire = g === 0 ? 0 : t(`c${i}`, src);
      const [q, k, m] = [`q${i}.${j}`, `k${i}.${j}`, `m${i}.${g}`];
      const a = fire + t(src, q);
      const mFire = fire + t(src, m);
      let last: number;
      if (polarity === 1) {
        const minus = mFire + t(m, q);
        const restore = a + 2 * t(q, k);
        if (!(minus >= a && minus < restore)) throw new Error(`select: column -1 on ${q} out of order`);
        last = Math.max(minus, restore);
      } else {
        const trig = mFire + t(m, k);
        if (!(trig > a + t(q, k))) throw new Error(`select: gate ${k} triggered before ${q} can close it`);
        last = trig + t(k, q);
      }
      const side = i < w / 2 ? 0 : 1;
      const [r, sr, z] = [`r${j}`, `s${j}.${side}`, `z${j}.${side}`];
      const bSent = t(r, sr);
      const b = bSent + t(sr, q);
      const cSent = bSent + t(sr, z);
      const c = cSent + t(z, q);
      px[i]!.push({ a, aSent: fire, b, bSent, c, cSent, colLast: last });
      // Row +1 before column +1 at the edge s = a - b only if it was sent earlier.
      hi = Math.min(hi, a - b + bSent < fire ? a - b : a - b - 1);
      // Column +1 before row -1 at the edge s = a - c only if it was sent earlier.
      lo = Math.max(lo, fire < a - c + cSent ? a - c : a - c + 1);
      [colLast, maxC, minB, minA, maxA] = [Math.max(colLast, last), Math.max(maxC, c), Math.min(minB, b), Math.min(minA, a), Math.max(maxA, a)];
    }
  }
  if (lo > hi) throw new Error('select: empty skew window');
  if (hi >= 0) throw new Error('select: the row must always fire before the column');
  const settle = Math.max(maxC, colLast - lo);
  const minF = settle + 1 - Math.min(minB, minA - hi);
  // Power fires the row Inhibitors once; its last -1 must land before any frame's first pulse.
  let pow = 0;
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) {
      const z = `z${j}.${i < w / 2 ? 0 : 1}`;
      pow = Math.max(pow, t('power', z) + t(z, `q${i}.${j}`));
    }
  const powerLead = Math.max(pow - minB, pow + hi - minA) + 1;
  return { px, lo, hi, settle, minF, powerLead };
}

const layouts = new Map<string, { L: Layout; T: SelectTiming }>();

/**
 * The layout for a plane size and polarity, computed once (it involves a
 * search). The hold (row +1 to row -1) is as long as minF <= MAX_MIN_F allows:
 * the longer the hold, the wider the skew window.
 */
function getLayout(w: number, h: number, polarity: 1 | -1) {
  const id = `${w}x${h}:${polarity}`;
  if (!layouts.has(id)) {
    const L = selectLayout(w, h, polarity);
    const B = addRowInputs(L);
    for (let hold = 300; ; hold -= 2) {
      if (hold < 60) throw new Error('select layout: no hold length fits MAX_MIN_F');
      addRowInhibitors(L, B + hold);
      const T = selectTiming(L);
      if (T.minF <= MAX_MIN_F) {
        layouts.set(id, { L, T });
        break;
      }
    }
  }
  return layouts.get(id)!;
}

/** [min, max] of a list. */
const range = (v: number[]) => [Math.min(...v), Math.max(...v)] as [number, number];

/**
 * The frame schedule of a plane size and polarity, from its layout (ticks;
 * row side after the row fire, column side after the column fire). The
 * lamp pulse is not here: it depends on where the screen is (Select.hit).
 */
export function selectSchedule(w: number, h: number, polarity: 1 | -1) {
  const { T } = getLayout(w, h, polarity);
  const px = T.px.flat();
  return {
    holdStart: range(px.map((p) => p.b)),
    columnPulse: range(px.map((p) => p.a)),
    columnDone: range(px.map((p) => p.colLast)),
    holdEnd: range(px.map((p) => p.c)),
    skew: [T.lo, T.hi] as [number, number],
    settle: T.settle,
    minF: T.minF,
    powerLead: T.powerLead,
  };
}

// ---- builders ----------------------------------------------------------------

/** The screen: a w x h rectangle of Lamps at pitch 1, lamps[y][x] at local (x, y). */
export function buildLamps(b: NetworkBuilder, place: Place, opts: { w: number; h: number; prefix: string }): string[][] {
  return Array.from({ length: opts.h }, (_, y) =>
    Array.from({ length: opts.w }, (_, x) => {
      const c = at(place, x, y);
      return b.neuron('lamp', c.x, c.y, { id: `${opts.prefix}-${x}.${y}` });
    }),
  );
}

export interface SelectOptions {
  w: number;
  h: number;
  /** +1 lights the selected lamp (head), -1 dims it (tail). */
  polarity: 1 | -1;
  prefix: string;
  /** The screen, lamps[y][x] (from buildLamps). */
  lamps: string[][];
}

export interface Select {
  /** cols[x]: fire once per frame, at the column tick t. In order along one straight edge, pitch 1. */
  cols: string[];
  /** rows[y]: fire once per frame at t + s, s in skew. In order along one straight edge, pitch 1. */
  rows: string[];
  /** Fire once, at least powerLead ticks before the first rows[] fire: digs every Q's resting hole. */
  power: string;
  powerLead: number;
  /** Allowed s = row fire tick - column fire tick (inclusive). Rows always fire first. */
  skew: { min: number; max: number };
  /** hit[y][x]: the lamp's pulse lands exactly hit ticks after the column fire (the later input). */
  hit: number[][];
  /** From the rows[] fire + settle until the next frame's first pulse lands, every internal neuron is at rest. */
  settle: number;
  /** Resting charge of every internal neuron (all Qs -1, everything else 0). */
  restFor(): Record<string, number>;
  /** Smallest frame period: rows fire F >= minF apart (one per frame, or none). */
  minF: number;
  /** select[y][x]: the selection neuron Q of pixel (x, y). */
  select: string[][];
}

/** Neuron kind and threshold of a role (see selectLayout), by polarity. */
function kindOf(role: string, polarity: 1 | -1): 'normal' | 'negative' {
  const head = role[0];
  if (head === 'z') return 'negative';
  if (head === 'q' || head === 'k') return polarity === 1 ? 'normal' : 'negative';
  if (head === 'm') return polarity === 1 ? 'negative' : 'normal';
  return 'normal';
}

/** Every connection of a layout, as role pairs. */
function wiring(L: Layout): Array<[string, string]> {
  const { w, h, groups, polarity } = L;
  const out: Array<[string, string]> = [];
  for (let i = 0; i < w; i++)
    groups.forEach((rows, g) => {
      const src = g === 0 ? `c${i}` : `f${i}.${g}`;
      if (g > 0) out.push([`c${i}`, src]);
      out.push([src, `m${i}.${g}`]);
      for (const j of rows) {
        out.push([src, `q${i}.${j}`]);
        out.push([`m${i}.${g}`, polarity === 1 ? `q${i}.${j}` : `k${i}.${j}`]);
        out.push([`q${i}.${j}`, `k${i}.${j}`], [`k${i}.${j}`, `q${i}.${j}`]);
      }
    });
  for (let j = 0; j < h; j++)
    for (const side of [0, 1]) {
      const [s, z] = [`s${j}.${side}`, `z${j}.${side}`];
      out.push([`r${j}`, s], [s, z], ['power', z]);
      for (let i = 0; i < w; i++) if ((i < w / 2 ? 0 : 1) === side) out.push([s, `q${i}.${j}`], [z, `q${i}.${j}`]);
    }
  return out;
}

/**
 * Select plane: a w x h (10 x 8) coincident-selection plane that adds +1
 * (head) or -1 (tail) to the one lamp whose column and row both fire.
 *
 * Per pixel two neurons: Q (threshold 1, resting at -1, a hole the power-on
 * pulse digs) and its partner K, side by side.
 * - The row is the hold: rows[y] fires first; relays S put +1 on the 10 Qs
 *   of row y (charge 0: armed), and Inhibitors Z take it back later.
 * - The column is the strike: cols[x] fires later; its +1 lands on the 8 Qs
 *   of column x. The armed one reaches 1 and fires: the pixel. The other
 *   seven go from -1 to 0 and get a -1 right back.
 * - Polarity +1 (head): Q is a normal neuron. It lights its lamp (+1); its
 *   relay K gives it +1 back 30 ticks later, after the column's -1 (from the
 *   column's partner Inhibitor M) has landed; the hold's -1 then leaves Q at -1.
 * - Polarity -1 (tail): Q is an Inhibitor. Its -1 dims its lamp and closes
 *   its gate K (an Inhibitor resting at 0) just before the column's trigger
 *   relay M pokes all the column's gates: open gates fire and send their
 *   half-selected Q its -1; the selected Q's gate stays shut (back to 0), and
 *   the hold's -1 brings that Q back to -1.
 *
 * Holding costs frame time (a frame lasts from the first hold +1 to the last
 * restore), so each kind of pulse is made to land at nearly the same tick on
 * every Q it serves. The two plane rows next to the screen (the farthest from
 * C) take the column pulse straight from C; every other pair of rows gets it
 * through a feeder F placed one detour away. Each half row gets its hold from
 * its own relay S and Inhibitor Z, placed far enough below that their fans are
 * narrow. selectTiming() derives the window and every other fact from the cells.
 *
 * Frame schedule, in ticks: rows fire at T, F apart (or not at all); the
 * column fires at t = T - s. Asserted by snake-select.test.ts.
 *
 *   event                                          head (+1)      tail (-1)
 *   hold +1 lands on the row's 10 Qs               T + 271..308   T + 271..308
 *   column +1 lands on the column's 8 Qs           t + 120..155   t + 120..155   the selected Q fires
 *   column side done (restore, gates, -1s)         t + 150..185   t + 154..192
 *   hold -1 lands on the row's 10 Qs               T + 477..502   T + 474..501
 *   lamp pulse (intended placement, hit)           t + 240..297   t + 240..297
 *   skew s = T - t, inclusive                      -323..-180     -318..-173
 *   every internal neuron at rest (settle)         T + 508        T + 510
 *   smallest frame period (minF)                   238            240
 *   power fires at least powerLead before a row    277            295
 *
 * The column always fires last, so hit is also the latency from the later
 * input. The rows need their lead: their relays sit far enough out to reach
 * all 10 Qs of a row at once.
 */
export function buildSelect(b: NetworkBuilder, place: Place, opts: SelectOptions): Select {
  const { w, h, polarity, prefix, lamps } = opts;
  const { L, T } = getLayout(w, h, polarity);
  const id = (role: string) => `${prefix}-${role}`;
  const abs = (role: string) => {
    const c = L.cells.get(role)!;
    return at(place, c.x, c.y);
  };
  // Which plane column / row serves pixel (x, y): the one that keeps every
  // Q-to-lamp wire the same length (the plane is a translated copy of the screen).
  const lampCell = new Map(b.build().neurons.map((n) => [n.id, n] as const));
  const lamp = (x: number, y: number) => lampCell.get(lamps[y]![x]!)!;
  const iOf = (x: number) => (Math.sign(lamp(w - 1, 0).x - lamp(0, 0).x) === place.sx ? x : w - 1 - x);
  const jOf = (y: number) => (Math.sign(lamp(0, h - 1).y - lamp(0, 0).y) === (place.sy ?? 1) ? y : h - 1 - y);
  const labels: Record<string, string> = { power: 'ON' };
  for (let x = 0; x < w; x++) labels[`c${iOf(x)}`] = `X${x}`;
  for (let y = 0; y < h; y++) labels[`r${jOf(y)}`] = `Y${y}`;
  for (const role of L.cells.keys()) {
    const c = abs(role);
    const label = labels[role];
    b.neuron(kindOf(role, polarity), c.x, c.y, { id: id(role), threshold: 1, ...(label ? { label } : {}) });
  }
  for (const [from, to] of wiring(L)) b.connect(id(from), id(to));
  const select = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => id(`q${iOf(x)}.${jOf(y)}`)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.connect(select[y]![x]!, lamps[y]![x]!);
  const hit = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => T.px[iOf(x)]![jOf(y)]!.a + tt(abs(`q${iOf(x)}.${jOf(y)}`), lamp(x, y))),
  );
  const internal = [...L.cells.keys()].map(id);
  return {
    cols: Array.from({ length: w }, (_, x) => id(`c${iOf(x)}`)),
    rows: Array.from({ length: h }, (_, y) => id(`r${jOf(y)}`)),
    power: id('power'),
    powerLead: T.powerLead,
    skew: { min: T.lo, max: T.hi },
    hit,
    settle: T.settle,
    restFor: () => Object.fromEntries(internal.map((n) => [n, n.startsWith(`${prefix}-q`) ? -1 : 0])),
    minF: T.minF,
    select,
  };
}

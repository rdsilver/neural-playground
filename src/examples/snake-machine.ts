import { NetworkBuilder, travelTicks, type Network } from '../engine';
import { buildControl, DIRECTIONS, type Cell, type ControlUnit, type Direction, type Place } from './snake-control';
import { buildQueue, type Queue } from './snake-queue';
import { buildRing, type Ring } from './snake-ring';
import { buildLamps, buildSelect, selectSchedule, type Select } from './snake-select';
import { Ambiguous, controlFacts, controlModel, type ControlFacts } from './snake-model';

/**
 * The whole Neural Snake: the finished blocks (control unit, four ring
 * counters, two select planes, the move queue) placed around a 10 x 8 screen
 * and joined by glue wires and delay relays. See buildSnake() for the frame
 * schedule; snake-machine.test.ts asserts it.
 */

const W = 10;
const H = 8;
/** Snake length: the queue's depth. */
const L = 4;

// ---- geometry ------------------------------------------------------------------

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The part [t0, t1] of segment a-b (as fractions of it) inside rectangle r; empty when t0 > t1 (Liang-Barsky). */
function clip(a: Cell, b: Cell, r: Rect): [number, number] {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return [1, 0];
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return [t0, t1];
}

/** Does segment a-b touch the rectangle? */
export function segmentHitsRect(a: Cell, b: Cell, r: Rect): boolean {
  const [t0, t1] = clip(a, b, r);
  return t0 <= t1;
}

/** Fraction of segment a-b inside the rectangle. */
const clipFraction = (a: Cell, b: Cell, r: Rect) => {
  const [t0, t1] = clip(a, b, r);
  return Math.max(0, t1 - t0);
};

/** Distance from point p to segment a-b. */
export function segmentDistance(a: Cell, b: Cell, p: Cell): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const tt = (a: Cell, b: Cell) => travelTicks(a, b);

// ---- placement -------------------------------------------------------------------

/**
 * Board layout (cells; x right, y down). The screen is the centrepiece; the
 * head plane hangs below it and the tail plane above it (mirrored), each one
 * cell clear of the screen's bezel margin. Every other block sits on the
 * left: the control unit (keys) beside the screen, the move queue next to
 * it, the head rings left of the head plane and the tail rings left of the
 * tail plane, each ring's line row facing its plane's inputs.
 */
export const LAYOUT = {
  screen: { x0: 20, y0: 30, sx: 1 } as Place,
  headSelect: { x0: 15, y0: 39, sx: 1, sy: 1 } as Place,
  tailSelect: { x0: 15, y0: 28, sx: 1, sy: -1 } as Place,
  /** Ring placements: the read source's cell; transposed, so each line row is a column facing the plane. */
  headX: { x0: 1, y0: 59, sx: 1, sy: -1 } as Place,
  headY: { x0: 1, y0: 45, sx: 1, sy: 1 } as Place,
  tailX: { x0: 1, y0: 8, sx: 1, sy: 1 } as Place,
  tailY: { x0: 1, y0: 23, sx: 1, sy: 1 } as Place,
  /** The control unit's top key. */
  control: { x: 9, y: 30 } as Cell,
  queue: { x0: 1, y0: 30, sx: 1, sy: -1 } as Place,
};

export interface Block {
  /** Neuron ids of the block. */
  ids: string[];
  box: Rect;
}

export type BlockName = 'control' | 'headX' | 'headY' | 'headSelect' | 'queue' | 'tailX' | 'tailY' | 'tailSelect';

/** Place every block (no glue yet). */
function placeBlocks(b: NetworkBuilder, F: number, start: Cell) {
  const lamps = buildLamps(b, LAYOUT.screen, { w: W, h: H, prefix: 'px' });
  const headSelect = buildSelect(b, LAYOUT.headSelect, { w: W, h: H, polarity: 1, prefix: 'hs', lamps });
  const tailSelect = buildSelect(b, LAYOUT.tailSelect, { w: W, h: H, polarity: -1, prefix: 'ts', lamps });
  const ring = (place: Place, n: number, prefix: string, s: number) => buildRing(b, place, { n, F, prefix, start: s, transpose: true });
  const headX = ring(LAYOUT.headX, W, 'hx', start.x);
  const headY = ring(LAYOUT.headY, H, 'hy', start.y);
  const tailX = ring(LAYOUT.tailX, W, 'tx', start.x);
  const tailY = ring(LAYOUT.tailY, H, 'ty', start.y);
  const control = buildControl(b, LAYOUT.control, { F });
  const queue = buildQueue(b, LAYOUT.queue, { lanes: 4, depth: L, prefix: 'q', F, labels: ['▶', '◀', '▼', '▲'] });
  return { lamps, headSelect, tailSelect, headX, headY, tailX, tailY, control, queue };
}

const PREFIX: Record<BlockName, string> = { control: 'ctl-', headX: 'hx-', headY: 'hy-', headSelect: 'hs-', queue: 'q-', tailX: 'tx-', tailY: 'ty-', tailSelect: 'ts-' };

/** Each block's neurons and bounding box. */
function blocksOf(net: Network): Record<BlockName, Block> {
  const out = {} as Record<BlockName, Block>;
  for (const name of Object.keys(PREFIX) as BlockName[]) {
    const ns = net.neurons.filter((n) => n.id.startsWith(PREFIX[name]));
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    out[name] = { ids: ns.map((n) => n.id), box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
  }
  return out;
}

// ---- glue ------------------------------------------------------------------------

const cellKey = (c: Cell) => `${c.x},${c.y}`;
/** The area a rectangle of cells covers: each cell is the unit square around its centre. */
export const squares = (r: Rect): Rect => ({ x0: r.x0 - 0.5, y0: r.y0 - 0.5, x1: r.x1 + 0.5, y1: r.y1 + 0.5 });
const inRect = (c: Cell, r: Rect) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1;

/** Longest glue hop, in cells. */
const MAX_HOP = 9;
/** Where glue relays may go: the corridors left of the rings and between the rings and the planes (rows of the planes). */
const GLUE_AREA: Rect = { x0: -7, y0: 1, x1: 13, y1: 66 };
/** Route cost of one relay (in cells of wire). */
const RELAY_COST = 3;

/**
 * Glue between the blocks: direct wires and lines of relays (threshold 1),
 * placed in free cells outside every block's box and off the screen; no
 * glue wire may cross the screen or its bezel margin. Routes are cheapest
 * paths (Dijkstra) where a hop costs its length, plus a penalty for every
 * neuron it passes over and for running through a block other than its
 * own ends'; an exact delay is then made by a detour (one or two relays
 * swapped in). Records every glue neuron and connection.
 */
class Glue {
  readonly ids: string[] = [];
  readonly conns: Array<[string, string]> = [];
  private cells = new Map<string, Cell>();
  private occupied = new Set<string>();
  private nearCache = new Map<string, number>();

  constructor(
    private b: NetworkBuilder,
    private boxes: Record<BlockName, Rect>,
    private bezel: Rect,
  ) {
    for (const n of b.build().neurons) this.track(n.id, n);
  }

  private track(id: string, c: Cell) {
    this.cells.set(id, { x: c.x, y: c.y });
    this.occupied.add(cellKey(c));
    this.nearCache.clear();
  }

  cell(id: string): Cell {
    const c = this.cells.get(id);
    if (!c) throw new Error(`glue: unknown neuron ${id}`);
    return c;
  }

  ticks(a: string, z: string): number {
    return tt(this.cell(a), this.cell(z));
  }

  /** The block a neuron belongs to (by id prefix), if any. */
  blockOf(id: string): BlockName | undefined {
    return (Object.keys(PREFIX) as BlockName[]).find((n) => id.startsWith(PREFIX[n]));
  }

  /** Free for a relay: in the glue area, empty, off the screen and its margin, outside every block. */
  free(c: Cell): boolean {
    return inRect(c, GLUE_AREA) && !this.occupied.has(cellKey(c)) && !inRect(c, this.bezel) && !Object.values(this.boxes).some((r) => inRect(c, r));
  }

  /** A hop may not cross the screen or its margin (their cells' squares). */
  ok = (p: Cell, q: Cell) => !segmentHitsRect(p, q, squares(this.bezel));

  /** Neurons a hop passes over (within 0.45 of their centre), its ends excepted. */
  private near(p: Cell, q: Cell): number {
    const k = `${cellKey(p)}>${cellKey(q)}`;
    let c = this.nearCache.get(k);
    if (c === undefined) {
      c = 0;
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++)
        for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) {
          const m = { x, y };
          if ((x !== p.x || y !== p.y) && (x !== q.x || y !== q.y) && this.occupied.has(cellKey(m)) && segmentDistance(p, q, m) < 0.45) c++;
        }
      this.nearCache.set(k, c);
    }
    return c;
  }

  /** Hop cost: length, +4 per neuron passed over, +2 per cell run through a block other than `own`, + a relay's cost. */
  hopCost(p: Cell, q: Cell, own: ReadonlySet<string>): number {
    const len = Math.hypot(p.x - q.x, p.y - q.y);
    let inside = 0;
    for (const [name, r] of Object.entries(this.boxes)) if (!own.has(name)) inside += len * clipFraction(p, q, squares(r));
    return len + 4 * this.near(p, q) + 2 * inside + RELAY_COST;
  }

  wire(from: string, to: string | string[]) {
    for (const t of Array.isArray(to) ? to : [to]) {
      if (!this.ok(this.cell(from), this.cell(t))) throw new Error(`glue: ${from} -> ${t} crosses the screen`);
      this.b.connect(from, t);
      this.conns.push([from, t]);
    }
  }

  private own(a: string, z: string): Set<string> {
    return new Set([this.blockOf(a), this.blockOf(z)].filter((n): n is BlockName => !!n));
  }

  /** Free cells near both ends (their box, widened by `pad`). */
  private nodes(a: Cell, z: Cell, pad = 8): Cell[] {
    const out: Cell[] = [];
    for (let y = Math.min(a.y, z.y) - pad; y <= Math.max(a.y, z.y) + pad; y++)
      for (let x = Math.min(a.x, z.x) - pad; x <= Math.max(a.x, z.x) + pad; x++) if (this.free({ x, y })) out.push({ x, y });
    return out;
  }

  /** Cheapest route from any of `from` to z (each tick of travel costs `lambda` more): the relay cells after the start, and the start. */
  route(from: string[], z: string, own: ReadonlySet<string>, avoid: ReadonlySet<string> = new Set(), lambda = 0): { start: string; relays: Cell[] } {
    const zc = this.cell(z);
    const starts = from.map((id) => this.cell(id));
    const nodes = [...starts, ...this.nodes(starts[0]!, zc).filter((c) => !avoid.has(cellKey(c)))];
    const goal = nodes.length;
    nodes.push(zc);
    const dist = nodes.map(() => Infinity);
    const prev = nodes.map(() => -1);
    starts.forEach((_, i) => (dist[i] = 0));
    const done = nodes.map(() => false);
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
      if (u < 0) throw new Error(`glue: no route to ${z}`);
      if (u === goal) break;
      done[u] = true;
      const p = nodes[u]!;
      nodes.forEach((q, v) => {
        if (done[v] || v < starts.length) return;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > MAX_HOP && v !== goal) return;
        if (!this.ok(p, q)) return;
        const c = dist[u]! + this.hopCost(p, q, own) + lambda * tt(p, q);
        if (c < dist[v]!) [dist[v], prev[v]] = [c, u];
      });
    }
    const path: number[] = [];
    for (let v = prev[goal]!; v >= starts.length; v = prev[v]!) path.unshift(v);
    let s = goal;
    while (prev[s]! >= starts.length) s = prev[s]!;
    return { start: from[prev[s]!]!, relays: path.map((i) => nodes[i]!) };
  }

  /**
   * Make a route a -> relays -> z exactly `total` ticks long: swap in the
   * cheapest detour (one relay moved, or one or two inserted into a hop).
   */
  pad(a: Cell, relays: Cell[], z: Cell, total: number, own: ReadonlySet<string>, avoid: ReadonlySet<string>, depth = 0): Cell[] | undefined {
    const pts = [a, ...relays, z];
    const T = pts.slice(1).reduce((s, q, i) => s + tt(pts[i]!, q), 0);
    if (T === total) return relays;
    if (T > total || relays.some((c) => avoid.has(cellKey(c)))) return undefined;
    const used = new Set([...pts.map(cellKey), ...avoid]);
    const cost = (seq: Cell[]) => seq.slice(1).reduce((s, q, i) => s + this.hopCost(seq[i]!, q, own), 0);
    const base = cost(pts);
    const isOld = (p: Cell, q: Cell) => pts.slice(1).some((r, j) => cellKey(pts[j]!) === cellKey(p) && cellKey(r) === cellKey(q));
    /** New hops stay short, except the first and last (leaving and entering a block); the route's own hops may be longer. */
    const valid = (rs: Cell[]) => {
      const seq = [a, ...rs, z];
      return seq.slice(1).every((q, i) => this.ok(seq[i]!, q) && (isOld(seq[i]!, q) || i === 0 || i === seq.length - 2 || Math.hypot(seq[i]!.x - q.x, seq[i]!.y - q.y) <= MAX_HOP));
    };
    let best: { relays: Cell[]; cost: number } | undefined;
    const consider = (rs: Cell[]) => {
      if (!valid(rs)) return;
      const c = cost([a, ...rs, z]);
      if (!best || c < best.cost) best = { relays: rs, cost: c };
    };
    const extra = total - T;
    const windowOf = (p: Cell, q: Cell, r: number) => this.nodes(p, q, r).filter((c) => !used.has(cellKey(c)));
    for (let h = 0; h + 1 < pts.length; h++) {
      const [p, q] = [pts[h]!, pts[h + 1]!];
      const need = tt(p, q) + extra;
      const window = windowOf(p, q, Math.min(MAX_HOP, Math.ceil(extra / 15) + 2));
      // One relay inserted into hop h.
      for (const d of window) if (tt(p, d) + tt(d, q) === need) consider([...relays.slice(0, h), d, ...relays.slice(h)]);
      // Relay h moved (h >= 1 is relay h - 1 of `relays`).
      if (h >= 1) {
        const [o, r] = [pts[h - 1]!, pts[h + 1]!];
        const needMove = tt(o, p) + tt(p, r) + extra;
        for (const d of window) if (tt(o, d) + tt(d, r) === needMove) consider([...relays.slice(0, h - 1), d, ...relays.slice(h)]);
      }
      // Two relays inserted into hop h (small detours only: the search is quadratic).
      if (!best && extra <= 120)
        for (const d of window)
          for (const e of window) if (d !== e && tt(p, d) + tt(d, e) + tt(e, q) === need) consider([...relays.slice(0, h), d, e, ...relays.slice(h)]);
    }
    if (best || depth >= 4) return best?.relays;
    // Too far for one detour: insert the relay that adds the most ticks per unit of cost, then pad the rest.
    let step: { relays: Cell[]; score: number } | undefined;
    for (let h = 0; h + 1 < pts.length; h++) {
      const [p, q] = [pts[h]!, pts[h + 1]!];
      for (const d of windowOf(p, q, MAX_HOP)) {
        const gain = tt(p, d) + tt(d, q) - tt(p, q);
        if (gain < 15 || gain > extra - 15) continue;
        const rs = [...relays.slice(0, h), d, ...relays.slice(h)];
        if (!valid(rs)) continue;
        const score = (cost([a, ...rs, z]) - base) / gain;
        if (!step || score < step.score) step = { relays: rs, score };
      }
    }
    return step && this.pad(a, step.relays, z, total, own, avoid, depth + 1);
  }

  /**
   * Exact taps from one periodic source: each target z gets a line of exactly
   * `total` ticks from src, branching off the cheapest relay already in the
   * tree (whose own delay from src is known). Builds them in order.
   */
  exactTree(src: string, targets: Array<[string, number, string]>): void {
    const at = new Map<string, number>([[src, 0]]);
    for (const [z, total, name] of targets) {
      let best: { from: string; path: Cell[]; cost: number } | undefined;
      for (const [from, t0] of at) {
        const own = this.own(src, z);
        for (const lambda of [0, 0.05, 0.2, 1]) {
          const r = this.route([from], z, own, new Set(), lambda);
          const path = this.pad(this.cell(from), r.relays, this.cell(z), total - t0, own, new Set());
          if (!path) continue;
          const pts = [this.cell(from), ...path, this.cell(z)];
          const cost = pts.slice(1).reduce((s, q, i) => s + this.hopCost(pts[i]!, q, own), 0);
          if (!best || cost < best.cost) best = { from, path, cost };
          break;
        }
      }
      if (!best) {
        const r = this.route([src], z, this.own(src, z));
        throw new Error(`glue: no ${total}-tick tap ${src} -> ${z}; route ${JSON.stringify(r.relays)} takes ${this.pathTicks(src, r.relays, z)}`);
      }
      const relays = this.build(best.from, z, best.path, name);
      let t = at.get(best.from)!;
      [best.from, ...relays].forEach((id, k, all) => k > 0 && at.set(id, (t += this.ticks(all[k - 1]!, id))));
    }
  }

  /** Build relays (named `${name}-1`, ...) and wire a -> relays -> z; returns the relay ids. */
  build(a: string, z: string, path: Cell[], name: string): string[] {
    const relays = path.map((c, i) => {
      const id = this.b.normal(c.x, c.y, 1, { id: `${name}-${i + 1}` });
      this.track(id, c);
      this.ids.push(id);
      return id;
    });
    const chain = [a, ...relays, z];
    for (let i = 0; i + 1 < chain.length; i++) this.wire(chain[i]!, chain[i + 1]!);
    return relays;
  }

  /** A line a -> z of any length in [lo, hi]: the cheapest route that fits, padded up to lo if short. Returns its length. */
  lineIn(a: string, z: string, lo: number, hi: number, name: string): number {
    const own = this.own(a, z);
    for (const lambda of [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 3]) {
      const r = this.route([a], z, own, new Set(), lambda);
      const T = this.pathTicks(a, r.relays, z);
      if (T > hi) continue;
      const path = T >= lo ? r.relays : this.pad(this.cell(a), r.relays, this.cell(z), lo, own, new Set());
      if (!path) continue;
      this.build(a, z, path, name);
      return Math.max(T, lo);
    }
    throw new Error(`glue: no line ${a} -> ${z} of ${lo}..${hi} ticks`);
  }

  /** A line a -> z of exactly `total` ticks: the cheapest route that fits (travel weighted more until one does), padded. */
  line(a: string, z: string, total: number, name: string): string[] {
    const own = this.own(a, z);
    for (const lambda of [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 3]) {
      const r = this.route([a], z, own, new Set(), lambda);
      const path = this.pad(this.cell(a), r.relays, this.cell(z), total, own, new Set());
      if (path) return this.build(a, z, path, name);
    }
    throw new Error(`glue: no ${total}-tick line ${a} -> ${z}`);
  }

  private pathTicks(a: string, relays: Cell[], z: string): number {
    const pts = [this.cell(a), ...relays, this.cell(z)];
    return pts.slice(1).reduce((s, q, i) => s + tt(pts[i]!, q), 0);
  }

  /** Cheapest routes for lines a_i -> z_i (avoiding each other), with their travel ticks. */
  routes(pairs: Array<[string, string, string]>, lambda = 0): Array<{ own: Set<string>; relays: Cell[]; ticks: number }> {
    const taken = new Set<string>();
    return pairs.map(([a, z]) => {
      const own = this.own(a, z);
      const relays = this.route([a], z, own, taken, lambda).relays;
      relays.forEach((c) => taken.add(cellKey(c)));
      return { own, relays, ticks: this.pathTicks(a, relays, z) };
    });
  }

  /**
   * Lines a_i -> z_i, all exactly T ticks: the given routes padded (or, if
   * that fails, routes with travel weighted more). Returns false if none fits.
   */
  padLines(pairs: Array<[string, string, string]>, T: number): boolean {
    for (const lambda of [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 3]) {
      const routes = this.routes(pairs, lambda);
      const avoid = new Set<string>();
      const paths: Cell[][] = [];
      for (const [i, [a, z]] of pairs.entries()) {
        const p = this.pad(this.cell(a), routes[i]!.relays, this.cell(z), T, routes[i]!.own, avoid);
        if (!p) break;
        p.forEach((c) => avoid.add(cellKey(c)));
        paths.push(p);
      }
      if (paths.length < pairs.length) continue;
      pairs.forEach(([a, z, name], i) => this.build(a, z, paths[i]!, name));
      return true;
    }
    return false;
  }

  /**
   * Drive a select plane from two rings: X lines from `xs` (pairs onto the X
   * ring's fwd/back), Y lines from `ys`, both sources firing at offset `from`.
   * Picks the move offsets (X as early as its cheapest routes allow, Y as
   * near its own routes' travel as the skew window allows) and builds the
   * lines. Returns [moveX, moveY].
   */
  movesFor(xs: Array<[string, string, string]>, ys: Array<[string, string, string]>, from: number, rowsRel: number[], colsRel: number[], skew: { min: number; max: number }): [number, number] {
    // cols - rows = (mX + c_i) - (mY + r_j) must lie in [-skew.max, -skew.min] for all i, j.
    const dLo = -skew.max - Math.min(...colsRel) + Math.max(...rowsRel);
    const dHi = -skew.min - Math.max(...colsRel) + Math.min(...rowsRel);
    if (dLo > dHi) throw new Error('glue: line spreads exceed the skew window');
    const rx = Math.max(...this.routes(xs).map((r) => r.ticks));
    const ry = Math.max(...this.routes(ys).map((r) => r.ticks));
    for (let mX = from + Math.max(rx, ry + dLo); mX < from + rx + 400; mX++) {
      // Y as close to its own route's travel as the window allows: the least padding.
      const ys0 = Array.from({ length: dHi - dLo + 1 }, (_, k) => mX - dHi + k).sort((a, b) => Math.abs(a - from - ry) - Math.abs(b - from - ry) || a - b);
      for (const mY of ys0) {
        if (mY - from < ry || mX - mY < dLo || mX - mY > dHi) continue;
        const saved = this.ids.length;
        if (this.padLines(ys, mY - from)) {
          if (this.padLines(xs, mX - from)) return [mX, mY];
          throw new Error(`glue: built Y lines but no X lines at ${mX} (relays from ${saved})`);
        }
      }
    }
    throw new Error(`glue: no moves for ${xs[0]![2]} / ${ys[0]![2]}`);
  }

  /** Reach each target from `src` or any relay already built for it (a tree); returns ticks from src to each. */
  tree(src: string, targets: string[], name: string): number[] {
    const at = new Map<string, number>([[src, 0]]);
    return targets.map((z, i) => {
      const r = this.route([...at.keys()], z, this.own(src, z));
      const relays = this.build(r.start, z, r.relays, `${name}-${i + 1}`);
      let t = at.get(r.start)!;
      [r.start, ...relays].forEach((id, k, all) => {
        if (k > 0) at.set(id, (t += this.ticks(all[k - 1]!, id)));
      });
      return t + this.ticks([r.start, ...relays].at(-1)!, z);
    });
  }
}

// ---- the machine -------------------------------------------------------------------

export interface SnakeOptions {
  /** Frame period in ticks (default 480). */
  F?: number;
  /** Where head and tail stand before frame 0 (default (0, 3)). */
  start?: { x: number; y: number };
}

/** Charges a block must hold at a probe tick: each neuron's allowed values. */
export interface Probe {
  tick: number;
  block: BlockName | 'glue';
  allowed: Record<string, number[]>;
}

/** What the probes need to know about frame k (from the reference model). */
export interface FrameState {
  /** Head and tail positions after frame k. */
  head: { x: number; y: number };
  tail: { x: number; y: number };
  /** Queue lane held by each stage after frame k's input: stage d holds frame k - d's strobe (null before frame 0). */
  queued: Array<number | null>;
}

export interface Snake {
  network: Network;
  /** The builder, for the example step to add texts (call b.build() again after). */
  b: NetworkBuilder;
  keys: Record<Direction, string>;
  /** lamps[y][x]. */
  lamps: string[][];
  /** The lamp rectangle: top-left lamp cell, width and height (pitch 1). */
  screen: { x0: number; y0: number; w: number; h: number };
  /** The screen plus its one-cell bezel margin: nothing but lamp wires may cross it. */
  bezel: Rect;
  blocks: Record<BlockName, Block>;
  parts: { control: ControlUnit; headX: Ring; headY: Ring; tailX: Ring; tailY: Ring; headSelect: Select; tailSelect: Select; queue: Queue };
  /** Glue neurons and connections (everything not inside a block). */
  glue: { ids: string[]; connections: Array<[string, string]> };
  F: number;
  start: { x: number; y: number };
  /** Tick of frame k's clock fire. */
  frameTick(k: number): number;
  /** A tick by which frame k's head +1 and tail -1 have landed and frame k+1's have not. */
  settledTick(k: number): number;
  /** The frame schedule: offsets (ticks after frameTick(k)) of every event; see buildSnake(). */
  schedule: Schedule;
  /**
   * Latencies in ticks, to the head lamp's +1 landing: from the strobe
   * [min, max over pixels]; from a key press that turns the snake (any
   * phase, any turn, any pixel; = pressToStrobe + strobeToLamp).
   */
  latency: { strobeToLamp: [number, number]; pressToStrobe: [number, number]; pressToLampMin: number; pressToLampMax: number };
  /** Probes for frame k: every neuron of every block at rest at that block's settled moment. */
  probes(k: number, state: FrameState): Probe[];
}

export interface Schedule {
  strobe: number;
  /** Head rings: move (fwd/back fire), read, lines; rows/cols fire; head lamp pulses land. */
  head: SideSchedule;
  tail: SideSchedule;
  queue: { shift: number; inputs: [number, number]; outputs: number; any: number };
  /** Every lamp pulse of frame k lands in [first, last]; settledTick(k) = frameTick(k) + last. */
  lamps: [number, number];
  /** Ticks power-on leads each block's need by (all >= 0). */
  powerSlack: Record<string, number>;
}

export interface SideSchedule {
  moveX: number;
  moveY: number;
  readX: number;
  readY: number;
  /** The ring's line fires (every position: default lines fire on one tick). */
  linesX: number;
  linesY: number;
  /** [min, max] over positions/wires. */
  cols: [number, number];
  rows: [number, number];
  /** Row fire - column fire over every combination, and the plane's window. */
  skew: [number, number];
  window: [number, number];
  /** Lamp pulse landing, over every pixel. */
  lamp: [number, number];
  /** Q fires (the pixel's select neuron), over every pixel. */
  q: [number, number];
}

const span = (v: number[]): [number, number] => [Math.min(...v), Math.max(...v)];

/**
 * Build the Neural Snake (F = 480: 4 moves per second at speed 32).
 *
 * Signal flow, once per frame. The control unit's frame clock fires at
 * frameTick(k) = 1 + kF; it samples the direction register and fires one
 * strobe. The strobe moves a head ring (RIGHT/LEFT: X fwd/back, DOWN/UP: Y
 * fwd/back) and enters the move queue in its own lane. The strobe clock K
 * (which fires every frame, 15 ticks before the strobe) reads both head rings;
 * their lines select one row and one column of the head plane, which adds +1
 * to the head's lamp. The queue gives each move back L = 4 frames later to the
 * tail rings, which ANY (fired by every queue output) reads; the tail plane
 * takes -1 from the lamp the tail leaves. Frames 0..3 have no queue output, so
 * the snake grows 1, 2, 3, 4 pixels, then stays 4 long.
 *
 * Timing is solved from the cells (Glue.movesFor): each X ring moves just
 * late enough that its plane's every row fires inside the skew window before
 * every column; every line is an exact relay delay. assemble() checks every
 * contract (skew windows, read lags, queue tolerance, power leads, settled
 * windows) and throws on a violation.
 *
 * Frame schedule, ticks after frameTick(k). The tail columns replay the move
 * of frame k - 4. Asserted by snake-machine.test.ts (SCHEDULE).
 *
 *   event                                            head          tail
 *   strobe fires (one of R/L/D/U)                    178
 *   queue: shift; inputs; outputs; ANY               160; 259-326; 194; 243
 *   Y ring moves (fwd or back), reads, line fires    414, 496, 757  418, 500, 761
 *   X ring moves, reads, line fires                  636, 714, 1021 670, 748, 1055
 *   plane rows fire                                  1012-1052     1037-1065
 *   plane columns fire                               1287-1320     1321-1354
 *   row - column skew (the plane's window)           -308..-235    -317..-256
 *                                                    (-323..-180)  (-318..-173)
 *   the pixel's Q fires                              1410-1472     1443-1507
 *   lamp pulse lands (+1 head, -1 tail)              1546-1620     1580-1655
 *   settled: every lamp pulse of frame k landed      1655 = settledTick(k) - frameTick(k)
 *     (frame k + 1's first lands at 480 + 1546)
 *
 * Latency (ticks, to the head lamp's +1): strobe to lamp 1368..1442; key
 * press to strobe 146..647 (any phase, any turn); press to lamp 1514..2089
 * (about 0.8 to 1.1 s at speed 32).
 */
export function buildSnake(opts: SnakeOptions = {}): Snake {
  const F = opts.F ?? 480;
  const start = opts.start ?? { x: 0, y: 3 };
  const b = new NetworkBuilder();
  const parts = placeBlocks(b, F, start);
  const { control: ctl, headX: hx, headY: hy, tailX: tx, tailY: ty, headSelect: hs, tailSelect: ts, queue: q } = parts;
  const s0 = LAYOUT.screen;
  const bezel: Rect = { x0: s0.x0 - 1, y0: s0.y0 - 1, x1: s0.x0 + W, y1: s0.y0 + H };
  const glue = new Glue(b, Object.fromEntries(Object.entries(blocksOf(b.build())).map(([k, v]) => [k, v.box])) as Record<BlockName, Rect>, bezel);
  const st = ctl.strobes;
  const T0 = ctl.strobeOffset;

  // Ring lines drive the select planes: straight wires, line j to input j.
  for (const [ring, sel] of [[hx, hs], [tx, ts]] as const) ring.lines.forEach((l, i) => glue.wire(l, sel.cols[i]!));
  for (const [ring, sel] of [[hy, hs], [ty, ts]] as const) ring.lines.forEach((l, j) => glue.wire(l, sel.rows[j]!));
  /** Offsets of the row (or column) fires after the ring's move, per position. */
  const fires = (ring: Ring, inputs: string[]) => ring.lines.map((l, j) => ring.readLag + ring.lineDelay[j]! + glue.ticks(l, inputs[j]!));

  // Head: the X ring moves as early as its cheapest wiring allows; the Y
  // ring so that every row fires mid-window before every column.
  const [hX, hY] = glue.movesFor(
    [[st.right, hx.fwd, 'g-hx-fwd'], [st.left, hx.back, 'g-hx-back']],
    [[st.down, hy.fwd, 'g-hy-fwd'], [st.up, hy.back, 'g-hy-back']],
    T0, fires(hy, hs.rows), fires(hx, hs.cols), hs.skew,
  );
  const headRows = fires(hy, hs.rows).map((r) => hY + r);
  const headCols = fires(hx, hs.cols);

  // Queue: each strobe feeds its lane; shift comes so that the earliest input is exactly on time.
  const lanes = [st.right, st.left, st.down, st.up];
  lanes.forEach((s, l) => glue.wire(s, q.inputs[l]!));
  const inputs = lanes.map((s, l) => T0 + glue.ticks(s, q.inputs[l]!));
  // The shift comes from the frame clock, so that every input is within the queue's tolerance.
  const shift = glue.lineIn(ctl.clock, q.shift, Math.max(...inputs) - q.tolerance.max, Math.min(...inputs) - q.tolerance.min, 'g-q-shift');

  // The ring reads tap the strobe clock K, which fires every frame 15 ticks before the strobe.
  const K = `${PREFIX.control}strobe-clock`;
  const kFire = T0 - glue.ticks(K, st.right);
  glue.exactTree(K, [
    [hy.read, hY + hy.readLag - kFire, 'g-hy-read'],
    [hx.read, hX + hx.readLag - kFire, 'g-hx-read'],
  ]);

  // Tail: driven by the queue outputs (frame k replays frame k - L), read by ANY.
  const out = shift + q.outLag;
  const [tX, tY] = glue.movesFor(
    [[q.outputs[0]!, tx.fwd, 'g-tx-fwd'], [q.outputs[1]!, tx.back, 'g-tx-back']],
    [[q.outputs[2]!, ty.fwd, 'g-ty-fwd'], [q.outputs[3]!, ty.back, 'g-ty-back']],
    out, fires(ty, ts.rows), fires(tx, ts.cols), ts.skew,
  );
  const tailRows = fires(ty, ts.rows).map((r) => tY + r);
  const tailCols = fires(tx, ts.cols);
  glue.line(q.any, ty.read, tY + ty.readLag - out - q.anyLag, 'g-ty-read');
  glue.line(q.any, tx.read, tX + tx.readLag - out - q.anyLag, 'g-tx-read');

  // Power-on: the control unit's one-shot timer (tick 1) powers every block, through a tree of relays.
  glue.tree(ctl.power, [q.power, hy.power, ty.power, hx.power, tx.power, hs.power, ts.power], 'g-power');

  const network = b.build();
  return assemble({ b, network, parts, glue, F, start, bezel, hX, hY, tX, tY, shift, inputs, headRows, headCols, tailRows, tailCols });
}

interface Solved {
  b: NetworkBuilder;
  network: Network;
  parts: Snake['parts'] & { lamps: string[][] };
  glue: Glue;
  F: number;
  start: { x: number; y: number };
  bezel: Rect;
  /** Offsets after the frame clock fire: ring moves, queue shift, input fires; row fires; column fires after the X move. */
  hX: number;
  hY: number;
  tX: number;
  tY: number;
  shift: number;
  inputs: number[];
  headRows: number[];
  headCols: number[];
  tailRows: number[];
  tailCols: number[];
}

/** Rest charges of the control unit at read + 48 (see snake-control.test.ts): flip-flop gates hold a hole or not, registers a bit. */
function controlRest(ctl: ControlUnit, ids: string[]): Record<string, number[]> {
  const strobeRest: Record<Direction, number> = { right: 0, left: -1, down: -1, up: -2 };
  const allowed: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, [0]]));
  for (const bit of [ctl.bits.axis, ctl.bits.sign]) {
    allowed[bit.setGate] = allowed[bit.resetGate] = [-1, 0];
    allowed[bit.register] = [0, 1];
  }
  for (const d of DIRECTIONS) allowed[ctl.strobes[d]] = [strobeRest[d]];
  return allowed;
}

function assemble(s: Solved): Snake {
  const { network, parts, glue, F, start } = s;
  const { control: ctl, headX: hx, headY: hy, tailX: tx, tailY: ty, headSelect: hs, tailSelect: ts, queue: q, lamps } = parts;
  const cell = new Map(network.neurons.map((n) => [n.id, n] as const));
  const t = (a: string, z: string) => travelTicks(cell.get(a)!, cell.get(z)!);
  const blocks = blocksOf(network);

  const side = (name: string, sel: Select, polarity: 1 | -1, moveX: number, moveY: number, rows: number[], colsRel: number[]): SideSchedule => {
    const cols = colsRel.map((c) => moveX + c);
    const skew: [number, number] = [Math.min(...rows) - Math.max(...cols), Math.max(...rows) - Math.min(...cols)];
    if (skew[0] < sel.skew.min || skew[1] > sel.skew.max) throw new Error(`snake: ${name} skew ${skew} outside ${sel.skew.min}..${sel.skew.max}`);
    const lamp: number[] = [];
    const qf: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        lamp.push(cols[x]! + sel.hit[y]![x]!);
        qf.push(cols[x]! + sel.hit[y]![x]! - t(sel.select[y]![x]!, lamps[y]![x]!));
      }
    // The plane rests from its last row fire + settle until the next frame's first pulse.
    const sch = selectSchedule(W, H, polarity);
    const restAt = Math.max(...rows) + sel.settle;
    const next = F + Math.min(Math.min(...rows) + sch.holdStart[0], Math.min(...cols) + sch.columnPulse[0]);
    if (restAt >= next) throw new Error(`snake: ${name} plane never rests`);
    const [rx, ry] = name === 'head' ? [hx, hy] : [tx, ty];
    const line = (r: Ring) => {
      if (new Set(r.lineDelay).size !== 1) throw new Error('snake: lines fire on different ticks');
      return r.readLag + r.lineDelay[0]!;
    };
    return {
      moveX, moveY, readX: moveX + rx.readLag, readY: moveY + ry.readLag, linesX: moveX + line(rx), linesY: moveY + line(ry),
      cols: span(cols), rows: span(rows), skew, window: [sel.skew.min, sel.skew.max], lamp: span(lamp), q: span(qf),
    };
  };
  const head = side('head', hs, 1, s.hX, s.hY, s.headRows, s.headCols);
  const tail = side('tail', ts, -1, s.tX, s.tY, s.tailRows, s.tailCols);
  const lampSpan = span([...head.lamp, ...tail.lamp]);
  if (lampSpan[1] >= F + lampSpan[0]) throw new Error(`snake: lamp pulses span ${lampSpan}, no settled moment`);

  // Queue: inputs within tolerance; its settled moment allows for a late input.
  for (const w of s.inputs) if (w - s.shift < q.tolerance.min || w - s.shift > q.tolerance.max) throw new Error(`snake: queue input at shift + ${w - s.shift}`);
  const qSettle = Math.max(q.settle, ...s.inputs.map((w, l) => w - s.shift + q.inTravel[l]!));
  if (qSettle >= F + q.outLag) throw new Error('snake: queue never settles');
  const out = s.shift + q.outLag;

  // Power-on (the control's one-shot timer fires at tick 1 = frameTick(0)).
  const pw = (id: string) => t(ctl.power, id);
  const powerSlack: Record<string, number> = {
    headX: s.hX - pw(hx.power) - hx.powerLead,
    headY: s.hY - pw(hy.power) - hy.powerLead,
    tailX: L * F + s.tX - pw(tx.power) - tx.powerLead,
    tailY: L * F + s.tY - pw(ty.power) - ty.powerLead,
    queue: s.shift - pw(q.power) - q.powerLead,
    headSelect: Math.min(...s.headRows) - pw(hs.power) - hs.powerLead,
    tailSelect: L * F + Math.min(...s.tailRows) - pw(ts.power) - ts.powerLead,
  };
  for (const [k, v] of Object.entries(powerSlack)) if (v < 0) throw new Error(`snake: ${k} powered ${-v} ticks too late`);

  const schedule: Schedule = {
    strobe: ctl.strobeOffset,
    head,
    tail,
    queue: { shift: s.shift, inputs: span(s.inputs), outputs: out, any: out + q.anyLag },
    lamps: lampSpan,
    powerSlack,
  };
  const frameTick = (k: number) => 1 + k * F;
  const strobeToLamp: [number, number] = [head.lamp[0] - ctl.strobeOffset, head.lamp[1] - ctl.strobeOffset];
  const toStrobe = pressToStrobe(controlFacts(network, ctl), ctl.strobeOffset);
  const glueIds = glue.ids;
  const ctlIds = blocks.control.ids;
  const exact = (rest: Record<string, number>) => Object.fromEntries(Object.entries(rest).map(([id, v]) => [id, [v]]));
  const probes = (k: number, state: FrameState): Probe[] => {
    const c = frameTick(k);
    return [
      { tick: c + ctl.readOffset + 48, block: 'control', allowed: controlRest(ctl, ctlIds) },
      { tick: c + s.hX + hx.settle, block: 'headX', allowed: exact(hx.restFor(state.head.x)) },
      { tick: c + s.hY + hy.settle, block: 'headY', allowed: exact(hy.restFor(state.head.y)) },
      { tick: c + s.tX + tx.settle, block: 'tailX', allowed: exact(tx.restFor(state.tail.x)) },
      { tick: c + s.tY + ty.settle, block: 'tailY', allowed: exact(ty.restFor(state.tail.y)) },
      { tick: c + s.shift + qSettle, block: 'queue', allowed: exact(q.restFor(state.queued)) },
      { tick: c + head.rows[1] + hs.settle, block: 'headSelect', allowed: exact(hs.restFor()) },
      { tick: c + tail.rows[1] + ts.settle, block: 'tailSelect', allowed: exact(ts.restFor()) },
      { tick: c + lampSpan[1], block: 'glue', allowed: Object.fromEntries(glueIds.map((id) => [id, [0]])) },
    ];
  };
  return {
    network,
    b: s.b,
    keys: ctl.keys,
    lamps,
    screen: { x0: LAYOUT.screen.x0, y0: LAYOUT.screen.y0, w: W, h: H },
    bezel: s.bezel,
    blocks,
    parts,
    glue: { ids: glueIds, connections: glue.conns },
    F,
    start,
    frameTick,
    settledTick: (k) => frameTick(k) + lampSpan[1],
    schedule,
    latency: { strobeToLamp, pressToStrobe: toStrobe, pressToLampMin: toStrobe[0] + strobeToLamp[0], pressToLampMax: toStrobe[1] + strobeToLamp[1] },
    probes,
  };
}

/**
 * Press-to-strobe latency [min, max] over every change of direction and every
 * press phase, from the press model: a press at tick p first shows in the
 * strobe of frame k (at frameTick(k) + strobeOffset).
 */
export function pressToStrobe(facts: ControlFacts, strobeOffset: number): [number, number] {
  const { F } = facts;
  const lat: number[] = [];
  for (const from of DIRECTIONS)
    for (const to of DIRECTIONS) {
      if (from === to) continue;
      for (let p = 1 + 3 * F; p < 1 + 5 * F; p++) {
        let dirs: Direction[];
        try {
          dirs = controlModel(9, [{ t: 40, key: from }, { t: p, key: to }], facts);
        } catch (e) {
          if (e instanceof Ambiguous) continue;
          throw e;
        }
        const k = dirs.findIndex((d, i) => i >= 3 && d === to);
        lat.push(1 + k * F + strobeOffset - p);
      }
    }
  return span(lat);
}

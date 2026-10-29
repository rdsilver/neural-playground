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

/** Does segment a-b come within the rectangle (cell centres, inclusive)? Liang-Barsky clipping. */
export function segmentHitsRect(a: Cell, b: Cell, r: Rect): boolean {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 <= t1;
}

/** Distance from point p to segment a-b. */
export function segmentDistance(a: Cell, b: Cell, p: Cell): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const tt = (a: Cell, b: Cell) => travelTicks(a, b);

/**
 * A delay line from a to z of exactly `total` ticks through at most
 * `maxRelays` relays chosen from `cands`; each hop must pass `ok`. Among the
 * lines with the fewest relays the shortest wiring wins. Deterministic. Like
 * findDelay (snake-control.ts), with a caller-chosen region, hop check and
 * hop cost (default: length).
 */
export function searchDelay(a: Cell, z: Cell, total: number, cands: Cell[], ok: (p: Cell, q: Cell) => boolean, maxRelays = 4, cost?: (p: Cell, q: Cell) => number): Cell[] | undefined {
  if (tt(a, z) === total && ok(a, z)) return [];
  const dist = cost ?? ((p: Cell, q: Cell) => Math.hypot(p.x - q.x, p.y - q.y));
  type Entry = { path: number[]; len: number };
  // layer[i]: ticks from a -> best path ending at cands[i]
  let layer = cands.map((c) => {
    const m = new Map<number, Entry>();
    const t = tt(a, c);
    if (ok(a, c) && t + tt(c, z) <= total) m.set(t, { path: [], len: dist(a, c) });
    return m;
  });
  for (let hops = 1; hops <= maxRelays; hops++) {
    let best: { path: number[]; len: number } | undefined;
    layer.forEach((m, i) => {
      const c = cands[i]!;
      const e = m.get(total - tt(c, z));
      if (e && ok(c, z) && (!best || e.len + dist(c, z) < best.len)) best = { path: [...e.path, i], len: e.len + dist(c, z) };
    });
    if (best) return best.path.map((i) => cands[i]!);
    if (hops === maxRelays) break;
    const next = cands.map(() => new Map<number, Entry>());
    layer.forEach((m, i) => {
      const c = cands[i]!;
      m.forEach((e, t0) =>
        cands.forEach((d, j) => {
          if (j === i || e.path.includes(j)) return;
          const t = t0 + tt(c, d);
          if (t + tt(d, z) > total || !ok(c, d)) return;
          const len = e.len + dist(c, d);
          const old = next[j]!.get(t);
          if (!old || len < old.len) next[j]!.set(t, { path: [...e.path, i], len });
        }),
      );
    });
    layer = next;
  }
  return undefined;
}

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
  headX: { x0: 1, y0: 60, sx: 1, sy: -1 } as Place,
  headY: { x0: 1, y0: 45, sx: 1, sy: 1 } as Place,
  tailX: { x0: 1, y0: 7, sx: 1, sy: 1 } as Place,
  tailY: { x0: 1, y0: 21, sx: 1, sy: 1 } as Place,
  /** The control unit's top key. */
  control: { x: 9, y: 29 } as Cell,
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

/** Only the blocks, for looking at the layout. */
export function buildBlocksOnly(F = 480, start: Cell = { x: 0, y: 3 }) {
  const b = new NetworkBuilder();
  const parts = placeBlocks(b, F, start);
  const network = b.build();
  return { b, network, parts, blocks: blocksOf(network) };
}

// ---- glue ------------------------------------------------------------------------

const cellKey = (c: Cell) => `${c.x},${c.y}`;
/** The area a rectangle of cells covers: each cell is the unit square around its centre. */
export const squares = (r: Rect): Rect => ({ x0: r.x0 - 0.5, y0: r.y0 - 0.5, x1: r.x1 + 0.5, y1: r.y1 + 0.5 });
const inRect = (c: Cell, r: Rect) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1;

/**
 * Glue between the blocks: direct wires and delay lines of relays, placed in
 * free cells outside every block's box and off the screen; no glue wire may
 * cross the screen or its bezel margin. Records every glue neuron and
 * connection (the mutation test cuts exactly these).
 */
class Glue {
  readonly ids: string[] = [];
  readonly conns: Array<[string, string]> = [];
  private cells = new Map<string, Cell>();
  private occupied = new Set<string>();
  private near = new Map<string, number>();

  constructor(
    private b: NetworkBuilder,
    private boxes: Rect[],
    private bezel: Rect,
  ) {
    for (const n of b.build().neurons) this.track(n.id, n);
  }

  private track(id: string, c: Cell) {
    this.cells.set(id, { x: c.x, y: c.y });
    this.occupied.add(cellKey(c));
  }

  cell(id: string): Cell {
    const c = this.cells.get(id);
    if (!c) throw new Error(`glue: unknown neuron ${id}`);
    return c;
  }

  ticks(a: string, z: string): number {
    return tt(this.cell(a), this.cell(z));
  }

  /** Free for a relay: empty, off the screen and its margin, outside every block. */
  free(c: Cell): boolean {
    return !this.occupied.has(cellKey(c)) && !inRect(c, this.bezel) && !this.boxes.some((r) => inRect(c, r));
  }

  /** A hop may not cross the screen or its margin (their cells' squares). */
  ok = (p: Cell, q: Cell) => !segmentHitsRect(p, q, squares(this.bezel));

  /** Hop cost: its length plus a penalty per neuron it passes over (within 0.45 of the centre). */
  cost = (p: Cell, q: Cell) => {
    const k = `${cellKey(p)}>${cellKey(q)}`;
    let c = this.near.get(k);
    if (c === undefined) {
      c = 0;
      for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++)
        for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) {
          const m = { x, y };
          if ((x !== p.x || y !== p.y) && (x !== q.x || y !== q.y) && this.occupied.has(cellKey(m)) && segmentDistance(p, q, m) < 0.45) c++;
        }
      this.near.set(k, c);
    }
    return Math.hypot(p.x - q.x, p.y - q.y) + 2 * c;
  };

  wire(from: string, to: string | string[]) {
    for (const t of Array.isArray(to) ? to : [to]) {
      if (!this.ok(this.cell(from), this.cell(t))) throw new Error(`glue: ${from} -> ${t} crosses the screen`);
      this.b.connect(from, t);
      this.conns.push([from, t]);
    }
  }

  /** Free cells of a rectangle. */
  region(r: Rect): Cell[] {
    const out: Cell[] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (this.free({ x, y })) out.push({ x, y });
    return out;
  }

  /** Relay cells for a line a -> z of exactly `total` ticks, or undefined. */
  plan(a: string, z: string, total: number, region: Rect, maxRelays = 3): Cell[] | undefined {
    return searchDelay(this.cell(a), this.cell(z), total, this.region(region), this.ok, maxRelays, this.cost);
  }

  /** Build a planned line (relays named `${name}-1`, ...); returns the relay ids. */
  build(a: string, z: string, path: Cell[], name: string, label?: string): string[] {
    const relays = path.map((c, i) => {
      const id = this.b.normal(c.x, c.y, 1, { id: `${name}-${i + 1}`, ...(label && i === path.length - 1 ? { label } : {}) });
      this.track(id, c);
      this.ids.push(id);
      return id;
    });
    const chain = [a, ...relays, z];
    for (let i = 0; i + 1 < chain.length; i++) this.wire(chain[i]!, chain[i + 1]!);
    return relays;
  }

  /**
   * Lines from each a_i to z_i, all exactly T ticks: the smallest T >= atLeast
   * for which every line fits (planned in order, each avoiding the earlier
   * ones' relays). Builds them; returns T.
   */
  equalLines(pairs: Array<[string, string, string]>, region: Rect, atLeast = 0, maxRelays = 3): number {
    const lo = Math.max(atLeast, ...pairs.map(([a, z]) => this.ticks(a, z)));
    for (let T = lo; T < lo + 600; T++) {
      const paths: Cell[][] = [];
      const taken = new Set<string>();
      for (const [a, z] of pairs) {
        const cands = this.region(region).filter((c) => !taken.has(cellKey(c)));
        const p = searchDelay(this.cell(a), this.cell(z), T, cands, this.ok, maxRelays, this.cost);
        if (!p) break;
        p.forEach((c) => taken.add(cellKey(c)));
        paths.push(p);
      }
      if (paths.length < pairs.length) continue;
      pairs.forEach(([a, z, name], i) => this.build(a, z, paths[i]!, name));
      return T;
    }
    throw new Error(`glue: no equal lines for ${pairs.map((p) => p[2]).join(', ')}`);
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
  /** The lamp rectangle (cells). */
  screen: Rect;
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
  latency: { strobeToLamp: [number, number]; pressToLampMin: number; pressToLampMax: number };
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

/** Where the glue's relays may go: the free cells left of the planes. */
const GLUE_REGION: Rect = { x0: -10, y0: -4, x1: 19, y1: 72 };

export function buildSnake(opts: SnakeOptions = {}): Snake {
  const F = opts.F ?? 480;
  const start = opts.start ?? { x: 0, y: 3 };
  const b = new NetworkBuilder();
  const parts = placeBlocks(b, F, start);
  const { control: ctl, headX: hx, headY: hy, tailX: tx, tailY: ty, headSelect: hs, tailSelect: ts, queue: q } = parts;
  const s0 = LAYOUT.screen;
  const screen: Rect = { x0: s0.x0, y0: s0.y0, x1: s0.x0 + W - 1, y1: s0.y0 + H - 1 };
  const bezel: Rect = { x0: screen.x0 - 1, y0: screen.y0 - 1, x1: screen.x1 + 1, y1: screen.y1 + 1 };
  const glue = new Glue(b, Object.values(blocksOf(b.build())).map((bl) => bl.box), bezel);
  const line = (a: string, z: string, total: number, name: string) => {
    const path = glue.plan(a, z, total, GLUE_REGION);
    if (!path) throw new Error(`snake: no ${total}-tick line ${a} -> ${z}`);
    return glue.build(a, z, path, name);
  };
  const st = ctl.strobes;
  const T0 = ctl.strobeOffset;

  // Ring lines drive the select planes: straight wires, line j to input j.
  for (const [ring, sel] of [[hx, hs], [tx, ts]] as const) ring.lines.forEach((l, i) => glue.wire(l, sel.cols[i]!));
  for (const [ring, sel] of [[hy, hs], [ty, ts]] as const) ring.lines.forEach((l, j) => glue.wire(l, sel.rows[j]!));
  /** Offsets of the row (or column) fires after the ring's move, per position. */
  const fires = (ring: Ring, inputs: string[]) => ring.lines.map((l, j) => ring.readLag + ring.lineDelay[j]! + glue.ticks(l, inputs[j]!));

  // Head: the Y ring moves as early as it can; the X ring late enough that
  // every row fires inside the plane's skew window before every column.
  const hY = T0 + glue.equalLines([[st.down, hy.fwd, 'g-hy-fwd'], [st.up, hy.back, 'g-hy-back']], GLUE_REGION);
  const headRows = fires(hy, hs.rows).map((r) => hY + r);
  const headCols = fires(hx, hs.cols);
  const hX = T0 + glue.equalLines([[st.right, hx.fwd, 'g-hx-fwd'], [st.left, hx.back, 'g-hx-back']], GLUE_REGION, Math.max(...headRows) - hs.skew.max - Math.min(...headCols) - T0);
  line(ctl.clock, hy.read, hY + hy.readLag, 'g-hy-read');
  line(ctl.clock, hx.read, hX + hx.readLag, 'g-hx-read');

  // Queue: each strobe feeds its lane; shift comes so that the earliest input is exactly on time.
  const lanes = [st.right, st.left, st.down, st.up];
  lanes.forEach((s, l) => glue.wire(s, q.inputs[l]!));
  const inputs = lanes.map((s, l) => T0 + glue.ticks(s, q.inputs[l]!));
  const shift = Math.min(...inputs) - q.inAt;
  line(ctl.clock, q.shift, shift, 'g-q-shift');

  // Tail: driven by the queue outputs (frame k replays frame k - L), read by ANY.
  const out = shift + q.outLag;
  const tY = out + glue.equalLines([[q.outputs[2]!, ty.fwd, 'g-ty-fwd'], [q.outputs[3]!, ty.back, 'g-ty-back']], GLUE_REGION);
  const tailRows = fires(ty, ts.rows).map((r) => tY + r);
  const tailCols = fires(tx, ts.cols);
  const tX = out + glue.equalLines([[q.outputs[0]!, tx.fwd, 'g-tx-fwd'], [q.outputs[1]!, tx.back, 'g-tx-back']], GLUE_REGION, Math.max(...tailRows) - ts.skew.max - Math.min(...tailCols) - out);
  line(q.any, ty.read, tY + ty.readLag - out - q.anyLag, 'g-ty-read');
  line(q.any, tx.read, tX + tx.readLag - out - q.anyLag, 'g-tx-read');

  // Power-on: the control unit's one-shot timer (tick 1) powers every block.
  for (const p of [hx.power, hy.power, tx.power, ty.power, q.power, hs.power, ts.power]) glue.wire(ctl.power, p);

  const network = b.build();
  return assemble({ b, network, parts, glue, F, start, screen, bezel, hX, hY, tX, tY, shift, inputs, headRows, headCols, tailRows, tailCols });
}

interface Solved {
  b: NetworkBuilder;
  network: Network;
  parts: Snake['parts'] & { lamps: string[][] };
  glue: Glue;
  F: number;
  start: { x: number; y: number };
  screen: Rect;
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
    return { moveX, moveY, readX: moveX + (name === 'head' ? hx : tx).readLag, readY: moveY + (name === 'head' ? hy : ty).readLag, cols: span(cols), rows: span(rows), skew, window: [sel.skew.min, sel.skew.max], lamp: span(lamp), q: span(qf) };
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
    screen: s.screen,
    bezel: s.bezel,
    blocks,
    parts,
    glue: { ids: glueIds, connections: glue.conns },
    F,
    start,
    frameTick,
    settledTick: (k) => frameTick(k) + lampSpan[1],
    schedule,
    latency: { strobeToLamp, pressToLampMin: toStrobe[0] + strobeToLamp[0], pressToLampMax: toStrobe[1] + strobeToLamp[1] },
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

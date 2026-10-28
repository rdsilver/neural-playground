import { NetworkBuilder, travelTicks } from '../engine';
import { at, type Cell, type Place } from './snake-control';

/**
 * Move queue of the Neural Snake: delays each move strobe (one lane per
 * direction) by exactly `depth` frames, so the tail can replay the head's
 * moves L frames late.
 *
 * Design: one conveyor (shift register) per lane, `depth` stage cells
 * (threshold 1) in a column. A stage holds a queued move as charge 0 (a
 * token); an empty stage rests at -1 (a hole). Power-on digs the holes.
 * Every frame the shift source P broadcasts a pair to every stage: +1
 * straight from P, -1 through the shared Inhibitor M next to P.
 * - an empty stage goes -1, 0, -1: nothing happens;
 * - a holder goes 0, 1: it fires (back to 0) and the -1 empties it (-1).
 *   Firing, it hands its token (+1) to the stage below, which must land
 *   after that stage's own -1 (else that stage would fire twice). The tokens
 *   flow TOWARD P: a token's path P -> S_d -> S_d+1 is about two cells longer
 *   than P -> S_d+1, so it always lands well after the pair. queueTiming()
 *   checks this, and every other timing fact, from the cells.
 * - an input fire lands +1 on stage 0 after its pair; the last stage's fire
 *   (when a pair finds it holding) is the lane's output.
 *
 * Exact delay. The conveyor is clocked: the last stages all sit at distance
 * sqrt(5) from P ((+-1, -2), (+-2, -1): the lanes are staggered by one row),
 * so every output fires exactly outLag ticks after a shift fire. An input
 * fired w ticks after shift fire s comes out at s + depth*F + outLag, a delay
 * of depth*F + (outLag - w). So the delay is exactly depth*F when w = outLag:
 * that is inAt, and inWindow is that single offset. (Keeping the input's own
 * phase for `depth` frames would need an F-tick delay line, which an
 * F-independent layout cannot have.) Any w in `tolerance` still queues the
 * move for exactly `depth` frames, output at shift + outLag; the input wire is
 * made just long enough for inAt to be inside it.
 *
 * ANY: each last stage also drives a relay A_l, and the four A_l sit at
 * distance sqrt(5) from ANY, so ANY fires anyLag after any output.
 *
 * Local layout (x right, y down; P at the origin; depth 4, 4 lanes):
 *
 *     x: -2  -1   0   1   2
 *   y=-8  I0  I1      I2  I3     inputs (one row)
 *   y=-5      S       S          lane columns, stage 0 at the top;
 *   y=-4  S   S   ON  S   S      inner lanes one row higher than outer ones
 *   y=-3  S   S       S   S      (ON: the power-on Inhibitor)
 *   y=-2  S   S       S   S
 *   y=-1  S   A1  M   A2  S      M: the pair's shared -1 source
 *   y= 0  A0      P       A3     P: shift (the pair's +1 source)
 *   y= 1          ANY
 *
 * Frame schedule, ticks after a shift fire (depth 4, 4 lanes). Asserted in
 * snake-queue.test.ts.
 *
 *   event                                          ticks
 *   shift fires (P); M fires                       0; 15
 *   pair +1 / -1 lands on stage cells              34-77 / 37-77    holders fire on the +1
 *   last stages fire = outputs (if holding)        34               outLag
 *   input fires, for an exact depth*F delay        34               inAt
 *   input +1 lands on stage 0                      94
 *   ANY fires (if an output fired)                 83               outLag + anyLag
 *   settled moment: all at rest (restFor)          94               settle
 *   input offsets that still queue for depth       32..F+33         tolerance
 *   smallest frame period                          61               minF
 *   power must precede the first shift by          >= 0             powerLead
 */

export interface QueueOptions {
  /** Number of lanes (1-4): RIGHT, LEFT, DOWN, UP in the snake. */
  lanes: number;
  /** Frames each input is held (the snake's length L). */
  depth: number;
  /** Prefix for every neuron id. */
  prefix: string;
  /** Frame period in ticks (shift fires every F ticks). */
  F: number;
  /** Optional labels for the input neurons, one per lane. */
  labels?: string[];
}

export interface Queue {
  /** Fire inputs[l] (at most one lane per frame) inAt ticks after a shift fire. */
  inputs: string[];
  /** outputs[l] fires exactly `delay` ticks after inputs[l] fired; nothing else fires them. */
  outputs: string[];
  /** Fire every frame (period F). */
  shift: string;
  /** Fires once per output fire, anyLag ticks after it (the tail rings' read clock). */
  any: string;
  /** Fire once, at least powerLead ticks before the first shift. */
  power: string;
  powerLead: number;
  /** Allowed (input fire - shift fire): exactly inAt, the offset that makes the delay exactly depth*F. */
  inWindow: { min: number; max: number };
  /** Ticks from an input fire (inside inWindow) to its output fire: depth*F. */
  delay: number;
  anyLag: number;
  /** At shift fire + settle every neuron is at rest (restFor) until the next frame's pair lands. */
  settle: number;
  /**
   * Resting charge of every neuron at the settled moment. queued[d] is the
   * lane held by stage d (the input of d frames ago; null when empty);
   * omitted stages are empty.
   */
  restFor(queued?: ReadonlyArray<number | null>): Record<string, number>;
  /** Smallest frame period this layout supports. */
  minF: number;
  /** = inWindow.min: input offset (after shift) giving delay = depth*F. */
  inAt: number;
  /** Every output fires exactly outLag ticks after a shift fire. */
  outLag: number;
  /**
   * Input offsets (after shift) that still hold the move exactly `depth`
   * frames: output at shift + outLag, delay = depth*F + inAt - offset. Inputs
   * after inAt land later than `settle` (the settled moment moves with them).
   */
  tolerance: { min: number; max: number };
  /** Stage cells per lane, stage 0 first (for tests and probes). */
  stages: string[][];
}

const tt = (a: Cell, b: Cell) => travelTicks(a, b);

/** Lane columns, left to right, by number of lanes; each on the sqrt(5) circle around P. */
const COLUMNS: Record<number, number[]> = { 1: [1], 2: [-1, 1], 3: [-1, 1, 2], 4: [-2, -1, 1, 2] };

/** Local cells by role: shift, minus, power, any, in{l}, a{l}, s{l}.{d}. */
function queueLayout(lanes: number, depth: number, inputRise: number): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const add = (role: string, c: Cell) => {
    for (const [r, q] of cells) if (q.x === c.x && q.y === c.y) throw new Error(`queue layout: ${role} and ${r} share a cell`);
    cells.set(role, c);
  };
  add('shift', { x: 0, y: 0 });
  add('minus', { x: 0, y: -1 });
  add('any', { x: 0, y: 1 });
  add('power', { x: 0, y: -2 }); // next to M: its holes beat every pair
  const cols = COLUMNS[lanes]!;
  const top = -2 - depth; // stage 0 row of the inner lanes
  cols.forEach((x, l) => {
    const last = Math.abs(x) === 1 ? -2 : -1; // (+-1, -2) and (+-2, -1): distance sqrt(5) from P
    for (let d = 0; d < depth; d++) add(`s${l}.${d}`, { x, y: last - (depth - 1 - d) });
    add(`a${l}`, { x, y: last + 1 }); // (+-1, -1) and (+-2, 0): distance sqrt(5) from ANY
    add(`in${l}`, { x, y: top + 1 - inputRise });
  });
  return cells;
}

interface QueueTiming {
  outLag: number;
  anyLag: number;
  settle: number;
  minF: number;
  powerLead: number;
  /** Input offsets that queue correctly: min .. maxMinusF + F. */
  tolerance: { min: number; maxMinusF: number };
}

/** An arrival: tick (after shift) and the tick its pulse was created; earlier-created lands first on a tie. */
type Arrival = [tick: number, created: number];
const after = (a: Arrival, b: Arrival) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/**
 * Every timing fact of the layout, from the cells, relative to a shift fire
 * (input at inAt = outLag). Throws if any constraint is violated, or returns
 * undefined if only the input wire is too short (the caller lengthens it).
 */
function queueTiming(lanes: number, depth: number, cells: Map<string, Cell>): QueueTiming | undefined {
  const c = (role: string) => cells.get(role)!;
  const t = (a: string, z: string) => tt(c(a), c(z));
  const s = (l: number, d: number) => `s${l}.${d}`;
  const plus = (l: number, d: number): Arrival => [t('shift', s(l, d)), 0];
  const minus = (l: number, d: number): Arrival => [t('shift', 'minus') + t('minus', s(l, d)), t('shift', 'minus')];
  const outs = Array.from({ length: lanes }, (_, l) => plus(l, depth - 1)[0]);
  if (new Set(outs).size !== 1) throw new Error('queue: outputs fire on different ticks');
  const outLag = outs[0]!;
  const anys = Array.from({ length: lanes }, (_, l) => t(s(l, depth - 1), `a${l}`) + t(`a${l}`, 'any'));
  if (new Set(anys).size !== 1) throw new Error('queue: ANY lags differ between lanes');
  let settle = 0;
  let minF = 0;
  let tolMin = -Infinity;
  let tolMax = Infinity;
  for (let l = 0; l < lanes; l++)
    for (let d = 0; d < depth; d++) {
      const [p, m] = [plus(l, d), minus(l, d)];
      if (!after(m, p)) throw new Error(`queue: -1 lands before +1 on ${s(l, d)}`);
      let token: Arrival;
      if (d > 0) {
        token = [plus(l, d - 1)[0] + t(s(l, d - 1), s(l, d)), plus(l, d - 1)[0]];
        if (!after(token, m)) throw new Error(`queue: token lands on ${s(l, d)} inside its pair`);
      } else {
        const a0 = t(`in${l}`, s(l, 0));
        token = [outLag + a0, outLag];
        // Input offsets w: land after the pair -1, before the next pair +1 (F = minF here).
        let w = m[0] - a0;
        while (!after([w + a0, w], m)) w++;
        tolMin = Math.max(tolMin, w);
        tolMax = Math.min(tolMax, p[0] - a0); // + F: land by the next pair's +1 (on a tie, either order fires S0 on that tick)
        if (!after(token, m)) return undefined;
      }
      settle = Math.max(settle, m[0], token[0]);
      minF = Math.max(minF, token[0] - p[0] + 1, m[0] - p[0] + 1);
    }
  const firstPlus = Math.min(...Array.from({ length: lanes }, (_, l) => Array.from({ length: depth }, (_, d) => plus(l, d)[0])).flat());
  minF = Math.max(minF, settle - firstPlus + 1);
  // Power's -1 hole must land before the first pair's +1: power fires `lead`
  // ticks before shift, hole - pair = h - lead; on a tie (h = lead) the hole
  // lands first only if power fired strictly earlier (lead > 0).
  let powerLead = -Infinity;
  for (let l = 0; l < lanes; l++)
    for (let d = 0; d < depth; d++) {
      const h = t('power', s(l, d)) - plus(l, d)[0];
      powerLead = Math.max(powerLead, h > 0 ? h : h + 1);
    }
  return { outLag, anyLag: anys[0]!, settle, minF, powerLead, tolerance: { min: tolMin, maxMinusF: tolMax } };
}

export function buildQueue(b: NetworkBuilder, place: Place, opts: QueueOptions): Queue {
  const { lanes, depth, prefix, F } = opts;
  if (!COLUMNS[lanes]) throw new Error(`queue ${prefix}: lanes must be 1-4, got ${lanes}`);
  if (!Number.isInteger(depth) || depth < 1) throw new Error(`queue ${prefix}: depth must be a positive integer`);
  // The input wire must be long enough for the input to land after stage 0's pair.
  let rise = 1;
  let T: QueueTiming | undefined;
  for (; !(T = queueTiming(lanes, depth, queueLayout(lanes, depth, rise))); rise++);
  const cells = queueLayout(lanes, depth, rise);
  if (F < T.minF) throw new Error(`queue ${prefix}: F=${F} is below this layout's minimum ${T.minF}`);
  const id = (role: string) => `${prefix}-${role}`;
  for (const [role, local] of cells) {
    const { x, y } = at(place, local.x, local.y);
    const l = /^in(\d+)$/.exec(role)?.[1];
    const label = l !== undefined ? (opts.labels?.[+l] ?? `IN${l}`) : ({ shift: 'SHIFT', any: 'ANY', power: 'ON' } as Record<string, string>)[role];
    const o = { id: id(role), ...(label ? { label } : {}) };
    if (role === 'minus' || role === 'power') b.inhibitor(x, y, 1, { label: '−1', ...o });
    else b.normal(x, y, 1, o);
  }
  const stages = Array.from({ length: lanes }, (_, l) => Array.from({ length: depth }, (_, d) => id(`s${l}.${d}`)));
  b.connect(id('shift'), id('minus'));
  stages.forEach((lane, l) => {
    b.connect(id('shift'), lane).connect(id('minus'), lane).connect(id('power'), lane);
    b.chain([id(`in${l}`), ...lane, id(`a${l}`), id('any')]);
  });
  const all = [...cells.keys()].map(id);
  const restFor = (queued: ReadonlyArray<number | null> = []) => {
    const rest: Record<string, number> = Object.fromEntries(all.map((x) => [x, 0]));
    stages.forEach((lane, l) => lane.forEach((x, d) => (rest[x] = queued[d] === l ? 0 : -1)));
    return rest;
  };
  return {
    inputs: stages.map((_, l) => id(`in${l}`)),
    outputs: stages.map((lane) => lane[depth - 1]!),
    shift: id('shift'), any: id('any'), power: id('power'), powerLead: T.powerLead,
    inWindow: { min: T.outLag, max: T.outLag }, delay: depth * F, anyLag: T.anyLag, settle: T.settle, restFor, minF: T.minF,
    inAt: T.outLag, outLag: T.outLag, tolerance: { min: T.tolerance.min, max: T.tolerance.maxMinusF + F }, stages,
  };
}

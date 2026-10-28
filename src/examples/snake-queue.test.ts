import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, travelTicks, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildQueue } from './snake-queue';

/** One frame of a scenario: the lane whose input fires (or null) and its offset after shift. */
interface Frame {
  lane: number | null;
  w?: number;
}

function makeQueue(F: number, depth = 4, lanes = 4) {
  const b = new NetworkBuilder();
  const q = buildQueue(b, { x0: 30, y0: 30, sx: 1 }, { lanes, depth, prefix: 'q', F });
  return { q, net: b.build(), F, depth, lanes };
}
type Unit = ReturnType<typeof makeQueue>;

const travel = (net: Network, a: string, z: string) => travelTicks(net.neurons.find((n) => n.id === a)!, net.neurons.find((n) => n.id === z)!);

interface RunOptions {
  /** Ticks from the power fire to the first shift fire (default powerLead). */
  lead?: number;
  /** On a same-tick power and shift, stimulate shift first (the worst case). */
  shiftFirst?: boolean;
  /** Run this network instead of the unit's (mutation tests). */
  net?: Network;
}

/**
 * Drive the queue: power once, shift k at s_k = P + lead + k*F, frame k's
 * input at s_k + w, then `depth` empty frames to flush. Returns the first
 * violated invariant (or undefined):
 * - every input comes out on its own lane at s_{k+depth} + outLag (exactly
 *   input + depth*F when w = inAt), and no output fires otherwise;
 * - ANY fires exactly once per output, anyLag after it;
 * - every stage fires on the beat: only at s_k + (its travel from shift);
 * - at s_k + settle every neuron of the block holds restFor(queue contents).
 */
function run(unit: Unit, frames: Frame[], opts: RunOptions = {}): string | undefined {
  const { q, F, depth } = unit;
  const net = opts.net ?? unit.net;
  const lead = opts.lead ?? q.powerLead;
  const p0 = 1 + Math.max(0, -lead);
  const s = (k: number) => p0 + lead + k * F;
  const sim = new Simulation(net);
  if (opts.shiftFirst) sim.schedule(s(0), q.shift);
  sim.schedule(p0, q.power);
  const total = frames.length + depth;
  for (let k = opts.shiftFirst ? 1 : 0; k < total; k++) sim.schedule(s(k), q.shift);
  const wOf = (f: Frame) => f.w ?? q.inAt;
  frames.forEach((f, k) => f.lane !== null && sim.schedule(s(k) + wOf(f), q.inputs[f.lane]!));

  const expected: string[] = [];
  frames.forEach((f, k) => {
    if (f.lane === null) return;
    const out = s(k + depth) + q.outLag;
    if (wOf(f) === q.inAt && out !== s(k) + q.inAt + q.delay) throw new Error('delay is not depth*F at inAt');
    expected.push(`${f.lane}@${out}`, `any@${out + q.anyLag}`);
  });
  const checks = new Map<number, number>(); // tick -> frame
  for (let k = 0; k < total; k++) checks.set(s(k) + q.settle, k);
  const laneOf = new Map(q.outputs.map((id, l) => [id, String(l)] as const));
  const beat = new Map(q.stages.flat().map((id) => [id, travel(net, q.shift, id)] as const));
  const seen: string[] = [];
  const ids = Object.keys(q.restFor());
  const end = s(total - 1) + Math.max(q.settle, q.outLag + q.anyLag) + 1;
  while (sim.tick < end) {
    for (const e of sim.step()) {
      const l = e.neuron === q.any ? 'any' : laneOf.get(e.neuron);
      if (l !== undefined) seen.push(`${l}@${e.tick}`);
      const p = beat.get(e.neuron);
      if (p !== undefined && ((e.tick - s(0) - p) % F !== 0 || e.tick < s(0))) return `${e.neuron} fires off the beat at tick ${e.tick}`;
    }
    const k = checks.get(sim.tick);
    if (k === undefined) continue;
    const queued = Array.from({ length: depth }, (_, d) => {
      const f = frames[k - d];
      if (!f || f.lane === null) return null;
      if (d > 0) return f.lane;
      return wOf(f) + travel(net, q.inputs[f.lane]!, q.stages[f.lane]![0]!) <= q.settle ? f.lane : null;
    });
    const rest = q.restFor(queued);
    for (const id of ids) if (sim.charge(id) !== rest[id]) return `${id} holds ${sim.charge(id)}, not ${rest[id]}, at s_${k} + settle (tick ${sim.tick})`;
  }
  const sort = (xs: string[]) => [...xs].sort((a, b) => +a.split('@')[1]! - +b.split('@')[1]! || a.localeCompare(b));
  const [a, b] = [sort(seen).join(' '), sort(expected).join(' ')];
  return a === b ? undefined : `fires ${a.slice(0, 300)}\nexpected ${b.slice(0, 300)}`;
}

/** Random lanes, about a quarter of the frames empty. */
function randomFrames(seed: number, n: number, lanes = 4): Frame[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => (rng() < 0.25 ? { lane: null } : { lane: Math.floor(rng() * lanes) }));
}

const minF = makeQueue(480).q.minF;
const F_VALUES = [240, 480, minF];

describe('move queue', () => {
  for (const F of F_VALUES) {
    it(`F=${F}: every lane, inputs across the whole tolerance window, exact output ticks`, () => {
      const unit = makeQueue(F);
      const { q } = unit;
      expect(q.inWindow).toEqual({ min: q.inAt, max: q.inAt });
      expect(q.tolerance.min).toBeLessThanOrEqual(q.inAt);
      for (let l = 0; l < 4; l++) {
        const frames: Frame[] = [];
        for (let w = q.tolerance.min; w <= q.tolerance.max; w++) frames.push({ lane: l, w }, { lane: (l + 1 + (w % 3)) % 4 });
        expect(run(unit, frames)).toBeUndefined();
      }
    });

    it(`F=${F}: 3000 random frames (with empty frames), three seeds`, () => {
      const unit = makeQueue(F);
      for (const seed of [1, 2, 3]) expect(run(unit, randomFrames(seed, 3000))).toBeUndefined();
    });

    it(`F=${F}: runs of the same lane, all-empty stretches, all lanes in a row`, () => {
      const unit = makeQueue(F);
      const frames: Frame[] = [];
      for (let l = 0; l < 4; l++) for (let i = 0; i < 6; i++) frames.push({ lane: l });
      for (let i = 0; i < 6; i++) frames.push({ lane: null });
      for (let i = 0; i < 12; i++) frames.push({ lane: i % 4 }, { lane: null });
      expect(run(unit, frames)).toBeUndefined();
    });
  }

  it('an input outside the tolerance window breaks it', () => {
    const unit = makeQueue(240);
    const { q } = unit;
    const frames = (w: number): Frame[] => [{ lane: null }, ...[0, 1, 2, 3].flatMap((l) => [{ lane: l, w }, { lane: null }])];
    expect(run(unit, frames(q.tolerance.min))).toBeUndefined();
    expect(run(unit, frames(q.tolerance.max))).toBeUndefined();
    expect(run(unit, frames(q.tolerance.min - 1))).toBeDefined();
    expect(run(unit, frames(q.tolerance.max + 1))).toBeDefined();
  });

  it('works at its own minimum frame period, and refuses a shorter one', () => {
    for (const depth of [1, 2, 3, 4, 6]) {
      const { q } = makeQueue(480, depth);
      expect(run(makeQueue(q.minF, depth), randomFrames(depth, 300))).toBeUndefined();
      expect(() => makeQueue(q.minF - 1, depth)).toThrow(/below/);
    }
  });

  it('other depths and lane counts', () => {
    for (const lanes of [1, 2, 3, 4])
      for (const depth of [1, 2, 3, 5]) for (const F of [240, 480]) expect(run(makeQueue(F, depth, lanes), randomFrames(lanes * 10 + depth, 200, lanes))).toBeUndefined();
  });

  it('power-on: powerLead ticks before the first shift is enough, one tick less is not', () => {
    const unit = makeQueue(240);
    const frames = randomFrames(5, 12);
    expect(run(unit, frames, { lead: unit.q.powerLead })).toBeUndefined();
    expect(run(unit, frames, { lead: unit.q.powerLead, shiftFirst: true })).toBeUndefined();
    expect(run(unit, frames, { lead: unit.q.powerLead + 100 })).toBeUndefined();
    expect(run(unit, frames, { lead: unit.q.powerLead - 1, shiftFirst: true })).toBeDefined();
  });
});

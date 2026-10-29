import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, travelTicks, type Network, type Pulse } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildQueue } from './snake-queue';
import { at, type Place } from './snake-control';

/** One frame of a scenario: the lane whose input fires (or null) and its offset after shift. */
interface Frame {
  lane: number | null;
  w?: number;
}

/**
 * The queue (prefix q-) plus one external sink per output and one for ANY
 * (prefix sink-): huge-threshold cells that count the charge the block's
 * outputs deliver, so the tests also see the polarity of those pulses.
 */
function makeQueue(F: number, depth = 4, lanes = 4, extra: { place?: Place; wired?: boolean } = {}) {
  const b = new NetworkBuilder();
  const place = extra.place ?? { x0: 30, y0: 30, sx: 1 };
  const q = buildQueue(b, place, { lanes, depth, prefix: 'q', F });
  const sinks = [...q.outputs, q.any].map((from, i) => {
    const id = `sink-${i}`;
    b.normal(40 + i, 33, 1_000_000, { id });
    b.connect(from, id);
    return id;
  });
  // wired: shift, power and every input are fired by a pulse from a driver
  // cell outside the block (as in the snake) instead of by a stimulus.
  const drive = new Map<string, { via: string; lag: number }>();
  if (extra.wired) {
    const drivers: [string, number, number][] = [[q.shift, -4, 0], [q.power, -4, -2], ...q.inputs.map((id, l) => [id, [-2, -1, 1, 2][l]!, -10 - depth] as [string, number, number])];
    for (const [to, x, y] of drivers) {
      const c = at(place, x, y);
      b.normal(c.x, c.y, 1, { id: `drv-${to}` });
      b.connect(`drv-${to}`, to);
      drive.set(to, { via: `drv-${to}`, lag: travelTicks(c, b.build().neurons.find((n) => n.id === to)!) });
    }
  }
  return { q, net: b.build(), F, depth, lanes, sinks, drive };
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
 * - at s_k + settle every neuron of the block holds restFor(queue contents),
 *   and every pulse inside the block sent before s_{k+1} has landed,
 *   except a late input's (one fired after s_k + inAt);
 * - the sinks receive +1 per output (and per ANY) fire: the outputs and ANY
 *   are excitatory.
 */
function run(unit: Unit, frames: Frame[], opts: RunOptions = {}): string | undefined {
  const { q, F, depth, sinks, drive } = unit;
  const net = opts.net ?? unit.net;
  const lead = opts.lead ?? q.powerLead;
  const p0 = 1 + Math.max(0, -lead) + 60 * drive.size;
  const s = (k: number) => p0 + lead + k * F;
  const sim = new Simulation(net);
  // Make `id` fire at tick t: a stimulus, or (wired) its driver's pulse.
  const fire = (t: number, id: string) => {
    const d = drive.get(id);
    sim.schedule(d ? t - d.lag : t, d ? d.via : id);
  };
  if (opts.shiftFirst) fire(s(0), q.shift);
  fire(p0, q.power);
  const total = frames.length + depth;
  for (let k = opts.shiftFirst ? 1 : 0; k < total; k++) fire(s(k), q.shift);
  const wOf = (f: Frame) => f.w ?? q.inAt;
  frames.forEach((f, k) => f.lane !== null && fire(s(k) + wOf(f), q.inputs[f.lane]!));

  const expected: string[] = [];
  const delivered = sinks.map(() => 0); // +1 per output fire on each sink, then per ANY fire
  frames.forEach((f, k) => {
    if (f.lane === null) return;
    const out = s(k + depth) + q.outLag;
    if (wOf(f) === q.inAt && out !== s(k) + q.inAt + q.delay) throw new Error('delay is not depth*F at inAt');
    expected.push(`${f.lane}@${out}`, `any@${out + q.anyLag}`);
    delivered[f.lane]!++;
    delivered[sinks.length - 1]!++;
  });
  const checks = new Map<number, number>(); // tick -> frame
  for (let k = 0; k < total; k++) checks.set(s(k) + q.settle, k);
  const laneOf = new Map(q.outputs.map((id, l) => [id, String(l)] as const));
  const beat = new Map(q.stages.flat().map((id) => [id, travel(net, q.shift, id)] as const));
  const seen: string[] = [];
  const ids = Object.keys(q.restFor());
  const block = new Set(ids);
  const inputs = new Set(q.inputs);
  const end = s(total - 1) + q.settle + 1;
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
      return wOf(f) + q.inTravel[f.lane]! <= q.settle ? f.lane : null;
    });
    const rest = q.restFor(queued);
    for (const id of ids) if (sim.charge(id) !== rest[id]) return `${id} holds ${sim.charge(id)}, not ${rest[id]}, at s_${k} + settle (tick ${sim.tick})`;
    const late = (x: Pulse) => inputs.has(x.from) && x.startTick > s(k) + q.inAt;
    const busy = sim.pulses().find((x) => block.has(x.from) && block.has(x.to) && x.startTick < s(k + 1) && !late(x));
    if (busy) return `${busy.from} -> ${busy.to} still in flight at s_${k} + settle (tick ${sim.tick})`;
  }
  // Let the last pulses reach the sinks.
  while (sim.pulses().some((x) => !block.has(x.to))) sim.step();
  const got = sinks.map((id) => sim.charge(id));
  if (got.join() !== delivered.join()) return `sinks hold ${got}, expected ${delivered}`;
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

  it('tolerance edges are exact for every lane count and depth', () => {
    for (const lanes of [1, 2, 3, 4])
      for (const depth of [1, 2, 3, 4, 5, 6, 8]) {
        const m = makeQueue(480, depth, lanes).q.minF;
        for (const F of [240, m]) {
          const unit = makeQueue(F, depth, lanes);
          const { tolerance: tol } = unit.q;
          const frames = (w: number): Frame[] => [{ lane: null }, ...Array.from({ length: lanes }, (_, l) => [{ lane: l, w }, { lane: null }]).flat()];
          const at = `lanes ${lanes} depth ${depth} F ${F}`;
          expect(run(unit, frames(tol.min)), `${at}: min`).toBeUndefined();
          expect(run(unit, frames(tol.max)), `${at}: max`).toBeUndefined();
          expect(run(unit, frames(tol.min - 1)), `${at}: min - 1`).toBeDefined();
          expect(run(unit, frames(tol.max + 1)), `${at}: max + 1`).toBeDefined();
        }
      }
  });

  it('works at its own minimum frame period, and refuses a shorter one', () => {
    for (const depth of [1, 2, 3, 4, 6]) {
      const { q } = makeQueue(480, depth);
      expect(run(makeQueue(q.minF, depth), randomFrames(depth, 300))).toBeUndefined();
      expect(() => makeQueue(q.minF - 1, depth)).toThrow(/below/);
    }
  });

  it('mirrored placements, and shift / power / inputs fired by wires instead of stimuli', () => {
    const places: Place[] = [{ x0: 30, y0: 30, sx: -1 }, { x0: 30, y0: 30, sx: 1, sy: -1 }, { x0: 30, y0: 30, sx: -1, sy: -1 }];
    for (const F of [240, minF]) {
      for (const place of places) expect(run(makeQueue(F, 4, 4, { place }), randomFrames(F + place.sx, 300))).toBeUndefined();
      for (const place of [undefined, ...places]) {
        const unit = makeQueue(F, 4, 4, { place, wired: true });
        expect(run(unit, randomFrames(F + 7, 300))).toBeUndefined();
        const { tolerance: tol } = unit.q;
        for (const w of [tol.min, tol.max]) expect(run(unit, [0, 1, 2, 3].flatMap((lane) => [{ lane, w }, { lane: null }]))).toBeUndefined();
      }
    }
  });

  it('other depths and lane counts', () => {
    for (const lanes of [1, 2, 3, 4])
      for (const depth of [1, 2, 3, 5]) for (const F of [240, 480]) expect(run(makeQueue(F, depth, lanes), randomFrames(lanes * 10 + depth, 200, lanes))).toBeUndefined();
  });

  it('power-on: powerLead ticks before the first shift is enough, one tick less is not', () => {
    for (const lanes of [1, 2, 3, 4]) {
      const unit = makeQueue(240, 4, lanes);
      const { powerLead } = unit.q;
      const frames = randomFrames(5, 12, lanes);
      expect(run(unit, frames, { lead: powerLead })).toBeUndefined();
      expect(run(unit, frames, { lead: powerLead + 100 })).toBeUndefined();
      expect(run(unit, frames, { lead: powerLead - 1, shiftFirst: true })).toBeDefined();
    }
    // 4 lanes: powerLead is 1 because one hole ties with its first pair +1
    // when power and shift fire on the same tick. At lead 0 the fire order
    // decides: power first works, shift first does not. powerLead is the
    // smallest lead that works whatever the order.
    const unit = makeQueue(240);
    expect(unit.q.powerLead).toBe(1);
    expect(run(unit, randomFrames(5, 12), { lead: 0 })).toBeUndefined();
    expect(run(unit, randomFrames(5, 12), { lead: 0, shiftFirst: true })).toBeDefined();
  });
});

describe('queue timing', () => {
  /**
   * The frame schedule (depth 4, 4 lanes), in ticks after a shift fire; the
   * same table is in snake-queue.ts.
   *
   *   event                                          ticks
   *   shift fires (P); M fires                       0; 15
   *   pair +1 / -1 lands on stage cells              34-77 / 37-77    holders fire on the +1
   *   tokens handed down land                        58-92
   *   last stages fire = outputs (if holding)        34               outLag
   *   input fires, for an exact depth*F delay        34               inAt
   *   input +1 lands on stage 0                      79 (inner), 94 (outer lanes)
   *   ANY fires (if an output fired)                 83               outLag + anyLag
   *   settled moment: all landed, at rest (restFor)  94               settle
   *   input offsets that still queue for depth       32 .. F+8        tolerance
   *   smallest frame period                          61               minF
   *   power must precede the first shift by          1                powerLead
   */
  it('matches the documented schedule', () => {
    for (const F of F_VALUES) {
      const { q } = makeQueue(F);
      const { inAt, outLag, anyLag, settle, minF: m, powerLead, delay, tolerance, inWindow } = q;
      expect({ inAt, outLag, anyLag, settle, minF: m, powerLead, delay, tolerance, inWindow }).toEqual({
        inAt: 34, outLag: 34, anyLag: 49, settle: 94, minF: 61, powerLead: 1, delay: 4 * F, tolerance: { min: 32, max: F + 8 }, inWindow: { min: 34, max: 34 },
      });
    }
  });

  it('every event happens at its documented tick', () => {
    const F = 240;
    const unit = makeQueue(F);
    const { q, net } = unit;
    const sim = new Simulation(net);
    const s0 = 2;
    sim.schedule(1, q.power);
    const frames = randomFrames(11, 200);
    frames.forEach((f, k) => {
      sim.schedule(s0 + k * F, q.shift);
      if (f.lane !== null) sim.schedule(s0 + k * F + q.inAt, q.inputs[f.lane]!);
    });
    const stages = q.stages.flat();
    const fires = new Map<string, Set<number>>();
    // A token (or input) landing is a rise from -1 to 0 after the stage's pair -1.
    const pm = new Map(stages.map((id) => [id, travel(net, q.shift, 'q-minus') + travel(net, 'q-minus', id)] as const));
    const landings = { stage: new Set<number>(), input: new Set<string>(), any: new Set<number>() };
    let last = new Map(stages.map((id) => [id, sim.charge(id)] as const));
    while (sim.tick < s0 + frames.length * F) {
      for (const e of sim.step()) {
        const role = e.neuron === q.any ? 'any' : q.outputs.includes(e.neuron) ? 'output' : stages.includes(e.neuron) ? 'stage' : e.neuron;
        if (!fires.has(role)) fires.set(role, new Set());
        fires.get(role)!.add((e.tick - s0) % F);
      }
      const o = (sim.tick - s0) % F;
      for (const id of sim.tick < s0 + F ? [] : stages) { // skip power-on
        const c = sim.charge(id);
        if (c !== last.get(id)) landings.any.add(o);
        if (last.get(id) === -1 && c === 0 && o > pm.get(id)!) {
          const lane = q.stages.findIndex((ln) => ln[0] === id);
          if (lane < 0) landings.stage.add(o);
          else landings.input.add(`${lane}@${o}`);
        }
      }
      last = new Map(stages.map((id) => [id, sim.charge(id)] as const));
    }
    const range = (xs: Set<number> | undefined) => [Math.min(...xs!), Math.max(...xs!)];
    expect(range(fires.get('q-shift'))).toEqual([0, 0]);
    expect(range(fires.get('q-minus'))).toEqual([15, 15]);
    expect(range(fires.get('stage'))).toEqual([43, 77]); // holders other than the last stages
    expect(range(fires.get('output'))).toEqual([34, 34]);
    expect(range(fires.get('any'))).toEqual([83, 83]);
    expect(range(landings.any)).toEqual([34, q.settle]); // every stage charge change of a frame
    expect(range(landings.stage)).toEqual([58, 92]);
    expect([...landings.input].sort()).toEqual(['0@94', '1@79', '2@79', '3@94']);
  });
});

describe('queue mutation test', () => {
  /**
   * Equivalent mutants, not counted as survivors (one line each):
   * - threshold 1 -> 0, on every neuron: the engine fires at charge >= max(1, threshold), so 0 behaves exactly as 1.
   * The test still runs them and checks that they really are equivalent.
   */
  const isEquivalent = (threshold: number) => threshold < 1;

  it('every single missing connection, every threshold +1 / -1 and every kind flip breaks an invariant', () => {
    const t0 = Date.now();
    const unit = makeQueue(minF);
    const { net } = unit;
    // Mutate the block only, not the test's sinks.
    const inBlock = (id: string) => id.startsWith('q-');
    // Every lane, back to back and apart, plus a seeded random tail with empty frames.
    const frames: Frame[] = [0, 1, 2, 3, null, 3, 2, 1, 0].map((lane) => ({ lane })).concat(randomFrames(9, 8));
    expect(run(unit, frames)).toBeUndefined();
    const survivors: string[] = [];
    let killed = 0;
    let equivalent = 0;
    const neurons = net.neurons.filter((n) => inBlock(n.id));
    const connections = net.connections.filter((c) => inBlock(c.from) && inBlock(c.to));
    net.connections.forEach((c, i) => {
      if (!inBlock(c.from) || !inBlock(c.to)) return;
      const mutant = { ...net, connections: net.connections.filter((_, j) => j !== i) };
      if (run(unit, frames, { net: mutant }) === undefined) survivors.push(`no ${c.from} -> ${c.to}`);
      else killed++;
    });
    const mutate = (i: number, change: Partial<Network['neurons'][number]>) => ({ ...net, neurons: net.neurons.map((m, j) => (j === i ? { ...m, ...change } : m)) });
    net.neurons.forEach((n, i) => {
      if (!inBlock(n.id)) return;
      for (const delta of [1, -1]) {
        const threshold = n.threshold + delta;
        const broken = run(unit, frames, { net: mutate(i, { threshold }) }) !== undefined;
        if (isEquivalent(threshold)) {
          expect(broken, `${n.id} threshold ${threshold} should be equivalent`).toBe(false);
          equivalent++;
        } else if (broken) killed++;
        else survivors.push(`${n.id} threshold ${threshold}`);
      }
      const kind = n.kind === 'negative' ? 'normal' : 'negative';
      if (run(unit, frames, { net: mutate(i, { kind }) }) !== undefined) killed++;
      else survivors.push(`${n.id} as ${kind}`);
    });
    expect(survivors).toEqual([]);
    expect([neurons.length, connections.length]).toEqual([28, 73]);
    expect(killed).toBe(connections.length + 2 * neurons.length);
    expect(equivalent).toBe(neurons.length);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});

describe('queue layout', () => {
  it('is the documented grid: lane columns, last stages on a circle around SHIFT, A relays on one around ANY', () => {
    const { q, net } = makeQueue(480);
    const cell = (id: string) => net.neurons.find((n) => n.id === id)!;
    const rel = (id: string) => ({ x: cell(id).x - cell(q.shift).x, y: cell(id).y - cell(q.shift).y });
    expect(q.stages.map((lane) => lane.map(rel))).toEqual(
      [-2, -1, 1, 2].map((x) => [3, 2, 1, 0].map((k) => ({ x, y: (Math.abs(x) === 1 ? -2 : -1) - k }))),
    );
    expect(q.inputs.map(rel)).toEqual([-2, -1, 1, 2].map((x) => ({ x, y: -8 })));
    expect([q.any, 'q-minus', q.power].map(rel)).toEqual([{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0, y: -2 }]);
    for (const out of q.outputs) expect(travel(net, q.shift, out)).toBe(q.outLag);
    q.outputs.forEach((out, l) => expect(travel(net, out, `q-a${l}`) + travel(net, `q-a${l}`, q.any)).toBe(q.anyLag));
    q.inputs.forEach((id, l) => expect(travel(net, id, q.stages[l]![0]!)).toBe(q.inTravel[l]));
    expect(q.inTravel).toEqual([60, 45, 45, 60]);
    const block = net.neurons.filter((n) => n.id.startsWith('q-'));
    expect([block.length, net.connections.filter((c) => c.to.startsWith('q-')).length]).toEqual([28, 73]);
    // Only M and ON are Inhibitors; everything else (outputs and ANY included) sends +1.
    expect(block.filter((n) => n.kind !== 'normal').map((n) => [n.id, n.kind])).toEqual([['q-minus', 'negative'], ['q-power', 'negative']]);
    expect(block.every((n) => n.threshold === 1)).toBe(true);
  });
});

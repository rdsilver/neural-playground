import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, travelTicks } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildBit, buildControl, DIRECTIONS, type Direction } from './snake-control';

// ---- bit model ---------------------------------------------------------------

interface Press {
  t: number;
  set: boolean;
}

/**
 * Exact model of one bit: a press poked at tick t reaches its gate at t+30;
 * it gets through iff that gate is open (the other gate's last change has
 * been news for 15 ticks). A change lands on the register 34 (SET) or 30
 * (RST) ticks after the gate. Returns, per read tick, whether G fires, plus
 * the register charge just before each read. Throws Ambiguous if a press
 * hits a gate exactly as news arrives (a tie the model does not decide).
 */
class Ambiguous extends Error {
  constructor(readonly press: Press) {
    super('ambiguous press');
  }
}
function bitModel(presses: Press[], reads: number[]) {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  let bit = 0;
  const open = { set: -Infinity, reset: Infinity }; // tick from which each gate is open
  const changes: Array<{ at: number; d: number; set: boolean }> = [];
  for (const p of sorted) {
    const a = p.t + 30;
    const gate = p.set ? 'set' : 'reset';
    if (open[gate] === a) throw new Ambiguous(p);
    if (open[gate] < a && (p.set ? bit === 0 : bit === 1)) {
      bit = p.set ? 1 : 0;
      open[gate] = Infinity;
      open[p.set ? 'reset' : 'set'] = a + 15;
      changes.push({ at: a + (p.set ? 34 : 30), d: p.set ? 1 : -1, set: p.set });
    }
  }
  const valueAt = (tick: number, includeSetAtTick: boolean) =>
    changes.filter((c) => c.at < tick || (c.at === tick && includeSetAtTick && c.set)).reduce((s, c) => s + c.d, 0);
  return reads.map((T) => ({ fires: valueAt(T, true) === 1, before: valueAt(T, false) }));
}

/** Drive a bit with presses; reads land on G at T0 + k*F. */
function runBit(F: number, frames: number, presses: Press[]) {
  const b = new NetworkBuilder();
  const bit = buildBit(b, { x0: 0, y0: 0, sx: 1 }, 'axis');
  const sim = new Simulation(b.build());
  sim.stimulate(bit.resetMinus); // power-on hole
  const T0 = 100;
  const reads = Array.from({ length: frames }, (_, k) => T0 + k * F);
  for (const T of reads) sim.schedule(T - 44, bit.readSource);
  for (const p of presses) sim.schedule(p.t, p.set ? bit.setSource : bit.resetSource);
  const fires: number[] = [];
  const before: number[] = [];
  const end = reads[reads.length - 1]! + F;
  while (sim.tick < end) {
    if (reads.includes(sim.tick + 1)) before.push(sim.charge(bit.register));
    for (const e of sim.step()) if (e.neuron === bit.register) fires.push(e.tick);
  }
  return { fires, before, reads };
}

function checkBit(F: number, frames: number, presses: Press[]): boolean {
  let model;
  try {
    model = bitModel(presses, Array.from({ length: frames }, (_, k) => 100 + k * F));
  } catch (e) {
    if (e instanceof Ambiguous) return false;
    throw e;
  }
  const { fires, before, reads } = runBit(F, frames, presses);
  expect(fires.every((t) => reads.includes(t))).toBe(true);
  expect(reads.map((T) => fires.includes(T))).toEqual(model.map((m) => m.fires));
  expect(before).toEqual(model.map((m) => m.before));
  return true;
}

describe('bit (flip-flop + register)', () => {
  it('SET then RST at every phase, every F', () => {
    for (const F of [60, 90, 120]) {
      for (let p = 0; p < F; p++) {
        checkBit(F, 8, [{ t: 100 + F + p, set: true }]);
        checkBit(F, 10, [
          { t: 100 + p, set: true },
          { t: 100 + 3 * F + p, set: false },
        ]);
      }
    }
  });

  it('every pair of presses within a frame-and-a-half', () => {
    const F = 90;
    for (const [s1, s2] of [[true, true], [true, false], [false, true], [false, false]] as const)
      for (let p = 0; p < F; p++)
        for (let d = 0; d < 140; d++) checkBit(F, 7, [{ t: 150 + p, set: s1 }, { t: 150 + p + d, set: s2 }, { t: 50, set: !s1 }]);
  });

  it('random bursts match the model', () => {
    const rng = mulberry32(7);
    let checked = 0;
    for (let run = 0; run < 300; run++) {
      const presses: Press[] = [];
      for (let i = 0; i < 25; i++) presses.push({ t: 20 + Math.floor(rng() * 1500), set: rng() < 0.5 });
      if (checkBit(90, 20, presses)) checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});

// ---- control unit ------------------------------------------------------------

interface KeyPress {
  t: number;
  key: Direction;
}

const F_VALUES = [64, 75, 90, 120];
const RESTS: Record<Direction, number> = { right: 0, left: -1, down: -1, up: -2 };

function makeControl(F: number) {
  const b = new NetworkBuilder();
  const ctl = buildControl(b, { x: 6, y: 0 }, { F });
  const net = b.build();
  const at = new Map(net.neurons.map((n) => [n.id, n]));
  const d = (a: string, c: string) => travelTicks(at.get(a)!, at.get(c)!);
  const { axis, sign } = ctl.bits;
  // Which bit inputs each key drives, and after how many ticks that source fires.
  const wiring: Record<Direction, Array<{ bit: 'axis' | 'sign'; set: boolean; delay: number }>> = {
    up: [{ bit: 'axis', set: true, delay: d(ctl.keys.up, axis.setSource) }, { bit: 'sign', set: true, delay: d(ctl.keys.up, sign.setSource) }],
    left: [{ bit: 'axis', set: false, delay: d(ctl.keys.left, axis.resetSource) }, { bit: 'sign', set: true, delay: d(ctl.keys.left, sign.setSource) }],
    down: [{ bit: 'axis', set: true, delay: d(ctl.keys.down, axis.setSource) }, { bit: 'sign', set: false, delay: d(ctl.keys.down, sign.resetSource) }],
    right: [{ bit: 'axis', set: false, delay: d(ctl.keys.right, axis.resetSource) }, { bit: 'sign', set: false, delay: d(ctl.keys.right, sign.resetSource) }],
  };
  return { ctl, net, wiring };
}
type Unit = ReturnType<typeof makeControl>;

/** Expected strobe direction per frame (throws Ambiguous on an undecided tie). */
function controlModel(F: number, frames: number, presses: KeyPress[], unit: Unit): Direction[] {
  const per = { axis: [] as Press[], sign: [] as Press[] };
  for (const p of presses) for (const w of unit.wiring[p.key]) per[w.bit].push({ t: p.t + w.delay, set: w.set });
  const reads = Array.from({ length: frames }, (_, k) => 1 + k * F + unit.ctl.readOffset);
  const a = bitModel(per.axis, reads);
  const s = bitModel(per.sign, reads);
  return reads.map((_, k) => (a[k]!.fires ? (s[k]!.fires ? 'up' : 'down') : s[k]!.fires ? 'left' : 'right'));
}

/** Drop presses until the model is unambiguous. */
function disambiguate(F: number, frames: number, presses: KeyPress[], unit: Unit): KeyPress[] {
  for (;;) {
    try {
      controlModel(F, frames, presses, unit);
      return presses;
    } catch (e) {
      if (!(e instanceof Ambiguous)) throw e;
      const bad = e.press;
      const i = presses.findIndex((p) => unit.wiring[p.key].some((w) => p.t + w.delay === bad.t && w.set === bad.set));
      presses = presses.filter((_, j) => j !== i);
    }
  }
}

/** Run the unit and check every frame against the model. Returns the strobes seen. */
function checkControl(F: number, frames: number, presses: KeyPress[], unit: Unit = makeControl(F)) {
  const { ctl, net } = unit;
  const expected = controlModel(F, frames, presses, unit);
  const sim = new Simulation(net);
  for (const p of presses) sim.schedule(p.t, ctl.keys[p.key]);
  const strobeIds = new Map(DIRECTIONS.map((d) => [ctl.strobes[d], d] as const));
  const seen: Array<{ d: Direction; tick: number }> = [];
  const lastStrobe = 1 + (frames - 1) * F + ctl.strobeOffset;
  const checks = new Set(Array.from({ length: frames }, (_, k) => 1 + k * F + ctl.readOffset + 48));
  const regs = [ctl.bits.axis.register, ctl.bits.sign.register];
  while (sim.tick < lastStrobe) {
    for (const e of sim.step()) {
      const d = strobeIds.get(e.neuron);
      if (d) seen.push({ d, tick: e.tick });
    }
    if (checks.has(sim.tick)) {
      for (const d of DIRECTIONS) if (sim.charge(ctl.strobes[d]) !== RESTS[d]) throw new Error(`${d} holds ${sim.charge(ctl.strobes[d])} at ${sim.tick}`);
      for (const r of regs) if (sim.charge(r) !== 0 && sim.charge(r) !== 1) throw new Error(`${r} holds ${sim.charge(r)} at ${sim.tick}`);
    }
  }
  expect(seen).toEqual(expected.map((d, k) => ({ d, tick: 1 + k * F + ctl.strobeOffset })));
  return { seen, sim };
}

describe('control unit', () => {
  for (const F of F_VALUES) {
    it(`F=${F}: idles RIGHT, one strobe per frame`, () => {
      const { seen } = checkControl(F, 60, []);
      expect(seen.every((s) => s.d === 'right')).toBe(true);
    });

    it(`F=${F}: every key at every phase, from every direction`, () => {
      const unit = makeControl(F);
      for (const from of DIRECTIONS)
        for (const key of DIRECTIONS) {
          const presses: KeyPress[] = [{ t: 40, key: from }];
          for (let p = 0; p < F; p++) presses.push({ t: 400 + p * 4 * F + p, key }, { t: 400 + p * 4 * F + 2 * F, key: from });
          checkControl(F, 4 * F + 8, disambiguate(F, 4 * F + 8, presses, unit), unit);
        }
    });
  }
});


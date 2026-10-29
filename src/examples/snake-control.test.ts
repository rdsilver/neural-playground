import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildBit, buildControl, DIRECTIONS, type Direction } from './snake-control';
import { Ambiguous, bitModel, controlFacts, controlModel, disambiguate, intentModel, type KeyPress, type Press } from './snake-model';

// ---- bit (flip-flop + register) ------------------------------------------------

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

  it('every pair of presses within a frame-and-a-half', { timeout: 60_000 }, () => {
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

const F_VALUES = [64, 75, 90, 120];

/** Distance from point p to segment a-b. */
function distanceToSegment(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const RESTS: Record<Direction, number> = { right: 0, left: -1, down: -1, up: -2 };

function makeControl(F: number) {
  const b = new NetworkBuilder();
  const ctl = buildControl(b, { x: 6, y: 0 }, { F });
  const net = b.build();
  return { ctl, net, facts: controlFacts(net, ctl) };
}
type Unit = ReturnType<typeof makeControl>;

/** Run the unit and check every frame against the model. Returns the strobes seen. */
function checkControl(F: number, frames: number, presses: KeyPress[], unit: Unit = makeControl(F)) {
  const { ctl, net } = unit;
  const expected = controlModel(frames, presses, unit.facts);
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
          const { seen } = checkControl(F, 4 * F + 8, disambiguate(4 * F + 8, presses, unit.facts), unit);
          // Never a direction nobody pressed: a key that changes both bits changes them at the same read.
          expect(seen.filter((s) => s.tick > 400 && s.d !== from && s.d !== key), `${from} -> ${key}`).toEqual([]);
        }
    });

    it(`F=${F}: of presses at least facts.gap apart the later always wins (intent model)`, () => {
      const unit = makeControl(F);
      for (const seed of [11, 12, 13]) {
        const rng = mulberry32(seed);
        const frames = 300;
        const presses: KeyPress[] = [];
        for (let t = Math.floor(rng() * 20); t < frames * F; t += unit.facts.gap + Math.floor(rng() * 2 * F)) presses.push({ t, key: DIRECTIONS[Math.floor(rng() * 4)]! });
        const want = intentModel(frames, presses, unit.facts);
        expect(controlModel(frames, presses, unit.facts)).toEqual(want);
        const { seen } = checkControl(F, frames, presses, unit);
        expect(seen.map((s) => s.d)).toEqual(want);
      }
    });

    it(`F=${F}: random bursts (same-tick and many-per-frame presses)`, () => {
      const unit = makeControl(F);
      for (const seed of [1, 2, 3, 4]) {
        const rng = mulberry32(seed);
        const frames = 400;
        const presses: KeyPress[] = [];
        let t = 30;
        while (t < frames * F) {
          const burst = 1 + Math.floor(rng() * 4);
          for (let i = 0; i < burst; i++) presses.push({ t: t + (rng() < 0.3 ? 0 : Math.floor(rng() * 40)), key: DIRECTIONS[Math.floor(rng() * 4)]! });
          t += Math.floor(rng() * 3 * F);
        }
        const kept = disambiguate(frames, presses, unit.facts);
        expect(kept.length).toBeGreaterThan(presses.length * 0.95);
        const { seen } = checkControl(F, frames, kept, unit);
        expect(new Set(seen.map((s) => s.d)).size).toBe(4);
      }
    });
  }

  it('every pair of presses, all phases and gaps up to 60 ticks (F=90)', { timeout: 120_000 }, () => {
    const F = 90;
    const unit = makeControl(F);
    for (const k1 of DIRECTIONS)
      for (const k2 of DIRECTIONS) {
        const presses: KeyPress[] = [];
        let slot = 0;
        for (let p = 0; p < F; p++)
          for (const d of [...Array.from({ length: 61 }, (_, i) => i), 75, 89]) {
            const t = 200 + slot++ * 3 * F + p;
            presses.push({ t, key: k1 }, { t: t + d, key: k2 });
          }
        const frames = slot * 3 + 4;
        const kept = disambiguate(frames, presses, unit.facts);
        expect(kept.length).toBeGreaterThan(presses.length * 0.98);
        checkControl(F, frames, kept, unit);
      }
  });

  it('key timing: each key changes both bits at the same read; keys within 16 ticks of each other', () => {
    const { ctl, net, facts } = makeControl(90);
    expect(facts.counts).toEqual({ up: 142, left: 143, down: 146, right: 158 });
    expect(facts.gap).toBe(35);
    expect(facts.wiring).toEqual({
      up: [{ bit: 'axis', set: true, delay: 78 }, { bit: 'sign', set: true, delay: 78 }],
      left: [{ bit: 'axis', set: false, delay: 82 }, { bit: 'sign', set: true, delay: 79 }],
      down: [{ bit: 'axis', set: true, delay: 82 }, { bit: 'sign', set: false, delay: 85 }],
      right: [{ bit: 'axis', set: false, delay: 97 }, { bit: 'sign', set: false, delay: 97 }],
    });
    // No wire of the unit passes over a key (that is not one of its ends).
    const at = new Map(net.neurons.map((n) => [n.id, n] as const));
    const keyIds = new Set(Object.values(ctl.keys));
    const over = net.connections.flatMap((c) => {
      const [a, z] = [at.get(c.from)!, at.get(c.to)!];
      return [...keyIds].filter((k) => k !== c.from && k !== c.to && distanceToSegment(a, z, at.get(k)!) < 0.5).map((k) => `${c.from} -> ${c.to} over ${k}`);
    });
    expect(over).toEqual([]);
    // The strobe schedule is unchanged by the key wiring.
    expect([ctl.readOffset, ctl.strobeOffset]).toEqual([108, 178]);
  });

  it("every pair of presses during power-on (ticks 1..40) matches the model", { timeout: 120_000 }, () => {
    const F = 90;
    const unit = makeControl(F);
    let [pairs, checked] = [0, 0];
    for (const k1 of DIRECTIONS)
      for (const k2 of DIRECTIONS)
        for (let t1 = 1; t1 <= 40; t1 += 2)
          for (let t2 = t1; t2 <= 40; t2 += 3) {
            const presses = disambiguate(8, [{ t: t1, key: k1 }, { t: t2, key: k2 }], unit.facts);
            pairs++;
            if (presses.length === 2) checked++;
            checkControl(F, 8, presses, unit);
          }
    expect(checked).toBeGreaterThan(pairs * 0.95);
  });

  it('presses during power-on (ticks 0..80) are safe', () => {
    const F = 90;
    const unit = makeControl(F);
    for (const key of DIRECTIONS)
      for (let t = 0; t <= 80; t++) {
        const sim = new Simulation(unit.net);
        if (t === 0) sim.stimulate(unit.ctl.keys[key]);
        else sim.schedule(t, unit.ctl.keys[key]);
        const strobes: string[] = [];
        sim.run(12 * F);
        for (let k = 0; k < 10; k++) {
          const fired = DIRECTIONS.filter((d) => sim.state(unit.ctl.strobes[d])!.fireCount > 0);
          strobes.push(fired.join());
        }
        // Afterwards it behaves like a press that got through: one strobe per frame, ending on `key`.
        const events = new Simulation(unit.net);
        if (t === 0) events.stimulate(unit.ctl.keys[key]);
        else events.schedule(t, unit.ctl.keys[key]);
        const seen: string[] = [];
        while (events.tick < 1 + 11 * F + unit.ctl.strobeOffset) for (const e of events.step()) if (DIRECTIONS.some((d) => unit.ctl.strobes[d] === e.neuron)) seen.push(`${e.neuron}@${(e.tick - 1 - unit.ctl.strobeOffset) % F}`);
        expect(seen.length, `key ${key} at ${t}`).toBe(12);
        expect(seen.every((s) => s.endsWith('@0'))).toBe(true);
        expect(seen[seen.length - 1]).toBe(`${unit.ctl.strobes[key]}@0`);
      }
  });
});


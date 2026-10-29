import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation } from '../engine';
import { mulberry32 } from '../engine/rng';
import { BITS, buildBit, buildControl, DIRECTIONS, type Direction } from './snake-control';
import { Ambiguous, bitModel, controlFacts, controlModel, disambiguate, intentModel, type KeyPress, type Press } from './snake-model';

// ---- bit (flip-flop + register) ------------------------------------------------

/** Drive a bit with presses; reads land on G at T0 + k*F. A bit starting at 1 gets the hole at SET and a +1 on G. */
function runBit(F: number, frames: number, presses: Press[], initial: 0 | 1 = 0) {
  const b = new NetworkBuilder();
  const bit = buildBit(b, { x0: 0, y0: 0, sx: 1 }, 'axis');
  const sim = new Simulation(b.build());
  sim.stimulate(initial ? bit.setMinus : bit.resetMinus); // power-on hole
  if (initial) sim.stimulate(bit.register);
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

function checkBit(F: number, frames: number, presses: Press[], initial: 0 | 1 = 0): boolean {
  let model;
  try {
    model = bitModel(presses, Array.from({ length: frames }, (_, k) => 100 + k * F), initial);
  } catch (e) {
    if (e instanceof Ambiguous) return false;
    throw e;
  }
  const { fires, before, reads } = runBit(F, frames, presses, initial);
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

  it('random bursts match the model, from 0 and from 1', () => {
    const rng = mulberry32(7);
    let checked = 0;
    for (let run = 0; run < 300; run++) {
      const presses: Press[] = [];
      for (let i = 0; i < 25; i++) presses.push({ t: 20 + Math.floor(rng() * 1500), set: rng() < 0.5 });
      if (checkBit(90, 20, presses, (run % 2) as 0 | 1)) checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });

  it('a bit that starts at 1 ignores SET and takes RST at every phase', () => {
    for (let p = 0; p < 90; p++) {
      checkBit(90, 8, [{ t: 100 + p, set: true }], 1);
      checkBit(90, 8, [{ t: 100 + p, set: false }], 1);
    }
  });
});

// ---- control unit ------------------------------------------------------------

const F_VALUES = [64, 75, 90, 120];

/** The unit's measured timing (ticks), pinned. */
const PINNED = {
  counts: { right: { axis: 109, own: 97 }, left: { axis: 107, own: 90 }, down: { axis: 116, own: 109 }, up: { axis: 104, own: 100 } },
  gap: 28,
  wiring: {
    right: [{ bit: 'axis', set: true, delay: 45 }, { bit: 'h', set: false, delay: 157 }],
    left: [{ bit: 'axis', set: true, delay: 43 }, { bit: 'h', set: true, delay: 147 }],
    down: [{ bit: 'axis', set: false, delay: 55 }, { bit: 'v', set: false, delay: 130 }],
    up: [{ bit: 'axis', set: false, delay: 43 }, { bit: 'v', set: true, delay: 118 }],
  },
  schedule: { reads: { axis: 59, h: 180, v: 141 }, strobe: 238, rest: 239, minF: 45, neurons: 80 },
};

/** Distance from point p to segment a-b. */
function distanceToSegment(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function makeControl(F: number) {
  const b = new NetworkBuilder();
  const ctl = buildControl(b, { x: 12, y: 8 }, { F });
  const net = b.build();
  return { ctl, net, facts: controlFacts(net, ctl) };
}
type Unit = ReturnType<typeof makeControl>;

/**
 * Run the unit and check every frame against the model. Returns the strobes seen. Also checks the rest
 * charges: each register holds 0 or 1 just before its read, and every strobe is back at 0 a tick after
 * the strobe tick (the NOT strobes' -1 has been cancelled by the +1).
 */
function checkControl(F: number, frames: number, presses: KeyPress[], unit: Unit = makeControl(F)) {
  const { ctl, net } = unit;
  const expected = controlModel(frames, presses, unit.facts);
  const sim = new Simulation(net);
  for (const p of presses) sim.schedule(p.t, ctl.keys[p.key]);
  const strobeIds = new Map(DIRECTIONS.map((d) => [ctl.strobes[d], d] as const));
  const seen: Array<{ d: Direction; tick: number }> = [];
  const lastStrobe = 1 + (frames - 1) * F + ctl.strobeOffset;
  const frameOf = (off: number) => new Set(Array.from({ length: frames }, (_, k) => 1 + k * F + off));
  const before = Object.fromEntries(BITS.map((n) => [n, frameOf(ctl.reads[n] - 1)]));
  const after = frameOf(ctl.strobeOffset + 1);
  while (sim.tick < lastStrobe) {
    for (const e of sim.step()) {
      const d = strobeIds.get(e.neuron);
      if (d) seen.push({ d, tick: e.tick });
    }
    for (const n of BITS) {
      const g = sim.charge(ctl.bits[n].register);
      if (before[n]!.has(sim.tick) && g !== 0 && g !== 1) throw new Error(`${n} register holds ${g} at ${sim.tick}`);
    }
    if (after.has(sim.tick)) for (const d of DIRECTIONS) if (sim.charge(ctl.strobes[d]) !== 0) throw new Error(`${d} holds ${sim.charge(ctl.strobes[d])} at ${sim.tick}`);
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
          // Never a direction nobody pressed: a key writes AXIS and its own bit, its own bit counting no later than AXIS.
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

  it('two keys pressed close together (same tick included) never show a third direction (model, every phase)', () => {
    const F = 90;
    const { facts } = makeControl(F);
    let [cases, skipped] = [0, 0];
    for (const from of DIRECTIONS)
      for (const k1 of DIRECTIONS)
        for (const k2 of DIRECTIONS)
          for (let p = 0; p < F; p++)
            for (let d = 0; d <= 80; d++) {
              const t = 1 + 3 * F + p;
              let dirs: Direction[];
              cases++;
              try {
                dirs = controlModel(9, [{ t: 40, key: from }, { t, key: k1 }, { t: t + d, key: k2 }], facts);
              } catch (e) {
                if (e instanceof Ambiguous) {
                  skipped++;
                  continue;
                }
                throw e;
              }
              const odd = dirs.slice(2).filter((x) => x !== from && x !== k1 && x !== k2);
              if (odd.length) throw new Error(`${from}, then ${k1} at ${t} and ${k2} at ${t + d}: ${dirs.join(' ')}`);
              // It ends on one of the two keys (a press can be lost in the other's news window, never both).
              if (dirs.at(-1) !== k1 && dirs.at(-1) !== k2) throw new Error(`${from}, then ${k1} at ${t} and ${k2} at ${t + d}: ends ${dirs.at(-1)}`);
            }
    expect(skipped).toBeLessThan(cases * 0.02);
  });

  it('moving RIGHT, two keys on the same tick (LEFT and DOWN in either order, ...) never show a third direction, at every phase (network)', () => {
    const F = 90;
    const unit = makeControl(F);
    for (const pair of [['left', 'down'], ['down', 'left'], ['up', 'left'], ['right', 'up']] as const) {
      const presses: KeyPress[] = [];
      for (let p = 0; p < F; p++) {
        const t = 200 + p * 4 * F + p;
        presses.push({ t, key: pair[0] }, { t, key: pair[1] }, { t: t + 2 * F, key: 'right' });
      }
      const kept = disambiguate(4 * F + 8, presses, unit.facts);
      const { seen } = checkControl(F, 4 * F + 8, kept, unit);
      expect(seen.filter((x) => x.d !== 'right' && x.d !== pair[0] && x.d !== pair[1])).toEqual([]);
    }
  });

  /**
   * A key's own bit must count no later than AXIS: moving along one axis
   * with the other axis's bit left at 1 by an old press (UP, then LEFT:
   * V = 1), DOWN must not show UP for a frame (AXIS turned vertical, V not
   * yet cleared). Every phase, every such triple.
   */
  it('a turn onto the other axis never first shows that axis\'s old direction (network, every phase)', { timeout: 60_000 }, () => {
    const F = 90;
    const unit = makeControl(F);
    const triples: Array<[Direction, Direction, Direction]> = [];
    for (const [old, now] of [['up', 'down'], ['down', 'up'], ['left', 'right'], ['right', 'left']] as const)
      for (const across of DIRECTIONS) if (across !== old && across !== now) triples.push([old, across, now]);
    for (const [old, across, now] of triples) {
      const presses: KeyPress[] = [];
      for (let p = 0; p < F; p++) {
        const t = 100 + p * 10 * F;
        presses.push({ t, key: old }, { t: t + 3 * F, key: across }, { t: t + 6 * F + p, key: now });
      }
      const { seen } = checkControl(F, F * 10 + 4, disambiguate(F * 10 + 4, presses, unit.facts), unit);
      const back = seen.filter((x, k) => x.d === old && seen[k - 1]?.d === across && x.tick > 100 + 6 * F);
      expect(back, `${old}, ${across}, ${now}`).toEqual([]);
    }
  });

  it('key timing: per bit the keys count within 12 ticks of each other, a key\'s own bit no later than AXIS', () => {
    const { ctl, net, facts } = makeControl(90);
    expect(facts.counts).toEqual(PINNED.counts);
    expect(facts.gap).toBe(PINNED.gap);
    expect(facts.wiring).toEqual(PINNED.wiring);
    for (const d of DIRECTIONS) expect(facts.counts[d].own).toBeLessThanOrEqual(facts.counts[d].axis);
    // No wire of the unit passes over a key (that is not one of its ends).
    const at = new Map(net.neurons.map((n) => [n.id, n] as const));
    const keyIds = new Set(Object.values(ctl.keys));
    const over = net.connections.flatMap((c) => {
      const [a, z] = [at.get(c.from)!, at.get(c.to)!];
      return [...keyIds].filter((k) => k !== c.from && k !== c.to && distanceToSegment(a, z, at.get(k)!) < 0.5).map((k) => `${c.from} -> ${c.to} over ${k}`);
    });
    expect(over).toEqual([]);
    expect({ reads: ctl.reads, strobe: ctl.strobeOffset, rest: ctl.restOffset, minF: ctl.minF, neurons: ctl.ids.length }).toEqual(PINNED.schedule);
    expect(ctl.initial).toEqual({ axis: 1, h: 0, v: 0 });
  });

  it('refuses a frame shorter than the read-out allows', () => {
    const { ctl } = makeControl(90);
    expect(() => buildControl(new NetworkBuilder(), { x: 12, y: 8 }, { F: ctl.minF - 1 })).toThrow(/shorter than/);
    expect(() => buildControl(new NetworkBuilder(), { x: 12, y: 8 }, { F: ctl.minF })).not.toThrow();
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


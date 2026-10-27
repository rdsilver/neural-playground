import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildBit } from './snake-control';

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
 * the register charge just before each read; or null if a press hit a gate
 * exactly as news arrived (a tie the model does not decide).
 */
function bitModel(presses: Press[], reads: number[]) {
  const sorted = [...presses].sort((a, b) => a.t - b.t);
  let bit = 0;
  const open = { set: -Infinity, reset: Infinity }; // tick from which each gate is open
  const changes: Array<{ at: number; d: number; set: boolean }> = [];
  for (const p of sorted) {
    const a = p.t + 30;
    const gate = p.set ? 'set' : 'reset';
    if (open[gate] === a) return null;
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
  const model = bitModel(presses, Array.from({ length: frames }, (_, k) => 100 + k * F));
  if (!model) return false;
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

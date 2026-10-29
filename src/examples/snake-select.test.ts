import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import type { Place } from './snake-control';
import { buildLamps, buildSelect, type Select } from './snake-select';

const W = 10;
const H = 8;
/** The intended placement: screen at (20, 30); head plane right below it, tail plane right above it (mirrored). */
const SCREEN: Place = { x0: 20, y0: 30, sx: 1 };
const HEAD: Place = { x0: 15, y0: 38, sx: 1, sy: 1 };
const TAIL: Place = { x0: 15, y0: 29 - 0, sx: 1, sy: -1 };

interface Unit {
  net: Network;
  sel: Select;
  lamps: string[][];
  polarity: 1 | -1;
}

function makeUnit(polarity: 1 | -1, place = polarity === 1 ? HEAD : TAIL): Unit {
  const b = new NetworkBuilder();
  const lamps = buildLamps(b, SCREEN, { w: W, h: H, prefix: 'px' });
  const sel = buildSelect(b, place, { w: W, h: H, polarity, prefix: polarity === 1 ? 'hd' : 'tl', lamps });
  const net = b.build();
  // Lamps here only count pulses: lift their threshold so they never fire.
  for (const n of net.neurons) if (n.kind === 'lamp') n.threshold = 1e9;
  return { net, sel, lamps, polarity };
}

const units = new Map<number, Unit>();
const unit = (p: 1 | -1) => {
  if (!units.has(p)) units.set(p, makeUnit(p));
  return units.get(p)!;
};

/** One frame: pixel (x, y) with skew s, or null for an empty frame. */
type Frame = { x: number; y: number; s: number } | null;

/**
 * Drive a plane: power at tick 1; frame k's row fires at T_k = T0 + k F, its
 * column at T_k - s. Checks every tick that every lamp holds exactly the sum
 * of the pulses due by then (so each selected lamp gets one pulse of the
 * plane's polarity at column + hit, and no other lamp anything), and at
 * column + settle of every frame that every internal neuron is at rest.
 * Returns the first problem found, or undefined.
 */
function run(u: Unit, F: number, frames: Frame[], net = u.net): string | undefined {
  const { sel, lamps, polarity } = u;
  const sim = new Simulation(net);
  sim.schedule(1, sel.power);
  const T0 = 1 + sel.powerLead + 1;
  const due = new Map<number, Array<[number, number]>>();
  const restAt = new Set<number>();
  frames.forEach((f, k) => {
    if (!f) return;
    const T = T0 + k * F;
    const tc = T - f.s;
    sim.schedule(T, sel.rows[f.y]!);
    sim.schedule(tc, sel.cols[f.x]!);
    const t = tc + sel.hit[f.y]![f.x]!;
    due.set(t, [...(due.get(t) ?? []), [f.x, f.y]]);
    restAt.add(T + sel.settle);
  });
  const end = T0 + frames.length * F + 2 * F;
  const want = lamps.map((r) => r.map(() => 0));
  const rest = sel.restFor();
  const ids = Object.keys(rest);
  while (sim.tick < end) {
    sim.step();
    for (const [x, y] of due.get(sim.tick) ?? []) want[y]![x]! += polarity;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const got = sim.charge(lamps[y]![x]!);
        if (got !== want[y]![x]) return `lamp (${x}, ${y}) holds ${got}, not ${want[y]![x]}, at tick ${sim.tick}`;
      }
    if (restAt.has(sim.tick))
      for (const n of ids) if (sim.charge(n) !== rest[n]) return `${n} holds ${sim.charge(n)}, not ${rest[n]}, at tick ${sim.tick}`;
  }
  if (sim.pulses().length) return 'pulses still in flight at the end';
  for (const n of ids) if (sim.charge(n) !== rest[n]) return `${n} holds ${sim.charge(n)} at the end`;
  return undefined;
}

function randomFrames(seed: number, n: number, sel: Select, emptyRate = 0.2): Frame[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => {
    if (rng() < emptyRate) return null;
    const s = sel.skew.min + Math.floor(rng() * (sel.skew.max - sel.skew.min + 1));
    return { x: Math.floor(rng() * W), y: Math.floor(rng() * H), s };
  });
}

describe.each([1, -1] as const)('select plane, polarity %i', (p) => {
  it('every pixel at the skew window edges and in between', () => {
    const u = unit(p);
    const { min, max } = u.sel.skew;
    for (const s of [min, max, Math.round((min + max) / 2)]) {
      const frames: Frame[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) frames.push({ x, y, s });
      expect(run(u, 480, frames)).toBeUndefined();
    }
  });

  for (const F of [240, 480, 'minF'] as const)
    it(`3000 random frames (random skews, empty frames) at F = ${F}`, () => {
      const u = unit(p);
      const f = F === 'minF' ? u.sel.minF : F;
      expect(f).toBeGreaterThanOrEqual(u.sel.minF);
      expect(run(u, f, randomFrames(F === 240 ? 1 : F === 480 ? 2 : 3, 3000, u.sel))).toBeUndefined();
    });

  it('a skew just outside the window misbehaves', () => {
    const u = unit(p);
    for (const s of [u.sel.skew.min - 1, u.sel.skew.max + 1]) {
      const bad: Array<[number, number]> = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (run(u, 480, [{ x, y, s }])) bad.push([x, y]);
      expect(bad.length, `skew ${s}`).toBeGreaterThan(0);
    }
  });
});

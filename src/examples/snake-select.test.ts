import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import type { Place } from './snake-control';
import { buildLamps, buildSelect, selectSchedule, type Select } from './snake-select';

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
function run(u: Unit, F: number, frames: Frame[], net = u.net, restOffset = u.sel.settle): string | undefined {
  const { sel, lamps, polarity } = u;
  const sim = new Simulation(net);
  sim.schedule(1, sel.power);
  const T0 = 1 + sel.powerLead;
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
    restAt.add(T + restOffset);
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

/** Every pulse arrival of a run: [from, to, tick], from the in-flight set before each step. */
function arrivals(net: Network, stimuli: Array<[number, string]>, ticks: number): Array<[string, string, number]> {
  const sim = new Simulation(net);
  for (const [t, n] of stimuli) sim.schedule(t, n);
  const out: Array<[string, string, number]> = [];
  for (let t = 1; t <= ticks; t++) {
    for (const p of sim.pulses()) if (p.arrivalTick === t) out.push([p.from, p.to, t]);
    sim.step();
  }
  return out;
}

const role = (id: string) => id.slice(id.indexOf('-') + 1);
const span = (v: number[]) => [Math.min(...v), Math.max(...v)];

describe('select timing', () => {
  /** The table above buildSelect(), row by row. */
  const TABLE = {
    1: { holdStart: [271, 308], columnPulse: [120, 155], columnDone: [150, 185], holdEnd: [477, 502], hit: [240, 297], skew: [-323, -180], settle: 508, minF: 238, powerLead: 277 },
    [-1]: { holdStart: [271, 308], columnPulse: [120, 155], columnDone: [154, 192], holdEnd: [474, 501], hit: [240, 297], skew: [-318, -173], settle: 510, minF: 240, powerLead: 295 },
  } as const;

  it.each([1, -1] as const)('polarity %i matches the documented schedule', (p) => {
    const { hit: h, ...rest } = TABLE[p];
    expect(selectSchedule(W, H, p)).toEqual(rest);
    const { sel } = unit(p);
    expect([sel.skew.min, sel.skew.max]).toEqual(TABLE[p].skew);
    expect([sel.settle, sel.minF, sel.powerLead]).toEqual([TABLE[p].settle, TABLE[p].minF, TABLE[p].powerLead]);
    expect(span(sel.hit.flat())).toEqual(h);
  });

  it.each([1, -1] as const)('polarity %i: every pulse lands at the documented ticks', (p) => {
    const u = unit(p);
    const { sel } = u;
    const F = 700;
    const s = Math.round((sel.skew.min + sel.skew.max) / 2);
    const T0 = 2 + sel.powerLead + F; // power-on's -1s land up to the first row's first +1: keep them out of frame 0
    const stim: Array<[number, string]> = [[1, sel.power]];
    const pixels: Array<[number, number]> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels.push([x, y]);
    pixels.forEach(([x, y], k) => stim.push([T0 + k * F, sel.rows[y]!], [T0 + k * F - s, sel.cols[x]!]));
    const all = arrivals(u.net, stim, T0 + pixels.length * F);
    const got = { holdStart: [] as number[], columnPulse: [] as number[], columnDone: [] as number[], holdEnd: [] as number[], hit: [] as number[] };
    const qOf = new Map(sel.select.flatMap((r, y) => r.map((q, x) => [role(q), [x, y]] as const)));
    for (const [from, to, tick] of all) {
      const k = Math.floor((tick - T0) / F); // frame k's pulses all land in [T_k, T_k + F)
      if (k < 0) continue; // power-on
      const [T, t] = [T0 + k * F, T0 + k * F - s];
      const [x, y] = pixels[k]!;
      const [rf, rt] = [role(from), role(to)];
      if (rt.startsWith('q') && rf.startsWith('s')) got.holdStart.push(tick - T);
      else if (rt.startsWith('q') && rf.startsWith('z')) got.holdEnd.push(tick - T);
      else if (rt.startsWith('q') && /^[cf]/.test(rf)) got.columnPulse.push(tick - t);
      else if (to.startsWith('px-')) got.hit.push(tick - t - sel.hit[y]![x]!);
      // Column side done, per pixel: head = the selected Q's restore; tail = a half-selected Q's -1 from its gate.
      else if (rf.startsWith('k') && rt.startsWith('q')) {
        const [px, py] = qOf.get(rt)!;
        if (p === 1 ? px === x && py === y : px === x && py !== y) got.columnDone.push(tick - t);
      }
    }
    expect(span(got.holdStart)).toEqual(TABLE[p].holdStart);
    expect(span(got.holdEnd)).toEqual(TABLE[p].holdEnd);
    expect(span(got.columnPulse)).toEqual(TABLE[p].columnPulse);
    expect(span(got.columnDone)).toEqual(TABLE[p].columnDone);
    expect(got.hit).toEqual(Array(W * H).fill(0));
  });
});

describe('select timing is tight', () => {
  it.each([1, -1] as const)('polarity %i: settle is the first tick of rest, minF the shortest period that keeps it', (p) => {
    const u = unit(p);
    const { min } = u.sel.skew;
    // At the latest column (s = min) some pixel is still busy one tick before settle.
    const busy: Array<[number, number]> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (run(u, 480, [{ x, y, s: min }], u.net, u.sel.settle - 1)) busy.push([x, y]);
    expect(busy.length).toBeGreaterThan(0);
    // One tick shorter than minF, some next frame's first pulse lands on the settle tick.
    const early: number[] = [];
    for (let y = 0; y < H; y++) if (run(u, u.sel.minF - 1, [{ x: 0, y: 0, s: min }, { x: 0, y, s: min }])) early.push(y);
    expect(early.length).toBeGreaterThan(0);
  });

  it.each([1, -1] as const)('polarity %i: power-on is done exactly when the first frame can start', (p) => {
    const u = unit(p);
    const { sel } = u;
    const all = arrivals(u.net, [[1, sel.power]], 2000);
    const last = Math.max(...all.map(([, , t]) => t));
    const s = selectSchedule(W, H, p);
    // First row at 1 + powerLead: its earliest pulse (a hold +1, or a column +1 at s = max) lands right after.
    expect(1 + sel.powerLead + Math.min(s.holdStart[0], s.columnPulse[0] - s.skew[1])).toBe(last + 1);
  });
});

import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, travelTicks, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildRing, type Ring, type RingOptions } from './snake-ring';

type Move = 'fwd' | 'back' | 'hold';
type Unit = { ring: Ring; net: Network };
const travel = (net: Network, a: string, b: string) => travelTicks(net.neurons.find((q) => q.id === a)!, net.neurons.find((q) => q.id === b)!);
const MOVES: readonly Move[] = ['fwd', 'back', 'hold'];
const SIZES = [8, 10] as const;
const MODES = [false, true] as const; // fastLines

function makeRing(n: number, F: number, start = 0, extra: Partial<RingOptions> = {}): Unit {
  const b = new NetworkBuilder();
  const ring = buildRing(b, { x0: 20, y0: 20, sx: 1 }, { n, F, prefix: 'x', start, ...extra });
  return { ring, net: b.build() };
}

interface Scenario {
  F: number;
  moves: Move[];
  start: number;
  /** Ticks from power to t_0 (default F). */
  lead?: number;
  /** Read offset of frame k (default readLag); the settled-moment probe needs the default. */
  read?: (k: number) => number;
}

/**
 * Run a ring through a scenario: power at tick 1, frame k's move at
 * t_k = 1 + lead + kF, its read at t_k + readLag (or read(k)). Checks, against the model
 * (position mod n), that every frame exactly one line fires, the right one,
 * at the exact tick, that every neuron of the block is at its rest charge at
 * t_k + settle, and that afterwards the block goes idle at rest. Returns the
 * first violation (it stops there), so mutants can be run through it.
 */
function run(unit: Unit, sc: Scenario, fireLog?: string[]): { error?: string; maxPulses: number; pos: number } {
  const { ring, net } = unit;
  const { F, moves, start } = sc;
  const n = ring.lines.length;
  const sim = new Simulation(net);
  sim.schedule(1, ring.power);
  const t = (k: number) => 1 + (sc.lead ?? F) + k * F;
  const r = moves.map((_, k) => sc.read?.(k) ?? ring.readLag);
  moves.forEach((m, k) => {
    if (m !== 'hold') sim.schedule(t(k), ring[m]);
    sim.schedule(t(k) + r[k]!, ring.read);
  });
  const lineOf = new Map(ring.lines.map((id, j) => [id, j] as const));
  const expected: Array<{ j: number; tick: number }> = [];
  const settleAt = new Map<number, number>(); // tick -> position
  let pos = start;
  moves.forEach((m, k) => {
    pos = (pos + (m === 'fwd' ? 1 : m === 'back' ? n - 1 : 0)) % n;
    expected.push({ j: pos, tick: t(k) + r[k]! + ring.lineDelay[pos]! });
    if (!sc.read) settleAt.set(t(k) + ring.settle, pos);
  });
  expected.sort((a, b) => a.tick - b.tick);
  const ids = Object.keys(ring.restFor(0));
  const atRest = (p: number) => {
    const rest = ring.restFor(p);
    const bad = ids.find((id) => sim.charge(id) !== rest[id]);
    return bad && `${bad} holds ${sim.charge(bad)}, not ${rest[bad]}, at tick ${sim.tick} (pos ${p})`;
  };
  const end = Math.max(...expected.map((e) => e.tick), ...settleAt.keys());
  let next = 0;
  let maxPulses = 0;
  while (sim.tick < end) {
    for (const e of sim.step()) {
      fireLog?.push(`${e.tick} ${e.neuron}`);
      const j = lineOf.get(e.neuron);
      if (j === undefined) continue;
      const want = expected[next++];
      if (!want || want.j !== j || want.tick !== e.tick) return { error: `line ${j} fired at ${e.tick}, expected ${JSON.stringify(want)}`, maxPulses, pos };
    }
    maxPulses = Math.max(maxPulses, sim.pulses().length);
    const p = settleAt.get(sim.tick);
    const bad = p !== undefined && atRest(p);
    if (bad) return { error: bad, maxPulses, pos };
  }
  if (next !== expected.length) return { error: `only ${next} of ${expected.length} lines fired`, maxPulses, pos };
  sim.runUntilIdle(2 * F);
  if (!sim.isIdle()) return { error: `still busy ${2 * F} ticks after the last line`, maxPulses, pos };
  return { error: atRest(pos) || undefined, maxPulses, pos };
}

/** run() that must pass. */
function drive(n: number, F: number, moves: Move[], start = 0, unit = makeRing(n, F, start)) {
  expect(unit.ring.lines).toHaveLength(n);
  const r = run(unit, { F, moves, start });
  expect(r.error).toBeUndefined();
  return r;
}

function randomMoves(seed: number, frames: number): Move[] {
  const rng = mulberry32(seed);
  return Array.from({ length: frames }, () => MOVES[Math.floor(rng() * 3)]!);
}

describe('ring counter', () => {
  for (const n of SIZES)
    for (const fastLines of MODES)
      for (const F of [90, 120, 240, 480]) {
        const name = `n=${n} F=${F}${fastLines ? ' fastLines' : ''}`;
        const unit = (s: number) => makeRing(n, F, s, { fastLines });

        it(`${name}: every start position, then fwd / back / hold`, () => {
          for (let s = 0; s < n; s++) {
            const u = unit(s);
            for (const m of MOVES) drive(n, F, [m, 'hold', m, m], s, u);
          }
        });

        it(`${name}: wraps around both ways`, () => {
          expect(drive(n, F, Array<Move>(2 * n + 1).fill('fwd'), 0, unit(0)).pos).toBe(1);
          expect(drive(n, F, Array<Move>(2 * n + 1).fill('back'), 0, unit(0)).pos).toBe(n - 1);
        });

        it(`${name}: 3000 random frames, three seeds`, () => {
          for (const seed of [1, 2, 3]) {
            const u = unit(seed % n);
            const { maxPulses } = drive(n, F, randomMoves(seed, 3000), seed % n, u);
            // In flight at once: at most one frame's broadcasts plus its consequences.
            expect(maxPulses).toBeLessThan(u.net.connections.length);
          }
        });
      }

  it('the layout does not depend on F', () => {
    for (const n of SIZES)
      for (const fastLines of MODES) {
        const { ring, net } = makeRing(n, 480, 3, { fastLines });
        expect(makeRing(n, ring.minF, 3, { fastLines }).net).toEqual(net);
      }
  });

  // With reads at readLag a frame's copy events span ticks 60..176 (n = 8)
  // or 75..189 (n = 10) after t_k: consecutive frames overlap up to F = 116
  // or 114, and above that every frame runs alone, so a sweep up to 200
  // covers every way they can interleave. (A read near readLatest always
  // overlaps the next frame: the read window tests cover that at F = 240
  // and 480.) One build serves every F.
  it('works at every F from its minimum up to 200 (reads at readLag or anywhere in the window), and refuses a shorter one', () => {
    for (const n of SIZES)
      for (const fastLines of MODES) {
        const units = Array.from({ length: n }, (_, s) => makeRing(n, 200, s, { fastLines }));
        const { minF } = units[0]!.ring;
        expect(minF).toBe(n === 8 ? 82 : 78);
        for (let F = minF; F <= 200; F++) {
          const u = units[F % n]!;
          drive(n, F, randomMoves(F, 40), F % n, u);
          // Again with a random read offset per frame, anywhere in the window.
          const [E, Lt] = [u.ring.readEarliest, F + u.ring.readLatest - 200];
          const rng = mulberry32(F);
          const r = Array.from({ length: 40 }, () => E + Math.floor(rng() * (Lt - E + 1)));
          expect(run(u, { F, start: F % n, moves: randomMoves(F + 1, 40), read: (k) => r[k]! }).error).toBeUndefined();
        }
        drive(n, minF, randomMoves(7, 500), 0, makeRing(n, minF, 0, { fastLines }));
        expect(() => makeRing(n, minF - 1, 0, { fastLines })).toThrow(/below/);
      }
  });
});

describe('ring timing', () => {
  /**
   * The frame schedule, in ticks after t_k (the tick fwd or back fires):
   *
   *   event                                   n = 8    n = 10
   *   pair +1/-1 lands on every F_j (or B_j)  60-64    75-81    (holder fires)
   *   token / stale clears land               ..141    ..152
   *   settled moment (all at rest)             141      152     = settle
   *   read fires                                82       78     = readLag
   *   read may fire instead at r in            66..F+4  62..F+4  = [readEarliest, readLatest]
   *   fastLines, read at readEarliest         141-145  152-158
   *   read +1 lands on every R_j (holder fires)142-146  153-159
   *   holder's restore lands                  172-176  183-189
   *   line j fires                             343      385     = readLag + lineDelay (or lineAt)
   *   line j fires, fastLines                 157-161  168-174  = readLag + lineDelay[j]
   *   minimum frame period                      82       78     = minF
   *   power lead before t_0                     21       22     = powerLead
   */
  it('matches the documented schedule', () => {
    const row = (n: number, fastLines: boolean) => {
      const { ring } = makeRing(n, 90, 0, { fastLines });
      const line = ring.lineDelay.map((d) => ring.readLag + d);
      const window = [ring.readEarliest, ring.readLatest - 90];
      return { readLag: ring.readLag, window, settle: ring.settle, line: [Math.min(...line), Math.max(...line)], minF: ring.minF, powerLead: ring.powerLead };
    };
    const core = {
      8: { readLag: 82, window: [66, 4], settle: 141, minF: 82, powerLead: 21 },
      10: { readLag: 78, window: [62, 4], settle: 152, minF: 78, powerLead: 22 },
    };
    expect(row(8, false)).toEqual({ ...core[8], line: [343, 343] });
    expect(row(10, false)).toEqual({ ...core[10], line: [385, 385] });
    expect(row(8, true)).toEqual({ ...core[8], line: [157, 161] });
    expect(row(10, true)).toEqual({ ...core[10], line: [168, 174] });
    // Fastest: fastLines with the read at readEarliest.
    const fastest = (n: number) => {
      const { ring } = makeRing(n, 90, 0, { fastLines: true });
      return [ring.readEarliest + Math.min(...ring.lineDelay), ring.readEarliest + Math.max(...ring.lineDelay)];
    };
    expect([fastest(8), fastest(10)]).toEqual([[141, 145], [152, 158]]);
    // fastLines, per position.
    expect(makeRing(8, 90, 0, { fastLines: true }).ring.lineDelay).toEqual([75, 79, 75, 79, 75, 79, 75, 79]);
    expect(makeRing(10, 90, 0, { fastLines: true }).ring.lineDelay).toEqual([90, 90, 96, 96, 90, 90, 90, 96, 96, 90]);
  });

  for (const F of [90, 240, 480])
    it(`F=${F}: copies fire, holders are restored and lines fire at the documented ticks`, () => {
      const table = {
        8: { holder: [60, 64], read: [142, 146], line: [157, 161] },
        10: { holder: [75, 81], read: [153, 159], line: [168, 174] },
      };
      for (const n of SIZES) {
        const { ring, net } = makeRing(n, F, 0, { fastLines: true });
        const sim = new Simulation(net);
        sim.schedule(1, ring.power);
        const moves: Move[] = [...Array<Move>(n).fill('fwd'), ...Array<Move>(n).fill('back')];
        const t = (k: number) => 1 + (k + 1) * F;
        moves.forEach((m, k) => {
          sim.schedule(t(k), ring[m as 'fwd' | 'back']);
          sim.schedule(t(k) + ring.readLag, ring.read);
        });
        const kind = new Map<string, 'holder' | 'read' | 'line'>([...ring.copies.f, ...ring.copies.b].map((id) => [id, 'holder'] as const));
        ring.copies.r.forEach((id) => kind.set(id, 'read'));
        ring.lines.forEach((id) => kind.set(id, 'line'));
        const seen = { holder: [] as number[], read: [] as number[], line: [] as number[] };
        const restores: Array<[string, number]> = [];
        while (sim.tick < t(moves.length) + 2 * F) {
          for (const e of sim.step()) {
            const k = kind.get(e.neuron);
            if (!k) continue;
            seen[k].push((e.tick - 1) % F); // offset from t_k, mod F
            if (k === 'read') restores.push([e.neuron, e.tick]);
          }
          for (const [id, at] of restores) {
            if (sim.tick > at && sim.tick < at + 30) expect(sim.charge(id)).toBeLessThanOrEqual(0);
            if (sim.tick === at + 30) expect(sim.charge(id)).toBe(0);
          }
        }
        // Offsets past a frame wrap around: compare them mod F.
        for (const k of ['holder', 'read', 'line'] as const) {
          const [lo, hi] = table[n][k].map((v) => v % F);
          expect(seen[k].length).toBe(moves.length);
          expect([Math.min(...seen[k]), Math.max(...seen[k])]).toEqual([lo, hi]);
        }
      }
    });

  it('X and Y can fire their lines on the same tick (lineAt), Y laid out as a column (transpose)', () => {
    const x = makeRing(10, 90, 0, { lineAt: 385 });
    const y = makeRing(8, 90, 0, { lineAt: 385, transpose: true });
    expect(x.ring.readLag + x.ring.lineDelay[0]!).toBe(385);
    expect(y.ring.readLag + y.ring.lineDelay[0]!).toBe(385);
    for (const [n, unit] of [[10, x], [8, y]] as const) drive(n, 90, randomMoves(n, 400), 0, unit);
    expect(() => makeRing(10, 90, 0, { lineAt: 300 })).toThrow(/cannot fire/);
    expect(() => makeRing(10, 90, 0, { lineAt: 385, fastLines: true })).toThrow(/lineAt/);
  });

  it('lines form a straight row at pitch 1, in order, on the edge of the block', () => {
    for (const transpose of [false, true])
      for (const n of SIZES) {
        const { ring, net } = makeRing(n, 90, 0, { transpose });
        const cell = (id: string) => net.neurons.find((q) => q.id === id)!;
        const [u, v] = transpose ? (['y', 'x'] as const) : (['x', 'y'] as const);
        const lines = ring.lines.map(cell);
        lines.forEach((l, j) => {
          expect(l[u] - lines[0]![u]).toBe(j);
          expect(l[v]).toBe(lines[0]![v]);
        });
        expect(Math.max(...net.neurons.map((q) => q[v]))).toBe(lines[0]![v]);
      }
  });

  it('fastLines: line j is the relay next to R_j, labelled j; no line row is built', () => {
    for (const transpose of [false, true])
      for (const n of SIZES) {
        const { ring, net } = makeRing(n, 90, 0, { fastLines: true, transpose });
        const slow = makeRing(n, 90, 0, { transpose });
        ring.lines.forEach((id, j) => {
          expect(travel(net, ring.copies.r[j]!, id)).toBe(15);
          expect(net.neurons.find((q) => q.id === id)!.label).toBe(String(j));
          expect(net.connections.filter((c) => c.from === id).map((c) => c.to)).toEqual([ring.copies.r[j]]);
        });
        // Same core, same cells: only the line row and its relays are gone.
        const core = new Set(net.neurons.map((q) => q.id));
        const extra = slow.net.neurons.filter((q) => !core.has(q.id));
        expect(extra.every((q) => /^x-(l|d)\d/.test(q.id))).toBe(true);
        expect(net.neurons.map(({ label: _, ...q }) => q)).toEqual(slow.net.neurons.filter((q) => core.has(q.id)).map(({ label: _, ...q }) => q));
      }
  });
});

describe('read window', () => {
  // The read may come at any offset in [readEarliest, readLatest], frame by
  // frame; the lines follow it. Both ends are exact: one tick outside breaks.
  for (const n of SIZES)
    for (const fastLines of MODES)
      it(`n=${n}${fastLines ? ' fastLines' : ''}: any read offset in the window works, one tick outside fails`, () => {
        const units = Array.from({ length: n }, (_, s) => makeRing(n, 480, s, { fastLines }));
        const { minF, readEarliest: E } = units[0]!.ring;
        for (const F of [minF, 240, 480]) {
          const Lt = F + units[0]!.ring.readLatest - 480;
          const sc = (s: number, seed: number, read: (k: number) => number, frames = 60): Scenario => ({ F, start: s, moves: randomMoves(seed, frames), read });
          const rng = mulberry32(F);
          for (const seed of [1, 2]) {
            const s = seed % n;
            const r = Array.from({ length: 3000 }, () => E + Math.floor(rng() * (Lt - E + 1)));
            expect(run(units[s]!, sc(s, seed, (k) => r[k]!, 3000)).error).toBeUndefined();
          }
          for (let s = 0; s < n; s++) {
            // Extremes, alternating: the latest read followed by the earliest.
            expect(run(units[s]!, sc(s, s, (k) => (k % 2 ? E : Lt))).error).toBeUndefined();
            expect(run(units[s]!, sc(s, s, (k) => (k % 2 ? Lt : E))).error).toBeUndefined();
          }
          const fails = (r: number) => units.some((u, s) => [1, 2, 3].some((seed) => run(u, sc(s, seed * 10 + s, () => r)).error));
          expect(fails(E), `F=${F}`).toBe(false);
          expect(fails(Lt), `F=${F}`).toBe(false);
          expect(fails(E - 1), `F=${F}`).toBe(true);
          expect(fails(Lt + 1), `F=${F}`).toBe(true);
        }
      });

  it('minF is exact: one tick shorter breaks the contract (with reads at readLag)', () => {
    for (const n of SIZES) {
      const units = Array.from({ length: n }, (_, s) => makeRing(n, 200, s));
      const { minF } = units[0]!.ring;
      const fails = (F: number) => units.some((u, s) => [1, 2, 3].some((seed) => run(u, { F, start: s, moves: randomMoves(seed * 10 + s, 60) }).error));
      expect(fails(minF)).toBe(false);
      expect(fails(minF - 1)).toBe(true);
    }
  });
});

describe('power-on', () => {
  it('alone, power digs the holes and leaves the token at the start, then all is idle', () => {
    for (const n of SIZES)
      for (let s = 0; s < n; s++) {
        const { ring, net } = makeRing(n, 90, s);
        const sim = new Simulation(net);
        sim.schedule(1, ring.power);
        sim.runUntilIdle();
        const rest = ring.restFor(s);
        for (const id of Object.keys(rest)) expect(sim.charge(id), id).toBe(rest[id]);
        expect(sim.pulses()).toHaveLength(0);
      }
  });

  // powerLead is exact: with power powerLead ticks before t_0 every start and
  // every first move (or hold) works; one tick later, some first move breaks.
  for (const fastLines of MODES)
    it(`powerLead is the smallest lead that works${fastLines ? ' (fastLines)' : ''}`, () => {
      for (const n of SIZES)
        for (let s = 0; s < n; s++) {
          const unit = makeRing(n, 200, s, { fastLines });
          const { powerLead, minF } = unit.ring;
          expect(powerLead).toBe(n === 8 ? 21 : 22);
          for (const F of [minF, 480]) {
            const sc = (m: Move, lead: number) => ({ F, start: s, lead, moves: [m, 'fwd', 'back', 'hold', 'back', 'fwd'] as Move[] });
            for (const m of MOVES) {
              expect(run(unit, sc(m, powerLead)).error, `n=${n} s=${s} ${m}`).toBeUndefined();
              expect(run(unit, { ...sc(m, powerLead), read: () => unit.ring.readEarliest }).error, `n=${n} s=${s} ${m} early read`).toBeUndefined();
            }
            expect(MOVES.some((m) => run(unit, sc(m, powerLead - 1)).error), `n=${n} s=${s}`).toBe(true);
          }
        }
    });
});

/**
 * Mutation test: the ring without each single connection, and with each
 * single threshold +1, must break an invariant of run() on a short scenario
 * where every position is the holder of a forward and of a backward move and
 * is read, at the tightest timing (F = minF, power powerLead before t_0).
 * Threshold -1 makes 0 of every threshold here (all are 1), which the engine
 * reads as 1 (Simulation.deliver: charge >= max(1, threshold)): those mutants
 * are the same network, which the test confirms with identical fire logs.
 */
describe('mutation test', () => {
  for (const n of SIZES)
    for (const fastLines of MODES)
      it(`n=${n}${fastLines ? ' fastLines' : ''}: every mutant breaks an invariant`, () => {
        const start = 3;
        const { ring, net } = makeRing(n, 200, start, { fastLines });
        const moves: Move[] = [...Array<Move>(n + 1).fill('fwd'), 'hold', ...Array<Move>(n + 1).fill('back'), 'hold', ...randomMoves(n, 10)];
        const sc: Scenario = { F: ring.minF, moves, start, lead: ring.powerLead };
        const log = (m: Network) => {
          const out: string[] = [];
          return { error: run({ ring, net: m }, sc, out).error, out };
        };
        const original = log(net);
        expect(original.error).toBeUndefined();
        const survivors: string[] = [];
        let killed = 0;
        const trial = (name: string, m: Network) => (run({ ring, net: m }, sc).error ? killed++ : survivors.push(name));
        net.connections.forEach((c, i) => trial(`cut ${c.from} -> ${c.to}`, { ...net, connections: net.connections.filter((_, k) => k !== i) }));
        const withThreshold = (i: number, th: number) => ({ ...net, neurons: net.neurons.map((q, k) => (k === i ? { ...q, threshold: th } : q)) });
        let equivalent = 0;
        net.neurons.forEach((q, i) => {
          trial(`${q.id} threshold ${q.threshold + 1}`, withThreshold(i, q.threshold + 1));
          if (q.threshold > 1) trial(`${q.id} threshold ${q.threshold - 1}`, withThreshold(i, q.threshold - 1));
          else {
            expect(log(withThreshold(i, 0))).toEqual(original);
            equivalent++;
          }
        });
        expect(survivors).toEqual([]);
        expect(killed).toBe(net.connections.length + net.neurons.length);
        expect(equivalent).toBe(net.neurons.length);
      });
});

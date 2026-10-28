import { describe, expect, it } from 'vitest';
import { NetworkBuilder, Simulation, travelTicks, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { buildRing, type RingOptions } from './snake-ring';

type Move = 'fwd' | 'back' | 'hold';
const travel = (net: Network, a: string, b: string) => travelTicks(net.neurons.find((q) => q.id === a)!, net.neurons.find((q) => q.id === b)!);
const MOVES: readonly Move[] = ['fwd', 'back', 'hold'];

function makeRing(n: number, F: number, start = 0, extra: Partial<RingOptions> = {}) {
  const b = new NetworkBuilder();
  const ring = buildRing(b, { x0: 20, y0: 20, sx: 1 }, { n, F, prefix: 'x', start, ...extra });
  return { ring, net: b.build() };
}

/**
 * Drive a ring: power at tick 1, frame k's move at t_k = 1 + (k+1)F, its
 * read at t_k + readLag. Checks, against the model (position mod n), that
 * every frame exactly one line fires, the right one, at the exact tick, and
 * that every neuron of the block is at its rest charge at t_k + settle.
 */
function drive(n: number, F: number, moves: Move[], start = 0, unit = makeRing(n, F, start)) {
  const { ring, net } = unit;
  const sim = new Simulation(net);
  sim.schedule(1, ring.power);
  const t = (k: number) => 1 + (k + 1) * F;
  moves.forEach((m, k) => {
    if (m !== 'hold') sim.schedule(t(k), ring[m]);
    sim.schedule(t(k) + ring.readLag, ring.read);
  });
  const lineOf = new Map(ring.lines.map((id, j) => [id, j] as const));
  const fired: Array<{ j: number; tick: number }> = [];
  const expected: Array<{ j: number; tick: number }> = [];
  const settleAt = new Map<number, number>(); // tick -> position
  let pos = start;
  moves.forEach((m, k) => {
    pos = (pos + (m === 'fwd' ? 1 : m === 'back' ? n - 1 : 0)) % n;
    expected.push({ j: pos, tick: t(k) + ring.readLag + ring.lineDelay[pos]! });
    settleAt.set(t(k) + ring.settle, pos);
  });
  const end = expected[expected.length - 1]!.tick + 1;
  let maxPulses = 0;
  let checks = 0;
  const ids = Object.keys(ring.restFor(0));
  while (sim.tick < end) {
    for (const e of sim.step()) {
      const j = lineOf.get(e.neuron);
      if (j !== undefined) fired.push({ j, tick: e.tick });
    }
    maxPulses = Math.max(maxPulses, sim.pulses().length);
    const p = settleAt.get(sim.tick);
    if (p !== undefined) {
      const rest = ring.restFor(p);
      for (const id of ids) if (sim.charge(id) !== rest[id]) throw new Error(`${id} holds ${sim.charge(id)}, not ${rest[id]}, at tick ${sim.tick} (pos ${p})`);
      checks++;
    }
  }
  expect(fired).toEqual(expected);
  expect(checks).toBe(moves.length);
  return { maxPulses, pos };
}

function randomMoves(seed: number, frames: number): Move[] {
  const rng = mulberry32(seed);
  return Array.from({ length: frames }, () => MOVES[Math.floor(rng() * 3)]!);
}

describe('ring counter', () => {
  for (const n of [8, 10])
    for (const F of [90, 120]) {
      it(`n=${n} F=${F}: every start position, then fwd / back / hold`, () => {
        for (let s = 0; s < n; s++) for (const m of MOVES) drive(n, F, [m, 'hold', m, m], s);
      });

      it(`n=${n} F=${F}: wraps around both ways`, () => {
        expect(drive(n, F, Array<Move>(2 * n + 1).fill('fwd')).pos).toBe(1);
        expect(drive(n, F, Array<Move>(2 * n + 1).fill('back')).pos).toBe(n - 1);
      });

      it(`n=${n} F=${F}: 3000 random frames, three seeds`, () => {
        const unit = makeRing(n, F);
        for (const seed of [1, 2, 3]) {
          const { maxPulses } = drive(n, F, randomMoves(seed, 3000), seed % n, makeRing(n, F, seed % n));
          // In flight at once: at most one frame's broadcasts plus its consequences.
          expect(maxPulses).toBeLessThan(unit.net.connections.length);
        }
      });
    }

  it('works at its own minimum frame period, and refuses a shorter one', () => {
    for (const n of [8, 10]) {
      const { ring } = makeRing(n, 200);
      drive(n, ring.minF, randomMoves(7, 500));
      expect(() => makeRing(n, ring.minF - 1)).toThrow(/below/);
    }
  });

  it('power-on: tokens and holes are in place before a move a frame later can reach them', () => {
    for (const n of [8, 10])
      for (let s = 0; s < n; s++) {
        const { ring, net } = makeRing(n, 90, s);
        const sim = new Simulation(net);
        sim.schedule(1, ring.power);
        // Power's last -1 lands before the first pair of a move fired >= F later.
        expect(sim.runUntilIdle()).toBeLessThan(90 + Math.min(...ring.copies.f.map((id) => travel(net, ring.fwd, id))));
        const rest = ring.restFor(s);
        for (const id of Object.keys(rest)) expect(sim.charge(id), id).toBe(rest[id]);
        expect(sim.pulses()).toHaveLength(0);
      }
  });
});

describe('ring timing', () => {
  /**
   * The frame schedule, in ticks after t_k (the tick fwd or back fires):
   *
   *   event                                   n = 8   n = 10
   *   pair +1/-1 lands on every F_j (or B_j)  60-64   75-81    (holder fires)
   *   token / stale clears land               ..141   ..152
   *   settled moment (all at rest)             141     152     = settle
   *   read fires                                82      78     = readLag
   *   read +1 lands on every R_j (holder fires)142-146 153-159
   *   line j fires                             343     385     = readLag + lineDelay (or lineAt)
   *   minimum frame period                      83      81     = minF
   */
  it('matches the documented schedule', () => {
    const row = (n: number) => {
      const { ring } = makeRing(n, 90);
      return { readLag: ring.readLag, settle: ring.settle, line: ring.readLag + ring.lineDelay[0]!, minF: ring.minF, uniform: new Set(ring.lineDelay).size };
    };
    expect(row(8)).toEqual({ readLag: 82, settle: 141, line: 343, minF: 83, uniform: 1 });
    expect(row(10)).toEqual({ readLag: 78, settle: 152, line: 385, minF: 81, uniform: 1 });
  });

  it('copies fire, and holders are restored, at the documented ticks', () => {
    const table = {
      8: { holder: [60, 64], read: [142, 146] },
      10: { holder: [75, 81], read: [153, 159] },
    };
    for (const n of [8, 10] as const) {
      const F = 90;
      const { ring, net } = makeRing(n, F);
      const sim = new Simulation(net);
      sim.schedule(1, ring.power);
      const moves: Move[] = [...Array<Move>(n).fill('fwd'), ...Array<Move>(n).fill('back')];
      const t = (k: number) => 1 + (k + 1) * F;
      moves.forEach((m, k) => {
        sim.schedule(t(k), ring[m as 'fwd' | 'back']);
        sim.schedule(t(k) + ring.readLag, ring.read);
      });
      const kind = new Map<string, 'holder' | 'read'>([...ring.copies.f, ...ring.copies.b].map((id) => [id, 'holder'] as const));
      ring.copies.r.forEach((id) => kind.set(id, 'read'));
      const seen = { holder: [] as number[], read: [] as number[] };
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
      for (const k of ['holder', 'read'] as const) {
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
  });

  it('lines form a straight row at pitch 1, in order, on the edge of the block', () => {
    for (const transpose of [false, true])
      for (const n of [8, 10]) {
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
});

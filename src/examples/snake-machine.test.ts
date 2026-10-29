import { describe, expect, it } from 'vitest';
import { Simulation, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { DIRECTIONS, type Direction } from './snake-control';
import { buildSnake, segmentHitsRect, squares, type Snake } from './snake-machine';
import { controlFacts, controlModel, disambiguate, snakeModel, type KeyPress } from './snake-model';

const snake = buildSnake();
const factsCache = new Map<Snake, ReturnType<typeof controlFacts>>();
const factsOf = (s: Snake) => factsCache.get(s) ?? factsCache.set(s, controlFacts(s.network, s.parts.control)).get(s)!;
const facts = factsOf(snake);
const F = snake.F;
const L = 4;
/** Most pulses ever in flight at once (the long run measures 222). */
const MAX_PULSES = 250;
/** Glue: every connection not internal to a block, and every relay outside the blocks. */
const GLUE_CONNECTIONS = 95;
const GLUE_NEURONS = 35;
const BUDGET = { neurons: 1160, connections: 2599, size: [43, 66] };
/** Latencies in ticks (see Snake.latency). */
const LATENCY = { strobeToLamp: [1368, 1442], pressToStrobe: [146, 647], pressToLampMin: 1514, pressToLampMax: 2089 };
/** The frame schedule: the table in buildSnake(), ticks after frameTick(k). */
const SCHEDULE: Snake['schedule'] = {
  strobe: 178,
  head: { moveX: 636, moveY: 414, readX: 714, readY: 496, linesX: 1021, linesY: 757, cols: [1287, 1320], rows: [1012, 1052], skew: [-308, -235], window: [-323, -180], lamp: [1546, 1620], q: [1410, 1472] },
  tail: { moveX: 670, moveY: 418, readX: 748, readY: 500, linesX: 1055, linesY: 761, cols: [1321, 1354], rows: [1037, 1065], skew: [-317, -256], window: [-318, -173], lamp: [1580, 1655], q: [1443, 1507] },
  queue: { shift: 160, inputs: [259, 326], outputs: 194, any: 243 },
  lamps: [1546, 1655],
  powerSlack: { headX: 224, headY: 197, tailX: 2164, tailY: 2121, queue: 35, headSelect: 399, tailSelect: 2313 },
};

interface RunOptions {
  /** Run this network instead (mutants). */
  net?: Network;
}

interface RunResult {
  error?: string;
  /** Most pulses in flight at once. */
  maxPulses: number;
  /** The model's direction per frame. */
  dirs: Direction[];
  /** Per frame (when the head enters a pixel the tail is not leaving): tick its lamp's charge rose. */
  headRise: Map<number, number>;
  /** Pixels the head visited. */
  visited: Set<string>;
  /** Most pulses in flight during each frame (tick 1 + kF .. kF + F). */
  pulsesByFrame: number[];
}

/**
 * Drive the machine with key presses for `frames` frames and check it against
 * the reference model (press model -> directions -> snake), exactly:
 * - every frame's strobe fires at frameTick(k) + strobe, in the model's direction;
 * - exactly one head Q fires per frame (the model's head pixel) and one tail Q
 *   per frame from frame L on (the pixel the tail leaves), inside their
 *   documented windows; no other Q ever fires;
 * - at settledTick(k) every lamp holds the model's multiplicity (0..L);
 * - every probe holds: each block at rest at its own settled moment.
 * Stops at the first problem.
 */
function run(s: Snake, frames: number, presses: KeyPress[], opts: RunOptions = {}): RunResult {
  const F = s.F;
  // The run ends at frame (frames - 1)'s settled tick, a few frames of strobes later.
  const dirs = controlModel(frames + 5, presses, factsOf(s));
  const model = snakeModel(dirs, s.start);
  const sim = new Simulation(opts.net ?? s.network);
  for (const p of presses) sim.schedule(p.t, s.keys[p.key]);
  const { schedule: sch, frameTick: c } = s;
  const strobes = new Map(DIRECTIONS.map((d) => [s.parts.control.strobes[d], d] as const));
  const headQ = new Map(s.parts.headSelect.select.flatMap((r, y) => r.map((id, x) => [id, { x, y }] as const)));
  const tailQ = new Map(s.parts.tailSelect.select.flatMap((r, y) => r.map((id, x) => [id, { x, y }] as const)));
  const probes = new Map<number, ReturnType<Snake['probes']>>();
  for (let k = 0; k < frames; k++) {
    const state = { head: model.heads[k]!, tail: model.tail(k), queued: [0, 1, 2, 3].map((d) => (k - d >= 0 ? DIRECTIONS.indexOf(dirs[k - d]!) : null)) };
    for (const p of s.probes(k, state)) probes.set(p.tick, [...(probes.get(p.tick) ?? []), p]);
  }
  const settled = new Map(Array.from({ length: frames }, (_, k) => [s.settledTick(k), k] as const));
  let error: string | undefined;
  const qSeen = { head: new Set<number>(), tail: new Set<number>() };
  const headRise = new Map<number, number>();
  const visited = new Set<string>();
  /** Lamps being watched for the head's +1: lamp id -> [frame, charge before]. */
  const watch = new Map<string, [number, number]>();
  const end = s.settledTick(frames - 1);
  let maxPulses = 0;
  const pulsesByFrame: number[] = [];
  /** Frame k whose window [c_k + lo, c_k + hi] holds tick, or -1. */
  const frameOf = (tick: number, [lo, hi]: [number, number]) => {
    const k = Math.floor((tick - c(0) - lo) / F);
    return k >= 0 && tick - c(k) <= hi ? k : -1;
  };
  while (sim.tick < end && !error) {
    for (const e of sim.step()) {
      const d = strobes.get(e.neuron);
      if (d) {
        const k = (e.tick - c(0) - sch.strobe) / F;
        if (!Number.isInteger(k) || dirs[k] !== d) error = `strobe ${d} at ${e.tick} (frame ${k}: ${dirs[k]})`;
      }
      for (const [side, map, win] of [['head', headQ, sch.head.q], ['tail', tailQ, sch.tail.q]] as const) {
        const px = map.get(e.neuron);
        if (!px) continue;
        const k = frameOf(e.tick, win);
        const want = k < 0 ? undefined : side === 'head' ? model.heads[k] : k >= L ? model.heads[k - L] : undefined;
        if (!want || want.x !== px.x || want.y !== px.y) error = `${side} Q (${px.x}, ${px.y}) fired at ${e.tick} (frame ${k})`;
        else if (qSeen[side].has(k)) error = `second ${side} Q in frame ${k}`;
        else qSeen[side].add(k);
        const tail = model.tail(k);
        if (side === 'head' && want && (k < L || tail.x !== px.x || tail.y !== px.y)) {
          const lamp = s.lamps[px.y]![px.x]!;
          watch.set(lamp, [k, sim.charge(lamp)]);
          visited.add(`${px.x},${px.y}`);
        }
      }
    }
    for (const [lamp, [k, before]] of watch)
      if (sim.charge(lamp) > before) {
        headRise.set(k, sim.tick);
        watch.delete(lamp);
      }
    const inFlight = sim.pulses().length;
    maxPulses = Math.max(maxPulses, inFlight);
    const fk = Math.floor((sim.tick - 1) / F);
    pulsesByFrame[fk] = Math.max(pulsesByFrame[fk] ?? 0, inFlight);
    const k = settled.get(sim.tick);
    if (k !== undefined) {
      const want = model.lit(k);
      for (let y = 0; y < 8 && !error; y++)
        for (let x = 0; x < 10 && !error; x++) {
          const got = sim.charge(s.lamps[y]![x]!);
          if (got !== want[y]![x] || got < 0 || got > L) error = `lamp (${x}, ${y}) holds ${got}, not ${want[y]![x]}, at frame ${k}'s settled tick ${sim.tick}`;
        }
      if (!qSeen.head.has(k)) error ??= `no head Q in frame ${k}`;
      if (k >= L && !qSeen.tail.has(k)) error ??= `no tail Q in frame ${k}`;
    }
    for (const p of probes.get(sim.tick) ?? [])
      for (const [id, ok] of Object.entries(p.allowed)) {
        const got = sim.charge(id);
        if (!ok.includes(got)) error ??= `${p.block}: ${id} holds ${got}, not ${ok.join('/')}, at tick ${sim.tick}`;
      }
  }
  return { error, maxPulses, dirs: dirs.slice(0, frames), headRise, visited, pulsesByFrame };
}

/** Random presses: bursts of 1-4 keys (some on the same tick), gaps up to 3 frames; ambiguous ties dropped. */
function randomPresses(seed: number, frames: number, s = snake): KeyPress[] {
  const rng = mulberry32(seed);
  const presses: KeyPress[] = [];
  const F = s.F;
  let t = 30;
  while (t < frames * F) {
    const burst = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < burst; i++) presses.push({ t: t + (rng() < 0.3 ? 0 : Math.floor(rng() * 40)), key: DIRECTIONS[Math.floor(rng() * 4)]! });
    t += Math.floor(rng() * 3 * F);
  }
  const kept = disambiguate(frames + 5, presses, factsOf(s));
  expect(kept.length).toBeGreaterThan(presses.length * 0.95);
  return kept;
}

/** The model's turn frame for a press of `to` at tick p while moving `from` (pressed at tick 40), or undefined on a tie. */
function turnFrame(from: Direction, to: Direction, p: number): number | undefined {
  try {
    const dirs = controlModel(Math.ceil(p / F) + 3, [{ t: 40, key: from }, { t: p, key: to }], facts);
    return dirs.findIndex((d, k) => k > 2 && d === to);
  } catch {
    return undefined;
  }
}

/** The latest press tick (key `to`, moving `from`) that still turns the snake at frame m. */
function lastPressFor(from: Direction, to: Direction, m: number): number {
  for (let p = snake.frameTick(m) + facts.readOffset; ; p--) if (turnFrame(from, to, p) === m) return p;
}

describe('snake machine: behaviour', () => {
  it('idle: moves right and wraps, growing to 4 lit pixels in a row, for 100 frames', () => {
    const r = run(snake, 100, []);
    expect(r.error).toBeUndefined();
    expect(r.dirs.every((d) => d === 'right')).toBe(true);
    // The model it matched: 1, 2, 3, then 4 pixels in a row on the start row, wrapping.
    const model = snakeModel(r.dirs, snake.start);
    for (const k of [0, 1, 2, 3, 50, 99]) {
      const lit = model.lit(k).flatMap((row, y) => row.flatMap((v, x) => (v ? [`${x},${y}`] : [])));
      const want = Array.from({ length: Math.min(k + 1, L) }, (_, i) => `${(snake.start.x + k + 1 - i + 100) % 10},${snake.start.y}`);
      expect(lit.sort()).toEqual(want.sort());
    }
  });

  it('every key at several phases turns the snake at exactly the frame the press model predicts', () => {
    const m = 6;
    let turns = 0;
    for (const from of DIRECTIONS)
      for (const to of DIRECTIONS) {
        if (from === to) continue;
        const last = lastPressFor(from, to, m);
        const phases = [last - F + 1, last - Math.round(F / 2), last - 1, last, last + 1, last + Math.round(F / 3)];
        for (const p of phases) {
          const k = turnFrame(from, to, p);
          if (k === undefined) continue; // a tie the model leaves open
          expect(k, `${from} -> ${to} at ${p}`).toBe(p <= last ? m : m + 1);
          const r = run(snake, k + 3, [{ t: 40, key: from }, { t: p, key: to }]);
          expect(r.error, `${from} -> ${to} at ${p}`).toBeUndefined();
          expect(r.dirs[k]).toBe(to);
          expect(r.dirs[k - 1]).not.toBe(to);
          turns++;
        }
      }
    expect(turns).toBeGreaterThanOrEqual(12 * 5);
  });

  for (const seed of [1, 2, 3, 4])
    it(`property: 600 frames of random presses (seed ${seed}) match the model exactly`, { timeout: 60_000 }, () => {
      const presses = randomPresses(seed, 600);
      const r = run(snake, 600, presses);
      expect(r.error).toBeUndefined();
      expect(new Set(r.dirs)).toEqual(new Set(DIRECTIONS));
    });

  it('other frame periods and start positions: the same layout, re-timed, still matches the model', { timeout: 60_000 }, () => {
    for (const [F2, start] of [[360, { x: 9, y: 7 }], [600, { x: 4, y: 0 }]] as const) {
      const other = buildSnake({ F: F2, start });
      expect(other.network.neurons.map((n) => [n.x, n.y])).toEqual(snake.network.neurons.map((n) => [n.x, n.y]));
      expect(run(other, 150, randomPresses(F2, 150, other)).error).toBeUndefined();
    }
    expect(() => buildSnake({ F: 240 })).toThrow(/never rests/);
  });

  it('the checker itself catches a machine that disagrees with the model', () => {
    // A snake started elsewhere, checked against the default start's model.
    const other = buildSnake({ start: { x: 5, y: 5 } });
    expect(run(snake, 8, [], { net: other.network }).error).toMatch(/Q|lamp|holds/);
    // Presses the machine never sees.
    const presses = [{ t: snake.frameTick(3), key: 'down' as const }];
    const deaf: Network = { ...snake.network, connections: snake.network.connections.filter((c) => c.from !== snake.keys.down) };
    expect(run(snake, 8, presses, { net: deaf }).error).toMatch(/strobe/);
  });

  it('long run: 3000 frames of random presses, no drift, pulses in flight bounded', { timeout: 120_000 }, () => {
    const r = run(snake, 3000, randomPresses(5, 3000));
    // No drift: every block was back at rest at its settled moment in every frame (run's probes).
    expect(r.error).toBeUndefined();
    // Bounded: the same ceiling early and late (no build-up), well under one pulse per connection.
    const early = Math.max(...r.pulsesByFrame.slice(0, 1000));
    const late = Math.max(...r.pulsesByFrame.slice(2000, 3000));
    expect(r.maxPulses).toBeLessThanOrEqual(MAX_PULSES);
    expect([early, late].every((m) => m <= MAX_PULSES && m > MAX_PULSES / 2)).toBe(true);
  });
});

describe('snake machine: glue mutation test', () => {
  /**
   * A scenario that uses every glue element: right x10 (every X position),
   * down x8 (every Y position), left x2, up x2, right x6; the tail replays it
   * all. Every glue connection cut, and every glue relay's threshold raised
   * to 2, must break an invariant of run(). (Threshold 0 is the same as 1 in
   * the engine, so lowering is not a mutant.)
   */
  it('every glue connection and every glue threshold matters', { timeout: 300_000 }, () => {
    const plan: Array<[number, Direction]> = [[10, 'down'], [18, 'left'], [20, 'up'], [22, 'right']];
    const presses = plan.map(([k, key]) => ({ t: snake.frameTick(k), key }));
    const frames = 28;
    const ok = run(snake, frames, presses);
    expect(ok.error).toBeUndefined();
    expect(ok.dirs.join(' ')).toBe(['right', 'down', 'left', 'up', 'right'].flatMap((d, i) => Array<string>([10, 8, 2, 2, 6][i]!).fill(d)).join(' '));
    const net = snake.network;
    const glueConn = new Set(snake.glue.connections.map(([a, z]) => `${a}>${z}`));
    // Glue = every connection not internal to a block (a block's own wires, lamp wires included, are tested with the block).
    const blockOf = (id: string) => Object.entries(snake.blocks).find(([, b]) => b.ids.includes(id))?.[0] ?? (id.startsWith('px-') ? 'screen' : 'glue');
    const internal = (a: string, z: string) => (blockOf(a) === blockOf(z) && blockOf(a) !== 'glue') || (blockOf(z) === 'screen' && /Select$/.test(blockOf(a)));
    const external = net.connections.filter((c) => !internal(c.from, c.to));
    expect(external.map((c) => `${c.from}>${c.to}`).sort()).toEqual([...glueConn].sort());
    const survivors: string[] = [];
    for (const c of external) {
      const mutant: Network = { ...net, connections: net.connections.filter((d) => d !== c) };
      if (!run(snake, frames, presses, { net: mutant }).error) survivors.push(`cut ${c.from} -> ${c.to}`);
    }
    for (const id of snake.glue.ids) {
      const mutant: Network = { ...net, neurons: net.neurons.map((n) => (n.id === id ? { ...n, threshold: n.threshold + 1 } : n)) };
      expect(net.neurons.find((n) => n.id === id)!.threshold).toBe(1);
      if (!run(snake, frames, presses, { net: mutant }).error) survivors.push(`${id} threshold 2`);
    }
    expect(survivors).toEqual([]);
    expect([external.length, snake.glue.ids.length]).toEqual([GLUE_CONNECTIONS, GLUE_NEURONS]);
  });
});

describe('snake machine: geometry and budget', () => {
  const net = snake.network;
  const cell = new Map(net.neurons.map((n) => [n.id, n] as const));
  const lampIds = new Set(snake.lamps.flat());

  it('the screen: 10 x 8 lamps at pitch 1, a free bezel margin around it', () => {
    snake.lamps.forEach((row, y) => row.forEach((id, x) => expect([cell.get(id)!.kind, cell.get(id)!.x, cell.get(id)!.y]).toEqual(['lamp', snake.screen.x0 + x, snake.screen.y0 + y])));
    expect([snake.screen.w, snake.screen.h, snake.lamps.length, snake.lamps[0]!.length]).toEqual([10, 8, 8, 10]);
    const { bezel, screen } = snake;
    expect([bezel.x0, bezel.y0, bezel.x1, bezel.y1]).toEqual([screen.x0 - 1, screen.y0 - 1, screen.x0 + screen.w, screen.y0 + screen.h]);
    const inside = net.neurons.filter((n) => n.x >= bezel.x0 && n.x <= bezel.x1 && n.y >= bezel.y0 && n.y <= bezel.y1);
    expect(inside.every((n) => lampIds.has(n.id))).toBe(true);
  });

  it('no wire crosses the screen or its margin unless it ends at a lamp; each lamp has exactly its two Qs', () => {
    const area = squares(snake.bezel);
    const crossing = net.connections.filter((c) => !lampIds.has(c.to) && segmentHitsRect(cell.get(c.from)!, cell.get(c.to)!, area));
    expect(crossing).toEqual([]);
    snake.lamps.forEach((row, y) =>
      row.forEach((id, x) => {
        const from = net.connections.filter((c) => c.to === id).map((c) => c.from).sort();
        expect(from).toEqual([snake.parts.headSelect.select[y]![x]!, snake.parts.tailSelect.select[y]![x]!].sort());
      }),
    );
    expect(net.connections.filter((c) => lampIds.has(c.from))).toEqual([]);
  });

  it('blocks do not overlap; glue relays sit outside every block and off the bezel', () => {
    const boxes = Object.entries(snake.blocks);
    for (const [a, A] of boxes)
      for (const [b, B] of boxes) if (a < b) expect(A.box.x1 < B.box.x0 || B.box.x1 < A.box.x0 || A.box.y1 < B.box.y0 || B.box.y1 < A.box.y0, `${a} / ${b}`).toBe(true);
    for (const id of snake.glue.ids) {
      const c = cell.get(id)!;
      for (const [, B] of [...boxes, ['bezel', { box: snake.bezel }] as const]) expect(c.x >= B.box.x0 && c.x <= B.box.x1 && c.y >= B.box.y0 && c.y <= B.box.y1, id).toBe(false);
    }
    // Every neuron belongs to exactly one block, the screen or the glue.
    const owned = [...Object.values(snake.blocks).flatMap((b) => b.ids), ...lampIds, ...snake.glue.ids];
    expect(owned.length).toBe(net.neurons.length);
    expect(new Set(owned).size).toBe(net.neurons.length);
  });

  it('the control unit sits left of the screen, its keys level with the screen middle', () => {
    const keys = DIRECTIONS.map((d) => cell.get(snake.keys[d])!);
    const mid = snake.screen.y0 + (snake.screen.h - 1) / 2;
    expect(Math.min(...keys.map((k) => k.y)) <= mid && Math.max(...keys.map((k) => k.y)) >= mid - 1).toBe(true);
    expect(snake.blocks.control.box.x1).toBeLessThan(snake.bezel.x0);
    expect(snake.blocks.control.box.y0).toBeGreaterThanOrEqual(snake.bezel.y0);
    expect(snake.blocks.control.box.y1).toBeLessThanOrEqual(snake.bezel.y1);
  });

  it('budget and size', () => {
    expect(net.neurons.length).toBeLessThanOrEqual(3000);
    expect(net.connections.length).toBeLessThanOrEqual(8000);
    const xs = net.neurons.map((n) => n.x);
    const ys = net.neurons.map((n) => n.y);
    const size = [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
    expect({ neurons: net.neurons.length, connections: net.connections.length, size }).toEqual(BUDGET);
  });

  it('glue wires: travel exactly as solved (they are the timing), none ends inside the wrong block', () => {
    for (const [a, z] of snake.glue.connections) expect(net.connections.some((c) => c.from === a && c.to === z)).toBe(true);
    // Glue starts only at block outputs and ends only at block inputs (or relays).
    const { control: ctl, headX, headY, tailX, tailY, headSelect, tailSelect, queue } = snake.parts;
    const outputs = new Set([...DIRECTIONS.map((d) => ctl.strobes[d]), ctl.clock, ctl.power, 'ctl-strobe-clock', ...queue.outputs, queue.any, ...headX.lines, ...headY.lines, ...tailX.lines, ...tailY.lines, ...snake.glue.ids]);
    const inputs = new Set([...[headX, headY, tailX, tailY].flatMap((r) => [r.fwd, r.back, r.read, r.power]), ...queue.inputs, queue.shift, queue.power, ...[headSelect, tailSelect].flatMap((p) => [...p.cols, ...p.rows, p.power]), ...snake.glue.ids]);
    for (const [a, z] of snake.glue.connections) {
      expect(outputs.has(a), a).toBe(true);
      expect(inputs.has(z), z).toBe(true);
    }
  });
});

describe('snake machine: latency', () => {
  it('strobe to lamp, measured on every pixel, is the computed span', { timeout: 60_000 }, () => {
    const lat: number[] = [];
    const visited = new Set<string>();
    for (const seed of [1, 2]) {
      const r = run(snake, 600, randomPresses(seed, 600));
      expect(r.error).toBeUndefined();
      for (const [k, t] of r.headRise) lat.push(t - snake.frameTick(k) - snake.schedule.strobe);
      r.visited.forEach((v) => visited.add(v));
    }
    expect(visited.size).toBe(80);
    expect([Math.min(...lat), Math.max(...lat)]).toEqual(snake.latency.strobeToLamp);
    expect(snake.latency).toEqual(LATENCY);
  });

  it('press to lamp: every turn lands within the bounds; press to strobe reaches both extremes', () => {
    const m = 6;
    const toStrobe: number[] = [];
    for (const from of DIRECTIONS)
      for (const to of DIRECTIONS) {
        if (from === to) continue;
        const last = lastPressFor(from, to, m);
        for (const p of [last, last + 1, last - 200]) {
          const k = turnFrame(from, to, p);
          if (k === undefined) continue;
          const r = run(snake, k + 1, [{ t: 40, key: from }, { t: p, key: to }]);
          expect(r.error).toBeUndefined();
          toStrobe.push(snake.frameTick(k) + snake.schedule.strobe - p);
          const rise = r.headRise.get(k);
          if (rise === undefined) continue; // the head entered the pixel the tail left
          expect(rise - p).toBeGreaterThanOrEqual(snake.latency.pressToLampMin);
          expect(rise - p).toBeLessThanOrEqual(snake.latency.pressToLampMax);
        }
      }
    expect([Math.min(...toStrobe), Math.max(...toStrobe)]).toEqual(snake.latency.pressToStrobe);
  });
});

describe('snake machine: frame schedule', () => {
  /**
   * The table in buildSnake(): ticks after frameTick(k) (the frame clock's
   * fire). The tail's events in frame k replay the head's move of frame k - 4.
   */
  it('matches the documented table', () => {
    expect(snake.schedule).toEqual(SCHEDULE);
    // A settled moment exists: every lamp pulse of a frame lands before the next frame's first.
    expect(snake.settledTick(7) - snake.frameTick(7)).toBe(SCHEDULE.lamps[1]);
    expect(SCHEDULE.lamps[1]).toBeLessThan(F + SCHEDULE.lamps[0]);
  });

  it("every event fires at its documented tick (mod F) in a 1500-frame run", { timeout: 60_000 }, () => {
    const { control: ctl, headX, headY, tailX, tailY, headSelect, tailSelect, queue } = snake.parts;
    const S = SCHEDULE;
    const groups: Record<string, [string[], number, number]> = {
      strobe: [DIRECTIONS.map((d) => ctl.strobes[d]), S.strobe, S.strobe],
      headMoveX: [[headX.fwd, headX.back], S.head.moveX, S.head.moveX],
      headMoveY: [[headY.fwd, headY.back], S.head.moveY, S.head.moveY],
      tailMoveX: [[tailX.fwd, tailX.back], S.tail.moveX, S.tail.moveX],
      tailMoveY: [[tailY.fwd, tailY.back], S.tail.moveY, S.tail.moveY],
      headReadX: [[headX.read], S.head.readX, S.head.readX],
      headReadY: [[headY.read], S.head.readY, S.head.readY],
      tailReadX: [[tailX.read], S.tail.readX, S.tail.readX],
      tailReadY: [[tailY.read], S.tail.readY, S.tail.readY],
      headLinesX: [headX.lines, S.head.linesX, S.head.linesX],
      headLinesY: [headY.lines, S.head.linesY, S.head.linesY],
      tailLinesX: [tailX.lines, S.tail.linesX, S.tail.linesX],
      tailLinesY: [tailY.lines, S.tail.linesY, S.tail.linesY],
      headCols: [headSelect.cols, ...S.head.cols],
      headRows: [headSelect.rows, ...S.head.rows],
      tailCols: [tailSelect.cols, ...S.tail.cols],
      tailRows: [tailSelect.rows, ...S.tail.rows],
      headQ: [headSelect.select.flat(), ...S.head.q],
      tailQ: [tailSelect.select.flat(), ...S.tail.q],
      shift: [[queue.shift], S.queue.shift, S.queue.shift],
      inputs: [queue.inputs, ...S.queue.inputs],
      outputs: [queue.outputs, S.queue.outputs, S.queue.outputs],
      any: [[queue.any], S.queue.any, S.queue.any],
    };
    const groupOf = new Map(Object.entries(groups).flatMap(([g, [ids]]) => ids.map((id) => [id, g] as const)));
    const seen = new Map<string, number[]>();
    const sim = new Simulation(snake.network);
    for (const p of randomPresses(3, 1500)) sim.schedule(p.t, snake.keys[p.key]);
    while (sim.tick < snake.frameTick(1500))
      for (const e of sim.step()) {
        const g = groupOf.get(e.neuron);
        // Offset past the group's documented start, mod F: a span may straddle a frame boundary.
        if (g) seen.set(g, [...(seen.get(g) ?? []), (((e.tick - 1 - groups[g]![1]) % F) + F) % F]);
      }
    for (const [g, [, lo, hi]] of Object.entries(groups)) {
      expect(hi - lo, g).toBeLessThan(F);
      const got = seen.get(g)!;
      expect([Math.min(...got), Math.max(...got)], g).toEqual([0, hi - lo]);
    }
  });
});

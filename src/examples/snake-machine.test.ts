import { describe, expect, it } from 'vitest';
import { Simulation, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { DIRECTIONS, type Direction } from './snake-control';
import { buildSnake, KEY_CLEARANCE, segmentDistance, segmentHitsRect, squares, turnExtremes, type Snake } from './snake-machine';
import { controlFacts, controlModel, disambiguate, intentModel, snakeModel, STEP, type KeyPress } from './snake-model';

const snake = buildSnake();
const factsCache = new Map<Snake, ReturnType<typeof controlFacts>>();
const factsOf = (s: Snake) => factsCache.get(s) ?? factsCache.set(s, controlFacts(s.network, s.parts.control)).get(s)!;
const facts = factsOf(snake);
const F = snake.F;
const L = 4;
/** Most pulses ever in flight at once (the long run measures 177). */
const MAX_PULSES = 200;
/** Glue: every connection not internal to a block, and every relay outside the blocks. */
const GLUE_CONNECTIONS = 99;
const GLUE_NEURONS = 39;
const BUDGET = { neurons: 1173, connections: 2612, size: [43, 66] };
/** Latencies in ticks (see Snake.latency). */
const LATENCY = { strobeToLamp: [1368, 1442], pressToStrobe: [212, 707], pressToLampMin: 1580, pressToLampMax: 2149 };
/** The frame schedule: the table in buildSnake(), ticks after frameTick(k). */
const SCHEDULE: Snake['schedule'] = {
  strobe: 178,
  head: { moveX: 636, moveY: 403, readX: 714, readY: 485, linesX: 1021, linesY: 746, cols: [1287, 1320], rows: [1001, 1041], skew: [-319, -246], window: [-323, -180], lamp: [1546, 1620], q: [1410, 1472] },
  tail: { moveX: 684, moveY: 434, readX: 762, readY: 516, linesX: 1069, linesY: 777, cols: [1335, 1368], rows: [1053, 1081], skew: [-315, -254], window: [-318, -173], lamp: [1594, 1669], q: [1457, 1521] },
  queue: { shift: 170, inputs: [273, 340], outputs: 204, any: 253 },
  lamps: [1546, 1669],
  powerSlack: { headX: 162, headY: 133, tailX: 1991, tailY: 2052, queue: 13, headSelect: 377, tailSelect: 2084 },
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

/** Random presses from tick 1 (power-on included): bursts of 1-4 keys (some on the same tick), gaps up to 3 frames; ambiguous ties dropped. */
function randomPresses(seed: number, frames: number, s = snake): KeyPress[] {
  const rng = mulberry32(seed);
  const presses: KeyPress[] = [];
  const F = s.F;
  let t = 1;
  while (t < frames * F) {
    const burst = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < burst; i++) presses.push({ t: t + (rng() < 0.3 ? 0 : Math.floor(rng() * 40)), key: DIRECTIONS[Math.floor(rng() * 4)]! });
    t += Math.floor(rng() * 3 * F);
  }
  const kept = disambiguate(frames + 5, presses, factsOf(s));
  expect(kept.length).toBeGreaterThan(presses.length * 0.95);
  return kept;
}

/** The latest press tick (key `to`, moving `from` since tick 40) that still turns the snake at frame m. */
function lastPressFor(from: Direction, to: Direction, m: number): number {
  const turnsAt = (p: number) => controlModel(m + 2, [{ t: 40, key: from }, { t: p, key: to }], facts)[m] === to;
  for (let p = snake.frameTick(m) + facts.readOffset; ; p--) if (turnsAt(p) && !turnsAt(p + 1)) return p;
}

const range = (lo: number, hi: number, step = 1) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

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

  /**
   * Every turn (12 pairs), pressed at every tick from 12 before its cutoff
   * to 30 after (where a key that changes both bits could show a third
   * direction for a frame) and at 26 phases across the whole frame. One run
   * per pair: moving `from`, press `to` at cutoff + o, back to `from` two
   * frames later. The turn shows at exactly the predicted frame (the slot's
   * frame if o <= 0, the next if o > 0), and no frame ever goes a direction
   * other than `from` or `to`.
   */
  it('every turn, at every phase near its cutoff and across the frame: the predicted frame, never a third direction', { timeout: 120_000 }, () => {
    let turns = 0;
    for (const from of DIRECTIONS)
      for (const to of DIRECTIONS) {
        if (from === to) continue;
        const cut = lastPressFor(from, to, 6) - snake.frameTick(6);
        const offsets = [...range(-12, 30), ...range(-F + 1, F - 1, 37)];
        const presses: KeyPress[] = [{ t: 40, key: from }];
        const slots = offsets.map((o, i) => {
          const m = 4 + 4 * i;
          presses.push({ t: snake.frameTick(m) + cut + o, key: to }, { t: snake.frameTick(m + 2) + cut, key: from });
          return { m, o };
        });
        const frames = 4 + 4 * slots.length;
        const r = run(snake, frames, presses);
        expect(r.error, `${from} -> ${to}`).toBeUndefined();
        expect(r.dirs.slice(2).filter((d) => d !== from && d !== to), `${from} -> ${to}`).toEqual([]);
        for (const { m, o } of slots) {
          expect([r.dirs[m - 1], r.dirs[m], r.dirs[m + 1]], `${from} -> ${to} at cutoff ${o >= 0 ? '+' : ''}${o}`).toEqual([from, o <= 0 ? to : from, to]);
          turns++;
        }
      }
    expect(turns).toBe(12 * 69);
  });

  it('property: presses at least facts.gap apart: the snake always goes where the last press says (intent model)', { timeout: 60_000 }, () => {
    const rng = mulberry32(21);
    const presses: KeyPress[] = [];
    for (let t = 1 + Math.floor(rng() * 20); t < 600 * F; t += facts.gap + Math.floor(rng() * 1.5 * F)) presses.push({ t, key: DIRECTIONS[Math.floor(rng() * 4)]! });
    const want = intentModel(605, presses, facts);
    expect(controlModel(605, presses, facts)).toEqual(want);
    const r = run(snake, 600, presses);
    expect(r.error).toBeUndefined();
    expect(r.dirs).toEqual(want.slice(0, 600));
    expect(presses.length).toBeGreaterThan(600);
  });

  for (const seed of [1, 2, 3, 4])
    it(`property: 600 frames of random presses (seed ${seed}) match the model exactly`, { timeout: 60_000 }, () => {
      const presses = randomPresses(seed, 600);
      const r = run(snake, 600, presses);
      expect(r.error).toBeUndefined();
      expect(new Set(r.dirs)).toEqual(new Set(DIRECTIONS));
    });

  it('between settled moments the snake shows 5 pixels for at most 123 ticks a frame, or 3 for at most 26', { timeout: 60_000 }, () => {
    const sim = new Simulation(snake.network);
    for (const p of randomPresses(6, 300)) sim.schedule(p.t, snake.keys[p.key]);
    const lamps = snake.lamps.flat();
    const longest = { 3: 0, 5: 0 };
    let [value, since] = [4, 0];
    while (sim.tick < snake.settledTick(299)) {
      sim.step();
      if (sim.tick < snake.settledTick(4)) continue;
      const sum = lamps.reduce((s, id) => s + sim.charge(id), 0);
      if (sum !== value) {
        if (value === 3 || value === 5) longest[value] = Math.max(longest[value], sim.tick - since);
        [value, since] = [sum, sim.tick];
      }
      expect([3, 4, 5]).toContain(sum);
    }
    // The schedule bounds them (head and tail lamp spans); this run's longest are 16 and 97.
    const { head, tail } = snake.schedule;
    expect([head.lamp[1] - tail.lamp[0], tail.lamp[1] - head.lamp[0]]).toEqual([26, 123]);
    expect(longest[3]).toBeLessThanOrEqual(26);
    expect(longest[5]).toBeLessThanOrEqual(123);
    expect(longest).toEqual({ 3: 16, 5: 97 });
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
    // Bounded: no build-up (the last 1000 frames peak no higher than the first 1000), well under one pulse per connection.
    const early = Math.max(...r.pulsesByFrame.slice(0, 1000));
    const late = Math.max(...r.pulsesByFrame.slice(2000, 3000));
    expect(r.maxPulses).toBeLessThanOrEqual(MAX_PULSES);
    expect(r.maxPulses).toBeGreaterThan(MAX_PULSES * 0.8);
    expect(late, `early ${early}, late ${late}`).toBeLessThanOrEqual(early);
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
    // Each press counts by frame k's read (it reaches the bits in under 160 ticks).
    const presses = plan.map(([k, key]) => ({ t: snake.frameTick(k) + facts.readOffset - 200, key }));
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

  it('the keys: a row (◀ ▲ ▼ ▶) on top of the control unit, left of the screen at its top edge; no wire passes over a key', () => {
    const keys = DIRECTIONS.map((d) => cell.get(snake.keys[d])!);
    const { bezel, blocks } = snake;
    // Left to right ◀ ▲ ▼ ▶, one row, the control unit's top row, level with the bezel's top edge.
    expect(['left', 'up', 'down', 'right'].map((d) => cell.get(snake.keys[d as Direction])!.x)).toEqual([...keys.map((k) => k.x)].sort((a, b) => a - b));
    expect(new Set(keys.map((k) => k.y))).toEqual(new Set([blocks.control.box.y0]));
    expect(blocks.control.box.y0).toBe(bezel.y0);
    expect(blocks.control.box.y1).toBeLessThanOrEqual(bezel.y1);
    expect(blocks.control.box.x1).toBeLessThan(bezel.x0);
    // Within reach of the screen: the nearest key is 5 cells from the bezel.
    expect(bezel.x0 - Math.max(...keys.map((k) => k.x))).toBe(5);
    const over = net.connections.flatMap((c) =>
      keys.filter((k) => k.id !== c.from && k.id !== c.to && segmentDistance(cell.get(c.from)!, cell.get(c.to)!, k) < KEY_CLEARANCE).map((k) => `${c.from} -> ${c.to} over ${k.id}`),
    );
    expect(over).toEqual([]);
  });

  it('glue is tidy: few neurons passed over, few block corners clipped (ring line bundles aside)', () => {
    // The ring lines must reach the plane inputs, which sit inside the planes:
    // those 36 wires cross the planes' relay fringe. Every other glue hop:
    const lines = new Set([snake.parts.headX, snake.parts.headY, snake.parts.tailX, snake.parts.tailY].flatMap((r) => r.lines));
    const blockOf = (id: string) => Object.entries(snake.blocks).find(([, b]) => b.ids.includes(id))?.[0];
    const hops = snake.glue.connections.filter(([a]) => !lines.has(a));
    const over = hops.map(([a, z]) => net.neurons.filter((m) => m.id !== a && m.id !== z && segmentDistance(cell.get(a)!, cell.get(z)!, m) < 0.45).length);
    const clips = hops.filter(([a, z]) => Object.entries(snake.blocks).some(([n, b]) => n !== blockOf(a) && n !== blockOf(z) && segmentHitsRect(cell.get(a)!, cell.get(z)!, squares(b.box))));
    // At most 5 neurons under one hop (a wire into a ring's centre crosses its disc).
    expect(Math.max(...over)).toBeLessThanOrEqual(5);
    expect({ hops: hops.length, over: over.reduce((s, v) => s + v, 0), clips: clips.length }).toEqual({ hops: 63, over: 87, clips: 11 });
  });

  it('the probes cover every neuron but the lamps (checked against the model) and the glue relays (which cannot hold charge)', () => {
    const state = { head: { x: 1, y: 1 }, tail: { x: 0, y: 0 }, queued: [0, 1, 2, 3] };
    const probed = new Set(snake.probes(9, state).flatMap((p) => Object.keys(p.allowed)));
    expect(net.neurons.filter((n) => !probed.has(n.id)).map((n) => n.id).sort()).toEqual([...lampIds, ...snake.glue.ids].sort());
    // A threshold-1 Normal neuron with no Inhibitor input fires on every pulse and never holds charge.
    for (const id of snake.glue.ids) {
      expect([cell.get(id)!.kind, cell.get(id)!.threshold]).toEqual(['normal', 1]);
      expect(net.connections.filter((c) => c.to === id).map((c) => cell.get(c.from)!.kind).filter((k) => k === 'negative')).toEqual([]);
    }
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
  it('strobe to lamp, measured on every pixel, is headLampAt - strobe and spans the documented range', { timeout: 60_000 }, () => {
    const lat: number[] = [];
    const visited = new Set<string>();
    for (const seed of [1, 2]) {
      const presses = randomPresses(seed, 600);
      const r = run(snake, 600, presses);
      expect(r.error).toBeUndefined();
      const model = snakeModel(r.dirs, snake.start);
      for (const [k, t] of r.headRise) {
        const { x, y } = model.heads[k]!;
        expect(t - snake.frameTick(k), `pixel (${x}, ${y})`).toBe(snake.headLampAt(x, y));
        lat.push(t - snake.frameTick(k) - snake.schedule.strobe);
      }
      r.visited.forEach((v) => visited.add(v));
    }
    expect(visited.size).toBe(80);
    expect([Math.min(...lat), Math.max(...lat)]).toEqual(snake.latency.strobeToLamp);
    expect(snake.latency).toEqual(LATENCY);
  });

  /**
   * Press to lamp, played in the machine at both extremes: the fastest turn
   * (key and press phase, from the press model) into the pixel the head
   * lamp lights fastest, and the slowest into the slowest. The snake is
   * started where that turn takes the head onto that pixel.
   */
  it('press to lamp: the fastest and slowest turns, played in the machine, take exactly pressToLampMin and pressToLampMax', { timeout: 60_000 }, () => {
    const pixels = Array.from({ length: 80 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) }));
    const at = (p: { x: number; y: number }) => snake.headLampAt(p.x, p.y);
    const fastest = pixels.reduce((a, p) => (at(p) < at(a) ? p : a));
    const slowest = pixels.reduce((a, p) => (at(p) > at(a) ? p : a));
    const turns = turnExtremes(facts, snake.schedule.strobe);
    for (const [turn, pixel, want] of [[turns.min, fastest, snake.latency.pressToLampMin], [turns.max, slowest, snake.latency.pressToLampMax]] as const) {
      const presses = [{ t: 40, key: turn.from }, { t: turn.press, key: turn.to }];
      const dirs = controlModel(turn.frame + 1, presses, facts);
      expect(dirs[turn.frame]).toBe(turn.to);
      // Start so that frame turn.frame takes the head onto the pixel.
      const moved = dirs.reduce((m, d) => ({ x: m.x + STEP[d].dx, y: m.y + STEP[d].dy }), { x: 0, y: 0 });
      const start = { x: (((pixel.x - moved.x) % 10) + 10) % 10, y: (((pixel.y - moved.y) % 8) + 8) % 8 };
      const other = buildSnake({ start });
      const r = run(other, turn.frame + 1, presses);
      expect(r.error).toBeUndefined();
      expect(snakeModel(r.dirs, start).heads[turn.frame]).toEqual(pixel);
      expect(r.headRise.get(turn.frame)! - turn.press).toBe(want);
    }
    expect(turns.min.ticks + at(fastest) - snake.schedule.strobe).toBe(snake.latency.pressToLampMin);
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
    const powers = { headX: headX.power, headY: headY.power, tailX: tailX.power, tailY: tailY.power, queue: queue.power, headSelect: headSelect.power, tailSelect: tailSelect.power };
    const powerFires = new Map<string, number[]>();
    const seen = new Map<string, number[]>();
    const sim = new Simulation(snake.network);
    for (const p of randomPresses(3, 1500)) sim.schedule(p.t, snake.keys[p.key]);
    while (sim.tick < snake.frameTick(1500))
      for (const e of sim.step()) {
        if (Object.values(powers).includes(e.neuron)) powerFires.set(e.neuron, [...(powerFires.get(e.neuron) ?? []), e.tick]);
        const g = groupOf.get(e.neuron);
        // Offset past the group's documented start, mod F: a span may straddle a frame boundary.
        if (g) seen.set(g, [...(seen.get(g) ?? []), (((e.tick - 1 - groups[g]![1]) % F) + F) % F]);
      }
    // Power-on: each block's power input fires once, early enough by exactly powerSlack ticks.
    const firstNeed = {
      headX: [S.head.moveX, headX.powerLead], headY: [S.head.moveY, headY.powerLead], tailX: [L * F + S.tail.moveX, tailX.powerLead], tailY: [L * F + S.tail.moveY, tailY.powerLead],
      queue: [S.queue.shift, queue.powerLead], headSelect: [S.head.rows[0], headSelect.powerLead], tailSelect: [L * F + S.tail.rows[0], tailSelect.powerLead],
    } as const;
    for (const [name, id] of Object.entries(powers)) {
      const fired = powerFires.get(id)!;
      expect(fired, name).toHaveLength(1);
      const [need, lead] = firstNeed[name as keyof typeof firstNeed];
      expect(snake.frameTick(0) + need - lead - fired[0]!, name).toBe(S.powerSlack[name]);
    }
    for (const [g, [, lo, hi]] of Object.entries(groups)) {
      expect(hi - lo, g).toBeLessThan(F);
      const got = seen.get(g)!;
      expect([Math.min(...got), Math.max(...got)], g).toEqual([0, hi - lo]);
    }
  });
});

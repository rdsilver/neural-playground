import { describe, expect, it } from 'vitest';
import { Simulation, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { DIRECTIONS, type Direction } from './snake-control';
import { buildSnake, type Snake } from './snake-machine';
import { controlFacts, controlModel, disambiguate, snakeModel, type KeyPress } from './snake-model';

const snake = buildSnake();
const facts = controlFacts(snake.network, snake.parts.control);

interface RunOptions {
  /** Run this network instead (mutants). */
  net?: Network;
  /** Stop at the first problem (default true). */
  stop?: boolean;
}

interface RunResult {
  error?: string;
  /** Most pulses in flight at once. */
  maxPulses: number;
  dirs: Direction[];
  /** Per frame: tick the head lamp's pulse landed (the lamp's charge rose) minus the strobe tick. */
  strobeToLamp: number[];
}

/**
 * Drive the machine with key presses for `frames` frames and check it against
 * the reference model (press model -> directions -> snake), exactly:
 * - every frame's strobe fires at frameTick(k) + strobe, the model's direction;
 * - exactly one head Q fires per frame (the model's head pixel), and one tail Q
 *   per frame from frame L on (the pixel the tail leaves), inside their
 *   documented windows; no other Q ever fires;
 * - at settledTick(k) every lamp holds the model's multiplicity (0..4);
 * - every probe holds: each block at rest at its own settled moment.
 * Returns the first problem (or all of them, with stop: false).
 */
function run(s: Snake, frames: number, presses: KeyPress[], opts: RunOptions = {}): RunResult {
  // The run ends at frame frames - 1's settled tick, a few frames of strobes later.
  const dirs = controlModel(frames + 5, presses, facts);
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
  const errors: string[] = [];
  const fail = (e: string) => errors.push(e);
  const qSeen = { head: new Map<number, number>(), tail: new Map<number, number>() };
  const strobeToLamp: number[] = [];
  const end = s.settledTick(frames - 1);
  let maxPulses = 0;
  /** Frame k whose window [c_k + lo, c_k + hi] holds tick, or -1. */
  const frameOf = (tick: number, [lo, hi]: [number, number]) => {
    const k = Math.floor((tick - c(0) - lo) / s.F);
    return k >= 0 && tick - c(k) <= hi ? k : -1;
  };
  while (sim.tick < end && (opts.stop === false || !errors.length)) {
    for (const e of sim.step()) {
      const d = strobes.get(e.neuron);
      if (d) {
        const k = (e.tick - c(0) - sch.strobe) / s.F;
        if (!Number.isInteger(k) || dirs[k] !== d) fail(`strobe ${d} at ${e.tick} (frame ${k}: ${dirs[k]})`);
      }
      for (const [side, map, win] of [['head', headQ, sch.head.q], ['tail', tailQ, sch.tail.q]] as const) {
        const px = map.get(e.neuron);
        if (!px) continue;
        const k = frameOf(e.tick, win);
        const want = k < 0 ? undefined : side === 'head' ? model.heads[k] : k >= 4 ? model.heads[k - 4] : undefined;
        if (!want || want.x !== px.x || want.y !== px.y) fail(`${side} Q (${px.x}, ${px.y}) fired at ${e.tick} (frame ${k})`);
        else if (qSeen[side].has(k)) fail(`second ${side} Q in frame ${k}`);
        else qSeen[side].set(k, e.tick);
      }
    }
    maxPulses = Math.max(maxPulses, sim.pulses().length);
    const k = settled.get(sim.tick);
    if (k !== undefined) {
      const want = model.lit(k);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 10; x++) {
          const got = sim.charge(s.lamps[y]![x]!);
          if (got !== want[y]![x]) fail(`lamp (${x}, ${y}) holds ${got}, not ${want[y]![x]}, at frame ${k}'s settled tick ${sim.tick}`);
        }
      if (!qSeen.head.has(k)) fail(`no head Q in frame ${k}`);
      if (k >= 4 && !qSeen.tail.has(k)) fail(`no tail Q in frame ${k}`);
    }
    for (const p of probes.get(sim.tick) ?? [])
      for (const [id, ok] of Object.entries(p.allowed)) {
        const got = sim.charge(id);
        if (!ok.includes(got)) fail(`${p.block}: ${id} holds ${got}, not ${ok.join('/')}, at tick ${sim.tick}`);
      }
  }
  return { error: errors.length ? errors.slice(0, 5).join('\n') : undefined, maxPulses, dirs: dirs.slice(0, frames), strobeToLamp };
}

/** Random presses: bursts of 1-4 keys (some on the same tick), gaps up to 3 frames. */
function randomPresses(seed: number, frames: number): KeyPress[] {
  const rng = mulberry32(seed);
  const presses: KeyPress[] = [];
  let t = 30;
  while (t < frames * snake.F) {
    const burst = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < burst; i++) presses.push({ t: t + (rng() < 0.3 ? 0 : Math.floor(rng() * 40)), key: DIRECTIONS[Math.floor(rng() * 4)]! });
    t += Math.floor(rng() * 3 * snake.F);
  }
  return disambiguate(frames, presses, facts);
}

describe('snake machine', () => {
  it('idle: moves right and wraps, growing to 4 lit pixels in a row, for 100 frames', () => {
    const r = run(snake, 100, []);
    expect(r.error).toBeUndefined();
    expect(r.dirs.every((d) => d === 'right')).toBe(true);
  });

  it('random presses: 100 frames', () => {
    const r = run(snake, 100, randomPresses(1, 100));
    expect(r.error).toBeUndefined();
  });
});

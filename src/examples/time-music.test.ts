import { describe, expect, it } from 'vitest';
import { networkBounds, Simulation, TICKS_PER_SECOND, travelTicks, type FireEvent, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { scheduleDemo } from './demo';
import { findExample } from './index';
import {
  CLOCK_DIGITS,
  POLY_CLOCK_SECONDS,
  ROUND_ENTRY_SECONDS,
  ROUND_SIDE,
  ROUND_VOICES,
  ROW_YOUR_BOAT,
  roundNoteId,
  TIME_MUSIC_EXAMPLES,
  WANDER_SCALE,
  WANDER_START_GAP,
  WANDER_STEP_TICKS,
  wanderNoteId,
  wanderPickId,
} from './time-music';

const clock = findExample('digital-clock')!;
const round = findExample('row-your-boat')!;
const poly = findExample('polyrhythm')!;

/** Smallest distance from a neuron centre to a connection it is not part of. */
function closestPass(network: Network): { distance: number; what: string } {
  const at = new Map(network.neurons.map((n) => [n.id, n]));
  let best = { distance: Infinity, what: '' };
  for (const c of network.connections) {
    const a = at.get(c.from)!, b = at.get(c.to)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    for (const n of network.neurons) {
      if (n.id === c.from || n.id === c.to) continue;
      const t = Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / len2));
      const d = Math.hypot(a.x + t * dx - n.x, a.y + t * dy - n.y);
      if (d < best.distance) best = { distance: d, what: `${c.from} -> ${c.to} passes ${n.id}` };
    }
  }
  return best;
}

/** Copy of a network with some neurons' fields changed. */
function patched(network: Network, changes: Record<string, object>, extra: Network['connections'] = []): Network {
  return {
    ...network,
    neurons: network.neurons.map((n) => (changes[n.id] ? { ...n, ...changes[n.id] } : n)),
    connections: [...network.connections, ...extra],
  };
}

const notesOf = (events: FireEvent[]) => events.filter((e) => e.kind === 'note').map((e) => ({ tick: e.tick, note: e.note! }));
const byTickThenNote = (a: { tick: number; note: number }, b: { tick: number; note: number }) => a.tick - b.tick || a.note - b.note;

describe('time and music examples', () => {
  it('are compact, and no connection passes through or close to another neuron', () => {
    for (const example of TIME_MUSIC_EXAMPLES) {
      const b = networkBounds(example.network);
      expect(b.maxX - b.minX, example.id).toBeLessThanOrEqual(45);
      expect(b.maxY - b.minY, example.id).toBeLessThanOrEqual(28);
      const pass = closestPass(example.network);
      expect(pass.distance, `${example.id}: ${pass.what}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('have 2-4 things to try and fit the gallery categories', () => {
    for (const example of TIME_MUSIC_EXAMPLES) {
      expect(example.tryThis!.length, example.id).toBeGreaterThanOrEqual(2);
      expect(example.tryThis!.length, example.id).toBeLessThanOrEqual(4);
      for (const label of example.network.neurons.map((n) => n.label ?? '')) expect(label.length).toBeLessThanOrEqual(12);
    }
    expect(Object.fromEntries(TIME_MUSIC_EXAMPLES.map((e) => [e.id, e.category]))).toEqual({
      'digital-clock': 'Counting',
      'row-your-boat': 'Music',
      polyrhythm: 'Music',
      'wandering-melody': 'Music',
    });
  });
});

// ---- Digital clock ---------------------------------------------------------

/** Place value in seconds of each neuron a user might click. */
const CLICK_SECONDS: Record<string, number> = Object.fromEntries([
  ...CLOCK_DIGITS.map((d) => [d.id, d.seconds] as const),
  ['colon', 60],
]);

function reading(sim: Simulation): string {
  const [mt, mo, st, so] = CLOCK_DIGITS.map(({ id, base }) => {
    const v = sim.charge(id);
    expect(v, id).toBeGreaterThanOrEqual(0);
    expect(v, id).toBeLessThan(base);
    return v;
  });
  return `${mt}${mo}:${st}${so}`;
}

const mmss = (seconds: number) => {
  const s = ((seconds % 3600) + 3600) % 3600;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Run to a tick and return the readings shown at each change, as [tick, reading]. */
function readingsBetween(sim: Simulation, from: number, to: number): Array<[number, string]> {
  sim.run(from - sim.tick);
  const out: Array<[number, string]> = [[sim.tick, reading(sim)]];
  while (sim.tick < to) {
    sim.step();
    const r = reading(sim);
    if (r !== out[out.length - 1]![1]) out.push([sim.tick, r]);
  }
  return out;
}

describe('digital clock', () => {
  it('pulses take one second to reach the seconds digit, and every carry hop is one cell', () => {
    const at = new Map(clock.network.neurons.map((n) => [n.id, n]));
    expect(travelTicks(at.get('clock')!, at.get('sec-ones')!)).toBe(60);
    for (const c of clock.network.connections.filter((c) => c.from !== 'clock')) {
      expect(travelTicks(at.get(c.from)!, at.get(c.to)!), `${c.from} -> ${c.to}`).toBe(15);
    }
  });

  it('reads the elapsed time for two hours, settled before each next second', () => {
    const sim = new Simulation(clock.network);
    expect(reading(sim)).toBe('00:00');
    for (let n = 1; n <= 7300; n++) {
      // Second n arrives at tick 60n + 1. Its ripple needs at most 45 ticks,
      // except at x9:59 -> x0:00 where it needs 60 and lands with second n+1.
      sim.run(60 * n + 60 - sim.tick);
      if (n % 600 !== 0) {
        expect(reading(sim), `second ${n}`).toBe(mmss(n));
      } else {
        sim.step();
        expect(reading(sim), `second ${n + 1}`).toBe(mmss(n + 1));
      }
    }
  });

  it('ripples 00:59 -> 00:50 -> 00:00 -> 01:00 right to left within the second', () => {
    const sim = new Simulation(clock.network);
    expect(readingsBetween(sim, 3599, 3662)).toEqual([
      [3599, '00:59'],
      [3601, '00:50'],
      [3616, '00:00'],
      [3646, '01:00'],
      [3661, '01:01'],
    ]);
  });

  it('takes the whole second to ripple at 09:59 and 59:59, then shows the next second', () => {
    const sim = new Simulation(clock.network);
    expect(readingsBetween(sim, 35_999, 36_062)).toEqual([
      [35_999, '09:59'],
      [36_001, '09:50'],
      [36_016, '09:00'],
      [36_046, '00:00'],
      [36_061, '10:01'],
    ]);
    expect(readingsBetween(sim, 215_999, 216_062)).toEqual([
      [215_999, '59:59'],
      [216_001, '59:50'],
      [216_016, '59:00'],
      [216_046, '50:00'],
      [216_061, '00:01'],
    ]);
  });

  it('never shows an impossible digit (0:60 and the like) over a full hour', () => {
    const sim = new Simulation(clock.network);
    for (let t = 0; t < 3610 * 60; t++) {
      sim.step();
      for (const { id, base } of CLOCK_DIGITS) {
        const v = sim.charge(id);
        if (v < 0 || v >= base) throw new Error(`${id} = ${v} at tick ${sim.tick}`);
      }
    }
  });

  it('can be set by clicking: each click is worth its place, and carries', () => {
    const sim = new Simulation(clock.network);
    sim.run(100);
    for (let i = 0; i < 5; i++) sim.stimulate('min-tens');
    for (let i = 0; i < 9; i++) sim.stimulate('min-ones');
    for (let i = 0; i < 5; i++) sim.stimulate('sec-tens');
    sim.run(60 * 9 + 55 - sim.tick); // second 9 has landed
    expect(reading(sim)).toBe('59:59');
    sim.run(60 * 10 + 60 - sim.tick); // second 10 is still rippling...
    expect(reading(sim)).toBe('50:00');
    sim.step(); // ...and lands with second 11
    expect(reading(sim)).toBe('00:01');
    sim.stimulate('colon');
    sim.run(15);
    expect(reading(sim)).toBe('01:01');
  });

  it('keeps exact time under random, overlapping, same-tick and hammered clicks', () => {
    const ids = Object.keys(CLICK_SECONDS);
    for (let seed = 1; seed <= 25; seed++) {
      const rng = mulberry32(seed);
      const sim = new Simulation(clock.network);
      let added = 0;
      const clickTicks = 600 + Math.floor(rng() * 4000);
      while (sim.tick < clickTicks) {
        const r = rng();
        if (r < 0.15) {
          // A burst: the same neuron on consecutive ticks, or all at once.
          const id = ids[Math.floor(rng() * ids.length)]!;
          const count = 1 + Math.floor(rng() * 12);
          const sameTick = rng() < 0.5;
          for (let i = 0; i < count; i++) {
            sim.stimulate(id);
            added += CLICK_SECONDS[id]!;
            if (!sameTick) sim.step();
          }
        } else if (r < 0.3) {
          const id = ids[Math.floor(rng() * ids.length)]!;
          sim.stimulate(id);
          added += CLICK_SECONDS[id]!;
        }
        sim.step();
      }
      // Find a moment after every ripple has landed: at least 61 ticks after
      // the last click, and at the end of a second whose ripple is short.
      let n = Math.ceil((sim.tick + 61) / 60);
      while ((n + added) % 600 === 0) n++;
      sim.run(60 * n + 60 - sim.tick);
      expect(reading(sim), `seed ${seed}`).toBe(mmss(n + added));
    }
  });

  it('chimes exactly on the minute with a Note neuron on the tens of seconds (a tip)', () => {
    const net = clock.network;
    const chimed: Network = {
      ...net,
      neurons: [...net.neurons, { id: 'chime', kind: 'note', x: 3, y: 6, threshold: 1, note: 84 }],
      connections: [...net.connections, { from: 'sec-tens', to: 'chime' }],
    };
    const sim = new Simulation(chimed);
    const chimes = sim.runSeconds(10 * 60 + 30).filter((e) => e.neuron === 'chime').map((e) => e.tick);
    // Minute m arrives at tick 3600m + 1, its carry reaches the tens 15 ticks
    // later and the chime 45 ticks after that.
    expect(chimes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => 3600 * m + 1 + 15 + 45));
  });

  it('demo: five clicks set 00:50, and the minute turns over at ten seconds', () => {
    const sim = new Simulation(clock.network);
    scheduleDemo(sim, clock.demo!);
    // The caption promises 00:50, so the display must really show it.
    expect(readingsBetween(sim, 0, 130)).toEqual([
      [0, '00:00'],
      [12, '00:10'],
      [21, '00:20'],
      [30, '00:30'],
      [39, '00:40'],
      [48, '00:50'],
      [61, '00:51'],
      [121, '00:52'],
    ]);
    sim.run(5 * 60 + 50 - sim.tick);
    expect(reading(sim)).toBe('00:55');
    expect(readingsBetween(sim, 599, 662)).toEqual([
      [599, '00:59'],
      [601, '00:50'],
      [616, '00:00'],
      [646, '01:00'],
      [661, '01:01'],
    ]);
    // The second caption appears shortly before that ripple.
    const ripple = clock.demo!.find((s) => s.caption?.includes('ripple'))!;
    expect(ripple.at * TICKS_PER_SECOND).toBeGreaterThan(450);
    expect(ripple.at * TICKS_PER_SECOND).toBeLessThan(601);
  });

  it('demo: replays identically after a reset, and more clicks afterwards still add up', () => {
    const sim = new Simulation(clock.network);
    scheduleDemo(sim, clock.demo!);
    const first = readingsBetween(sim, 0, 800);
    sim.reset();
    scheduleDemo(sim, clock.demo!);
    expect(readingsBetween(sim, 0, 800)).toEqual(first);
    // Hammer the colon and the minutes in the middle of the next minute ripple
    // (second 70 lands at tick 4201 and reads 02:00 = 01:59 + 1).
    sim.run(4205 - sim.tick);
    for (let i = 0; i < 3; i++) sim.stimulate('colon');
    sim.step();
    for (let i = 0; i < 7; i++) sim.stimulate('min-ones');
    sim.stimulate('min-tens');
    sim.run(60 * 72 + 59 - sim.tick); // second 72 has landed and settled
    expect(reading(sim)).toBe(mmss(72 + 50 + 3 * 60 + 7 * 60 + 600));
  });

  it('settles on the exact time whenever no carry is in flight, under random clicks', () => {
    const ids = Object.keys(CLICK_SECONDS);
    for (let seed = 1; seed <= 6; seed++) {
      const rng = mulberry32(100 + seed);
      const sim = new Simulation(clock.network);
      let added = 0;
      let checked = 0;
      for (let t = 0; t < 20_000; t++) {
        if (rng() < 0.08) {
          const id = ids[Math.floor(rng() * ids.length)]!;
          const count = 1 + Math.floor(rng() * 4);
          for (let i = 0; i < count; i++) sim.stimulate(id);
          added += count * CLICK_SECONDS[id]!;
        }
        sim.step();
        // Only the timer's own pulse is travelling: every carry has landed.
        if (sim.pulses().every((p) => p.from === 'clock')) {
          const landed = sim.state('clock')!.fireCount - sim.pulses().length;
          expect(reading(sim), `seed ${seed}, tick ${sim.tick}`).toBe(mmss(landed + added));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(5_000);
    }
  });

  it('a click at any tick of a 10-minute rollover, on any digit or the colon, adds exactly its place value', () => {
    // 09:58 by clicks at tick 0; second 2 (tick 121) starts the slowest
    // ripple there is, 09:59 -> 10:00, which lands on tick 181.
    for (const [id, worth] of Object.entries(CLICK_SECONDS)) {
      for (let at = 100; at <= 200; at++) {
        const sim = new Simulation(clock.network);
        for (let i = 0; i < 9; i++) sim.stimulate('min-ones');
        for (let i = 0; i < 5; i++) sim.stimulate('sec-tens');
        for (let i = 0; i < 8; i++) sim.stimulate('sec-ones');
        sim.run(at - sim.tick);
        sim.stimulate(id);
        sim.stimulate(id); // and a double click on the same tick
        sim.run(60 * 6 + 59 - sim.tick);
        expect(reading(sim), `${id} at tick ${at}`).toBe(mmss(598 + 6 + 2 * worth));
      }
    }
  });
});

// ---- Row, row, row your boat ----------------------------------------------

const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, C5 = 72;

/** Onset (in eighth notes) of each note of the melody. */
function onsets(): number[] {
  const out: number[] = [];
  let t = 0;
  for (const [, length] of ROW_YOUR_BOAT) {
    out.push(t);
    t += length;
  }
  return out;
}

/** The note events one voice makes when its first note fires at `start`. */
function voice(start: number): Array<{ tick: number; note: number }> {
  return onsets().map((onset, i) => ({ tick: start + onset * 15, note: ROW_YOUR_BOAT[i]![0] }));
}

/** Tick of the first note of voice 1: the timer fires at tick 1. */
const FIRST_NOTE_TICK = 1 + 43;

describe('row, row, row your boat', () => {
  it('is the right tune and rhythm: 27 notes, 8 bars of 6/8, every bar starting on a note', () => {
    expect(ROW_YOUR_BOAT.map(([n]) => n)).toEqual([
      C4, C4, C4, D4, E4,
      E4, D4, E4, F4, G4,
      C5, C5, C5, G4, G4, G4, E4, E4, E4, C4, C4, C4,
      G4, F4, E4, D4, C4,
    ]);
    expect(ROW_YOUR_BOAT.map(([, len]) => len)).toEqual([
      3, 3, 2, 1, 3,
      2, 1, 2, 1, 6,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      2, 1, 2, 1, 6,
    ]);
    const starts = onsets();
    for (let bar = 0; bar < 8; bar++) expect(starts, `bar ${bar + 1}`).toContain(bar * 6);
    expect(starts.at(-1)! + ROW_YOUR_BOAT.at(-1)![1]).toBe(48);
  });

  it('lays each 2-bar line along one side of the square, starting on a corner', () => {
    const at = new Map(round.network.neurons.map((n) => [n.id, n]));
    const corners = [[0, 0], [ROUND_SIDE, 0], [ROUND_SIDE, ROUND_SIDE], [0, ROUND_SIDE]];
    onsets().forEach((onset, i) => {
      const n = at.get(roundNoteId(i))!;
      if (onset % 12 === 0) expect([n.x, n.y]).toEqual(corners[onset / 12]);
      const side = Math.floor(onset / 12);
      if (side === 0) expect(n.y).toBe(0);
      if (side === 1) expect(n.x).toBe(ROUND_SIDE);
      if (side === 2) expect(n.y).toBe(ROUND_SIDE);
      if (side === 3) expect(n.x).toBe(0);
    });
    // Each gap is exactly the note's length: 15 ticks per eighth note.
    for (let i = 0; i + 1 < ROW_YOUR_BOAT.length; i++) {
      expect(travelTicks(at.get(roundNoteId(i))!, at.get(roundNoteId(i + 1))!), `note ${i + 1}`).toBe(ROW_YOUR_BOAT[i]![1] * 15);
    }
    expect(travelTicks(at.get('voices')!, at.get(roundNoteId(0))!)).toBe(FIRST_NOTE_TICK - 1);
  });

  it('plays the tune once with exact timing when the timer fires once', () => {
    const sim = new Simulation(patched(round.network, { voices: { times: 1 } }));
    const events = notesOf(sim.run(60 * 20));
    expect(events).toEqual(voice(FIRST_NOTE_TICK));
    expect(events.at(-1)!.tick).toBe(FIRST_NOTE_TICK + 42 * 15);
  });

  it('plays a four-voice round: the same tune, entering every two bars', () => {
    const sim = new Simulation(round.network);
    const events = notesOf(sim.run(60 * 40)).sort(byTickThenNote);
    const expected = [0, 1, 2, 3].flatMap((v) => voice(FIRST_NOTE_TICK + v * ROUND_ENTRY_SECONDS * TICKS_PER_SECOND)).sort(byTickThenNote);
    expect(ROUND_VOICES).toBe(4);
    expect(events).toEqual(expected);
    expect(events.length).toBe(4 * 27);
    expect(sim.isIdle()).toBe(true);
  });

  it('keeps the round going with more voices when the timer fires more times (a tip)', () => {
    const sim = new Simulation(patched(round.network, { voices: { times: 8 } }));
    const events = notesOf(sim.run(60 * 50)).sort(byTickThenNote);
    const expected = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((v) => voice(FIRST_NOTE_TICK + v * 180)).sort(byTickThenNote);
    expect(events).toEqual(expected);
  });

  it('has one voice on each side of the square while all four sing', () => {
    const sim = new Simulation(round.network);
    const at = new Map(round.network.neurons.map((n) => [n.id, n]));
    const sideOf = (id: string) => {
      const n = at.get(id)!;
      if (n.kind === 'timer') return -1;
      const i = Number(id.slice('note-'.length)) - 1;
      return Math.floor(onsets()[i]! / 12);
    };
    const v4 = FIRST_NOTE_TICK + 3 * 180;
    const v1End = FIRST_NOTE_TICK + 42 * 15;
    sim.run(v4 - 1);
    for (let t = v4; t < v1End; t++) {
      sim.step();
      const sides = sim.pulses().map((p) => sideOf(p.from)).sort();
      expect(sides, `tick ${t}`).toEqual([0, 1, 2, 3]);
    }
    sim.step();
    expect(sim.pulses().length).toBe(3);
  });

  it('adds a whole extra voice for every click on the first note, however close together', () => {
    const clicks = [100, 101, 102, 102, 102, 450, 451, 1000];
    const sim = new Simulation(round.network);
    const events: FireEvent[] = [];
    for (let t = 1; t <= 60 * 40; t++) {
      for (const c of clicks) if (c === t) events.push(...sim.stimulate(roundNoteId(0)));
      events.push(...sim.step());
    }
    const expected = [
      ...[0, 1, 2, 3].flatMap((v) => voice(FIRST_NOTE_TICK + v * 180)),
      ...clicks.flatMap((c) => voice(c - 1)),
    ].sort(byTickThenNote);
    // stimulate() before step() acts on the tick that is about to end, so a
    // click made "at tick t" fires on the current tick t - 1.
    expect(notesOf(events).sort(byTickThenNote)).toEqual(expected);
  });

  it('becomes an endless round when the last note is wired back to the first', () => {
    const loop = patched(round.network, {}, [{ from: roundNoteId(26), to: roundNoteId(0) }]);
    const at = new Map(loop.neurons.map((n) => [n.id, n]));
    expect(travelTicks(at.get(roundNoteId(26))!, at.get(roundNoteId(0))!)).toBe(6 * 15);
    const sim = new Simulation(loop);
    sim.runSeconds(60);
    const lap = 48 * 15;
    const a = notesOf(sim.run(lap));
    const b = notesOf(sim.run(lap));
    expect(a.length).toBe(4 * 27);
    expect(b).toEqual(a.map((e) => ({ ...e, tick: e.tick + lap })));
    expect(sim.pulses().length).toBe(4);
  });

  it('demo only shows captions: the music is the same with or without it', () => {
    const plain = new Simulation(round.network);
    const withDemo = new Simulation(round.network);
    scheduleDemo(withDemo, round.demo!);
    expect(round.demo!.every((s) => s.neuron === undefined && s.caption)).toBe(true);
    expect(withDemo.run(60 * 25)).toEqual(plain.run(60 * 25));
  });

  it('demo captions match the music: each voice enters as its caption appears', () => {
    const sim = new Simulation(round.network);
    const firsts = fires(sim.run(60 * 25), roundNoteId(0));
    expect(firsts).toEqual([0, 1, 2, 3].map((v) => FIRST_NOTE_TICK + v * 180));
    const [v1, v2, v3, v4, done] = round.demo!.map((s) => Math.round(s.at * TICKS_PER_SECOND));
    // Each "voice n" caption shows up when the timer sends that voice off,
    // before its first note.
    [v1, v2, v3, v4].forEach((t, v) => {
      expect(t!).toBeLessThanOrEqual(firsts[v]!);
      expect(t!).toBeGreaterThan(firsts[v]! - 60);
    });
    // "Voice 1 has finished" comes after its last note, while voice 2 still sings.
    const v1End = FIRST_NOTE_TICK + 42 * 15;
    expect(done!).toBeGreaterThan(v1End);
    expect(done!).toBeLessThan(v1End + 60);
  });

  it('replays identically after a reset, with clicks during the demo', () => {
    const play = (sim: Simulation) => {
      scheduleDemo(sim, round.demo!);
      const events: FireEvent[] = [];
      for (let t = 0; t < 60 * 30; t++) {
        if (t === 200 || t === 201 || t === 590) events.push(...sim.stimulate(roundNoteId(0)));
        if (t === 300) events.push(...sim.stimulate(roundNoteId(10))); // a voice from the middle of the tune
        events.push(...sim.step());
      }
      return notesOf(events);
    };
    const sim = new Simulation(round.network);
    const first = play(sim);
    sim.reset();
    expect(play(sim)).toEqual(first);
    expect(first.length).toBe(4 * 27 + 3 * 27 + 17);
    expect(sim.isIdle()).toBe(true);
  });
});

// ---- Polyrhythm --------------------------------------------------------------

const CLOCK_TICKS = Math.round(POLY_CLOCK_SECONDS * TICKS_PER_SECOND);
/** Ticks from a clock fire to the note it triggers: clock -> divider -> note. */
const POLY_DELAY = 55 + 45;
/** Tick at which the clock's k-th pulse (k = 1, 2, ...) leads to a note. */
const beatTick = (k: number) => 1 + (k - 1) * CLOCK_TICKS + POLY_DELAY;

function fires(events: FireEvent[], id: string): number[] {
  return events.filter((e) => e.neuron === id).map((e) => e.tick);
}

describe('polyrhythm', () => {
  it('has equal paths from the clock to both notes', () => {
    const at = new Map(poly.network.neurons.map((n) => [n.id, n]));
    const path = (ids: string[]) => ids.slice(1).reduce((sum, id, i) => sum + travelTicks(at.get(ids[i]!)!, at.get(id)!), 0);
    expect(path(['clock', 'div3', 'high'])).toBe(POLY_DELAY);
    expect(path(['clock', 'div4', 'low'])).toBe(POLY_DELAY);
    expect(CLOCK_TICKS).toBe(12);
  });

  it('plays high notes on every 3rd clock tick and low notes on every 4th, exactly', () => {
    const sim = new Simulation(poly.network);
    const events = sim.runSeconds(120);
    const last = Math.floor((sim.tick - 1 - POLY_DELAY) / CLOCK_TICKS) + 1;
    const ks = Array.from({ length: last }, (_, i) => i + 1);
    expect(fires(events, 'high')).toEqual(ks.filter((k) => k % 3 === 0).map(beatTick));
    expect(fires(events, 'low')).toEqual(ks.filter((k) => k % 4 === 0).map(beatTick));
    expect(events.filter((e) => e.neuron === 'high').every((e) => e.note === 67)).toBe(true);
    expect(events.filter((e) => e.neuron === 'low').every((e) => e.note === 48)).toBe(true);
  });

  it('plays 4 against 3 in every bar, meeting on the same tick once a bar', () => {
    const sim = new Simulation(poly.network);
    const events = sim.runSeconds(60);
    const bar = 12 * CLOCK_TICKS;
    for (let start = beatTick(12); start + bar <= sim.tick - 1; start += bar) {
      const inBar = (t: number) => t >= start && t < start + bar;
      const high = fires(events, 'high').filter(inBar).map((t) => t - start);
      const low = fires(events, 'low').filter(inBar).map((t) => t - start);
      expect(high).toEqual([0, 36, 72, 108]);
      expect(low).toEqual([0, 48, 96]);
    }
  });

  it('beat counters show the beat of the bar and return to 0 together on the downbeat', () => {
    // The dividers show how far into the current beat the clock is...
    const dividers = new Simulation(poly.network);
    for (let k = 1; k <= 120; k++) {
      dividers.run(beatTick(k) - 45 - dividers.tick); // pulse k has just arrived
      expect(dividers.charge('div3'), `pulse ${k}`).toBe(k % 3);
      expect(dividers.charge('div4'), `pulse ${k}`).toBe(k % 4);
    }
    // ...and the counters which beat of the bar each voice has reached. A
    // counter is one cell after its note, so it shows a beat from 15 ticks
    // after the note sounds until 15 ticks after the next clock pulse's
    // turn: it never lags behind the music by a whole beat.
    const sim = new Simulation(poly.network);
    const counterDelay = 15;
    sim.run(beatTick(1) + counterDelay - 1);
    for (let k = 1; k <= 120; k++) {
      for (let t = beatTick(k) + counterDelay; t < beatTick(k + 1) + counterDelay; t++) {
        sim.step();
        expect(sim.tick).toBe(t);
        expect(sim.charge('beat-of-4'), `pulse ${k}, tick ${t}`).toBe(Math.floor(k / 3) % 4);
        expect(sim.charge('beat-of-3'), `pulse ${k}, tick ${t}`).toBe(Math.floor(k / 4) % 3);
      }
    }
    const at = new Map(poly.network.neurons.map((n) => [n.id, n]));
    expect(travelTicks(at.get('high')!, at.get('beat-of-4')!)).toBe(counterDelay);
    expect(travelTicks(at.get('low')!, at.get('beat-of-3')!)).toBe(counterDelay);
  });

  it('after clicks on the dividers it is still 4 against 3, still meeting once a bar', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      const sim = new Simulation(poly.network);
      while (sim.tick < 600) {
        if (rng() < 0.05) {
          const id = rng() < 0.5 ? 'div3' : 'div4';
          const count = 1 + Math.floor(rng() * 5);
          for (let i = 0; i < count; i++) sim.stimulate(id);
        }
        sim.step();
      }
      sim.run(200); // let the last clicked beats land
      const events = sim.run(12 * CLOCK_TICKS * 5);
      const high = fires(events, 'high');
      const low = fires(events, 'low');
      expect(high.length, `seed ${seed}`).toBe(20);
      expect(low.length, `seed ${seed}`).toBe(15);
      for (let i = 1; i < high.length; i++) expect(high[i]! - high[i - 1]!).toBe(36);
      for (let i = 1; i < low.length; i++) expect(low[i]! - low[i - 1]!).toBe(48);
      const together = high.filter((t) => low.includes(t));
      expect(together.length, `seed ${seed}`).toBe(5);
    }
  });

  it('clicks on the notes, the counters or the clock never move the rhythm, and a reset replays it exactly', () => {
    const plain = new Simulation(poly.network);
    const expected = plain.run(60 * 60).filter((e) => e.kind === 'note');
    const sim = new Simulation(poly.network);
    const rng = mulberry32(7);
    const ids = ['high', 'low', 'beat-of-4', 'beat-of-3', 'clock'];
    const fromSteps: FireEvent[] = [];
    let clicks = 0;
    for (let t = 0; t < 60 * 60; t++) {
      if (rng() < 0.05) {
        const id = ids[Math.floor(rng() * ids.length)]!;
        for (let i = 1 + Math.floor(rng() * 3); i > 0; i--) {
          const fired = sim.stimulate(id);
          // A click on a note plays it at once; nothing else fires a note.
          expect(fired.filter((e) => e.kind === 'note').length).toBe(id === 'high' || id === 'low' ? 1 : 0);
          clicks++;
        }
      }
      fromSteps.push(...sim.step());
    }
    expect(clicks).toBeGreaterThan(100);
    expect(fromSteps.filter((e) => e.kind === 'note')).toEqual(expected);
    sim.reset();
    expect(sim.run(60 * 60).filter((e) => e.kind === 'note')).toEqual(expected);
  });

  it('becomes 5 against 4 with the thresholds from the tips', () => {
    const net = patched(poly.network, { div3: { threshold: 5 }, 'beat-of-3': { threshold: 5 } });
    const sim = new Simulation(net);
    const events = sim.runSeconds(60);
    const cycle = 20 * CLOCK_TICKS;
    const start = beatTick(20);
    const inCycle = (t: number) => t >= start && t < start + cycle;
    expect(fires(events, 'high').filter(inCycle).map((t) => t - start)).toEqual([0, 60, 120, 180]);
    expect(fires(events, 'low').filter(inCycle).map((t) => t - start)).toEqual([0, 48, 96, 144, 192]);
  });
});

// ---- Wandering melody --------------------------------------------------------

const wander = findExample('wandering-melody')!;
const SCALE_INDEX = new Map<number, number>(WANDER_SCALE.map((midi, i) => [midi, i]));
/** The middle note, where the timer starts both walkers: its pulse takes 60 ticks. */
const WANDER_FIRST = 1 + 60;

describe('wandering melody', () => {
  it('takes the same time for every step: note -> Random neuron -> neighbouring note', () => {
    const at = new Map(wander.network.neurons.map((n) => [n.id, n]));
    WANDER_SCALE.forEach((_, i) => {
      const pick = at.get(wanderPickId(i))!;
      expect(travelTicks(at.get(wanderNoteId(i))!, pick)).toBe(30);
      const targets = wander.network.connections.filter((c) => c.from === pick.id).map((c) => c.to).sort();
      const expected = [i - 1, i + 1].filter((j) => j >= 0 && j < WANDER_SCALE.length);
      expect(targets).toEqual(expected.map(wanderNoteId).sort());
      for (const t of targets) expect(travelTicks(pick, at.get(t)!)).toBe(WANDER_STEP_TICKS - 30);
    });
    expect(travelTicks(at.get('start')!, at.get(wanderNoteId(5))!)).toBe(WANDER_FIRST - 1);
  });

  it('a single walker only ever steps to a neighbouring note, on a steady beat, and visits them all', () => {
    const sim = new Simulation(patched(wander.network, { start: { times: 1 } }));
    const events = notesOf(sim.run(WANDER_FIRST + 3000 * WANDER_STEP_TICKS));
    expect(events.length).toBe(3001);
    expect(events[0]).toEqual({ tick: WANDER_FIRST, note: 72 });
    const steps = new Map<number, number>();
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.tick - events[i - 1]!.tick).toBe(WANDER_STEP_TICKS);
      const from = SCALE_INDEX.get(events[i - 1]!.note)!, to = SCALE_INDEX.get(events[i]!.note)!;
      const step = to - from;
      expect(Math.abs(step)).toBe(1);
      steps.set(step, (steps.get(step) ?? 0) + 1);
    }
    expect(new Set(events.map((e) => e.note)).size).toBe(WANDER_SCALE.length);
    // Up and down are equally likely: neither should be rare over 3000 steps.
    expect(steps.get(1)!).toBeGreaterThan(1200);
    expect(steps.get(-1)!).toBeGreaterThan(1200);
  });

  it('keeps exactly two walkers forever, each on its own steady beat, playing only scale notes', () => {
    const sim = new Simulation(wander.network);
    sim.run(WANDER_FIRST + 40);
    const events: FireEvent[] = [];
    for (let t = 0; t < 60 * 600; t++) {
      events.push(...sim.step());
      expect(sim.pulses().length).toBe(2);
    }
    const notes = notesOf(events);
    expect(notes.every((e) => SCALE_INDEX.has(e.note))).toBe(true);
    const phases = new Set(notes.map((e) => (e.tick - WANDER_FIRST) % WANDER_STEP_TICKS));
    expect([...phases].sort((a, b) => a - b)).toEqual([0, WANDER_START_GAP * 60]);
  });

  it('adds exactly one walker per click on a note or a Random neuron, however the clicks overlap', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed);
      const ids = wander.network.neurons.filter((n) => n.kind !== 'timer').map((n) => n.id);
      const sim = new Simulation(wander.network, { seed });
      sim.run(200);
      let walkers = 2;
      for (let t = 0; t < 3000; t++) {
        if (rng() < 0.02) {
          const id = ids[Math.floor(rng() * ids.length)]!;
          const count = 1 + Math.floor(rng() * 4);
          for (let i = 0; i < count; i++) sim.stimulate(id);
          walkers += count;
        }
        sim.step();
        expect(sim.pulses().length, `seed ${seed}, tick ${sim.tick}`).toBe(walkers);
      }
      sim.runSeconds(120);
      expect(sim.pulses().length).toBe(walkers);
    }
  });

  it('with any seed, both default walkers step to a neighbour every 73 ticks, and a reset replays the same tune', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Simulation(wander.network, { seed });
      const notes = notesOf(sim.runSeconds(300));
      const walkers = [0, WANDER_START_GAP * 60].map((phase) => notes.filter((e) => (e.tick - WANDER_FIRST) % WANDER_STEP_TICKS === phase));
      expect(walkers[0]!.length + walkers[1]!.length, `seed ${seed}`).toBe(notes.length);
      for (const walk of walkers) {
        expect(walk.length, `seed ${seed}`).toBeGreaterThan(240);
        expect(walk[0]!.note).toBe(72);
        for (let i = 1; i < walk.length; i++) {
          expect(walk[i]!.tick - walk[i - 1]!.tick).toBe(WANDER_STEP_TICKS);
          expect(Math.abs(SCALE_INDEX.get(walk[i]!.note)! - SCALE_INDEX.get(walk[i - 1]!.note)!), `seed ${seed}`).toBe(1);
        }
      }
      sim.reset();
      expect(notesOf(sim.runSeconds(300)), `seed ${seed}`).toEqual(notes);
    }
  });

  it('becomes a one-way valve when a Random neuron loses its downward connection (a tip)', () => {
    const valve = 8;
    const net = patched(wander.network, { start: { times: 1 } });
    net.connections = net.connections.filter((c) => !(c.from === wanderPickId(valve) && c.to === wanderNoteId(valve - 1)));
    const sim = new Simulation(net);
    const played = notesOf(sim.runSeconds(60 * 30)).map((e) => SCALE_INDEX.get(e.note)!);
    const reached = played.indexOf(valve);
    expect(reached).toBeGreaterThan(0);
    expect(Math.min(...played.slice(reached))).toBe(valve);
    expect(Math.min(...played.slice(0, reached))).toBeLessThan(valve);
  });
});

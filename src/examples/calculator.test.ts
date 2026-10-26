import { describe, expect, it } from 'vitest';
import { networkBounds, Simulation, TICKS_PER_SECOND, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { ADDING_MACHINE_PLACES, addKey, subtractKey, type Place } from './calculator';
import { demoCaptionAt, scheduleDemo } from './demo';
import { findExample } from './index';
import type { Example } from './types';

const machine = findExample('adding-machine')!;
const dial = findExample('pulse-dial')!;

const MOD = 10_000;
const VALUE: Record<Place, number> = { thousands: 1000, hundreds: 100, tens: 10, ones: 1 };
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const mod = (n: number, m = MOD) => ((n % m) + m) % m;

/** The number the adding machine's display shows. */
function display(sim: Simulation): number {
  return ADDING_MACHINE_PLACES.reduce((total, place) => {
    const digit = sim.charge(place);
    expect(digit).toBeGreaterThanOrEqual(0);
    expect(digit).toBeLessThan(10);
    return total * 10 + digit;
  }, 0);
}

/** Type a number on the + keys (one press per non-zero digit) and let it land. */
function enter(sim: Simulation, value: number): void {
  ADDING_MACHINE_PLACES.forEach((place, i) => {
    const digit = Math.floor(value / 10 ** (3 - i)) % 10;
    if (digit) sim.stimulate(addKey(place, digit));
  });
  sim.runUntilIdle();
}

/** Every key of the machine with the amount it adds (mod 10000). */
const KEYS: Array<{ id: string; amount: number }> = ADDING_MACHINE_PLACES.flatMap((place) =>
  DIGITS.flatMap((k) => [
    { id: addKey(place, k), amount: k * VALUE[place] },
    { id: subtractKey(place, k), amount: -k * VALUE[place] },
  ]),
);

function countFires(sim: Simulation, ticks: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of sim.run(ticks)) counts.set(e.neuron, (counts.get(e.neuron) ?? 0) + 1);
  return counts;
}

/** Demo checkpoints: the tick each captioned step starts, with its caption. */
function captionedSteps(example: Example): Array<{ tick: number; caption: string }> {
  return example.demo!.filter((s) => s.caption).map((s) => ({ tick: Math.round(s.at * TICKS_PER_SECOND), caption: s.caption! }));
}

/** Smallest distance from a neuron centre to a connection it is not part of. */
function closestPass(network: Network): { distance: number; what: string } {
  const at = new Map(network.neurons.map((n) => [n.id, n]));
  let best = { distance: Infinity, what: '' };
  for (const c of network.connections) {
    const a = at.get(c.from)!, b = at.get(c.to)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const n of network.neurons) {
      if (n.id === c.from || n.id === c.to) continue;
      const t = Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + t * dx - n.x, a.y + t * dy - n.y);
      if (d < best.distance) best = { distance: d, what: `${c.from} -> ${c.to} passes ${n.id}` };
    }
  }
  return best;
}

describe('adding machine', () => {
  it('has a labelled + and − key for every digit in every column, over a Digit register', () => {
    const byId = new Map(machine.network.neurons.map((n) => [n.id, n]));
    for (const place of ADDING_MACHINE_PLACES) {
      expect(byId.get(place)).toMatchObject({ kind: 'character', threshold: 10 });
      for (const k of DIGITS) {
        expect(byId.get(addKey(place, k))).toMatchObject({ kind: 'normal', threshold: 1, label: String(k) });
        expect(byId.get(subtractKey(place, k))).toMatchObject({ kind: 'normal', threshold: 1, label: `−${k}` });
      }
    }
    // Nothing but excitatory relays and digits: the arithmetic is pure counting.
    expect(new Set(machine.network.neurons.map((n) => n.kind))).toEqual(new Set(['normal', 'character']));
  });

  it('+k sends exactly k pulses into its column', () => {
    for (const place of ADDING_MACHINE_PLACES) {
      for (const k of DIGITS) {
        const sim = new Simulation(machine.network);
        sim.stimulate(addKey(place, k));
        const fires = countFires(sim, 30 * TICKS_PER_SECOND);
        expect(fires.get(`${place}-add-collector`) ?? 0).toBe(k);
        expect(sim.isIdle()).toBe(true);
        expect(display(sim)).toBe(k * VALUE[place]);
      }
    }
  });

  it('−k adds 10 − k to its column and 9 to every column on its left', () => {
    ADDING_MACHINE_PLACES.forEach((place, column) => {
      for (const k of DIGITS) {
        const sim = new Simulation(machine.network);
        sim.stimulate(subtractKey(place, k));
        const fires = countFires(sim, 60 * TICKS_PER_SECOND);
        ADDING_MACHINE_PLACES.forEach((other, i) => {
          const expected = i === column ? 10 - k : i < column ? 9 : 0;
          expect(fires.get(`${other}-subtract-collector`) ?? 0, `${subtractKey(place, k)} into ${other}`).toBe(expected);
        });
        expect(display(sim)).toBe(mod(-k * VALUE[place]));
      }
    });
  });

  it('every key gives the exact answer from many starting values', () => {
    for (const start of [0, 1, 9, 10, 99, 100, 132, 999, 1000, 4321, 5000, 9000, 9990, 9999]) {
      for (const { id, amount } of KEYS) {
        const sim = new Simulation(machine.network);
        enter(sim, start);
        expect(display(sim)).toBe(start);
        sim.stimulate(id);
        sim.runUntilIdle();
        expect(display(sim), `${start} then ${id}`).toBe(mod(start + amount));
      }
    }
  });

  it('wraps around like a real adding machine', () => {
    const sim = new Simulation(machine.network);
    enter(sim, 9999);
    sim.stimulate('ones+1');
    sim.runUntilIdle();
    expect(display(sim)).toBe(0);
    sim.stimulate('ones-1');
    sim.runUntilIdle();
    expect(display(sim)).toBe(9999);
  });

  it('multiplies by repeated adding with column shifts, even when keys are hammered', () => {
    // 12 × 13 = 12 × 3 + 120, pressed one key per tick.
    let sim = new Simulation(machine.network);
    for (let i = 0; i < 3; i++) {
      sim.stimulate('tens+1');
      sim.step();
      sim.stimulate('ones+2');
      sim.step();
    }
    sim.stimulate('hundreds+1');
    sim.stimulate('tens+2');
    sim.runUntilIdle();
    expect(display(sim)).toBe(156);

    // 99 × 99 = 99 × 9 + 990 × 9, all eighteen keystrokes on one tick each.
    sim = new Simulation(machine.network);
    for (let i = 0; i < 9; i++) {
      sim.stimulate('tens+9');
      sim.stimulate('ones+9');
      sim.step();
    }
    for (let i = 0; i < 9; i++) {
      sim.stimulate('hundreds+9');
      sim.stimulate('tens+9');
      sim.step();
    }
    sim.runUntilIdle();
    expect(display(sim)).toBe(9801);
  });

  it('loses nothing when one key is hammered on consecutive ticks or many times in one tick', () => {
    const sim = new Simulation(machine.network);
    for (let i = 0; i < 100; i++) {
      sim.stimulate('ones+9');
      sim.step();
    }
    sim.runUntilIdle();
    expect(display(sim)).toBe(900);
    for (let i = 0; i < 7; i++) {
      sim.stimulate('thousands-1');
      sim.step();
    }
    sim.runUntilIdle();
    expect(display(sim)).toBe(mod(900 - 7000));
    for (let i = 0; i < 50; i++) sim.stimulate('ones-1');
    sim.runUntilIdle();
    expect(display(sim)).toBe(mod(900 - 7000 - 50));
  });

  it('property: random presses at random moments always settle on plain arithmetic mod 10000', () => {
    // Clicking a collector or a display digit also adds 1 to that column.
    const extras = ADDING_MACHINE_PLACES.flatMap((place) =>
      [place, `${place}-add-collector`, `${place}-subtract-collector`].map((id) => ({ id, amount: VALUE[place] })),
    );
    const pool = [...KEYS, ...KEYS, ...extras];
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const sim = new Simulation(machine.network);
      let expected = 0;
      for (let press = 0; press < 60; press++) {
        const { id, amount } = pool[Math.floor(rand() * pool.length)]!;
        sim.stimulate(id);
        expected += amount;
        // Mostly short gaps, so presses overlap pulses still in flight.
        const r = rand();
        const gap = r < 0.3 ? 0 : r < 0.6 ? 1 + Math.floor(rand() * 5) : r < 0.9 ? Math.floor(rand() * 120) : Math.floor(rand() * 1200);
        sim.run(gap);
        if (rand() < 0.1) {
          sim.runUntilIdle();
          expect(display(sim), `seed ${seed}, press ${press}`).toBe(mod(expected));
        }
      }
      sim.runUntilIdle();
      expect(display(sim), `seed ${seed}`).toBe(mod(expected));
    }
  });

  it('stays exact over a long session of thousands of overlapping presses', () => {
    const rand = mulberry32(2026);
    const sim = new Simulation(machine.network);
    let expected = 0;
    for (let press = 0; press < 3000; press++) {
      const { id, amount } = KEYS[Math.floor(rand() * KEYS.length)]!;
      sim.stimulate(id);
      expected += amount;
      sim.run(Math.floor(rand() * 20));
    }
    sim.runUntilIdle();
    expect(display(sim)).toBe(mod(expected));
  });

  it('demo: 47 + 85 = 132, − 58 = 74, + 12 × 13 = 230, each step settled before the next', () => {
    const sim = new Simulation(machine.network);
    scheduleDemo(sim, machine.demo!);
    const steps = captionedSteps(machine);
    // Register value once each captioned step has played out.
    const results = [47, 132, 74, null, 230];
    expect(steps).toHaveLength(results.length);
    steps.forEach((step, i) => {
      if (i > 0) {
        sim.run(step.tick - 1 - sim.tick);
        const previous = results[i - 1];
        if (previous !== null) {
          expect(sim.pulses(), `still busy before "${step.caption}"`).toHaveLength(0);
          expect(display(sim), `before "${step.caption}"`).toBe(previous);
        }
      }
    });
    sim.runUntilIdle();
    expect(display(sim)).toBe(230);
    expect(sim.seconds).toBeLessThan(40);
    // The captions state the results the display ends up showing.
    expect(steps[1]!.caption).toContain('= 132');
    expect(steps[2]!.caption).toContain('= 74');
    expect(steps[4]!.caption).toContain('= 230');
    expect(demoCaptionAt(machine.demo!, sim.seconds)).toBe(steps[4]!.caption);
  });

  it('demo arithmetic matches the keys it presses', () => {
    let expected = 0;
    for (const step of machine.demo!) expected += KEYS.find((k) => k.id === step.neuron)!.amount;
    expect(mod(expected)).toBe(230);
  });

  it('after the demo, the tryThis steps clear to 0000, wrap to 9999 and carry back to 0000', () => {
    const sim = new Simulation(machine.network);
    scheduleDemo(sim, machine.demo!);
    sim.runUntilIdle();
    expect(display(sim)).toBe(230);
    // "There is no clear key, so subtract what the display shows."
    sim.stimulate('hundreds-2');
    sim.stimulate('tens-3');
    sim.runUntilIdle();
    expect(display(sim)).toBe(0);
    // "From 0000, press −1 in the ones … leaves 9999."
    sim.stimulate('ones-1');
    sim.runUntilIdle();
    expect(display(sim)).toBe(9999);
    // "… press 1 in the ones and a single carry ripples all the way back."
    sim.stimulate('ones+1');
    const fires = countFires(sim, 30 * TICKS_PER_SECOND);
    for (const place of ADDING_MACHINE_PLACES) expect(fires.get(place), place).toBe(1);
    expect(display(sim)).toBe(0);
  });

  it('replays the demo tick for tick after a reset mid-calculation, or when started late', () => {
    /** Fires of a demo run, timed from when the demo was scheduled. */
    const trace = (sim: Simulation) => {
      const start = sim.tick;
      scheduleDemo(sim, machine.demo!);
      const fires: string[] = [];
      while (!sim.isIdle()) for (const e of sim.step()) fires.push(`${e.tick - start} ${e.neuron}`);
      expect(display(sim)).toBe(230);
      return fires;
    };
    const reference = trace(new Simulation(machine.network));

    // Reset in the middle of the subtraction, with the user's own pulses in flight too.
    const replayed = new Simulation(machine.network);
    scheduleDemo(replayed, machine.demo!);
    replayed.runSeconds(20);
    replayed.stimulate('thousands+7');
    replayed.stimulate('ones-1');
    expect(replayed.pulses().length).toBeGreaterThan(0);
    replayed.reset();
    expect(display(replayed)).toBe(0);
    expect(trace(replayed)).toEqual(reference);

    // Started after the machine has idled for a while.
    const late = new Simulation(machine.network);
    late.run(1234);
    expect(trace(late)).toEqual(reference);
  });

  it('adds presses made while the demo plays, including ones on the same tick as a demo step', () => {
    // The demo queued twice presses every demo key twice on the same tick.
    const doubled = new Simulation(machine.network);
    scheduleDemo(doubled, machine.demo!);
    scheduleDemo(doubled, machine.demo!);
    doubled.runUntilIdle();
    expect(display(doubled)).toBe(460);

    for (let seed = 1; seed <= 12; seed++) {
      const rand = mulberry32(1000 + seed);
      const sim = new Simulation(machine.network);
      scheduleDemo(sim, machine.demo!);
      let expected = 230;
      while (sim.seconds < 40) {
        if (rand() < 0.02) {
          const { id, amount } = KEYS[Math.floor(rand() * KEYS.length)]!;
          sim.stimulate(id);
          expected += amount;
        }
        sim.step();
      }
      sim.runUntilIdle();
      expect(display(sim), `seed ${seed}`).toBe(mod(expected));
    }
  });

  it('cancels out exactly when every key is pressed at once, or one per tick in shuffled order', () => {
    // +k and −k add up to 0 in every column, so all 72 keys together change nothing.
    const sim = new Simulation(machine.network);
    enter(sim, 4321);
    for (const { id } of KEYS) sim.stimulate(id);
    sim.runUntilIdle();
    expect(display(sim)).toBe(4321);

    const rand = mulberry32(72);
    const order = [...KEYS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const { id } of order) {
      sim.stimulate(id);
      sim.step();
    }
    sim.runUntilIdle();
    expect(display(sim)).toBe(4321);
  });
});

describe('pulse dial', () => {
  const read = (sim: Simulation) => sim.charge('tens') * 10 + sim.charge('ones');
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => ({ id: `dial-${d}`, amount: d === 0 ? 10 : d }));

  it('each number sends that many pulses, and 0 sends ten', () => {
    for (const { id, amount } of keys) {
      const sim = new Simulation(dial.network);
      sim.stimulate(id);
      const fires = countFires(sim, 30 * TICKS_PER_SECOND);
      expect(fires.get('collector'), id).toBe(amount);
      expect(sim.isIdle()).toBe(true);
      expect(read(sim)).toBe(amount % 100);
      expect(dial.network.neurons.find((n) => n.id === id)!.label).toBe(id.slice(-1));
    }
  });

  it('property: quick, overlapping dialling always adds up (mod 100)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = mulberry32(seed);
      const sim = new Simulation(dial.network);
      let expected = 0;
      for (let i = 0; i < 40; i++) {
        const { id, amount } = keys[Math.floor(rand() * keys.length)]!;
        sim.stimulate(id);
        expected += amount;
        sim.run(rand() < 0.4 ? 0 : Math.floor(rand() * 200));
      }
      sim.runUntilIdle();
      expect(read(sim), `seed ${seed}`).toBe(expected % 100);
    }
  });

  it('0 spins the ones digit all the way round and carries once, and 99 wraps to 00', () => {
    const sim = new Simulation(dial.network);
    sim.stimulate('dial-7');
    sim.runUntilIdle();
    for (let i = 1; i <= 10; i++) {
      sim.stimulate('dial-0');
      const fires = countFires(sim, 30 * TICKS_PER_SECOND);
      expect(fires.get('ones'), `0 number ${i}`).toBe(1);
      expect(read(sim)).toBe((7 + 10 * i) % 100);
    }
  });

  it('demo: 7, then 7 + 10 = 17, then 17 + 5 = 22', () => {
    const sim = new Simulation(dial.network);
    scheduleDemo(sim, dial.demo!);
    const steps = captionedSteps(dial);
    const results = [7, 17, 22];
    steps.forEach((step, i) => {
      if (i > 0) {
        sim.run(step.tick - 1 - sim.tick);
        expect(sim.pulses()).toHaveLength(0);
        expect(read(sim), `before "${step.caption}"`).toBe(results[i - 1]);
      }
    });
    sim.runUntilIdle();
    expect(read(sim)).toBe(22);
    expect(steps[1]!.caption).toContain('= 17');
    expect(steps[2]!.caption).toContain('= 22');
  });
});

describe('calculator demos', () => {
  // Both apps keep the last caption up for 6 s after the final demo step.
  const CAPTION_TAIL_SECONDS = 6;

  it('settle while the last caption is still showing', () => {
    for (const example of [machine, dial]) {
      const last = Math.max(...example.demo!.map((s) => s.at));
      const sim = new Simulation(example.network);
      scheduleDemo(sim, example.demo!);
      sim.runUntilIdle();
      expect(sim.seconds, example.id).toBeLessThanOrEqual(last + CAPTION_TAIL_SECONDS);
    }
  });
});

/** Text annotation boxes in cells, estimated the way networkBounds does. */
function textBoxes(network: Network) {
  return (network.texts ?? []).map((t) => {
    const size = t.size ?? 0.6;
    const lines = t.text.split('\n');
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.55;
    const left = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
    return { text: t.text, left, top: t.y, right: left + width, bottom: t.y + lines.length * size * 1.25 };
  });
}

describe('calculator layouts', () => {
  it('stay compact, and no connection passes through or close to another neuron', () => {
    for (const example of [machine, dial]) {
      const b = networkBounds(example.network);
      expect(b.maxX - b.minX, example.id).toBeLessThanOrEqual(45);
      expect(b.maxY - b.minY, example.id).toBeLessThanOrEqual(28);
      const pass = closestPass(example.network);
      expect(pass.distance, `${example.id}: ${pass.what}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('keep texts clear of neurons, connection lines and each other', () => {
    for (const example of [machine, dial]) {
      const { neurons, connections } = example.network;
      const at = new Map(neurons.map((n) => [n.id, n]));
      const boxes = textBoxes(example.network);
      const inside = (box: (typeof boxes)[number], x: number, y: number) => x > box.left && x < box.right && y > box.top && y < box.bottom;
      for (const box of boxes) {
        for (const n of neurons) {
          // Neurons are drawn 0.08 cells in from their cell's edges.
          const overlaps = box.left < n.x + 0.92 && box.right > n.x + 0.08 && box.top < n.y + 0.92 && box.bottom > n.y + 0.08;
          expect(overlaps, `${example.id}: "${box.text}" covers ${n.id}`).toBe(false);
        }
        for (const c of connections) {
          const a = at.get(c.from)!, b = at.get(c.to)!;
          for (let s = 0; s <= 100; s++) {
            const x = a.x + 0.5 + ((b.x - a.x) * s) / 100, y = a.y + 0.5 + ((b.y - a.y) * s) / 100;
            expect(inside(box, x, y), `${example.id}: "${box.text}" is crossed by ${c.from} -> ${c.to}`).toBe(false);
          }
        }
        for (const other of boxes) {
          if (other === box) continue;
          const overlaps = box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
          expect(overlaps, `${example.id}: "${box.text}" overlaps "${other.text}"`).toBe(false);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { Simulation, TICKS_PER_SECOND, travelTicks, type Network, type NeuronSpec } from '../engine';
import { mulberry32 } from '../engine/rng';
import { BITS, DIVISORS, TIMES_TABLE_COUNT, TIMES_TABLE_INTERVAL } from './arithmetic';
import { findExample, scheduleDemo } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Reader = (sim: Simulation) => number;
type Readers = Record<string, Reader>;

/** The number shown by a row of Digits, given ones first. */
const decimal = (sim: Simulation, ids: string[]) => ids.reduce((sum, id, i) => sum + sim.charge(id) * 10 ** i, 0);
const digits3 = (prefix: string) => [`${prefix}-ones`, `${prefix}-tens`, `${prefix}-hundreds`];

function network(id: string): Network {
  const example = findExample(id);
  if (!example) throw new Error(`missing example ${id}`);
  return example.network;
}

function spec(net: Network, id: string): NeuronSpec {
  const neuron = net.neurons.find((n) => n.id === id);
  if (!neuron) throw new Error(`missing neuron ${id}`);
  return neuron;
}

/**
 * How much one +1 pulse delivered to each neuron eventually adds to each
 * reading, measured by poking that neuron in a fresh, timer-free copy of the
 * network and letting it settle.
 */
function worths(net: Network, readers: Readers): Map<string, Record<string, number>> {
  const quiet: Network = {
    ...net,
    neurons: net.neurons.filter((n) => n.kind !== 'timer'),
    connections: net.connections.filter((c) => net.neurons.find((n) => n.id === c.from)!.kind !== 'timer'),
  };
  const table = new Map<string, Record<string, number>>();
  for (const neuron of quiet.neurons) {
    const sim = new Simulation(quiet);
    sim.stimulate(neuron.id);
    sim.runUntilIdle();
    table.set(neuron.id, Object.fromEntries(Object.entries(readers).map(([name, read]) => [name, read(sim)])));
  }
  return table;
}

/**
 * Keeps the books on a simulation: every click and timer pulse adds the worth
 * of where it lands, and after every tick, for every reading, what is shown
 * plus what is still in flight must equal everything put in so far. In other
 * words no pulse is ever lost or counted twice, whatever the timing.
 */
class Ledger {
  private readonly injected: Record<string, number>;

  constructor(
    readonly sim: Simulation,
    private readonly readers: Readers,
    private readonly worth: Map<string, Record<string, number>>,
  ) {
    this.injected = Object.fromEntries(Object.keys(readers).map((n) => [n, 0]));
  }

  /** Click a neuron now (before the next tick, as the UI does between frames). */
  click(id: string): void {
    this.add(id);
    this.sim.stimulate(id);
  }

  step(): void {
    for (const event of this.sim.step()) {
      if (event.kind === 'timer') for (const target of this.sim.targets(event.neuron)) this.add(target);
    }
    for (const [name, read] of Object.entries(this.readers)) {
      const inFlight = this.sim.pulses().reduce((sum, p) => sum + p.charge * this.worth.get(p.to)![name]!, 0);
      if (read(this.sim) + inFlight !== this.injected[name]) {
        throw new Error(`tick ${this.sim.tick}: ${name} shows ${read(this.sim)} + ${inFlight} in flight, expected ${this.injected[name]}`);
      }
    }
  }

  private add(id: string): void {
    for (const name of Object.keys(this.injected)) this.injected[name]! += this.worth.get(id)![name]!;
  }

  /** Run to `tick`, applying the planned clicks at the start of their ticks. */
  runTo(tick: number, clicks: ReadonlyMap<number, readonly string[]> = new Map()): void {
    while (this.sim.tick < tick) {
      for (const id of clicks.get(this.sim.tick + 1) ?? []) this.click(id);
      this.step();
    }
  }
}

function clickPlan(entries: Array<[number, string]>): Map<number, string[]> {
  const plan = new Map<number, string[]>();
  for (const [tick, id] of entries) plan.set(tick, [...(plan.get(tick) ?? []), id]);
  return plan;
}

/**
 * A seeded storm of clicks on any of `targets` before `horizon`: single
 * clicks, bursts on consecutive ticks, and several clicks on the same tick.
 */
function randomClicks(seed: number, targets: readonly string[], count: number, horizon: number): Array<[number, string]> {
  const rng = mulberry32(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;
  const entries: Array<[number, string]> = [];
  while (entries.length < count) {
    const tick = 1 + Math.floor(rng() * horizon);
    const id = pick(targets);
    const style = rng();
    if (style < 0.5) entries.push([tick, id]);
    else if (style < 0.8) for (let i = 0; i < 2 + Math.floor(rng() * 5); i++) entries.push([tick + i, id]);
    else for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) entries.push([tick, i ? pick(targets) : id]);
  }
  return entries;
}

/** Demo steps as clicks, on the ticks scheduleDemo would use on a fresh run. */
const demoClicks = (id: string): Array<[number, string]> =>
  findExample(id)!.demo!.map((step) => [Math.max(1, Math.round(step.at * TICKS_PER_SECOND)), step.neuron]);

/**
 * A decimal counter read so that it never wraps: the value shown plus 1000
 * for every time its hundreds digit overflowed (and lost the carry).
 */
const unwrapped = (sim: Simulation, prefix: string) => decimal(sim, digits3(prefix)) + 1000 * sim.state(`${prefix}-hundreds`)!.fireCount;

/**
 * Apply a storm of clicks, checking the ledger after every tick, then run
 * until idle. Returns how many clicks landed while pulses were in flight.
 */
function storm(net: Network, readers: Readers, clicks: Array<[number, string]>): number {
  const ledger = new Ledger(new Simulation(net), readers, worths(net, readers));
  const plan = clickPlan(clicks);
  const last = Math.max(...clicks.map(([tick]) => tick));
  let busyClicks = 0;
  while (ledger.sim.tick < last) {
    if (ledger.sim.pulses().length > 0) busyClicks += plan.get(ledger.sim.tick + 1)?.length ?? 0;
    ledger.runTo(ledger.sim.tick + 1, plan);
  }
  while (!ledger.sim.isIdle()) ledger.step();
  return busyClicks;
}

// ---------------------------------------------------------------------------
// Times tables
// ---------------------------------------------------------------------------

describe('times tables', () => {
  const net = network('times-tables');
  const ks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const row = (sim: Simulation, k: number) => decimal(sim, digits3(`x${k}`));
  const n = (sim: Simulation) => decimal(sim, digits3('n'));
  const table = (sim: Simulation) => ks.map((k) => row(sim, k));
  const readers: Readers = { n, ...Object.fromEntries(ks.map((k) => [`x${k}`, (sim: Simulation) => row(sim, k)])) };
  const interval = TIMES_TABLE_INTERVAL * TICKS_PER_SECOND;
  /** The timer fires on tick 1 and then every interval. */
  const fireTick = (m: number) => 1 + (m - 1) * interval;

  it('shows k × n in every row after each tick, before the next tick starts', () => {
    const sim = new Simulation(net);
    for (let m = 1; m <= TIMES_TABLE_COUNT; m++) {
      // 9.6 s after tick m everything has landed...
      sim.run(fireTick(m) + Math.round(9.6 * TICKS_PER_SECOND) - sim.tick);
      expect(n(sim), `n after tick ${m}`).toBe(m);
      expect(table(sim), `table after tick ${m}`).toEqual(ks.map((k) => k * m));
      expect(sim.pulses(), `nothing in flight after tick ${m}`).toHaveLength(0);
      // ...and it stays that way until the next tick fires.
      if (m < TIMES_TABLE_COUNT) {
        sim.run(fireTick(m + 1) - sim.tick);
        expect(table(sim)).toEqual(ks.map((k) => k * m));
        expect(n(sim)).toBe(m);
      }
    }
  });

  it('settles about 9.5 s after each tick, then stands still for over 2 s before the next', () => {
    const sim = new Simulation(net);
    const shown = () => [n(sim), ...table(sim)].join();
    const changes: number[] = [];
    let previous = shown();
    while (!sim.isIdle()) {
      sim.step();
      if (shown() !== previous) changes.push(sim.tick);
      previous = shown();
    }
    for (let m = 1; m <= TIMES_TABLE_COUNT; m++) {
      const during = changes.filter((t) => t >= fireTick(m) && t < fireTick(m) + interval);
      const settled = (during.at(-1)! - fireTick(m)) / TICKS_PER_SECOND;
      expect(settled, `tick ${m}`).toBeGreaterThan(9);
      expect(settled, `tick ${m}`).toBeLessThan(10);
      expect(TIMES_TABLE_INTERVAL - settled, `rest after tick ${m}`).toBeGreaterThan(2);
    }
  });

  it('a reset in the middle of the run starts the table over cleanly', () => {
    const sim = new Simulation(net);
    sim.runSeconds(50.3);
    sim.stimulate('step');
    sim.reset();
    expect([n(sim), ...table(sim)]).toEqual(Array(10).fill(0));
    sim.runUntilIdle();
    expect(n(sim)).toBe(12);
    expect(table(sim)).toEqual([12, 24, 36, 48, 60, 72, 84, 96, 108]);
  });

  it.each([1, 2, 3, 4, 5])('stays exact under a seeded storm of +1 clicks during the run (seed %i)', (seed) => {
    const sim = new Simulation(net);
    const end = fireTick(TIMES_TABLE_COUNT) + interval;
    const plan = clickPlan(randomClicks(seed, ['step'], 40, end));
    let clicks = 0;
    while (sim.tick < end || !sim.isIdle()) {
      for (const id of plan.get(sim.tick + 1) ?? []) {
        sim.stimulate(id);
        clicks++;
      }
      sim.step();
    }
    expect(clicks).toBeGreaterThanOrEqual(40);
    expect(n(sim)).toBe(TIMES_TABLE_COUNT + clicks);
    expect(table(sim)).toEqual(ks.map((k) => k * (TIMES_TABLE_COUNT + clicks)));
  });

  it.each([11, 12, 13])('never loses a pulse when any neuron is clicked at random (seed %i)', (seed) => {
    const readers: Readers = {
      n: (sim) => unwrapped(sim, 'n'),
      ...Object.fromEntries(ks.map((k) => [`x${k}`, (sim: Simulation) => unwrapped(sim, `x${k}`)])),
    };
    const targets = net.neurons.filter((neuron) => neuron.kind !== 'timer').map((neuron) => neuron.id);
    const busy = storm(net, readers, randomClicks(seed, targets, 150, fireTick(TIMES_TABLE_COUNT) + interval));
    expect(busy).toBeGreaterThan(20);
  });

  it('ends on 12, 24, 36 … 108 and goes quiet', () => {
    const sim = new Simulation(net);
    sim.runUntilIdle();
    expect(sim.tick).toBeLessThan(fireTick(TIMES_TABLE_COUNT) + interval);
    expect(n(sim)).toBe(12);
    expect(table(sim)).toEqual([12, 24, 36, 48, 60, 72, 84, 96, 108]);
    sim.runSeconds(600);
    expect(table(sim)).toEqual([12, 24, 36, 48, 60, 72, 84, 96, 108]);
  });

  it('whenever a row is at rest it shows a multiple of k, and it rests on every one in turn', () => {
    const sim = new Simulation(net);
    const resting = ks.map(() => [] as number[]);
    while (!sim.isIdle()) {
      sim.step();
      // A row is at rest when no pulse is on its way to its ladder or counter.
      const busy = new Set(sim.pulses().map((p) => p.to.split('-')[0]));
      ks.forEach((k, i) => {
        const value = row(sim, k);
        if (!busy.has(`x${k}`) && resting[i]!.at(-1) !== value) resting[i]!.push(value);
      });
    }
    ks.forEach((k, i) => {
      expect(resting[i], `row ×${k}`).toEqual(Array.from({ length: TIMES_TABLE_COUNT + 1 }, (_, m) => k * m));
    });
  });

  it('streams the copies into ×9 half a second apart', () => {
    const sim = new Simulation(net);
    sim.runUntilIdle();
    sim.stimulate('x9-r1');
    const arrivals: number[] = [];
    let last = sim.charge('x9-ones');
    while (!sim.isIdle()) {
      sim.step();
      if (sim.charge('x9-ones') !== last) arrivals.push(sim.tick);
      last = sim.charge('x9-ones');
    }
    expect(arrivals).toHaveLength(9);
    expect(arrivals.slice(1).map((t, i) => t - arrivals[i]!)).toEqual(Array(8).fill(TICKS_PER_SECOND / 2));
    expect(row(sim, 9)).toBe(108 + 9);
  });

  it('a click on rung i of ladder ×k adds k − i + 1 to that row only, at any click speed', () => {
    const sim = new Simulation(net);
    sim.runUntilIdle();
    // Five clicks on consecutive ticks on every first rung, and three on the fifth rung of ×9.
    for (let t = 0; t < 5; t++) {
      for (const k of ks) sim.stimulate(`x${k}-r1`);
      if (t < 3) sim.stimulate('x9-r5');
      sim.step();
    }
    sim.runUntilIdle();
    expect(n(sim)).toBe(12);
    expect(table(sim)).toEqual(ks.map((k) => 12 * k + 5 * k + (k === 9 ? 3 * 5 : 0)));
  });

  it('never loses or double-counts a pulse, even with frantic clicking during the run', () => {
    const worth = worths(net, readers);
    expect(worth.get('step')).toEqual({ n: 1, ...Object.fromEntries(ks.map((k) => [`x${k}`, k])) });

    // The timer fires on tick 1; click +1 on the very tick its pulse arrives.
    const firstArrival = 1 + travelTicks(spec(net, 'timer'), spec(net, 'step'));
    const ledger = new Ledger(new Simulation(net), readers, worth);
    const sim = ledger.sim;
    const clicks = clickPlan([
      [firstArrival, 'step'],
      // Eight clicks on consecutive ticks while the first tick is still on its way down.
      ...Array.from({ length: 8 }, (_, i): [number, string] => [100 + i, 'step']),
      // Clicks in the middle of the machinery: a bus, a rung, a bottom rail, a digit.
      [2000, 'bus-2'],
      [2000, 'bus-2'],
      [2400, 'x7-r1'],
      [2401, 'x9-b5'],
      [2402, 'x3-ones'],
      [2403, 'x8-tens'],
    ]);
    ledger.runTo(fireTick(TIMES_TABLE_COUNT) + interval, clicks);
    expect(sim.isIdle()).toBe(true);

    // 12 ticks + 9 clicks on +1 = 21; bus-2 feeds rows 2 to 5 twice.
    const extra: Record<number, number> = { 2: 2 * 2, 3: 2 * 3 + 1, 4: 2 * 4, 5: 2 * 5, 7: 7, 8: 10, 9: 1 };
    expect(n(sim)).toBe(21);
    expect(table(sim)).toEqual(ks.map((k) => 21 * k + (extra[k] ?? 0)));
  });
});

// ---------------------------------------------------------------------------
// Division with remainders
// ---------------------------------------------------------------------------

describe('division with remainders', () => {
  const net = network('division-remainders');
  const N = (sim: Simulation) => decimal(sim, digits3('n'));
  const quotient = (sim: Simulation, d: number) => decimal(sim, digits3(`quot-${d}`));
  const remainder = (sim: Simulation, d: number) => sim.charge(`rem-${d}`);
  const readers: Readers = {
    n: N,
    ...Object.fromEntries(DIVISORS.map((d) => [`÷${d}`, (sim: Simulation) => d * quotient(sim, d) + remainder(sim, d)])),
  };
  const shows = (sim: Simulation) => ({
    n: N(sim),
    rows: DIVISORS.map((d) => [quotient(sim, d), remainder(sim, d)]),
  });
  const exact = (value: number) => ({ n: value, rows: DIVISORS.map((d) => [Math.floor(value / d), value % d]) });
  const isPrime = (v: number) => v > 1 && Array.from({ length: v - 2 }, (_, i) => i + 2).every((f) => v % f !== 0);

  /** Press +10 and +1 on consecutive ticks to send `value` pulses. */
  function enter(sim: Simulation, value: number): void {
    const presses = [...Array<string>(Math.floor(value / 10)).fill('key-10-r1'), ...Array<string>(value % 10).fill('key-1')];
    for (const id of presses) {
      sim.stimulate(id);
      sim.step();
    }
  }

  it('plays its demo: 20, then 21, 22 and finally 23, with no zero remainder', () => {
    const example = findExample('division-remainders')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    const at = (seconds: number) => sim.run(Math.round(seconds * TICKS_PER_SECOND) - sim.tick);
    at(9.9);
    expect(shows(sim)).toEqual(exact(20));
    at(13.9);
    expect(shows(sim)).toEqual(exact(21));
    at(17.9);
    expect(shows(sim)).toEqual(exact(22));
    sim.runUntilIdle();
    expect(sim.seconds).toBeLessThan(22);
    expect(shows(sim)).toEqual(exact(23));
    expect(shows(sim).rows).toEqual([[11, 1], [7, 2], [4, 3], [3, 2]]);
    // Try this: one more press makes 24 = 2 × 12 = 3 × 8.
    sim.stimulate('key-1');
    sim.runUntilIdle();
    expect(shows(sim)).toEqual(exact(24));
    expect(DIVISORS.filter((d) => remainder(sim, d) === 0)).toEqual([2, 3]);
  });

  it('is exact for every N from 0 to 130, one press at a time, and spots primes up to 120', () => {
    const sim = new Simulation(net);
    for (let value = 0; value <= 130; value++) {
      if (value > 0) {
        sim.stimulate('key-1');
        sim.runUntilIdle();
      }
      expect(shows(sim)).toEqual(exact(value));
      if (value >= 2 && value <= 120) {
        const noZero = DIVISORS.every((d) => remainder(sim, d) !== 0);
        expect(noZero || [2, 3, 5, 7].includes(value), `N = ${value}`).toBe(isPrime(value));
      }
    }
  });

  it('the prime trick stops at 121 = 11 × 11, as the description says', () => {
    const sim = new Simulation(net);
    enter(sim, 121);
    sim.runUntilIdle();
    expect(DIVISORS.every((d) => remainder(sim, d) !== 0)).toBe(true);
    expect(isPrime(121)).toBe(false);
  });

  it.each([7, 42, 99, 210, 365, 999])('is exact for N = %i entered with rapid presses', (value) => {
    const sim = new Simulation(net);
    enter(sim, value);
    sim.runUntilIdle();
    expect(shows(sim)).toEqual(exact(value));
  });

  it('replays its demo exactly after a reset part-way through (as the app does on Replay)', () => {
    const example = findExample('division-remainders')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    sim.runSeconds(12.3);
    sim.stimulate('key-10-r1');
    sim.reset();
    scheduleDemo(sim, example.demo!);
    sim.runUntilIdle();
    expect(shows(sim)).toEqual(exact(23));
  });

  it('follows the demo with the tryThis presses: 24, then the primes 29, 31 and 37', () => {
    const example = findExample('division-remainders')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    sim.runUntilIdle();
    const noZero = () => DIVISORS.every((d) => remainder(sim, d) !== 0);
    // Pressed on consecutive ticks, without waiting for the rows to settle.
    const press = (times: number) => {
      for (let i = 0; i < times; i++) {
        sim.stimulate('key-1');
        sim.step();
      }
      sim.runUntilIdle();
    };
    press(1);
    expect(shows(sim)).toEqual(exact(24));
    expect(noZero()).toBe(false);
    for (const prime of [29, 31, 37]) {
      press(prime - N(sim));
      expect(shows(sim)).toEqual(exact(prime));
      expect(noZero(), `N = ${prime}`).toBe(true);
    }
  });

  it.each([1, 2, 3, 4, 5])('is exact after a seeded storm of +10 and +1 presses (seed %i)', (seed) => {
    const sim = new Simulation(net);
    const plan = clickPlan(randomClicks(seed, ['key-10-r1', 'key-1'], 50, 900));
    let value = 0;
    while (sim.tick < 900 || !sim.isIdle()) {
      for (const id of plan.get(sim.tick + 1) ?? []) {
        sim.stimulate(id);
        value += id === 'key-1' ? 1 : 10;
      }
      sim.step();
    }
    expect(value).toBeGreaterThan(100);
    expect(value).toBeLessThan(1000);
    expect(shows(sim)).toEqual(exact(value));
  });

  it.each([11, 12, 13])('never loses a pulse when any neuron is clicked at random during the demo (seed %i)', (seed) => {
    const readers: Readers = {
      n: (sim) => unwrapped(sim, 'n'),
      ...Object.fromEntries(DIVISORS.map((d) => [`÷${d}`, (sim: Simulation) => d * unwrapped(sim, `quot-${d}`) + remainder(sim, d)])),
    };
    const targets = net.neurons.map((neuron) => neuron.id);
    const busy = storm(net, readers, [...demoClicks('division-remainders'), ...randomClicks(seed, targets, 150, 1500)]);
    expect(busy).toBeGreaterThan(20);
  });

  it('lags while pulses are in flight but never loses one, and is exact once settled', () => {
    const worth = worths(net, readers);
    expect(worth.get('key-10-r1')).toEqual({ n: 10, ...Object.fromEntries(DIVISORS.map((d) => [`÷${d}`, 10])) });

    // Presses at awkward moments: bursts on consecutive ticks, two keys on the
    // same tick, and presses while earlier ladders are still emptying.
    const entries: Array<[number, string]> = [];
    for (let i = 0; i < 6; i++) entries.push([10 + i, 'key-10-r1']);
    for (let i = 0; i < 7; i++) entries.push([12 + i, 'key-1']);
    entries.push([200, 'key-10-r1'], [200, 'key-1'], [201, 'bus-5'], [230, 'key-10-r1']);
    const ledger = new Ledger(new Simulation(net), readers, worth);
    const sim = ledger.sim;
    const clicks = clickPlan(entries);
    let lagging = 0;
    let carryInFlight = 0;
    while (sim.tick < 240 || !sim.isIdle()) {
      ledger.runTo(sim.tick + 1, clicks);
      // Mid-flight the display is behind the presses made so far...
      if (sim.tick > 230 && N(sim) < 88) lagging++;
      // ...for example the ÷7 digit has wrapped to 0 but its quotient has not counted it yet.
      if (sim.pulses().some((p) => p.from === 'rem-7' && p.to === 'quot-7-ones')) carryInFlight++;
    }
    expect(lagging).toBeGreaterThan(0);
    expect(carryInFlight).toBeGreaterThan(0);
    // 8 × 10 + 7 + 1 = 88 pulses on the bus; bus-5 adds one more to ÷5 and ÷7 only.
    expect(N(sim)).toBe(88);
    expect(shows(sim).rows).toEqual([
      [44, 0],
      [29, 1],
      [17, 4],
      [12, 5],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Binary to decimal
// ---------------------------------------------------------------------------

describe('binary to decimal', () => {
  const net = network('binary-to-decimal');
  const bits = (sim: Simulation) => Array.from({ length: BITS }, (_, j) => sim.charge(`bit-${j}`));
  const binary = (sim: Simulation) => bits(sim).reduce((sum, bit, j) => sum + bit * 2 ** j, 0);
  const binaryText = (sim: Simulation) => bits(sim).reverse().join('');
  const dec = (sim: Simulation) => decimal(sim, digits3('dec'));
  const keyFor = (j: number) => `key-${2 ** j}`;

  it('plays its demo: 1011 = 11, then 128 more, then 11111111 = 255', () => {
    const example = findExample('binary-to-decimal')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    const at = (seconds: number) => sim.run(Math.round(seconds * TICKS_PER_SECOND) - sim.tick);
    at(8);
    expect([binaryText(sim), dec(sim)]).toEqual(['00001011', 11]);
    at(14.5);
    expect([binaryText(sim), dec(sim)]).toEqual(['10001011', 139]);
    sim.runUntilIdle();
    expect(sim.seconds).toBeLessThan(21);
    expect([binaryText(sim), dec(sim)]).toEqual(['11111111', 255]);
  });

  it('converts every number from 0 to 255, pressing its bits in any order on consecutive ticks', () => {
    for (let value = 0; value < 256; value++) {
      const sim = new Simulation(net);
      const ones = Array.from({ length: BITS }, (_, j) => j).filter((j) => value & (1 << j));
      // Vary the order: high bits first, low bits first, or odd positions first.
      const order =
        value % 3 === 0 ? [...ones].reverse() : value % 3 === 1 ? ones : [...ones.filter((_, i) => i % 2), ...ones.filter((_, i) => !(i % 2))];
      for (const j of order) {
        sim.stimulate(keyFor(j));
        sim.step();
      }
      sim.runUntilIdle();
      expect([binary(sim), dec(sim)], `value ${value}`).toEqual([value, value]);
      expect(bits(sim).every((bit) => bit === 0 || bit === 1)).toBe(true);
    }
  });

  it("delivers a press of key 128 as 128 pulses, in bunches that form a row of Pascal's triangle", () => {
    const sim = new Simulation(net);
    sim.stimulate('key-128');
    const firesPerTick = new Map<number, number>();
    while (!sim.isIdle()) {
      for (const event of sim.step()) {
        if (event.neuron === 'key-1') firesPerTick.set(event.tick, (firesPerTick.get(event.tick) ?? 0) + 1);
      }
    }
    expect([...firesPerTick.values()]).toEqual([1, 7, 21, 35, 35, 21, 7, 1]);
    expect([binaryText(sim), dec(sim)]).toEqual(['10000000', 128]);
  });

  it('wraps the binary row after 255 while the decimal row keeps counting', () => {
    const sim = new Simulation(net);
    // Every key three times, interleaved, on consecutive ticks.
    for (let round = 0; round < 3; round++) {
      for (let j = 0; j < BITS; j++) {
        sim.stimulate(keyFor((j * 3 + round) % BITS));
        sim.step();
      }
    }
    sim.runUntilIdle();
    expect(dec(sim)).toBe(3 * 255);
    expect(binary(sim)).toBe((3 * 255) % 256);
  });

  it('replays its demo exactly after a reset part-way through (as the app does on Replay)', () => {
    const example = findExample('binary-to-decimal')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    sim.runSeconds(9.2);
    sim.stimulate('key-64');
    sim.reset();
    scheduleDemo(sim, example.demo!);
    sim.runUntilIdle();
    expect([binaryText(sim), dec(sim)]).toEqual(['11111111', 255]);
  });

  it('follows the demo with the tryThis presses: 1 wraps the byte, then 64 + 64 carries into 128', () => {
    const example = findExample('binary-to-decimal')!;
    const sim = new Simulation(net);
    scheduleDemo(sim, example.demo!);
    sim.runUntilIdle();
    sim.stimulate('key-1');
    sim.runUntilIdle();
    expect([binaryText(sim), dec(sim)]).toEqual(['00000000', 256]);
    sim.stimulate('key-64');
    sim.step();
    sim.stimulate('key-64');
    sim.runUntilIdle();
    expect([binaryText(sim), dec(sim)]).toEqual(['10000000', 384]);
  });

  it.each([1, 2, 3, 4, 5])('adds up a seeded storm of key presses exactly in both rows (seed %i)', (seed) => {
    const sim = new Simulation(net);
    const keys = Array.from({ length: BITS }, (_, j) => keyFor(j));
    const plan = clickPlan(randomClicks(seed, keys, 25, 600));
    let value = 0;
    while (sim.tick < 600 || !sim.isIdle()) {
      for (const id of plan.get(sim.tick + 1) ?? []) {
        const worth = Number(id.slice('key-'.length));
        if (value + worth > 999) continue; // stay within the decimal row
        sim.stimulate(id);
        value += worth;
      }
      sim.step();
    }
    expect(value).toBeGreaterThan(255);
    expect([binary(sim), dec(sim)]).toEqual([value % 256, value]);
    expect(bits(sim).every((bit) => bit === 0 || bit === 1)).toBe(true);
  });

  it.each([11, 12, 13])('never loses a pulse when any neuron is clicked at random during the demo (seed %i)', (seed) => {
    const readers: Readers = {
      binary: (sim) => binary(sim) + 256 * sim.state('bit-7')!.fireCount,
      decimal: (sim) => unwrapped(sim, 'dec'),
    };
    const targets = net.neurons.map((neuron) => neuron.id);
    const busy = storm(net, readers, [...demoClicks('binary-to-decimal'), ...randomClicks(seed, targets, 150, 1500)]);
    expect(busy).toBeGreaterThan(20);
  });

  it('never loses or double-counts a pulse under frantic pressing', () => {
    const readers: Readers = { binary, decimal: dec };
    const worth = worths(net, readers);
    for (let j = 0; j < BITS; j++) expect(worth.get(keyFor(j))).toEqual({ binary: 2 ** j, decimal: 2 ** j });
    const clicks = clickPlan([
      [1, 'key-8'],
      // Key 8's first pulse reaches key 4 on this tick: press key 4 at the same moment.
      [1 + travelTicks(spec(net, 'key-8'), spec(net, 'key-4')), 'key-4'],
      [2, 'key-64'],
      [3, 'key-64'],
      [3, 'key-32'],
      [4, 'key-32'],
      [40, 'key-8'],
      [41, 'key-8'],
      [42, 'double-16'],
      ...Array.from({ length: 5 }, (): [number, string] => [50, 'key-1']),
      [51, 'key-2'],
    ]);
    const ledger = new Ledger(new Simulation(net), readers, worth);
    ledger.runTo(60, clicks);
    while (!ledger.sim.isIdle()) ledger.step();
    // 3 × 8 + 4 + 2 × 64 + 2 × 32 + 8 (the bump into key 8) + 5 × 1 + 2
    expect([binary(ledger.sim), dec(ledger.sim)]).toEqual([235, 235]);
  });
});

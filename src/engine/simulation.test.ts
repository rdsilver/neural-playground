import { describe, expect, it } from 'vitest';
import { NetworkBuilder } from './builder';
import { Simulation, TICKS_PER_CELL, TICKS_PER_SECOND, travelTicks } from './simulation';
import type { ConnectionSpec, NeuronSpec } from './types';

describe('Simulation', () => {
  it('accumulates charge and fires at the threshold, resetting to zero', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 3, { id: 'a' });
    const sim = new Simulation(b.build());
    expect(sim.stimulate(a)).toEqual([]);
    expect(sim.charge(a)).toBe(1);
    sim.stimulate(a);
    const events = sim.stimulate(a);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fire', neuron: 'a', kind: 'normal' });
    expect(sim.charge(a)).toBe(0);
    expect(sim.state(a)!.fireCount).toBe(1);
  });

  it('delivers pulses after a delay proportional to distance', () => {
    const b = new NetworkBuilder();
    const src = b.normal(0, 0, 1, { id: 'src' });
    const near = b.normal(1, 0, 5, { id: 'near' });
    const far = b.normal(0, 3, 5, { id: 'far' });
    b.connect(src, [near, far]);
    const sim = new Simulation(b.build());
    sim.stimulate(src);
    expect(sim.pulses()).toHaveLength(2);

    sim.run(TICKS_PER_CELL - 1);
    expect(sim.charge(near)).toBe(0);
    sim.step();
    expect(sim.charge(near)).toBe(1);
    expect(sim.charge(far)).toBe(0);
    sim.run(2 * TICKS_PER_CELL);
    expect(sim.charge(far)).toBe(1);
    expect(sim.pulses()).toHaveLength(0);
  });

  it('travel time is ceil(distance * ticks per cell), at least one tick', () => {
    expect(travelTicks({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(15);
    expect(travelTicks({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(Math.ceil(Math.SQRT2 * 15));
    expect(travelTicks({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(1);
  });

  it('inhibitors send negative pulses and charge can go negative', () => {
    const b = new NetworkBuilder();
    const inh = b.inhibitor(0, 0, 1, { id: 'inh' });
    const target = b.normal(1, 0, 2, { id: 't' });
    b.connect(inh, target);
    const sim = new Simulation(b.build());
    sim.stimulate(inh);
    sim.run(TICKS_PER_CELL);
    expect(sim.charge(target)).toBe(-1);
  });

  it('digits count in their base and carry into the next digit', () => {
    const b = new NetworkBuilder();
    const ones = b.digit(2, 0, 10, { id: 'ones' });
    const tens = b.digit(1, 0, 10, { id: 'tens' });
    b.connect(ones, tens);
    const sim = new Simulation(b.build());
    for (let i = 0; i < 23; i++) sim.stimulate(ones);
    sim.run(TICKS_PER_CELL);
    expect([sim.charge(tens), sim.charge(ones)]).toEqual([2, 3]);
  });

  it('timers fire on the first tick, then every interval, a limited number of times', () => {
    const b = new NetworkBuilder();
    const t = b.timer(0, 0, { id: 't', interval: 0.5, times: 3 });
    const sim = new Simulation(b.build());
    const fires = sim.run(5 * TICKS_PER_SECOND).filter((e) => e.neuron === t).map((e) => e.tick);
    expect(fires).toEqual([1, 31, 61]);
    expect(sim.isIdle()).toBe(true);
  });

  it('timers ignore incoming charge', () => {
    const b = new NetworkBuilder();
    const t = b.timer(0, 0, { id: 't', interval: 100, times: 0 });
    const sim = new Simulation(b.build());
    expect(sim.stimulate(t)).toEqual([]);
    expect(sim.charge(t)).toBe(0);
  });

  it('random neurons send exactly one pulse, deterministically for a seed', () => {
    const build = () => {
      const b = new NetworkBuilder();
      const r = b.random(0, 0, 1, { id: 'r' });
      for (let i = 0; i < 4; i++) b.connect(r, b.digit(i - 2, 2, 36, { id: `d${i}` }));
      return b.build();
    };
    const counts = (seed: number) => {
      const sim = new Simulation(build(), { seed });
      for (let i = 0; i < 400; i++) {
        sim.stimulate('r');
        expect(sim.pulses().length).toBeLessThanOrEqual(i + 1);
      }
      sim.run(10 * TICKS_PER_CELL);
      return [0, 1, 2, 3].map((i) => sim.state(`d${i}`)!.fireCount * 36 + sim.charge(`d${i}`));
    };
    const a = counts(7);
    expect(a.reduce((x, y) => x + y)).toBe(400);
    expect(a.every((n) => n > 60)).toBe(true);
    expect(counts(7)).toEqual(a);
  });

  it('random neurons with no connections fire harmlessly', () => {
    const b = new NetworkBuilder();
    b.random(0, 0, 1, { id: 'r' });
    const sim = new Simulation(b.build());
    expect(sim.stimulate('r')).toHaveLength(1);
    expect(sim.pulses()).toHaveLength(0);
  });

  it('note neurons report their note when they fire', () => {
    const b = new NetworkBuilder();
    b.note(0, 0, 69, 1, { id: 'a4' });
    const sim = new Simulation(b.build());
    expect(sim.stimulate('a4')[0]).toMatchObject({ kind: 'note', note: 69 });
  });

  it('reset clears charge, pulses and the clock', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 1, { id: 'a' });
    const c = b.normal(5, 0, 9, { id: 'c' });
    b.connect(a, c);
    const sim = new Simulation(b.build());
    sim.stimulate(a);
    sim.stimulate(c);
    sim.run(3);
    sim.reset();
    expect(sim.tick).toBe(0);
    expect(sim.charge(c)).toBe(0);
    expect(sim.pulses()).toHaveLength(0);
    expect(sim.state(a)!.fireCount).toBe(0);
  });

  it('load() keeps state for surviving neurons and drops pulses on removed connections', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 1, { id: 'a' });
    const x = b.normal(4, 0, 9, { id: 'x' });
    const y = b.normal(0, 4, 9, { id: 'y' });
    b.connect(a, [x, y]);
    const net = b.build();
    const sim = new Simulation(net);
    sim.stimulate(x);
    sim.stimulate(a);
    expect(sim.pulses()).toHaveLength(2);
    sim.load({ ...net, neurons: net.neurons.filter((n) => n.id !== 'y'), connections: [{ from: 'a', to: 'x' }] });
    expect(sim.charge(x)).toBe(1);
    expect(sim.pulses().map((p) => p.to)).toEqual(['x']);
  });

  it('ignores self, duplicate and dangling connections', () => {
    const sim = new Simulation({
      version: 2,
      neurons: [
        { id: 'a', kind: 'normal', x: 0, y: 0, threshold: 1 },
        { id: 'b', kind: 'normal', x: 1, y: 0, threshold: 5 },
      ],
      connections: [
        { from: 'a', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'ghost' },
      ],
    });
    sim.stimulate('a');
    expect(sim.pulses()).toHaveLength(1);
  });

  it('a two-neuron loop with threshold 1 sustains itself', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 1, { id: 'a' });
    const c = b.normal(2, 0, 1, { id: 'c' });
    b.both(a, c);
    const sim = new Simulation(b.build());
    sim.stimulate(a);
    sim.runSeconds(10);
    expect(sim.state(a)!.fireCount).toBeGreaterThan(8);
    expect(sim.pulses()).toHaveLength(1);
  });

  it('applies scheduled stimuli on their tick, in order, and clears them on reset', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 2, { id: 'a' });
    const sim = new Simulation(b.build());
    sim.schedule(10, a);
    sim.schedule(5, a);
    sim.run(5);
    expect(sim.charge(a)).toBe(1);
    expect(sim.isIdle()).toBe(false);
    const events = sim.run(5);
    expect(events.map((e) => e.tick)).toEqual([10]);
    sim.schedule(20, a);
    sim.reset();
    expect(sim.pendingStimuli()).toHaveLength(0);
  });

  it('nextEventTick finds the soonest stimulus, arrival or timer fire', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0, 1, { id: 'a' });
    const c = b.normal(2, 0, 5, { id: 'c' });
    b.connect(a, c);
    const t = b.timer(0, 5, { id: 't', interval: 1, times: 1 });
    const sim = new Simulation(b.build());
    expect(sim.nextEventTick()).toBe(1);
    sim.step();
    expect(sim.state(t)!.timerFires).toBe(1);
    expect(sim.nextEventTick()).toBeUndefined();
    sim.stimulate(a);
    expect(sim.nextEventTick()).toBe(1 + 30);
    sim.schedule(10, c);
    expect(sim.nextEventTick()).toBe(10);
  });

  it('load() forgets stimuli scheduled for deleted neurons', () => {
    const b = new NetworkBuilder();
    b.normal(0, 0, 1, { id: 'a' });
    b.normal(1, 0, 1, { id: 'b' });
    const net = b.build();
    const sim = new Simulation(net);
    sim.schedule(5, 'a');
    sim.schedule(6, 'b');
    sim.load({ ...net, neurons: net.neurons.filter((n) => n.id !== 'a') });
    expect(sim.pendingStimuli().map((s) => s.neuron)).toEqual(['b']);
  });

  it('run() copes with more fires in one tick than fit in a function call', () => {
    // 200k neurons on a thin ring around a hub, all exactly 15R ticks away, so
    // every one of them fires on the same tick (a spread push would throw).
    const R = 480_000;
    const neurons: NeuronSpec[] = [{ id: 'hub', kind: 'normal', x: 0, y: 0, threshold: 1 }];
    const connections: ConnectionSpec[] = [];
    const inner = (R - 1 / 15) ** 2;
    for (let x = -R; x <= R && neurons.length <= 200_000; x++) {
      const yMax = Math.floor(Math.sqrt(R * R - x * x));
      for (let y = yMax; y >= 0 && x * x + y * y > inner; y--) {
        for (const cy of y === 0 ? [0] : [y, -y]) {
          const id = `r${neurons.length}`;
          neurons.push({ id, kind: 'normal', x, y: cy, threshold: 1 });
          connections.push({ from: 'hub', to: id });
        }
      }
    }
    const sim = new Simulation({ version: 2, neurons, connections });
    sim.stimulate('hub');
    const events = sim.run(15 * R);
    expect(events.length).toBe(neurons.length - 1);
  });
});


import { describe, expect, it } from 'vitest';
import { NetworkBuilder, TICKS_PER_SECOND } from '../engine';
import { clampSpeed, formatSimTime, formatSpeed, MAX_PULSES, MAX_TICKS_PER_FRAME, nudgeSpeed, Runner } from './runner';

function relay() {
  const b = new NetworkBuilder();
  const t = b.timer(0, 0, { id: 'clock', interval: 1 });
  const a = b.normal(4, 0, 1, { id: 'a' });
  b.connect(t, a);
  return b.build();
}

describe('Runner', () => {
  it('advances in real time at the chosen speed and only while playing', () => {
    const r = new Runner(relay());
    expect(r.advance(1)).toEqual([]);
    r.playing = true;
    r.speed = 2;
    r.advance(0.05);
    r.advance(0.05);
    expect(r.sim.tick).toBe(Math.round(0.1 * TICKS_PER_SECOND * 2));
  });

  it('carries fractional ticks for smooth slow motion', () => {
    const r = new Runner(relay());
    r.playing = true;
    r.speed = 0.25;
    r.advance(1 / 60);
    expect(r.sim.tick).toBe(0);
    expect(r.renderTick).toBeCloseTo(0.25);
    for (let i = 0; i < 3; i++) r.advance(1 / 60);
    expect(r.sim.tick).toBe(1);
  });

  it('caps the work done for a huge frame gap', () => {
    const r = new Runner(relay());
    r.playing = true;
    r.speed = 32;
    r.advance(60);
    expect(r.sim.tick).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
  });

  it('stops early when the frame budget is spent', () => {
    let now = 0;
    const r = new Runner(relay(), () => (now += 4));
    r.playing = true;
    r.speed = 32;
    r.advance(0.1);
    expect(r.sim.tick).toBeLessThan(10);
  });

  it('pauses itself when a runaway network floods the board with pulses', () => {
    // Six threshold-1 relays all wired to each other: every pulse makes five more.
    const b = new NetworkBuilder();
    const ids = Array.from({ length: 6 }, (_, i) => b.normal(i, 0, 1));
    for (const a of ids) for (const c of ids) if (a !== c) b.connect(a, c);
    const r = new Runner(b.build());
    r.sim.stimulate(ids[0]!);
    r.playing = true;
    r.speed = 32;
    for (let i = 0; i < 2000 && r.playing; i++) r.advance(0.1);
    expect(r.playing).toBe(false);
    expect(r.overloaded).toBe(true);
    expect(r.sim.pulses().length).toBeGreaterThan(MAX_PULSES);
    r.reset();
    expect(r.overloaded).toBe(false);
  });

  it('plays demos, shows captions, and restarts them on reset', () => {
    const r = new Runner(relay());
    r.startDemo([
      { at: 0.5, neuron: 'a', caption: 'first' },
      { at: 1.5, neuron: 'a', caption: 'second' },
    ]);
    expect(r.caption).toBeUndefined();
    r.sim.runSeconds(0.6);
    expect(r.caption).toBe('first');
    expect(r.demoProgress).toEqual({ done: 1, total: 2 });
    r.sim.runSeconds(1);
    expect(r.caption).toBe('second');
    expect(r.sim.state('a')!.fireCount).toBeGreaterThanOrEqual(2);
    r.reset();
    expect(r.sim.tick).toBe(0);
    expect(r.caption).toBeUndefined();
    expect(r.sim.pendingStimuli()).toHaveLength(2);
    r.stopDemo();
    expect(r.sim.pendingStimuli()).toHaveLength(0);
    expect(r.demoProgress).toBeNull();
  });

  it('steps to the next fire', () => {
    const r = new Runner(relay());
    const events = r.stepToNextFire();
    expect(events.map((e) => e.neuron)).toEqual(['clock']);
  });
});

describe('speed helpers', () => {
  it('nudges through the speed list and clamps example speeds', () => {
    expect(nudgeSpeed(1, 1)).toBe(2);
    expect(nudgeSpeed(0.25, -1)).toBe(0.25);
    expect(nudgeSpeed(32, 1)).toBe(32);
    expect(nudgeSpeed(3, -1)).toBe(2);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(3)).toBe(3);
    expect(clampSpeed(100)).toBe(32);
    expect(clampSpeed(0.01)).toBe(0.25);
    expect(formatSpeed(0.25)).toBe('¼×');
    expect(formatSpeed(3)).toBe('3×');
  });

  it('formats the simulated clock', () => {
    expect(formatSimTime(0)).toBe('0:00.0');
    expect(formatSimTime(65.33)).toBe('1:05.3');
  });
});

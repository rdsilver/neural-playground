import { describe, expect, it } from 'vitest';
import { digitText, normalizeNetwork, Simulation } from '../engine';
import { EXAMPLES, findExample } from './index';

describe('all examples', () => {
  it('have unique ids and valid, already-normalized networks', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of EXAMPLES) {
      expect(example.id).toMatch(/^[a-z0-9-]+$/);
      expect(normalizeNetwork(example.network), example.id).toEqual(example.network);
      expect(example.network.neurons.length, example.id).toBeGreaterThan(0);
    }
  });

  it('run for a simulated minute without throwing', () => {
    for (const example of EXAMPLES) {
      const sim = new Simulation(example.network);
      expect(() => sim.runSeconds(60), example.id).not.toThrow();
    }
  });
});

describe('classic examples', () => {
  it('count to 1000 ends with 1000 written in bases 2 through 10', () => {
    const { network } = findExample('count-to-1000')!;
    const sim = new Simulation(network);
    sim.runUntilIdle();
    const rows = new Map<number, string>();
    for (const n of [...network.neurons].sort((a, b) => a.x - b.x)) {
      if (n.kind === 'character' && n.threshold <= 10) rows.set(n.threshold, (rows.get(n.threshold) ?? '') + digitText(sim.charge(n.id)));
    }
    for (let base = 2; base <= 10; base++) {
      expect(parseInt(rows.get(base)!, base), `base ${base}: ${rows.get(base)}`).toBe(1000);
    }
  });

  it('count to 1000 writes its own title', () => {
    const { network } = findExample('count-to-1000')!;
    const sim = new Simulation(network);
    sim.runSeconds(30);
    const title = network.neurons
      .filter((n) => n.kind === 'character' && n.threshold === 36 && n.y === 2)
      .sort((a, b) => a.x - b.x)
      .map((n) => digitText(sim.charge(n.id)))
      .join('');
    expect(title).toBe('COUNTTO1000');
  });

  it('stable loops keep firing long after their timers stop', () => {
    const { network } = findExample('stable-loops')!;
    const sim = new Simulation(network);
    sim.runSeconds(120);
    const before = network.neurons.map((n) => sim.state(n.id)!.fireCount);
    sim.runSeconds(30);
    const active = network.neurons.filter((n, i) => n.kind === 'normal' && sim.state(n.id)!.fireCount > before[i]!);
    expect(active.length).toBe(network.neurons.filter((n) => n.kind === 'normal').length);
  });
});

describe('demos', () => {
  it('only poke neurons that exist', () => {
    for (const example of EXAMPLES) {
      const ids = new Set(example.network.neurons.map((n) => n.id));
      for (const step of example.demo ?? []) {
        if (step.neuron !== undefined) expect(ids.has(step.neuron), `${example.id}: ${step.neuron}`).toBe(true);
        else expect(step.caption, `${example.id}: a step needs a neuron or a caption`).toBeTruthy();
      }
    }
  });
});

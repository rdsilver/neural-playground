import { describe, expect, it } from 'vitest';
import { makeNeuron } from './netops';
import { describeNeuron, ordinal, seconds } from './describe';

const neuron = (kind: Parameters<typeof makeNeuron>[0], patch: Record<string, number> = {}) => ({ ...makeNeuron(kind, 'n1', 0, 0), ...patch });

describe('describeNeuron', () => {
  it('spells out ordinals and durations', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 102, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '102nd', '111th']);
    expect(seconds(0.5)).toBe('0.5 s');
    expect(seconds(1)).toBe('1 s');
    expect(seconds(1 / 3)).toBe('0.33 s');
  });

  it('describes threshold neurons by when they fire', () => {
    expect(describeNeuron(neuron('normal', { threshold: 2 }))).toBe('Fires on its 2nd charge, then resets to zero.');
    expect(describeNeuron(neuron('normal', { threshold: 1 }))).toBe('Fires on every pulse it receives and passes it straight on: a relay.');
    expect(describeNeuron(neuron('negative', { threshold: 1 }))).toBe('Fires on every pulse it receives. Each fire removes 1 charge from its targets.');
    expect(describeNeuron(neuron('random', { threshold: 3 }))).toContain('3rd charge');
  });

  it('describes digits as counters that carry', () => {
    expect(describeNeuron(neuron('character', { threshold: 10 }))).toBe('Counts 0–9, then rolls over to 0 and sends a carry pulse.');
    expect(describeNeuron(neuron('character', { threshold: 16 }))).toBe('Counts 0–F, then rolls over to 0 and sends a carry pulse.');
    expect(describeNeuron(neuron('character', { threshold: 1 }))).toBe('Shows 0 and passes every pulse straight on.');
  });

  it('describes timers by their schedule', () => {
    expect(describeNeuron(neuron('timer', { interval: 0.5, times: 10 }))).toBe('Fires every 0.5 s, 10 times.');
    expect(describeNeuron(neuron('timer', { interval: 1, times: -1 }))).toBe('Fires every 1 s, forever. Pulses and pokes do not change it.');
    expect(describeNeuron(neuron('timer', { times: 1 }))).toBe('Fires once, as soon as the network starts.');
    expect(describeNeuron(neuron('timer', { times: 0 }))).toBe('Never fires (set to 0 times).');
  });

  it('describes notes by the note they play', () => {
    expect(describeNeuron(neuron('note', { note: 69 }))).toBe('Plays A4 every time it fires, on every pulse it receives.');
    expect(describeNeuron(neuron('note', { note: 60, threshold: 2 }))).toBe('Plays C4 every time it fires: on its 2nd charge.');
  });
});

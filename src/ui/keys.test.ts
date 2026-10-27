import { describe, expect, it } from 'vitest';
import { boundNeuron, keyGroups, keyHint, keyName } from './keys';

const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('boundNeuron', () => {
  const keys = { ArrowLeft: 'left', a: 'left', ArrowUp: 'up', ' ': 'fire', R: 'restart' };
  const all = () => true;

  it('finds the neuron a key pokes', () => {
    expect(boundNeuron(keys, press('ArrowLeft'), all)).toBe('left');
    expect(boundNeuron(keys, press('a'), all)).toBe('left');
    expect(boundNeuron(keys, press(' '), all)).toBe('fire');
  });

  it('matches KeyboardEvent.key exactly (case-sensitive)', () => {
    expect(boundNeuron(keys, press('A'), all)).toBeNull();
    expect(boundNeuron(keys, press('R'), all)).toBe('restart');
    expect(boundNeuron(keys, press('r'), all)).toBeNull();
  });

  it('leaves modified presses and unbound keys to the shortcuts', () => {
    expect(boundNeuron(keys, press('a', { ctrlKey: true }), all)).toBeNull();
    expect(boundNeuron(keys, press('a', { metaKey: true }), all)).toBeNull();
    expect(boundNeuron(keys, press('ArrowLeft', { altKey: true }), all)).toBeNull();
    expect(boundNeuron(keys, press('ArrowDown'), all)).toBeNull();
    expect(boundNeuron(undefined, press('ArrowLeft'), all)).toBeNull();
  });

  it('ignores bindings to neurons that are gone, and inherited properties', () => {
    expect(boundNeuron(keys, press('ArrowUp'), (id) => id !== 'up')).toBeNull();
    expect(boundNeuron(keys, press('toString'), all)).toBeNull();
    expect(boundNeuron(keys, press('constructor'), all)).toBeNull();
  });
});

describe('showing key bindings', () => {
  it('names keys the way they look on a keyboard', () => {
    expect(keyName('ArrowLeft')).toBe('←');
    expect(keyName(' ')).toBe('Space');
    expect(keyName('w')).toBe('W');
    expect(keyName('W')).toBe('⇧W');
    expect(keyName('W', true)).toBe('W');
    expect(keyName('7')).toBe('7');
    expect(keyName('F2')).toBe('F2');
  });

  const snake = { ArrowLeft: 'kl', ArrowUp: 'ku', ArrowDown: 'kd', ArrowRight: 'kr', a: 'kl', w: 'ku', s: 'kd', d: 'kr', A: 'kl' };
  const labels: Record<string, string> = { kl: '◀', ku: '▲', kd: '▼', kr: '▶' };

  it('groups the keys that poke the same neuron, under its label', () => {
    expect(keyGroups(snake, (id) => labels[id])).toEqual([
      { neuron: 'kl', label: '◀', keys: ['←', 'A'] },
      { neuron: 'ku', label: '▲', keys: ['↑', 'W'] },
      { neuron: 'kd', label: '▼', keys: ['↓', 'S'] },
      { neuron: 'kr', label: '▶', keys: ['→', 'D'] },
    ]);
    // Unlabelled neurons go by their id.
    expect(keyGroups({ x: 'go' }, () => undefined)).toEqual([{ neuron: 'go', label: 'go', keys: ['X'] }]);
    expect(keyGroups(undefined, () => undefined)).toEqual([]);
  });

  it('sums the bindings up in one line for the hint', () => {
    expect(keyHint(keyGroups(snake, (id) => labels[id]))).toBe('← ↑ ↓ → / A W S D');
    expect(keyHint(keyGroups({ ' ': 'fire' }, () => undefined))).toBe('Space');
    expect(keyHint(keyGroups({ ' ': 'fire', Enter: 'fire', x: 'other' }, () => undefined))).toBe('Space X / Enter');
    expect(keyHint([])).toBe('');
  });
});

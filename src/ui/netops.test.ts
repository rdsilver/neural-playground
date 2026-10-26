import { describe, expect, it } from 'vitest';
import { emptyNetwork, NetworkBuilder, normalizeNetwork } from '../engine';
import {
  addNeuron,
  addText,
  canMove,
  connect,
  copyItems,
  deleteItems,
  indexNetwork,
  moveItems,
  nextId,
  pasteClip,
  reverseConnection,
  setTwoWay,
  updateNeuron,
  updateText,
} from './netops';

function sample() {
  const b = new NetworkBuilder();
  const a = b.normal(0, 0, 2, { id: 'a' });
  const c = b.digit(2, 0, 10, { id: 'c' });
  const t = b.timer(0, 2, { id: 't', interval: 0.5 });
  b.connect(t, a).connect(a, c);
  b.text(0, -1, 'hello', { id: 'x' });
  return b.build();
}

describe('netops', () => {
  it('assigns fresh ids', () => {
    expect(nextId(['n1', 'n7', 'x3'], 'n')).toBe('n8');
    expect(nextId([], 't')).toBe('t1');
  });

  it('places neurons with kind defaults, one per cell', () => {
    const r = addNeuron(emptyNetwork(), 'timer', 3, 4)!;
    expect(r.net.neurons[0]).toEqual({ id: 'n1', kind: 'timer', x: 3, y: 4, threshold: 1, interval: 1, times: -1 });
    expect(addNeuron(r.net, 'normal', 3, 4)).toBeNull();
  });

  it('changes kind, keeping shared params and adding defaults', () => {
    const net = updateNeuron(sample(), 'a', { kind: 'note', label: '  key ' });
    const a = net.neurons.find((n) => n.id === 'a')!;
    expect(a).toEqual({ id: 'a', kind: 'note', x: 0, y: 0, threshold: 2, label: 'key', note: 60 });
    const back = updateNeuron(net, 'a', { kind: 'normal', label: '' });
    expect(back.neurons.find((n) => n.id === 'a')).toEqual({ id: 'a', kind: 'normal', x: 0, y: 0, threshold: 2 });
    // The result is always a normalized network.
    expect(normalizeNetwork(net)).toEqual(net);
  });

  it('clamps parameters', () => {
    let net = updateNeuron(sample(), 'a', { threshold: 0 });
    expect(net.neurons.find((n) => n.id === 'a')!.threshold).toBe(1);
    net = updateNeuron(net, 't', { times: -5, interval: 2 });
    expect(net.neurons.find((n) => n.id === 't')).toMatchObject({ times: -1, interval: 2 });
  });

  it('deletes neurons with their connections', () => {
    const net = deleteItems(sample(), { neurons: ['a'], texts: ['x'] });
    expect(net.neurons.map((n) => n.id)).toEqual(['c', 't']);
    expect(net.connections).toEqual([]);
    expect(net.texts).toEqual([]);
    const conn = deleteItems(sample(), { connections: [{ from: 'a', to: 'c' }] });
    expect(conn.connections).toEqual([{ from: 't', to: 'a' }]);
  });

  it('moves neurons only onto free cells (moving ones may swap places)', () => {
    const net = sample();
    expect(moveItems(net, ['a'], [], 2, 0)).toBeNull();
    expect(canMove(net, ['a', 'c'], 2, 0)).toBe(true);
    const moved = moveItems(net, ['a'], ['x'], 1, 1)!;
    expect(moved.neurons.find((n) => n.id === 'a')).toMatchObject({ x: 1, y: 1 });
    expect(moved.texts![0]).toMatchObject({ x: 1, y: 0 });
    expect(net.neurons.find((n) => n.id === 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('connects, makes two-way and reverses', () => {
    let net = connect(sample(), 'c', 'a');
    expect(indexNetwork(net).pairs.has('c>a')).toBe(true);
    net = setTwoWay(net, 'c', 'a', false);
    expect(indexNetwork(net).pairs.has('a>c')).toBe(false);
    expect(connect(net, 'a', 'a')).toBe(net);
    net = reverseConnection(net, 'c', 'a');
    expect(net.connections).toContainEqual({ from: 'a', to: 'c' });
  });

  it('adds and edits texts', () => {
    const { net, id } = addText(sample(), 1.5, 2.5, 'note');
    expect(id).toBe('t1');
    const edited = updateText(net, id, { size: 99, tone: 'accent' });
    expect(edited.texts!.find((t) => t.id === id)).toMatchObject({ size: 4, tone: 'accent', text: 'note' });
  });

  it('copies and pastes with new ids, avoiding occupied cells', () => {
    const net = sample();
    const clip = copyItems(net, ['a', 'c'], ['x'])!;
    expect(clip.connections).toEqual([{ from: 'a', to: 'c' }]);
    const pasted = pasteClip(net, clip, 0, 0);
    expect(pasted.neurons).toHaveLength(2);
    const idx = indexNetwork(pasted.net);
    expect(idx.byId.size).toBe(5);
    expect(idx.byCell.size).toBe(5);
    expect(pasted.net.connections).toHaveLength(3);
    expect(normalizeNetwork(pasted.net)).toEqual(pasted.net);
  });
});

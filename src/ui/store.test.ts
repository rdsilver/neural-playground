import { describe, expect, it } from 'vitest';
import { emptyNetwork, NetworkBuilder } from '../engine';
import { addNeuron, deleteItems } from './netops';
import { Store } from './store';

function sample() {
  const b = new NetworkBuilder();
  b.normal(0, 0, 1, { id: 'a' });
  b.normal(2, 0, 1, { id: 'b' });
  b.connect('a', 'b');
  return b.build();
}

describe('Store', () => {
  it('commits edits as undo steps and reports document swaps', () => {
    const store = new Store(sample(), { title: 'Sample' });
    const changes: boolean[] = [];
    store.on('network', (c) => changes.push(c.docChanged));
    store.commit(addNeuron(store.network, 'timer', 5, 5)!.net, 'Add timer');
    expect(store.network.neurons).toHaveLength(3);
    store.replace(emptyNetwork(), { title: 'Empty' }, 'Clear canvas');
    expect(store.doc.title).toBe('Empty');
    expect(store.undo()).toBe('Clear canvas');
    expect(store.doc.title).toBe('Sample');
    expect(store.network.neurons).toHaveLength(3);
    expect(store.undo()).toBe('Add timer');
    expect(store.network.neurons).toHaveLength(2);
    expect(store.redo()).toBe('Add timer');
    expect(changes).toEqual([false, true, true, false, false]);
  });

  it('drops selected items that an edit removes', () => {
    const store = new Store(sample(), { title: 'Sample' });
    store.select({ neurons: new Set(['a', 'b']), texts: new Set(), connection: null });
    store.commit(deleteItems(store.network, { neurons: ['a'] }), 'Delete');
    expect([...store.selection.neurons]).toEqual(['b']);
    store.selectConnection({ from: 'a', to: 'b' });
    store.undo();
    expect(store.selection.connection).toEqual({ from: 'a', to: 'b' });
    store.redo();
    expect(store.selection.connection).toBeNull();
  });

  it('picking a kind switches to the place tool', () => {
    const store = new Store(sample(), { title: 'Sample' });
    const tools: string[] = [];
    store.on('tool', (t) => tools.push(t));
    store.setKind('note');
    store.setTool('select');
    expect(tools).toEqual(['place', 'select']);
    expect(store.kind).toBe('note');
  });

  it('exposes the single selected neuron', () => {
    const store = new Store(sample(), { title: 'Sample' });
    store.selectOnly('neuron', 'a');
    expect(store.selectedNeuron?.id).toBe('a');
    store.toggleSelected('neuron', 'b');
    expect(store.selectedNeuron).toBeUndefined();
  });

  it('marks selections made in passing as quiet, and keeps that through edits', () => {
    const store = new Store(sample(), { title: 'Sample' });
    const seen: boolean[] = [];
    store.on('selection', () => seen.push(store.selectionQuiet));
    store.selectOnly('neuron', 'a', true);
    store.selectOnly('neuron', 'a');
    store.select({ neurons: new Set(['a', 'b']), texts: new Set(), connection: null }, true);
    store.commit(deleteItems(store.network, { neurons: ['a'] }), 'Delete');
    expect(seen).toEqual([true, false, true, true]);
    expect([...store.selection.neurons]).toEqual(['b']);
  });
});

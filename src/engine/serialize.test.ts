import { describe, expect, it } from 'vitest';
import { NetworkBuilder } from './builder';
import { fromLegacy } from './legacy';
import { decodeShareCode, encodeShareCode, networkFromJson, networkToJson, NetworkFormatError, normalizeNetwork } from './serialize';

function sample() {
  const b = new NetworkBuilder();
  const t = b.timer(0, 0, { interval: 0.25, times: 10, label: 'go' });
  const d = b.digit(3, 0, 10);
  const n = b.note(3, 2, 64);
  b.connect(t, [d, n]).text(0, 2, 'hello', { tone: 'accent' });
  return b.build();
}

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const net = sample();
    expect(networkFromJson(networkToJson(net))).toEqual(normalizeNetwork(net));
    expect(normalizeNetwork(net)).toEqual(net);
  });

  it('round-trips through a share code', async () => {
    const net = sample();
    const code = await encodeShareCode(net);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShareCode(code)).toEqual(net);
  });

  it('rejects garbage', async () => {
    expect(() => networkFromJson('{nope')).toThrow(NetworkFormatError);
    expect(() => normalizeNetwork({ hello: 1 })).toThrow(NetworkFormatError);
    await expect(decodeShareCode('!!!not-a-code')).rejects.toThrow(NetworkFormatError);
  });

  it('cleans up invalid content', () => {
    const net = normalizeNetwork({
      neurons: [
        { id: 'a', kind: 'normal', x: 0.4, y: 0, threshold: -3 },
        { id: 'b', kind: 'normal', x: 0, y: 0, threshold: 2 }, // same cell as a
        { id: 'a', kind: 'normal', x: 5, y: 5, threshold: 2 }, // duplicate id
        { id: 'c', kind: 'wizard', x: 1, y: 1, threshold: 2 },
        { id: 'd', kind: 'note', x: 2, y: 2, threshold: 1, note: 999, label: '' },
        { id: 'e', kind: 'timer', x: 3, y: 3, threshold: 1, interval: -1 },
      ],
      connections: [{ from: 'a', to: 'd' }, { from: 'a', to: 'b' }, { from: 'd', to: 'd' }, 'junk'],
      texts: [{ x: 1, y: 1, text: 'hi', size: 99 }],
    });
    expect(net.neurons.map((n) => n.id)).toEqual(['a', 'd', 'e']);
    expect(net.neurons[0]).toMatchObject({ x: 0, threshold: 1 });
    expect(net.neurons[1]).toMatchObject({ note: 127 });
    expect(net.neurons[1]!.label).toBeUndefined();
    expect(net.neurons[2]).toMatchObject({ interval: 1, times: -1 });
    expect(net.connections).toEqual([{ from: 'a', to: 'd' }]);
    expect(net.texts).toEqual([{ id: 't1', x: 1, y: 1, text: 'hi', size: 4 }]);
  });

  it('imports networks saved by the 2016 version', () => {
    const legacy = [
      { type: 'TimerNeuron', x: 60, y: 30, size: 30, activationLevel: 2, outBounds: ['120 30'], inBounds: [], timeInSeconds: 0.25, maxSteps: 4 },
      { type: 'CharacterNeuron', x: 120, y: 30, size: 30, activationLevel: 36, outBounds: [], inBounds: ['60 30'] },
      { type: 'NoteNeuron', x: 0, y: 0, size: 30, activationLevel: 1, outBounds: ['60 30'], inBounds: [], note: 57 },
    ];
    const net = normalizeNetwork(legacy);
    expect(net.neurons).toEqual([
      { id: 'n1', kind: 'timer', x: 2, y: 1, threshold: 2, interval: 0.25, times: 4 },
      { id: 'n2', kind: 'character', x: 4, y: 1, threshold: 36 },
      { id: 'n3', kind: 'note', x: 0, y: 0, threshold: 1, note: 57 },
    ]);
    expect(net.connections).toEqual([{ from: 'n1', to: 'n2' }, { from: 'n3', to: 'n1' }]);
    expect(fromLegacy(legacy as never).neurons).toHaveLength(3);
  });
});

describe('NetworkBuilder', () => {
  it('refuses two neurons in one cell and self connections', () => {
    const b = new NetworkBuilder();
    const a = b.normal(0, 0);
    expect(() => b.normal(0, 0)).toThrow(/already holds/);
    expect(() => b.connect(a, a)).toThrow(/itself/);
    expect(() => b.normal(0.5, 1)).toThrow(/integers/);
  });
});

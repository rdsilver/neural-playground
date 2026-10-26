import type { Network, NeuronKind, NeuronSpec } from './types';

/** A neuron as saved by the 2016 p5.js version (pixel coordinates). */
export interface LegacyNeuron {
  type: 'Neuron' | 'CharacterNeuron' | 'NegativeNeuron' | 'RandomNeuron' | 'TimerNeuron' | 'NoteNeuron';
  x: number;
  y: number;
  size: number;
  activationLevel: number;
  outBounds: string[];
  inBounds: string[];
  timeInSeconds?: number;
  maxSteps?: number;
  note?: number;
}

const LEGACY_KINDS: Record<LegacyNeuron['type'], NeuronKind> = {
  Neuron: 'normal',
  CharacterNeuron: 'character',
  NegativeNeuron: 'negative',
  RandomNeuron: 'random',
  TimerNeuron: 'timer',
  NoteNeuron: 'note',
};

export function isLegacyNetwork(input: unknown): input is LegacyNeuron[] {
  return (
    Array.isArray(input) &&
    input.every((n) => typeof n === 'object' && n !== null && typeof n.type === 'string' && n.type in LEGACY_KINDS && Array.isArray(n.outBounds))
  );
}

/**
 * Convert a legacy network. Neurons were keyed by their pixel position
 * ("x y") and stored redundant in/out connection lists; only outBounds
 * ever carried pulses, so that is what becomes a connection.
 */
export function fromLegacy(legacy: LegacyNeuron[]): Network {
  const idByKey = new Map<string, string>();
  const neurons: NeuronSpec[] = legacy.map((n, i) => {
    const size = n.size > 0 ? n.size : 30;
    const id = `n${i + 1}`;
    idByKey.set(`${n.x} ${n.y}`, id);
    const kind = LEGACY_KINDS[n.type];
    const spec: NeuronSpec = { id, kind, x: Math.round(n.x / size), y: Math.round(n.y / size), threshold: n.activationLevel };
    if (kind === 'timer') {
      spec.interval = n.timeInSeconds ?? 1;
      spec.times = n.maxSteps === undefined || Number.isNaN(n.maxSteps) || n.maxSteps < 0 ? -1 : n.maxSteps;
    }
    if (kind === 'note') spec.note = n.note ?? 60;
    return spec;
  });

  const connections = legacy.flatMap((n) =>
    n.outBounds
      .map((key) => idByKey.get(key))
      .filter((to): to is string => to !== undefined)
      .map((to) => ({ from: idByKey.get(`${n.x} ${n.y}`)!, to })),
  );

  return { version: 2, neurons, connections, texts: [] };
}

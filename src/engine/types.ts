// Serializable description of a neural network. Everything in here is plain
// JSON so it can be saved, shared in a URL, or written by hand in an example.

export const NEURON_KINDS = ['normal', 'character', 'negative', 'random', 'timer', 'note'] as const;
export type NeuronKind = (typeof NEURON_KINDS)[number];

export interface NeuronSpec {
  /** Stable identifier, unique within a network. */
  id: string;
  kind: NeuronKind;
  /** Integer grid cell coordinates. At most one neuron per cell. */
  x: number;
  y: number;
  /** Charge needed to fire (the "activation level"). Ignored by timers. */
  threshold: number;
  /** Optional short text drawn on the neuron (e.g. a calculator key "7"). */
  label?: string;
  /** Timer: seconds between fires. */
  interval?: number;
  /** Timer: how many times to fire. -1 (or omitted) fires forever. */
  times?: number;
  /** Note: MIDI note number played when the neuron fires. */
  note?: number;
}

/** A directed connection (axon) from one neuron to another. */
export interface ConnectionSpec {
  from: string;
  to: string;
}

/** Free-floating text drawn on the canvas, used to explain a circuit. */
export interface TextSpec {
  id: string;
  /** Cell coordinates of the text's top-left corner. Fractions allowed. */
  x: number;
  y: number;
  text: string;
  /** Font size in cells (default 0.6). */
  size?: number;
  /** Horizontal alignment relative to x (default 'left'). */
  align?: 'left' | 'center' | 'right';
  /** Optional color hint: a named tone the renderer maps to its palette. */
  tone?: 'default' | 'muted' | 'accent' | 'warning';
}

export interface Network {
  version: 2;
  neurons: NeuronSpec[];
  connections: ConnectionSpec[];
  texts?: TextSpec[];
}

export function emptyNetwork(): Network {
  return { version: 2, neurons: [], connections: [], texts: [] };
}

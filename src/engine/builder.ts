import { KIND_INFO } from './kinds';
import type { ConnectionSpec, Network, NeuronKind, NeuronSpec, TextSpec } from './types';

type NeuronOptions = Partial<Omit<NeuronSpec, 'kind' | 'x' | 'y'>>;
type TextOptions = Partial<Omit<TextSpec, 'x' | 'y' | 'text'>>;

/**
 * Small DSL for writing networks in code (used by the built-in examples).
 * Methods that create neurons return the new neuron's id.
 *
 *   const b = new NetworkBuilder();
 *   const clock = b.timer(0, 0, { interval: 0.5 });
 *   const ones = b.digit(4, 0, 10, { id: 'ones' });
 *   b.connect(clock, ones);
 *   const network = b.build();
 */
export class NetworkBuilder {
  private neurons: NeuronSpec[] = [];
  private connections: ConnectionSpec[] = [];
  private texts: TextSpec[] = [];
  private cells = new Map<string, string>();
  private counter = 0;

  neuron(kind: NeuronKind, x: number, y: number, options: NeuronOptions = {}): string {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`Neuron cells must be integers, got (${x}, ${y}).`);
    const cell = `${x},${y}`;
    if (this.cells.has(cell)) throw new Error(`Cell (${x}, ${y}) already holds neuron "${this.cells.get(cell)}".`);
    const id = options.id ?? `n${++this.counter}`;
    if (this.neurons.some((n) => n.id === id)) throw new Error(`Duplicate neuron id "${id}".`);
    this.cells.set(cell, id);
    this.neurons.push({ ...KIND_INFO[kind].defaults, ...options, id, kind, x, y });
    return id;
  }

  /** A plain neuron. Threshold 1 makes a relay that fires on every pulse. */
  normal(x: number, y: number, threshold = 1, options: NeuronOptions = {}): string {
    return this.neuron('normal', x, y, { ...options, threshold });
  }

  /** A Digit neuron that counts in the given base (its threshold). */
  digit(x: number, y: number, base = 10, options: NeuronOptions = {}): string {
    return this.neuron('character', x, y, { ...options, threshold: base });
  }

  inhibitor(x: number, y: number, threshold = 1, options: NeuronOptions = {}): string {
    return this.neuron('negative', x, y, { ...options, threshold });
  }

  random(x: number, y: number, threshold = 1, options: NeuronOptions = {}): string {
    return this.neuron('random', x, y, { ...options, threshold });
  }

  /** A timer firing every `interval` seconds, `times` times (-1 = forever). */
  timer(x: number, y: number, { interval = 1, times = -1, ...options }: NeuronOptions = {}): string {
    return this.neuron('timer', x, y, { ...options, interval, times });
  }

  note(x: number, y: number, midi: number, threshold = 1, options: NeuronOptions = {}): string {
    return this.neuron('note', x, y, { ...options, note: midi, threshold });
  }

  /** Connect `from` to one or more targets. */
  connect(from: string, to: string | string[]): this {
    for (const target of Array.isArray(to) ? to : [to]) {
      if (from === target) throw new Error(`Cannot connect neuron "${from}" to itself.`);
      if (!this.has(from) || !this.has(target)) throw new Error(`Unknown neuron in connection ${from} -> ${target}.`);
      if (!this.connections.some((c) => c.from === from && c.to === target)) this.connections.push({ from, to: target });
    }
    return this;
  }

  /** Connect two neurons in both directions. */
  both(a: string, b: string): this {
    return this.connect(a, b).connect(b, a);
  }

  /** Connect each neuron to the next: a -> b -> c. */
  chain(ids: string[]): this {
    for (let i = 0; i + 1 < ids.length; i++) this.connect(ids[i]!, ids[i + 1]!);
    return this;
  }

  text(x: number, y: number, text: string, options: TextOptions = {}): this {
    this.texts.push({ id: options.id ?? `t${this.texts.length + 1}`, ...options, x, y, text });
    return this;
  }

  has(id: string): boolean {
    return this.neurons.some((n) => n.id === id);
  }

  build(): Network {
    return {
      version: 2,
      neurons: this.neurons.map((n) => ({ ...n })),
      connections: this.connections.map((c) => ({ ...c })),
      texts: this.texts.map((t) => ({ ...t })),
    };
  }
}

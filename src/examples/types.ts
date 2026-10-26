import type { Network } from '../engine';

export const EXAMPLE_CATEGORIES = ['Start here', 'Calculators', 'Computers', 'Counting', 'Music', 'Patterns', 'Classics'] as const;
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

/** One step of an example's demo: poke a neuron and/or change the caption. */
export interface DemoStep {
  /** Seconds after the example starts running. */
  at: number;
  /** Neuron to stimulate (+1 charge, like a click). Omit for a caption-only step. */
  neuron?: string;
  /** Optional caption to show while the demo plays, e.g. "47 + 85". */
  caption?: string;
}

export interface Example {
  /** URL-safe slug, unique across examples (used in links: #example=<id>). */
  id: string;
  title: string;
  category: ExampleCategory;
  /** One line for the gallery card. */
  summary: string;
  /** A short explanation. Blank lines separate paragraphs. Plain text. */
  description: string;
  /** Things to try, shown as a list next to the running example. */
  tryThis?: string[];
  network: Network;
  /** Start running as soon as the example loads (default true). */
  autoplay?: boolean;
  /** Suggested simulation speed multiplier (default 1). */
  speed?: number;
  /**
   * Optional keyboard controls while the example runs: KeyboardEvent.key
   * (e.g. 'ArrowLeft', 'a', ' ') to the id of the neuron that key pokes.
   */
  keys?: Record<string, string>;
  /**
   * Optional scripted demo, played when the example loads (and on replay).
   * Schedule it with scheduleDemo() so the app and tests agree on timing.
   */
  demo?: DemoStep[];
}

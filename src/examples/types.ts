import type { Network } from '../engine';

export const EXAMPLE_CATEGORIES = ['Start here', 'Calculators', 'Counting', 'Music', 'Patterns', 'Classics'] as const;
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

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
}

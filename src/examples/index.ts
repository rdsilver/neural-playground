import { ARITHMETIC_EXAMPLES } from './arithmetic';
import { CLASSIC_EXAMPLES } from './classics';
import { EXAMPLE_CATEGORIES, type Example } from './types';

export * from './types';
export * from './demo';

/** Every built-in example, in gallery order. */
export const EXAMPLES: Example[] = [...ARITHMETIC_EXAMPLES, ...CLASSIC_EXAMPLES].sort(
  (a, b) => EXAMPLE_CATEGORIES.indexOf(a.category) - EXAMPLE_CATEGORIES.indexOf(b.category),
);

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

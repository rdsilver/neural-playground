// Keyboard controls of an example (Example.keys: KeyboardEvent.key -> the
// neuron that key pokes), and how to show them: grouped by neuron in the
// notes card ("← A ◀"), as one line in the running hint ("← ↑ ↓ → /
// W A S D"). Pure, so the lookup and the wording are tested.

export type KeyMap = Readonly<Record<string, string>>;

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * The neuron a key press pokes, or null. Keys match KeyboardEvent.key
 * exactly (case-sensitive: 'a' is not 'A'); presses with Ctrl, ⌘ or Alt are
 * shortcuts, never bindings; a binding to a neuron the network no longer has
 * (the example was edited) does nothing.
 */
export function boundNeuron(keys: KeyMap | undefined, e: KeyLike, exists: (id: string) => boolean): string | null {
  if (!keys || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (!Object.prototype.hasOwnProperty.call(keys, e.key)) return null;
  const id = keys[e.key];
  return id && exists(id) ? id : null;
}

const NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: '⌫',
  Tab: 'Tab',
};

/**
 * How to show one bound key: arrows as arrows, letters in capitals. A
 * capital letter bound on its own (without its lower case) needs Shift.
 */
export function keyName(key: string, lowerAlsoBound = false): string {
  const named = NAMES[key];
  if (named) return named;
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const isCapital = key !== key.toLowerCase() && key === upper;
    return isCapital && !lowerAlsoBound ? `⇧${upper}` : upper;
  }
  return key;
}

export interface KeyGroup {
  /** The neuron these keys poke. */
  neuron: string;
  /** What the neuron is called on the board: its label, else its id. */
  label: string;
  /** Display names of the keys, in binding order, without repeats. */
  keys: string[];
}

/** Bindings grouped by the neuron they poke, in order of first appearance. */
export function keyGroups(keys: KeyMap | undefined, labelOf: (id: string) => string | undefined): KeyGroup[] {
  if (!keys) return [];
  const groups = new Map<string, KeyGroup>();
  for (const [key, neuron] of Object.entries(keys)) {
    let g = groups.get(neuron);
    if (!g) groups.set(neuron, (g = { neuron, label: labelOf(neuron) ?? neuron, keys: [] }));
    const lowerAlsoBound = keys[key.toLowerCase()] === neuron;
    const name = keyName(key, lowerAlsoBound);
    if (!g.keys.includes(name)) g.keys.push(name);
  }
  return [...groups.values()];
}

/**
 * One line for the hint: each group's first key in order, then its second
 * keys as an alternative, and so on ("← ↑ ↓ → / W A S D").
 */
export function keyHint(groups: readonly KeyGroup[]): string {
  const rows: string[] = [];
  const depth = Math.max(0, ...groups.map((g) => g.keys.length));
  for (let i = 0; i < depth; i++) {
    const row = groups.flatMap((g) => (g.keys[i] ? [g.keys[i]!] : []));
    if (row.length) rows.push(row.join(' '));
  }
  return rows.join(' / ');
}

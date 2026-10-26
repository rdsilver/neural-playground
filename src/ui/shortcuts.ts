// Keyboard shortcut specs like "mod+shift+z": parsed once, matched against
// KeyboardEvents, and formatted for tooltips, the help sheet and the
// command palette ("mod" is ⌘ on Apple platforms and Ctrl elsewhere).

export interface KeyBinding {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseKeys(spec: string): KeyBinding {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop()!;
  return { key: key === 'plus' ? '+' : key, mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') };
}

/** Keys whose shifted form is a different character, so Shift is implied by the key itself. */
const SHIFTED = new Set(['?', '+', '!', '{', '}', '<', '>', ':', '"', '|', '_']);

export function matches(binding: KeyBinding, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (key !== binding.key) return false;
  if ((e.ctrlKey || e.metaKey) !== binding.mod) return false;
  if (e.altKey !== binding.alt) return false;
  if (!SHIFTED.has(binding.key) && e.shiftKey !== binding.shift) return false;
  return true;
}

const NAMES: Record<string, string> = {
  space: 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  enter: 'Enter',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
};

/** Display tokens for one shortcut, e.g. ["⌘", "⇧", "Z"] or ["Ctrl", "Shift", "Z"]. */
export function formatKeys(spec: string, mac: boolean): string[] {
  const b = parseKeys(spec);
  const out: string[] = [];
  if (b.mod) out.push(mac ? '⌘' : 'Ctrl');
  if (b.alt) out.push(mac ? '⌥' : 'Alt');
  if (b.shift) out.push(mac ? '⇧' : 'Shift');
  out.push(NAMES[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key[0]!.toUpperCase() + b.key.slice(1)));
  return out;
}

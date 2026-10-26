import { describe, expect, it } from 'vitest';
import { formatKeys, matches, parseKeys } from './shortcuts';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('shortcuts', () => {
  it('parses specs', () => {
    expect(parseKeys('mod+shift+z')).toEqual({ key: 'z', mod: true, shift: true, alt: false });
    expect(parseKeys('plus')).toEqual({ key: '+', mod: false, shift: false, alt: false });
  });

  it('matches events, treating Ctrl and Cmd alike', () => {
    expect(matches(parseKeys('mod+z'), key('z', { ctrlKey: true }))).toBe(true);
    expect(matches(parseKeys('mod+z'), key('z', { metaKey: true }))).toBe(true);
    expect(matches(parseKeys('mod+z'), key('Z', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(matches(parseKeys('mod+shift+z'), key('Z', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(matches(parseKeys('space'), key(' '))).toBe(true);
    expect(matches(parseKeys('v'), key('v', { ctrlKey: true }))).toBe(false);
    // "?" needs Shift on most layouts; the binding should not care.
    expect(matches(parseKeys('?'), key('?', { shiftKey: true }))).toBe(true);
    expect(matches(parseKeys('>'), key('>', { shiftKey: true }))).toBe(true);
    expect(matches(parseKeys('.'), key('>', { shiftKey: true }))).toBe(false);
  });

  it('formats for each platform', () => {
    expect(formatKeys('mod+shift+z', true)).toEqual(['⌘', '⇧', 'Z']);
    expect(formatKeys('mod+shift+z', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(formatKeys('space', true)).toEqual(['Space']);
    expect(formatKeys('arrowleft', false)).toEqual(['←']);
  });
});

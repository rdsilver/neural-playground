import { describe, expect, it } from 'vitest';
import { noteName } from '../engine';
import { parseNote } from './music';

describe('parseNote', () => {
  it('reads note names with sharps and flats', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('a4')).toBe(69);
    expect(parseNote('F#3')).toBe(54);
    expect(parseNote('C♯5')).toBe(73);
    expect(parseNote('Bb2')).toBe(46);
    expect(parseNote(' 64 ')).toBe(64);
  });

  it('round-trips with the engine note names', () => {
    for (let midi = 0; midi <= 127; midi++) expect(parseNote(noteName(midi))).toBe(midi);
  });

  it('rejects junk and out-of-range notes', () => {
    expect(parseNote('H2')).toBeNull();
    expect(parseNote('200')).toBeNull();
    expect(parseNote('G9')).toBe(127);
    expect(parseNote('G#9')).toBeNull();
    expect(parseNote('')).toBeNull();
  });
});

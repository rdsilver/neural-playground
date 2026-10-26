import { describe, expect, it } from 'vitest';
import { noteName } from '../engine';
import { MAX_NOTES_PER_FRAME, parseNote, scheduleNotes } from './music';

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

describe('scheduleNotes', () => {
  const fire = (tick: number, note?: number) => ({ tick, note });

  it('places each note at its tick within the frame, so rhythm survives high speeds', () => {
    // 4× speed: 240 ticks per real second; ticks 11..14 ran in this frame.
    const notes = scheduleNotes([fire(11, 60), fire(12), fire(13, 64), fire(14, 67)], 11, 240);
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(notes.map((n) => n.delay)).toEqual([0, 2 / 240, 3 / 240]);
    expect(notes.every((n) => n.gain === 1)).toBe(true);
  });

  it('merges repeats on a tick and shares loudness across a chord', () => {
    const notes = scheduleNotes([fire(5, 60), fire(5, 60), fire(5, 64), fire(5, 67), fire(5, 72)], 5, 60);
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 72]);
    for (const n of notes) expect(n.gain).toBeCloseTo(0.5);
    // The same note on the next tick is a new note.
    expect(scheduleNotes([fire(5, 60), fire(6, 60)], 5, 60)).toHaveLength(2);
  });

  it('plays instant jumps at once, and caps a burst', () => {
    expect(scheduleNotes([fire(1, 60), fire(90, 62)], 1, Infinity).map((n) => n.delay)).toEqual([0, 0]);
    const burst = Array.from({ length: 40 }, (_, i) => fire(1 + i, 40 + i));
    const notes = scheduleNotes(burst, 1, 60 * 32);
    expect(notes).toHaveLength(MAX_NOTES_PER_FRAME);
    expect(notes[0]!.midi).toBe(40);
  });
});

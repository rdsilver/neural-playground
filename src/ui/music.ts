// Note-name parsing for the Note neuron inspector ("C4", "F#3", "Bb5", "60").

const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** MIDI number for a note name or number, or null if it is not one (0..127). */
export function parseNote(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');
  let midi: number;
  if (/^\d{1,3}$/.test(t)) midi = Number(t);
  else {
    const m = t.match(/^([a-g])(#|b)?(-?\d)$/);
    if (!m) return null;
    midi = (Number(m[3]) + 1) * 12 + LETTERS[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Semitones within an octave that are black piano keys. */
export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

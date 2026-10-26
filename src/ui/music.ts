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

/** A note to play `delay` seconds from now at relative loudness `gain` (0..1). */
export interface ScheduledNote {
  midi: number;
  delay: number;
  gain: number;
}

/** Most notes started from one animation frame (a burst at high speed). */
export const MAX_NOTES_PER_FRAME = 12;

/**
 * Place one frame's note fires at their exact times. A frame can run many
 * simulation ticks at once (four at 4×, dozens at 32×); playing them all at
 * the frame's instant would smear the rhythm, so each note is delayed by its
 * tick's offset from the frame's first tick, in real seconds at the current
 * speed. The same note twice on one tick plays once, notes sharing a tick (a
 * chord) share the loudness, and the earliest `cap` notes win.
 * `ticksPerSecond` is Infinity for instant jumps (everything plays now).
 */
export function scheduleNotes(
  events: readonly { tick: number; note?: number }[],
  firstTick: number,
  ticksPerSecond: number,
  cap = MAX_NOTES_PER_FRAME,
): ScheduledNote[] {
  const byTick = new Map<number, Set<number>>();
  for (const e of events) {
    if (e.note === undefined) continue;
    let notes = byTick.get(e.tick);
    if (!notes) byTick.set(e.tick, (notes = new Set()));
    notes.add(e.note);
  }
  const out: ScheduledNote[] = [];
  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    const notes = byTick.get(tick)!;
    const delay = Number.isFinite(ticksPerSecond) ? Math.max(0, (tick - firstTick) / ticksPerSecond) : 0;
    const gain = 1 / Math.sqrt(notes.size);
    for (const midi of notes) {
      if (out.length >= cap) return out;
      out.push({ midi, delay, gain });
    }
  }
  return out;
}

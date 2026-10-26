import { NetworkBuilder, type Network } from '../engine';
import type { DemoStep, Example } from './types';

// Clocks and music. Everything here leans on one fact of the engine: a pulse
// takes 15 ticks (a quarter of a second) to cross one cell, so the distance
// between two neurons IS the time between their fires.

// ---- Digital clock ---------------------------------------------------------
//
// A ripple counter in mixed radix. Each Digit neuron's threshold is its base:
// seconds-ones and minutes-ones count to 10, the tens digits count to 6. When
// a digit reaches its base it resets to 0 and fires one carry pulse into its
// left-hand neighbour. Even the colon is a neuron: a relay (threshold 1) that
// passes the minute carry from the seconds to the minutes.
//
// Every hop is one cell, the shortest possible, 15 ticks. A ripple from the
// seconds-ones digit reaches the minutes-ones digit 45 ticks later and the
// minutes-tens digit 60 ticks later, i.e. just as the next second arrives.
// Any clicks are fine: a click is one more pulse, and each digit simply
// counts the pulses it receives, so the clock always settles on
// (seconds + clicks, weighted by place) mod 60 minutes.

/** The clock's digits, most significant first, with their bases and place values in seconds. */
export const CLOCK_DIGITS = [
  { id: 'min-tens', base: 6, seconds: 600, x: 0 },
  { id: 'min-ones', base: 10, seconds: 60, x: 1 },
  { id: 'sec-tens', base: 6, seconds: 10, x: 3 },
  { id: 'sec-ones', base: 10, seconds: 1, x: 4 },
] as const;

function digitalClock(): Network {
  const b = new NetworkBuilder();
  b.text(0, 0, 'Digital clock', { size: 0.9 });
  b.text(0, 1.1, 'Four Digit neurons counting in bases 10 and 6.', { size: 0.45, tone: 'muted' });

  const y = 3;
  for (const { id, base, x } of CLOCK_DIGITS) b.digit(x, y, base, { id, label: base === 6 ? 'tens' : 'ones' });
  b.normal(2, y, 1, { id: 'colon', label: ':' });
  // Carries run right to left, one cell per hop.
  b.chain(['sec-ones', 'sec-tens', 'colon', 'min-ones', 'min-tens']);
  b.text(1, y + 1.55, 'minutes', { size: 0.45, align: 'center', tone: 'muted' });
  b.text(4, y + 1.55, 'seconds', { size: 0.45, align: 'center', tone: 'muted' });

  // Four cells from the seconds digit, so its pulses take exactly 60 ticks:
  // the timer's n-th fire (at tick 60n - 59) shows up as n seconds at tick
  // 60n + 1, right on time.
  b.timer(8, y, { id: 'clock', interval: 1 });
  b.connect('clock', 'sec-ones');
  b.text(8.5, y + 1.15, 'every 1 s', { size: 0.45, align: 'center', tone: 'muted' });
  return b.build();
}

// ---- Row, row, row your boat ----------------------------------------------
//
// The melody is a chain of Note neurons (threshold 1 relays that play a note)
// and the gap to the next note is the current note's length: one cell, a
// quarter second, per eighth note. In 6/8 each bar is 6 eighths, so each
// 2-bar line of the song is exactly 12 cells long, and the four lines fit the
// four sides of a 12 x 12 square, each line starting on a corner.
//
// The round needs no extra wiring: pulses never interfere, so a timer that
// fires into the first note four times, 2 bars (3 s) apart, sends four voices
// round the same square, one side behind each other.

const C3 = 48, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, C5 = 72;

/** The melody as [MIDI note, length in eighth notes]. 6/8, 8 bars. */
export const ROW_YOUR_BOAT: ReadonlyArray<readonly [number, number]> = [
  // Row, row, row your boat,
  [C4, 3], [C4, 3], [C4, 2], [D4, 1], [E4, 3],
  // gently down the stream.
  [E4, 2], [D4, 1], [E4, 2], [F4, 1], [G4, 6],
  // Merrily, merrily, merrily, merrily,
  [C5, 1], [C5, 1], [C5, 1], [G4, 1], [G4, 1], [G4, 1],
  [E4, 1], [E4, 1], [E4, 1], [C4, 1], [C4, 1], [C4, 1],
  // life is but a dream.
  [G4, 2], [F4, 1], [E4, 2], [D4, 1], [C4, 6],
];

/** Side of the square in cells: one 2-bar line of the song. */
export const ROUND_SIDE = 12;
/** Seconds between voices: two bars of 6 eighths at a quarter second each. */
export const ROUND_ENTRY_SECONDS = 3;
export const ROUND_VOICES = 4;
export const roundNoteId = (i: number): string => `note-${i + 1}`;

/** Grid cell for a moment of the song, measured clockwise round the square. */
function squarePosition(eighths: number): { x: number; y: number } {
  const side = Math.floor(eighths / ROUND_SIDE) % 4;
  const along = eighths % ROUND_SIDE;
  if (side === 0) return { x: along, y: 0 };
  if (side === 1) return { x: ROUND_SIDE, y: along };
  if (side === 2) return { x: ROUND_SIDE - along, y: ROUND_SIDE };
  return { x: 0, y: ROUND_SIDE - along };
}

function rowYourBoat(): Network {
  const b = new NetworkBuilder();
  const S = ROUND_SIDE;
  let onset = 0;
  const notes = ROW_YOUR_BOAT.map(([midi, length], i) => {
    const { x, y } = squarePosition(onset);
    onset += length;
    return b.note(x, y, midi, 1, { id: roundNoteId(i) });
  });
  b.chain(notes);

  const conductor = b.timer(-2, -2, { id: 'voices', interval: ROUND_ENTRY_SECONDS, times: ROUND_VOICES });
  b.connect(conductor, notes[0]!);
  b.text(-0.8, -2.05, '4 voices, 2 bars apart', { size: 0.42, tone: 'muted' });

  // Bar numbers just outside the square, at the start of each bar.
  for (let bar = 0; bar < 8; bar++) {
    const { x, y } = squarePosition(bar * 6);
    const label = `bar ${bar + 1}`;
    if (y === 0 && x > 0) b.text(x + 0.5, -0.75, label, { size: 0.38, align: 'center', tone: 'muted' });
    else if (x === S && y > 0 && y < S) b.text(S + 1.15, y + 0.3, label, { size: 0.38, tone: 'muted' });
    else if (y === S) b.text(x + 0.5, S + 1.2, label, { size: 0.38, align: 'center', tone: 'muted' });
    else if (x === 0 && y > 0) b.text(-0.15, y + 0.3, label, { size: 0.38, align: 'right', tone: 'muted' });
    else b.text(x + 1.15, -0.75, label, { size: 0.38, tone: 'muted' });
  }

  // Lyrics along the inside of each side.
  b.text(1.2, 1.25, 'Row, row, row your boat,', { size: 0.5, tone: 'accent' });
  b.text(S - 0.2, 2.6, 'gently down\nthe stream.', { size: 0.5, align: 'right', tone: 'accent' });
  b.text(S - 0.2, S - 1.0, 'Merrily, merrily, merrily, merrily,', { size: 0.5, align: 'right', tone: 'accent' });
  b.text(1.2, 7.9, 'life is but\na dream.', { size: 0.5, tone: 'accent' });

  b.text(S / 2 + 0.5, 4.3, 'Row, Row, Row Your Boat', { size: 0.75, align: 'center' });
  b.text(S / 2 + 0.5, 5.4, 'a round for four voices', { size: 0.5, align: 'center', tone: 'muted' });
  b.text(S / 2 + 0.5, 6.4, 'one cell = one eighth note', { size: 0.42, align: 'center', tone: 'muted' });
  return b.build();
}

/** Caption-only demo steps: timers ignore pokes, so poking one changes nothing. */
function captions(neuron: string, steps: Array<[number, string]>): DemoStep[] {
  return steps.map(([at, caption]) => ({ at, neuron, caption }));
}

// ---- Polyrhythm ------------------------------------------------------------
//
// One clock, two dividers. A Digit neuron with threshold k fires on every
// k-th pulse it receives, so it divides the clock by k (and shows where it is
// in the count). With 12 clock ticks to a bar, divide-by-3 gives 4 beats and
// divide-by-4 gives 3 beats. Both paths from the clock to the notes are the
// same length, so the two voices land on exactly the same tick once a bar.

/** Seconds between clock ticks: 12 ticks make a 2.4 s bar. */
export const POLY_CLOCK_SECONDS = 0.2;

function polyrhythm(): Network {
  const b = new NetworkBuilder();
  b.text(0, 0, 'Polyrhythm: 3 against 4', { size: 0.9 });
  b.text(0, 1.1, 'One clock, divided by 3 and by 4.', { size: 0.45, tone: 'muted' });

  const clock = b.timer(0, 5, { id: 'clock', interval: POLY_CLOCK_SECONDS });
  b.text(0.5, 6.15, 'clock', { size: 0.42, align: 'center', tone: 'muted' });
  b.text(0.5, 6.7, 'every 0.2 s', { size: 0.38, align: 'center', tone: 'muted' });

  // Each beat counter sits right next to its note, so it shows the new beat
  // 15 ticks after the note sounds, well before the next beat (36 or 48 ticks
  // later). Three cells away (45 ticks) the high counter would still show the
  // previous beat when the next one sounded.

  // Upper voice: every 3rd tick, 4 beats a bar, high note.
  const div3 = b.digit(3, 3, 3, { id: 'div3', label: '÷3' });
  const high = b.note(6, 3, G4, 1, { id: 'high' });
  const beats4 = b.digit(7, 3, 4, { id: 'beat-of-4', label: 'beat' });
  b.chain([clock, div3, high, beats4]);
  b.text(8.4, 3.2, '4 beats a bar', { size: 0.45, tone: 'accent' });

  // Lower voice: every 4th tick, 3 beats a bar, low note.
  const div4 = b.digit(3, 7, 4, { id: 'div4', label: '÷4' });
  const low = b.note(6, 7, C3, 1, { id: 'low' });
  const beats3 = b.digit(7, 7, 3, { id: 'beat-of-3', label: 'beat' });
  b.chain([clock, div4, low, beats3]);
  b.text(8.4, 7.2, '3 beats a bar', { size: 0.45, tone: 'accent' });

  // A picture of one bar: twelve clock ticks, and where each voice plays.
  const gridY = 10;
  b.text(3.2, gridY - 0.85, 'one bar = 12 clock ticks', { size: 0.42, tone: 'muted' });
  b.text(2.9, gridY, 'high', { size: 0.42, align: 'right', tone: 'muted' });
  b.text(2.9, gridY + 0.75, 'low', { size: 0.42, align: 'right', tone: 'muted' });
  for (let tick = 0; tick < 12; tick++) {
    const x = 3.5 + tick * 0.6;
    const dot = (on: boolean, y: number) => b.text(x, y, on ? '●' : '·', { size: 0.42, align: 'center', tone: on ? 'accent' : 'muted' });
    dot(tick % 3 === 0, gridY);
    dot(tick % 4 === 0, gridY + 0.75);
  }
  return b.build();
}

// ---- Wandering melody ------------------------------------------------------
//
// A random walk on a pentatonic scale. Every note passes its pulse to its own
// Random neuron, and that neuron sends it on to ONE of the notes either side
// (the end notes have only one neighbour to go to). A Random neuron fires exactly
// one pulse for each pulse it receives, so every walker is a single pulse
// that wanders forever, and walkers never merge or multiply.
//
// The Random neurons alternate above and below the row of notes, so their
// V-shaped connections interlock without crossing. Every step is the same
// length: 2 cells from a note to its Random neuron, then a 2-by-2 diagonal
// to the next note, 30 + 43 ticks.

/** C major pentatonic over two octaves, low to high. */
export const WANDER_SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84] as const;
export const wanderNoteId = (i: number): string => `note-${i}`;
export const wanderPickId = (i: number): string => `pick-${i}`;
/** Ticks per step of the walk: note -> Random neuron -> next note. */
export const WANDER_STEP_TICKS = 30 + 43;
/** Seconds between the two walkers the timer starts. */
export const WANDER_START_GAP = 0.6;

function wanderingMelody(): Network {
  const b = new NetworkBuilder();
  b.text(0, -1.9, 'Wandering melody', { size: 0.9 });
  b.text(0, -0.8, 'Each note passes its pulse one step up or down the scale, at random.', { size: 0.45, tone: 'muted' });

  const row = 3;
  const last = WANDER_SCALE.length - 1;
  const notes = WANDER_SCALE.map((midi, i) => b.note(2 * i, row, midi, 1, { id: wanderNoteId(i) }));
  WANDER_SCALE.forEach((_, i) => {
    const pick = b.random(2 * i, i % 2 ? row - 2 : row + 2, 1, { id: wanderPickId(i) });
    b.connect(notes[i]!, pick);
    // One step down or one step up; at the ends the only way is back.
    b.connect(pick, [notes[i - 1], notes[i + 1]].filter((n): n is string => n !== undefined));
  });

  const middle = Math.floor(last / 2);
  const start = b.timer(2 * middle, row + 4, { id: 'start', interval: WANDER_START_GAP, times: 2 });
  b.connect(start, notes[middle]!);
  b.text(2 * middle + 1.2, row + 4.2, 'starts two walkers', { size: 0.42, tone: 'muted' });
  b.text(-0.3, row + 0.2, 'low', { size: 0.42, align: 'right', tone: 'muted' });
  b.text(2 * last + 1.3, row + 0.2, 'high', { size: 0.42, tone: 'muted' });
  return b.build();
}

export const TIME_MUSIC_EXAMPLES: Example[] = [
  {
    id: 'digital-clock',
    title: 'Digital clock',
    category: 'Counting',
    summary: 'Minutes and seconds from four Digit neurons in bases 10 and 6.',
    description:
      'A timer sends one pulse a second into the seconds digit. Each Digit neuron\'s threshold is its base: the ones digits count to 10 and the tens digits only to 6, so after 59 seconds comes a new minute, and after 59 minutes the minutes wrap round to 00. When a digit reaches its base it resets to 0 and fires a carry pulse to the left. Even the colon is a neuron: it passes the carry from the seconds to the minutes.\n\n' +
      'Carries take time to travel, a quarter of a second per cell. So when 00:59 becomes 01:00 the digits change one after another, right to left, like the wheels of an odometer: for a moment the clock reads 00:50, then 00:00, then 01:00. Every hop is a single cell, so the ripple is over within the second. At 09:59, 19:59 and so on the carry has one more digit to reach and takes the whole second, so the display skips 10:00 and catches up just as 10:01 arrives.',
    tryThis: [
      'Set the speed to 16× and watch the minutes roll over.',
      'Click a digit to set the clock: a click counts just like an incoming pulse, so it carries too. The colon adds a minute.',
      'Slow down to ¼× just before a minute ends to watch the carry ripple from right to left.',
      'Connect the tens-of-seconds digit to a new Note neuron: that digit fires once a minute, so the clock chimes on the minute.',
    ],
    network: digitalClock(),
    demo: [
      // All five clicks land before the first second does (tick 61), so the
      // display really reads 00:10, 00:20, ... 00:50 and then 00:51.
      ...[0.2, 0.35, 0.5, 0.65, 0.8].map((at, i) => ({
        at,
        neuron: 'sec-tens',
        ...(i === 0 ? { caption: 'Five clicks on the tens of seconds set the clock to 00:50…' } : {}),
      })),
      ...captions('clock', [[9.4, '…so the minute turns soon: watch the carry ripple right to left.']]),
    ],
  },
  {
    id: 'row-your-boat',
    title: 'Row, row, row your boat',
    category: 'Music',
    summary: 'A four-voice round played by one chain of notes.',
    description:
      'The melody is a chain of Note neurons. Each note plays and passes the pulse on, and the gap to the next note is the length of the note: one cell, a quarter of a second, for every eighth note. The song is in 6/8, so each two-bar line is exactly 12 cells long and the four lines fit the four sides of a square, each one starting on a corner.\n\n' +
      'A round is the same tune sung by several voices, each starting two bars after the last. Here that needs no extra wiring: pulses travel independently, so the timer simply fires into the first note four times, 3 seconds apart. Each voice is one pulse travelling round the square, and once all four have started each side of the square is playing a different line of the song at the same time.',
    tryThis: [
      'Turn on sound first (the speaker button).',
      'Click the first note (top left) to add another voice whenever you like.',
      'Connect the last note (halfway up the left side) back to the first: that gap is exactly one dotted half note, so the round goes on forever.',
      'Set the timer to fire once to hear the plain tune, or 8 times for a longer round.',
    ],
    network: rowYourBoat(),
    demo: captions('voices', [
      [0.1, 'Voice 1: “Row, row, row your boat…”'],
      [3, 'Voice 2 comes in as voice 1 turns the first corner.'],
      [6, 'Voice 3 joins: three lines of the song at once.'],
      [9, 'Voice 4: every side of the square is singing.'],
      [11.5, 'Voice 1 has finished; the others follow it home.'],
    ]),
  },
  {
    id: 'polyrhythm',
    title: 'Polyrhythm: 3 against 4',
    category: 'Music',
    summary: 'One clock divided by 3 and by 4 plays two rhythms at once.',
    description:
      'The timer ticks five times a second. Two Digit neurons divide it: one has threshold 3 and fires on every third tick, the other has threshold 4 and fires on every fourth. Each one fires a Note neuron, and each note feeds a counter that shows which beat of the bar it is on (0 is the downbeat).\n\n' +
      'Twelve ticks make a bar of 2.4 seconds: in that time the high note plays 4 evenly spaced beats and the low note 3, as the dots under the circuit show. The paths from the clock to both notes are the same length, so once a bar the two land on exactly the same tick and both beat counters return to 0 together.',
    tryThis: [
      'Turn on sound and tap along with either voice; then try to hear both at once.',
      'Change the ÷3 digit\'s threshold to 5 and the lower beat counter\'s to 5: now it is 5 against 4, repeating every 20 ticks.',
      'Click a divider to nudge its voice: it is still 3 against 4, and because 3 and 4 share no factor the voices still meet exactly once a bar, just somewhere else in it.',
    ],
    network: polyrhythm(),
  },
  {
    id: 'wandering-melody',
    title: 'Wandering melody',
    category: 'Music',
    summary: 'Pulses wander up and down a pentatonic scale, one step at a time.',
    description:
      'Eleven Note neurons play the C major pentatonic scale (C D E G A) over two octaves. Each note passes its pulse to its own Random neuron, which sends it on to just one of the two neighbouring notes: one step up or one step down (at the top and bottom the only way is back). The result is a random walk. Every step goes to a neighbour, so the tune moves smoothly, and in a pentatonic scale any two notes sound fine together.\n\n' +
      'A Random neuron fires exactly one pulse for each pulse it receives, so a walker never dies out or multiplies: it is one pulse that wanders forever. The timer starts two of them, a little apart, for a gentle duet. Every step takes the same time, so the walkers keep a steady beat.',
    tryThis: [
      'Turn on sound, then click any note to add another walker. Reset to start again with two.',
      'Delete the connection from one Random neuron to the lower of its two notes (the one on the left). Walkers can still climb past the note that feeds it, but can never get back below that note.',
      'Change the notes to a different scale, for example a minor pentatonic (C E♭ F G B♭).',
    ],
    network: wanderingMelody(),
    speed: 2,
  },
];

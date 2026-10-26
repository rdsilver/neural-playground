import { NetworkBuilder, type Network } from '../engine';
import type { Example } from './types';

// Onboarding and pattern examples: a guided tour of every neuron kind, a
// 1-bit memory that cannot be confused by its keys, and a Galton board.
//
// Remember while reading the coordinates: pulses travel 4 cells per second
// (15 ticks per cell), so every distance below is also a delay.

// ---- Hello, neurons ------------------------------------------------------

/** Neuron ids of the tour, so tests (and curious readers) can find them. */
export const HELLO = {
  clickMe: 'click-me',
  fires: 'fires',
  go: 'go',
  hops: ['hop-1', 'hop-2', 'hop-3'],
  clock: 'clock',
  tens: 'tens',
  ones: 'ones',
  plus: 'plus',
  minus: 'minus',
  charge: 'charge',
  play: 'play',
  notes: ['note-c4', 'note-e4', 'note-g4', 'note-c5'],
  coinTimer: 'coin-timer',
  coin: 'coin',
  heads: ['heads-hundreds', 'heads-tens', 'heads-ones'],
  tails: ['tails-hundreds', 'tails-tens', 'tails-ones'],
} as const;

/** MIDI notes of the arpeggio in step 5: C4 E4 G4 C5. */
export const HELLO_ARPEGGIO = [60, 64, 67, 72] as const;

/** Write a numbered step heading and its one- or two-line hint. */
function step(b: NetworkBuilder, x: number, y: number, n: number, title: string, hint: string): void {
  b.text(x, y, `${'①②③④⑤⑥'[n - 1]} ${title}`, { size: 0.62, tone: 'accent' });
  b.text(x, y + 0.95, hint, { size: 0.5, tone: 'muted' });
}

function helloNeurons(): Network {
  const b = new NetworkBuilder();
  b.text(0, -0.4, 'Hello, neurons', { size: 0.9 });
  b.text(0, 0.8, 'Six tiny circuits, one idea each. Read left to right, then click the neurons that ask for it.', { size: 0.5, tone: 'muted' });

  // Panels sit on a 3 x 2 grid: 15 cells apart across and 10 down.
  const col = [0, 15, 30];
  const row = [3, 13];

  // 1. Threshold: a plain neuron that needs 3 charge. Each click adds 1; on the
  //    third it fires (and resets to 0), and the Digit counts its fires.
  {
    const x = col[0]!, y = row[0]!;
    step(b, x, y, 1, 'Click me three times', 'Each click adds 1 charge.\nAt 3 (its threshold) it fires and resets.');
    const me = b.normal(x + 2, y + 4, 3, { id: HELLO.clickMe });
    const fires = b.digit(x + 7, y + 4, 10, { id: HELLO.fires, label: 'fires' });
    b.connect(me, fires);
    b.text(x + 2.5, y + 5.15, 'threshold 3', { size: 0.4, tone: 'muted', align: 'center' });
  }

  // 2. Travel time: hops of 2, 4 and 6 cells take 0.5, 1 and 1.5 seconds.
  {
    const x = col[1]!, y = row[0]!;
    step(b, x, y, 2, 'Pulses take time', 'Click go. Pulses move 4 cells a second,\nso longer links take longer.');
    const go = b.normal(x, y + 4, 1, { id: HELLO.go, label: 'go' });
    const stops = [2, 6, 12].map((dx, i) => b.normal(x + dx, y + 4, 1, { id: HELLO.hops[i] }));
    b.chain([go, ...stops]);
    const gaps: Array<[number, number, string]> = [[0, 2, '½ s'], [2, 6, '1 s'], [6, 12, '1½ s']];
    for (const [from, to, label] of gaps) b.text(x + (from + to) / 2 + 0.5, y + 4.95, label, { size: 0.42, tone: 'muted', align: 'center' });
  }

  // 3. Timer + Digits: a Timer firing once a second into a two-digit counter.
  //    The ones Digit has threshold 10: its tenth pulse resets it to 0 and
  //    fires a carry into the tens Digit.
  {
    const x = col[2]!, y = row[0]!;
    step(b, x, y, 3, 'Timers fire on their own', 'This Timer fires once a second.\nThe Digits count: ones carry into tens.');
    const tens = b.digit(x + 4, y + 4, 10, { id: HELLO.tens, label: 'tens' });
    const ones = b.digit(x + 6, y + 4, 10, { id: HELLO.ones, label: 'ones' });
    const clock = b.timer(x + 10, y + 4, { id: HELLO.clock, interval: 1 });
    b.connect(clock, ones).connect(ones, tens);
  }

  // 4. Inhibitor: one key adds 1, the Inhibitor key takes 1 away.
  {
    const x = col[0]!, y = row[1]!;
    step(b, x, y, 4, 'Inhibitors subtract', 'Click +1 and −1. An Inhibitor fires −1 pulses\nthat take charge away.');
    const plus = b.normal(x + 3, y + 3, 1, { id: HELLO.plus, label: '+1' });
    const minus = b.inhibitor(x + 3, y + 7, 1, { id: HELLO.minus, label: '−1' });
    const charge = b.digit(x + 7, y + 5, 10, { id: HELLO.charge, label: 'charge' });
    b.connect(plus, charge).connect(minus, charge);
  }

  // 5. Notes: a key starts a rising arpeggio, each Note passing the pulse on.
  {
    const x = col[1]!, y = row[1]!;
    step(b, x, y, 5, 'Notes make sound', 'Turn sound on, then click ▶.\nEach Note plays, then passes the pulse on.');
    const play = b.normal(x, y + 7, 1, { id: HELLO.play, label: '▶' });
    const names = ['C', 'E', 'G', 'C'];
    const notes = HELLO_ARPEGGIO.map((midi, i) => b.note(x + 3 + 2 * i, y + 7 - i, midi, 1, { id: HELLO.notes[i], label: names[i] }));
    b.chain([play, ...notes]);
  }

  // 6. Random: a Timer drops a pulse into a Random neuron twice a second and it
  //    sends each one down just one of its two connections: a coin flip. The
  //    counters have three digits, so neither side wraps round to 000 (and
  //    seems to fall behind) during a long visit.
  {
    const x = col[2]!, y = row[1]!;
    step(b, x, y, 6, 'Random picks one path', 'Each pulse goes up or down, chosen at random.\nWhich side is winning?');
    /** Hundreds, tens, ones left to right, carrying leftwards; returns the ones Digit. */
    const counter = (ids: readonly string[], cy: number): string => {
      ids.forEach((id, i) => b.digit(x + 2 + i, cy, 10, { id }));
      b.chain([...ids].reverse());
      return ids[ids.length - 1]!;
    };
    const heads = counter(HELLO.heads, y + 3);
    const tails = counter(HELLO.tails, y + 7);
    const coin = b.random(x + 8, y + 5, 1, { id: HELLO.coin });
    const timer = b.timer(x + 11, y + 5, { id: HELLO.coinTimer, interval: 0.5 });
    b.connect(timer, coin).connect(coin, [heads, tails]);
    b.text(x + 1.6, y + 3.2, 'heads', { size: 0.46, tone: 'muted', align: 'right' });
    b.text(x + 1.6, y + 7.2, 'tails', { size: 0.46, tone: 'muted', align: 'right' });
  }

  b.text(0, 22, 'Ready for more? The Calculators and Patterns examples build bigger machines from these same parts.', { size: 0.5 });

  return b.build();
}

// ---- Flip-flop memory ----------------------------------------------------

/** Neuron ids of the flip-flop. */
export const FLIP_FLOP = {
  set: 'set',
  setPlus: 'set-plus',
  setMinus: 'set-minus',
  setGate: 'set-gate',
  reset: 'reset',
  resetPlus: 'reset-plus',
  resetMinus: 'reset-minus',
  resetGate: 'reset-gate',
  power: 'power-on',
  stop: 'stop',
  loop: ['loop-a', 'loop-b'],
  bit: 'bit',
  bitMinus: 'bit-minus',
} as const;

/**
 * A key whose press reaches its gate as a +1 and a -1 in the same tick.
 * The key sits at one corner of a 2 x 2 square and the gate at the opposite
 * corner; the pulse splits around the square through a relay (+1) and an
 * Inhibitor (-1). Both routes are 4 cells long, and the relay is connected
 * first, so the +1 always lands just before the -1: an open gate (charge 0)
 * fires on the +1, then the -1 leaves it at -1; a closed gate (-1) goes to 0
 * and straight back to -1. Nothing else can arrive in between.
 */
function pairKey(b: NetworkBuilder, key: { id: string; label: string }, plus: string, minus: string, gate: string, x: number, y: number, dy: 1 | -1): void {
  const k = b.normal(x, y + 2 * dy, 1, key);
  const p = b.normal(x + 2, y + 2 * dy, 1, { id: plus, label: '+1' });
  const m = b.inhibitor(x, y, 1, { id: minus, label: '−1' });
  b.connect(k, [p, m]).connect(p, gate).connect(m, gate);
}

function flipFlop(): Network {
  const b = new NetworkBuilder();
  const F = FLIP_FLOP;
  b.text(0, -0.4, 'Flip-flop memory', { size: 0.9 });
  b.text(0, 0.8, 'One bit, stored as a pulse that bounces forever. SET stores 1, RST stores 0.', { size: 0.5, tone: 'muted' });

  // The two gates share one "hole" of -1 charge (see the description).
  const setGate = b.normal(5, 6, 1, { id: F.setGate });
  const resetGate = b.normal(5, 8, 1, { id: F.resetGate });
  b.both(setGate, resetGate);
  pairKey(b, { id: F.set, label: 'SET' }, F.setPlus, F.setMinus, setGate, 3, 6, -1);
  pairKey(b, { id: F.reset, label: 'RST' }, F.resetPlus, F.resetMinus, resetGate, 3, 8, 1);
  // Power-on: one pulse into RST's Inhibitor digs the first hole, so the
  // memory starts at 0.
  const power = b.timer(0, 8, { id: F.power, interval: 1, times: 1 });
  b.connect(power, F.resetMinus);

  // The memory loop, with its display above it. The display gets +1 each
  // time loop-a fires and -1 (through bit-minus) each time loop-b fires; the
  // -1 lands in the same tick as the next +1, so it reads a steady 1 while
  // the pulse bounces and drops to 0 when the pulse is caught at loop-a.
  const a = b.normal(8, 7, 1, { id: F.loop[0] });
  const bb = b.normal(11, 7, 1, { id: F.loop[1] });
  const bit = b.digit(8, 5, 36, { id: F.bit }); // threshold 36: it only displays, never fires
  const bitMinus = b.inhibitor(11, 5, 1, { id: F.bitMinus });
  b.both(a, bb).connect(a, bit).connect(bb, bitMinus).connect(bitMinus, bit);
  const stop = b.inhibitor(7, 9, 1, { id: F.stop });
  b.connect(setGate, a).connect(resetGate, stop).connect(stop, a);

  b.text(2.7, 4.2, 'store 1', { size: 0.45, tone: 'muted', align: 'right' });
  b.text(2.7, 10.2, 'store 0', { size: 0.45, tone: 'muted', align: 'right' });
  b.text(0.5, 9.1, 'power-on', { size: 0.4, tone: 'muted', align: 'center' });
  b.text(7.7, 5.2, 'bit', { size: 0.5, tone: 'accent', align: 'right' });
  b.text(10, 8.25, 'memory loop', { size: 0.45, tone: 'muted', align: 'center' });
  b.text(7.5, 10.1, 'stop', { size: 0.4, tone: 'muted', align: 'center' });
  b.text(4.95, 7.2, 'gates', { size: 0.4, tone: 'muted', align: 'right' });
  b.text(0, 11.6, 'Press either key as often as you like: repeats are ignored.', { size: 0.45 });
  return b.build();
}

// ---- Galton board --------------------------------------------------------

/** Rows of Random pegs; there is one more bin than rows. */
export const GALTON_ROWS = 8;
/** Balls the timer drops. 256 = 2^8, so the expected bins are row 8 of Pascal's triangle. */
export const GALTON_BALLS = 256;
export const galtonBin = (i: number, place: 'tens' | 'ones'): string => `bin-${i}-${place}`;
export const GALTON_DROPPED = ['dropped-hundreds', 'dropped-tens', 'dropped-ones'] as const;
/** Pentatonic notes for the bin mouths, low to high: you can hear the middle win. */
const GALTON_NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79];

/** n choose k: how many of the 2^n left/right paths end in bin k. */
function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

function galtonBoard(): Network {
  const b = new NetworkBuilder();
  const cx = 19; // centre column
  const top = 5; // first peg row
  b.text(0, -0.4, 'Galton board', { size: 0.9 });
  b.text(0, 0.8, 'Every peg is a Random neuron that sends each ball left or right.', { size: 0.5, tone: 'muted' });

  // A timer drops the balls and a three-digit counter keeps the tally.
  const timer = b.timer(cx, top - 2, { id: 'dropper', interval: 0.25, times: GALTON_BALLS });
  const dropped = GALTON_DROPPED.map((id, i) => b.digit(cx - 7 + i, top - 2, 10, { id }));
  b.chain([...dropped].reverse()); // ones -> tens -> hundreds
  b.connect(timer, dropped[2]!);
  b.text(cx - 5.5, top - 3.3, 'balls dropped', { size: 0.45, tone: 'muted', align: 'center' });

  // Peg (row k, i) sits at x = cx + 2(2i - k): pegs 4 apart, rows 2 apart,
  // so every hop is the same diagonal and all balls fall at the same pace.
  const peg = (k: number, i: number) => `peg-${k}-${i}`;
  const mouth = (i: number) => `mouth-${i}`;
  for (let k = 0; k < GALTON_ROWS; k++) {
    for (let i = 0; i <= k; i++) b.random(cx + 2 * (2 * i - k), top + 2 * k, 1, { id: peg(k, i) });
  }
  // Below the last row: a Note at the mouth of each bin, then a two-digit
  // counter. The ones digit is fed straight from above so no line crosses
  // the tens digit beside it.
  const mouthY = top + 2 * GALTON_ROWS;
  for (let i = 0; i <= GALTON_ROWS; i++) {
    const x = cx + 2 * (2 * i - GALTON_ROWS);
    b.note(x, mouthY, GALTON_NOTES[i]!, 1, { id: mouth(i) });
    const tens = b.digit(x - 1, mouthY + 2, 10, { id: galtonBin(i, 'tens') });
    const ones = b.digit(x, mouthY + 2, 10, { id: galtonBin(i, 'ones') });
    b.connect(mouth(i), ones).connect(ones, tens);
    b.text(x, mouthY + 3.2, `≈${choose(GALTON_ROWS, i)}`, { size: 0.4, tone: 'muted', align: 'center' });
  }
  b.text(cx, mouthY + 3.9, `average count after ${GALTON_BALLS} balls`, { size: 0.4, tone: 'muted', align: 'center' });

  b.connect(timer, peg(0, 0));
  for (let k = 0; k < GALTON_ROWS; k++) {
    const below = k + 1 === GALTON_ROWS ? mouth : (j: number) => peg(k + 1, j);
    for (let i = 0; i <= k; i++) b.connect(peg(k, i), [below(i), below(i + 1)]);
  }
  return b.build();
}

// ---- Fireworks -------------------------------------------------------------

/** Spark directions of a burst: seven rays, leaving room below for the trail. */
const RAYS: ReadonlyArray<readonly [number, number]> = [[3, 0], [2, -2], [0, -3], [-2, -2], [-3, 0], [-2, 2], [2, 2]];

export interface FireworkSpec {
  name: string;
  /** Burst centre. */
  x: number;
  y: number;
  /** MIDI note of the bang. */
  note: number;
}

export const FIREWORKS: readonly FireworkSpec[] = [
  { name: 'left', x: 7, y: 11, note: 43 },
  { name: 'middle', x: 21, y: 9, note: 48 },
  { name: 'right', x: 35, y: 12, note: 52 },
];
export const FIREWORKS_GROUND = 21;

function fireworks(): Network {
  const b = new NetworkBuilder();
  b.text(0, -0.4, 'Fireworks', { size: 0.9 });
  b.text(0, 0.8, 'A Timer lights a fuse every second; a Random neuron picks which rocket it reaches.', { size: 0.5, tone: 'muted' });

  const launcher = b.random(21, FIREWORKS_GROUND + 2, 1, { id: 'launcher' });
  const timer = b.timer(21, FIREWORKS_GROUND + 4, { id: 'fuse-timer', interval: 1 });
  b.connect(timer, launcher);
  for (const f of FIREWORKS) {
    // Rocket: a pad on the ground and a trail of relays up to the burst.
    const pad = b.normal(f.x, FIREWORKS_GROUND, 1, { id: `${f.name}-pad` });
    b.connect(launcher, pad);
    const trail = [pad];
    for (let y = FIREWORKS_GROUND - 2; y > f.y + 2; y -= 2) trail.push(b.normal(f.x, y, 1, { id: `${f.name}-trail-${y}` }));
    // The burst: a Note goes bang, and sparks fly out along each ray, two
    // rings deep. Rays are 3 cells (or a 2-2 diagonal, 2.8 cells) per ring,
    // so all sparks of a ring light up within 4 ticks of each other.
    const bang = b.note(f.x, f.y, f.note, 1, { id: `${f.name}-bang` });
    b.chain([...trail, bang]);
    RAYS.forEach(([dx, dy], i) => {
      const inner = b.normal(f.x + dx, f.y + dy, 1, { id: `${f.name}-spark-${i}` });
      const outer = b.normal(f.x + 2 * dx, f.y + 2 * dy, 1, { id: `${f.name}-ember-${i}` });
      b.chain([bang, inner, outer]);
    });
  }
  return b.build();
}

// ---- Registry ------------------------------------------------------------

export const BASICS_EXAMPLES: Example[] = [
  {
    id: 'hello-neurons',
    title: 'Hello, neurons',
    category: 'Start here',
    summary: 'Six tiny circuits, one idea each: a quick tour of every kind of neuron.',
    description:
      'A neuron collects charge. When its charge reaches its threshold, it resets to zero and fires: one pulse down every outgoing connection. Clicking a neuron adds 1 charge, just like an incoming pulse. Each numbered circuit shows one more idea.\n\n' +
      '1. The first neuron has threshold 3, so it fires on every third click. The Digit beside it counts its fires.\n\n' +
      '2. Pulses travel 4 cells per second, so distance is delay: the three hops take ½, 1 and 1½ seconds.\n\n' +
      '3. A Timer ignores incoming pulses and fires on its own. A Digit shows its charge; with threshold 10 its tenth pulse resets it to 0 and carries 1 into the next Digit.\n\n' +
      '4. An Inhibitor fires −1 pulses that take charge away. Charge can even go below zero.\n\n' +
      '5. A Note plays a note when it fires, then passes the pulse on.\n\n' +
      '6. A Random neuron sends each pulse down just one of its connections, picked at random.',
    tryThis: [
      'Click the first neuron six more times, as fast as you like: its Digit goes up by 2, one for every third click.',
      'Click go twice in a row: two pulses travel the line, one behind the other.',
      'Click −1 a few times: the charge goes below zero, and +1 brings it back.',
      'Click ▶ again while the notes are still playing: a second run of notes follows close behind the first.',
    ],
    network: helloNeurons(),
    demo: [
      { at: 1, neuron: HELLO.clickMe, caption: '① Each click adds 1 charge…' },
      { at: 2, neuron: HELLO.clickMe, caption: '① …2 charge…' },
      { at: 3, neuron: HELLO.clickMe, caption: '① …3 reaches the threshold: it fires! Now try the others.' },
    ],
  },
  {
    id: 'flip-flop',
    title: 'Flip-flop memory',
    category: 'Patterns',
    summary: 'A 1-bit memory: a pulse bouncing forever, with keys you cannot confuse.',
    description:
      'The memory is the loop on the right: two neurons with threshold 1, connected both ways. A pulse inside it is passed back and forth forever. Pulse bouncing = 1, loop empty = 0. The Digit above reads the loop: it gains 1 each time the left loop neuron fires and loses 1 (through the Inhibitor) each time the right one fires, so it holds a steady 1 while the pulse bounces.\n\n' +
      'SET starts the loop with a +1; RST stops it with an Inhibitor, whose −1 swallows the bouncing pulse. Wired straight to the loop, that breaks easily: press SET twice and two pulses bounce, so one RST is not enough; press RST twice and the spare −1 stays in the loop and swallows your next SET.\n\n' +
      'The two gates in the middle prevent that. Between them they hold exactly one "hole" of −1 charge: on the RST gate while the bit is 0, on the SET gate while it is 1. Each key press reaches its gate as a +1 and a −1 in the same tick (the square splits the press in two, and both halves travel 4 cells). If the gate holds the hole, the +1 fills it and the −1 digs it again: nothing happens, however often you press. If the gate is open, the +1 fires it, which starts or stops the loop and sends +1 across to fill the other gate\'s hole, and the −1 leaves the hole behind. So the gates take turns, and the loop never gets a second pulse or leftover charge.\n\n' +
      'One catch, as with real flip-flops: news of a change takes half a second of simulated time to cross between the gates, so an opposite key pressed within that half second is ignored. Nothing is left half-done: press it again and it works. At power-on a one-shot Timer digs the very first hole, so the memory starts at 0.',
    tryThis: [
      'Press SET again and again: there is still only one pulse, and the bit stays 1.',
      'Press RST twice, then SET: it works first time, because no charge was left behind.',
      'Slow the simulation down and press a key: the press splits around its square and reaches the gate as a +1 and a −1 at the same moment.',
      'Click the left loop neuron to sneak in a second pulse behind the gates\' backs: now the keys can never empty the loop.',
    ],
    network: flipFlop(),
    speed: 2,
    demo: [
      // 7 s apart (3.5 s at the suggested 2x): time to read the caption, watch
      // the press travel, and see the bit change before the next step.
      { at: 1.5, neuron: FLIP_FLOP.set, caption: 'SET: a pulse starts bouncing in the loop. The bit is 1.' },
      { at: 8.5, neuron: FLIP_FLOP.set, caption: 'SET again: ignored. Still exactly one pulse.' },
      { at: 15.5, neuron: FLIP_FLOP.reset, caption: 'RST: an Inhibitor catches the pulse. The bit is 0.' },
      { at: 22.5, neuron: FLIP_FLOP.reset, caption: 'RST again: ignored, and no −1 is left behind…' },
      { at: 29.5, neuron: FLIP_FLOP.set, caption: '…so the next SET works first time.' },
    ],
  },
  {
    id: 'galton-board',
    title: 'Galton board',
    category: 'Patterns',
    summary: 'Random pegs sort 256 balls into a bell curve.',
    description:
      `A timer drops ${GALTON_BALLS} balls, four a second, onto ${GALTON_ROWS} rows of pegs. Every peg is a Random neuron that sends each ball down to the left or to the right, as if it flipped a coin. A ball's bin is decided by how many times it went right.\n\n` +
      'There are far more ways to reach the middle than the edges: of the 256 possible left/right paths, 70 end in the centre bin and only one in each corner. So the counts pile up into a bell shape, and on average each bin ends near its number from row 8 of Pascal\'s triangle: 1, 8, 28, 56, 70, 56, 28, 8, 1. Luck decides the exact counts, but the number of paths decides the overall shape.\n\n' +
      'The bins are two-digit counters (the ones Digit carries into the tens), and each bin mouth is a Note from a pentatonic scale.',
    tryThis: [
      'Turn sound on: the middle notes come up far more often than the lowest and highest.',
      'Slow it down and follow one ball: at every peg it takes just one path.',
      'Compare with the Bell curve classic, which sends every pulse both ways instead of choosing.',
    ],
    network: galtonBoard(),
    speed: 2,
  },
  {
    id: 'fireworks',
    title: 'Fireworks',
    category: 'Patterns',
    summary: 'Rockets climb, bang and burst into round showers of sparks.',
    description:
      'A Timer lights a fuse once a second. The fuse runs into a Random neuron, which passes it to just one of the three launch pads, so you never know which rocket goes next. The rocket climbs its trail of relays, the Note at the top goes bang, and the pulse fans out along seven rays, two sparks deep.\n\n' +
      'The bursts come out round because layout is timing: every ray is 3 cells long, or a 2-by-2 diagonal of 2.8 cells, so all the sparks of a ring light up within a fifteenth of a second of each other. The fuses to the two outer pads are long, so those rockets take a few seconds to go up.',
    tryThis: [
      'Turn sound on: each rocket bangs on its own low note.',
      'Move one spark a cell further out and watch that ray lag behind the rest.',
      'Set the Timer\'s interval to 0.3 for a grand finale.',
    ],
    network: fireworks(),
  },
];

import { NetworkBuilder } from '../engine';
import type { Example } from './types';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * A decimal read-out: `digits` Digit neurons (threshold 10) in a row with the
 * ones digit at (x, y) and each digit carrying into its left-hand neighbour.
 * Returns the ids, ones first.
 */
function decimal(b: NetworkBuilder, x: number, y: number, digits: number, id: string): string[] {
  const names = ['ones', 'tens', 'hundreds'];
  const ids: string[] = [];
  for (let i = 0; i < digits; i++) ids.push(b.digit(x - i, y, 10, { id: `${id}-${names[i]}` }));
  b.chain(ids);
  return ids;
}

/**
 * A multiplier ladder: every pulse into its first rung sends exactly k pulses
 * into `into`, which must sit directly below the first rung. For k = 4:
 *
 *        r1 → r2 → r3 → r4      top rail: the pulse runs out to the right
 *        ↓    ↓    ↓    ↓       rungs: each rung drops a copy
 *      into ← b2 ← b3 ← b4      bottom rail: copies run back into `into`
 *
 * Every neuron has threshold 1, so it fires once for every pulse it receives,
 * even when two arrive on the same tick: nothing is ever lost. Because the
 * bottom rail runs the opposite way to the top rail, the copies arrive half a
 * second apart instead of piling up, so you can count them going in.
 * `dir` -1 builds the same ladder mirrored, running out to the left.
 * Returns the id of the first rung.
 */
function ladder(b: NetworkBuilder, x: number, y: number, k: number, into: string, id: string, options: { dir?: 1 | -1; label?: string } = {}): string {
  const { dir = 1, label } = options;
  const top: string[] = [];
  for (let i = 1; i <= k; i++) top.push(b.normal(x + dir * (i - 1), y, 1, { id: `${id}-r${i}`, ...(i === 1 && label ? { label } : {}) }));
  b.chain(top);
  b.connect(top[0]!, into);
  let next = into;
  for (let i = 2; i <= k; i++) {
    const rail = b.normal(x + dir * (i - 1), y + 1, 1, { id: `${id}-b${i}` });
    b.connect(top[i - 1]!, rail).connect(rail, next);
    next = rail;
  }
  return top[0]!;
}

// ---------------------------------------------------------------------------
// Times tables
// ---------------------------------------------------------------------------

/** Seconds between timer ticks, and how many ticks before it stops. */
export const TIMES_TABLE_INTERVAL = 10;
export const TIMES_TABLE_COUNT = 12;

/** Grid column of each multiplier's bus neuron, and the row of its top rail. */
function timesRow(k: number): { bus: number; y: number } {
  return k <= 5 ? { bus: 0, y: 4 + 3 * (k - 1) } : { bus: 11, y: 4 + 3 * (k - 6) };
}

function timesTables(): Example {
  const b = new NetworkBuilder();
  b.text(0, -0.2, 'Times tables', { size: 0.9, tone: 'accent' });

  // n, counted by the timer, at the top.
  const step = b.normal(6, 1, 1, { id: 'step', label: '+1' });
  const timer = b.timer(7, 0, { id: 'timer', interval: TIMES_TABLE_INTERVAL, times: TIMES_TABLE_COUNT });
  b.connect(timer, step);
  const n = decimal(b, 4, 1, 2, 'n');
  b.connect(step, n[0]!);
  b.text(2.7, 1.15, 'n', { size: 0.7, align: 'right', tone: 'accent' });

  // Two buses carry each tick down the left and right columns.
  let previous = step;
  for (let k = 1; k <= 9; k++) {
    const { bus: bx, y } = timesRow(k);
    if (k === 6) previous = step;
    const bus = b.normal(bx, y, 1, { id: `bus-${k}` });
    b.connect(previous, bus);
    previous = bus;
    const digits = decimal(b, bx + 4, y + 1, 3, `x${k}`);
    b.text(bx + 1.5, y + 1.15, `×${k}`, { size: 0.6, align: 'center' });
    const first = ladder(b, bx + 4, y, k, digits[0]!, `x${k}`);
    b.connect(bus, first);
  }
  b.text(11, 16.3, 'Every tick adds 1 to n, and\nladder ×k adds k to its row.', { size: 0.55, tone: 'muted' });

  return {
    id: 'times-tables',
    title: 'Times tables',
    category: 'Calculators',
    summary: 'Nine multiplier ladders turn one count into a whole times table.',
    description:
      'A timer ticks 12 times, ten seconds apart. Each tick fires the +1 neuron, which adds 1 to n and sends the tick down two buses, one on the left of each column, which hand a copy to every row.\n\n' +
      'Row ×k is fed by a multiplier ladder: k neurons with threshold 1 in a row. The tick runs out along the top rail, and every rung drops a copy onto the bottom rail, which carries it back into the row\'s counter. One pulse in, k pulses out, so after n ticks row ×k reads k × n. The two rails run in opposite directions, so the copies arrive half a second apart instead of all at once.\n\n' +
      'Every relay has threshold 1, so it fires once for every pulse it receives, and the counters are ordinary decimal Digits: no pulse is ever lost, however they bunch up. The ×9 ladder is the slowest, and the whole table is up to date about nine and a half seconds after each tick, just before the next one. When the timer stops, the table reads 12, 24, 36 … 108.',
    tryThis: [
      'Click +1 for an extra tick: n and every row move on together. Click it as fast as you like; every click counts.',
      'Click the first rung of a ladder (the green neuron right above its ones digit) to add one more lot to that row alone: ×7 jumps by exactly 7.',
      'Click a rung further along: it only reaches the rungs after it, so the fifth rung of ×9 adds 5.',
      'Slow down to 1× and watch nine copies stream into the ×9 counter.',
    ],
    network: b.build(),
    speed: 4,
  };
}

// ---------------------------------------------------------------------------
// Division with remainders
// ---------------------------------------------------------------------------

/** The divisors shown, top to bottom. */
export const DIVISORS = [2, 3, 5, 7] as const;

function division(): Example {
  const b = new NetworkBuilder();
  const q = 6; // column of every quotient's ones digit (and N's ones digit)
  const bx = q + 3; // the bus column, right of the remainders
  b.text(0, -0.2, 'Division with remainders', { size: 0.9, tone: 'accent' });

  // Keys. "+10" is a ten-rung multiplier ladder that empties into "+1".
  const one = b.normal(bx, 2, 1, { id: 'key-1', label: '+1' });
  ladder(b, bx, 1, 10, one, 'key-10', { dir: -1, label: '+10' });
  b.text(bx + 1.3, 1.6, 'press\na key', { size: 0.55, tone: 'muted' });

  // The bus runs down the right-hand side and hands every pulse to each row.
  // First N, a plain decimal counter of every pulse sent.
  const nBus = b.normal(bx, 4, 1, { id: 'bus-n' });
  const n = decimal(b, q, 4, 3, 'n');
  b.connect(one, nBus).connect(nBus, n[0]!);
  let previous = nBus;
  b.text(q - 2.35, 4.15, 'N', { size: 0.7, align: 'right', tone: 'accent' });

  b.text(q - 1 + 0.5, 5.6, 'quotient', { size: 0.5, align: 'center', tone: 'muted' });
  b.text(q + 2 + 0.5, 5.6, 'remainder', { size: 0.5, align: 'center', tone: 'muted' });

  DIVISORS.forEach((d, i) => {
    const y = 7 + 2 * i;
    const bus = b.normal(bx, y, 1, { id: `bus-${d}` });
    b.connect(previous, bus);
    previous = bus;
    // The divider: a Digit with threshold d holds N mod d and fires once
    // every d pulses; those fires are counted by the quotient display.
    const remainder = b.digit(q + 2, y, d, { id: `rem-${d}` });
    const quotient = decimal(b, q, y, 3, `quot-${d}`);
    b.connect(bus, remainder).connect(remainder, quotient[0]!);
    b.text(q - 2.35, y + 0.15, `÷${d}`, { size: 0.7, align: 'right' });
  });

  return {
    id: 'division-remainders',
    title: 'Division with remainders',
    category: 'Calculators',
    summary: 'A Digit with threshold d divides by d: its charge is the remainder.',
    description:
      'A Digit neuron with threshold d is a ÷d machine. Feed it N pulses and it fires once every d pulses, going back to 0 each time. So the charge it shows is the remainder, and the number of times it has fired is the quotient: N = d × quotient + remainder.\n\n' +
      'Every press of +1 sends one pulse down the bus on the right, which hands a copy to each row. N counts them all. In a ÷d row the pulse lands on the remainder digit, and each time that digit overflows it sends one pulse left into a decimal counter: the quotient. The +10 key is a ten-rung multiplier ladder (the same trick as in Times tables) that empties into +1, so one press sends ten pulses.\n\n' +
      'Just after a press the rows take a moment to catch up, the lower ones last; once the pulses have landed the answer is exact, however fast you pressed. N is a ÷10 machine too: its ones digit is the remainder and the digits to its left are the quotient. The counters have three digits, so keep N below 1000.',
    tryThis: [
      'Press +1 once more: 24 = 2 × 12 = 3 × 8, so two remainders drop to 0.',
      'Hunt for primes. Up to 120, any number above 1 whose four remainders are all non-zero is prime: try 29, 31 and 37.',
      'Press +10 and +1 as fast as you can, even while pulses are still flying: every press is counted.',
      'Watch a remainder count up to one less than its divisor, then wrap to 0 as its quotient goes up by one.',
    ],
    network: b.build(),
    speed: 2,
    demo: [
      { at: 0.5, neuron: 'key-10-r1', caption: 'Press +10 twice: each press sends ten pulses to every row.' },
      { at: 1, neuron: 'key-10-r1' },
      { at: 10, neuron: 'key-1', caption: '21 = 3 × 7: the ÷3 and ÷7 remainders are 0.' },
      { at: 14, neuron: 'key-1', caption: '22 = 2 × 11.' },
      { at: 18, neuron: 'key-1', caption: '23: no remainder is 0, so none of 2, 3, 5, 7 divides it. 23 is prime.' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Binary to decimal
// ---------------------------------------------------------------------------

/** Number of binary keys (and bits): 128 down to 1. */
export const BITS = 8;

function binaryToDecimal(): Example {
  const b = new NetworkBuilder();
  const keyY = 3;
  const bitY = 6;
  /** Key and bit j (worth 2^j) sit in the same column, 128 on the left. */
  const col = (j: number) => 2 * (BITS - 1 - j);
  b.text(0, -0.8, 'Binary to decimal', { size: 0.9, tone: 'accent' });

  // The keys form a doubling chain. Each key passes every pulse to the next
  // key twice: once directly and once through a detour neuron above. So a
  // pulse from key j reaches key 0 as 2^j pulses.
  const keys: string[] = [];
  for (let j = 0; j < BITS; j++) keys.push(b.normal(col(j), keyY, 1, { id: `key-${2 ** j}`, label: String(2 ** j) }));
  for (let j = BITS - 1; j >= 1; j--) {
    const detour = b.normal(col(j) + 1, keyY - 1, 1, { id: `double-${2 ** j}` });
    b.connect(keys[j]!, [keys[j - 1]!, detour]).connect(detour, keys[j - 1]!);
    b.text(col(j) + 1.5, keyY - 1.75, '×2', { size: 0.45, align: 'center', tone: 'muted' });
  }

  // Key 1 feeds two counters on the bottom row: a binary one with each bit
  // under its key, and a decimal one, reached through a relay above its ones.
  const bits: string[] = [];
  for (let j = 0; j < BITS; j++) bits.push(b.digit(col(j), bitY, 2, { id: `bit-${j}` }));
  b.chain(bits);
  b.connect(keys[0]!, bits[0]!);
  const decX = col(0) + 5;
  const dec = decimal(b, decX, bitY, 3, 'dec');
  const equals = b.normal(decX, keyY, 1, { id: 'equals', label: '=' });
  b.connect(keys[0]!, equals).connect(equals, dec[0]!);
  b.text(-0.6, keyY + 0.15, 'press', { size: 0.55, align: 'right', tone: 'muted' });
  b.text(-0.6, bitY + 0.15, 'binary', { size: 0.55, align: 'right', tone: 'muted' });
  b.text(decX - 1 + 0.5, bitY + 1.2, 'decimal', { size: 0.55, align: 'center', tone: 'muted' });

  return {
    id: 'binary-to-decimal',
    title: 'Binary to decimal',
    category: 'Calculators',
    summary: 'Press the keys for the 1 bits; a doubling chain does the rest.',
    description:
      'Each key passes every pulse it gets to the key on its right twice: once straight across, and once over the bump through the neuron above. So a pulse doubles at every step. Key 1 is right next to the counters, key 2 is one doubling away, and key 128 is seven doublings away: one press of 128 delivers 128 pulses.\n\n' +
      'Key 1 feeds two counters on the bottom row. The binary one is made of Digits with threshold 2, each carrying into the bit on its left, and each bit sits under the key with its place value. The decimal one is the usual threshold-10 Digits. Both count the same pulses, so they always settle on the same number.\n\n' +
      'To convert a binary number, press the keys for its 1 bits: 1011 is 8 + 2 + 1 = 11. The order and speed of the presses do not matter. The binary row has eight bits, so like a byte it wraps back to 0 after 255; the decimal row goes up to 999.',
    tryThis: [
      'Type a number of your own, up to 255, by pressing the keys for its 1 bits.',
      'Press the same key twice: 64 + 64 carries into the 128 bit, just like adding in binary.',
      'Slow down and press 128: its pulses reach key 1 in eight bunches of 1, 7, 21, 35, 35, 21, 7 and 1, a row of Pascal\'s triangle. Routes with the same number of bumps take the same time (compare Bell curve).',
      'Go past 255: the binary row wraps round to 0 while the decimal row keeps counting.',
    ],
    network: b.build(),
    demo: [
      { at: 0.5, neuron: 'key-8', caption: '1011 in binary: press 8, 2 and 1.' },
      { at: 1, neuron: 'key-2' },
      { at: 1.5, neuron: 'key-1' },
      { at: 5, neuron: 'key-128', caption: 'Key 128 is seven doublings from the counters: one press, 128 pulses.' },
      { at: 12, neuron: 'key-64', caption: 'Now the other bits: 11111111 = 255.' },
      { at: 12.5, neuron: 'key-32' },
      { at: 13, neuron: 'key-16' },
      { at: 13.5, neuron: 'key-4' },
    ],
  };
}

export const ARITHMETIC_EXAMPLES: Example[] = [timesTables(), division(), binaryToDecimal()];

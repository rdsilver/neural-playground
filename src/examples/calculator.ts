import { NetworkBuilder, type Network } from '../engine';
import type { DemoStep, Example } from './types';

// Calculators built from two tricks:
//
// 1. A PULSE LADDER turns one click into k pulses. Keys are relays
//    (threshold 1) chained 9 -> 8 -> ... -> 1, and every key also connects to
//    a collector. Clicking key k starts a pulse that visits keys k, k-1, ..., 1
//    and each of them drops one pulse into the collector: k pulses in all.
//    Relays fire on every pulse they receive, so presses that overlap in
//    flight never interfere; every pulse is counted on its own.
//
// 2. A DECIMAL REGISTER of Digit neurons with threshold 10, chained
//    ones -> tens -> hundreds -> thousands. Each pulse adds exactly 1 and the
//    tenth resets the digit to exactly 0 and sends a carry, so the register
//    holds the exact total however the pulses interleave.
//
// Subtraction uses ten's complement, as mechanical calculators did: "−k" adds
// 10 − k to its column and borrows, i.e. adds 9 to every column on its left.
// The carry out of the top column is dropped, so the machine works modulo
// 10^n and "−k" really does subtract k.

/** Decimal places of the adding machine, most significant first. */
export const ADDING_MACHINE_PLACES = ['thousands', 'hundreds', 'tens', 'ones'] as const;
export type Place = (typeof ADDING_MACHINE_PLACES)[number];

/** Id of the key that adds k (1-9) to a column, e.g. "tens+4". */
export const addKey = (place: Place, k: number): string => `${place}+${k}`;
/** Id of the key that subtracts k (1-9) from a column, e.g. "ones-8". */
export const subtractKey = (place: Place, k: number): string => `${place}-${k}`;

interface KeySpec {
  id: string;
  label: string;
  x: number;
  y: number;
}

/**
 * Place keys (relays with threshold 1) in chain order, chain each to the next
 * and connect every one of them to the collector. Returns the key ids.
 */
function pulseLadder(b: NetworkBuilder, keys: KeySpec[], collector: string): string[] {
  const ids = keys.map(({ id, label, x, y }) => b.normal(x, y, 1, { id, label }));
  b.chain(ids);
  for (const id of ids) b.connect(id, collector);
  return ids;
}

/** Turn "press these keys at this time" groups into demo steps. */
function demoScript(groups: Array<{ at: number; keys: string[]; caption?: string }>): DemoStep[] {
  return groups.flatMap(({ at, keys, caption }) =>
    keys.map((neuron, i) => (i === 0 && caption ? { at, neuron, caption } : { at, neuron })),
  );
}

// ---- Adding machine ------------------------------------------------------

// Offsets of keys 9, 8, ..., 1 (chain order) from their column's "+"
// collector: a diamond open at the bottom, so every step of the chain is one
// diagonal cell and every spoke to the collector is clear of the other keys.
// The "−" keys use the mirror image below the display row, so −k sits
// opposite +k.
const ARCH: ReadonlyArray<readonly [number, number]> = [
  [-2, 1], [-3, 0], [-2, -1], [-1, -2], [0, -3], [1, -2], [2, -1], [3, 0], [2, 1],
];
const COLUMN_SPACING = 8;
const ADD_ROW = 6; // "+" collectors
const DISPLAY_ROW = 9; // the Digit register
const SUBTRACT_ROW = 12; // "−" collectors

function addingMachine(): Network {
  const b = new NetworkBuilder();
  b.text(0, -0.6, 'Adding machine', { size: 0.9 });
  b.text(0, 0.6, 'Click keys while it runs: top keys add, bottom keys subtract.', { size: 0.5, tone: 'muted' });

  // Build from the ones column leftwards so each column can be wired to the
  // column on its right (carries and borrows travel right to left).
  let rightDigit: string | undefined;
  let rightBorrow: string | undefined;
  for (let i = ADDING_MACHINE_PLACES.length - 1; i >= 0; i--) {
    const place = ADDING_MACHINE_PLACES[i]!;
    const cx = 3 + COLUMN_SPACING * i;

    const digit = b.digit(cx, DISPLAY_ROW, 10, { id: place });
    const adds = b.normal(cx, ADD_ROW, 1, { id: `${place}-add-collector` });
    const subtracts = b.normal(cx, SUBTRACT_ROW, 1, { id: `${place}-subtract-collector` });
    b.connect(adds, digit).connect(subtracts, digit);

    // "+" keys: the ladder 9 -> 1 adds k pulses for key k.
    pulseLadder(
      b,
      ARCH.map(([dx, dy], j) => ({ id: addKey(place, 9 - j), label: String(9 - j), x: cx + dx, y: ADD_ROW + dy })),
      adds,
    );

    // "−" keys: the ladder runs −1 -> −9, so key −k visits 10 − k keys and
    // adds 10 − k pulses. Its last key, −9, is where every subtraction ends;
    // from there one pulse goes on to the next column's −1 key, which adds 9
    // to that column and borrows in turn. That is the "add 9 to every column
    // on the left" half of ten's complement.
    const minus = pulseLadder(
      b,
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
        const [dx, dy] = ARCH[9 - k]!;
        return { id: subtractKey(place, k), label: `−${k}`, x: cx + dx, y: SUBTRACT_ROW - dy };
      }),
      subtracts,
    );

    if (rightDigit) b.connect(rightDigit, digit); // carry
    if (rightBorrow) b.connect(rightBorrow, minus[0]!); // borrow
    rightDigit = digit;
    rightBorrow = minus[minus.length - 1]!;

    b.text(cx + 0.5, 2.1, place, { align: 'center', size: 0.55, tone: 'accent' });
    if (i > 0) {
      b.text(cx - 3.5, DISPLAY_ROW - 0.25, 'carry', { align: 'center', size: 0.4, tone: 'muted' });
      b.text(cx - 3.5, SUBTRACT_ROW - 1.3, 'borrow', { align: 'center', size: 0.4, tone: 'muted' });
    }
  }
  // The thousands digit's carry and −9 key's borrow go nowhere: dropped.
  b.text(0, 17, 'Carries and borrows off the left end are dropped, so 9999 + 1 = 0000.', { size: 0.45, tone: 'muted' });
  return b.build();
}

const ADDING_MACHINE_DEMO = demoScript([
  { at: 0.5, keys: ['tens+4', 'ones+7'], caption: 'Type 47: press 4 in the tens column and 7 in the ones.' },
  { at: 6.5, keys: ['tens+8', 'ones+5'], caption: '47 + 85 = 132: the ones pass 9 and send a carry pulse left.' },
  { at: 14.5, keys: ['tens-5', 'ones-8'], caption: '132 − 58 = 74: a − key adds its complement (−8 adds 2), then borrows from the left.' },
  { at: 31, keys: ['tens+1', 'ones+2'], caption: 'Multiply by adding: for + 12 × 13, press 12 three times…' },
  { at: 32, keys: ['tens+1', 'ones+2'] },
  { at: 33, keys: ['tens+1', 'ones+2'] },
  { at: 34, keys: ['hundreds+1', 'tens+2'], caption: '…then 12 once more, one column to the left (120): 74 + 156 = 230.' },
]);

// ---- Pulse dial ----------------------------------------------------------

// A rotary telephone dial: ten holes on a ring of twelve positions, with the
// two bottom positions left open so the collector can reach the display.
// Chain order is 0 -> 9 -> ... -> 1, and "0" sends ten pulses, as on a phone.
const DIAL: ReadonlyArray<readonly [string, number, number]> = [
  ['0', -3, 3], ['9', -4, 1], ['8', -4, -1], ['7', -3, -3], ['6', -1, -4],
  ['5', 1, -4], ['4', 3, -3], ['3', 4, -1], ['2', 4, 1], ['1', 3, 3],
];

function pulseDial(): Network {
  const b = new NetworkBuilder();
  const cx = 6;
  const cy = 6;
  b.text(cx + 0.5, 0, 'Pulse dial', { size: 0.9, align: 'center' });
  b.text(cx + 0.5, 1.1, 'Click a number on the dial.', { size: 0.5, align: 'center', tone: 'muted' });
  const collector = b.normal(cx, cy, 1, { id: 'collector' });
  pulseLadder(
    b,
    DIAL.map(([label, dx, dy]) => ({ id: `dial-${label}`, label, x: cx + dx, y: cy + dy })),
    collector,
  );
  const ones = b.digit(cx, cy + 6, 10, { id: 'ones', label: 'ones' });
  const tens = b.digit(cx - 2, cy + 6, 10, { id: 'tens', label: 'tens' });
  b.connect(collector, ones).connect(ones, tens);
  return b.build();
}

const PULSE_DIAL_DEMO = demoScript([
  { at: 0.5, keys: ['dial-7'], caption: 'Dial 7: the pulse passes 7, 6, 5 … 1 and each drops one pulse into the middle.' },
  { at: 9, keys: ['dial-5'], caption: '7 + 5 = 12: the ones digit passes 9, resets to 0 and carries 1 into the tens.' },
  { at: 17, keys: ['dial-0'], caption: '0 sends ten pulses, just like a telephone: 12 + 10 = 22.' },
]);

// ---- Examples ------------------------------------------------------------

export const CALCULATOR_EXAMPLES: Example[] = [
  {
    id: 'adding-machine',
    title: 'Adding machine',
    category: 'Calculators',
    summary: 'A four-digit mechanical calculator: keys send pulses, digits count them, carries ripple left.',
    description:
      'A four-digit adding machine in the spirit of the 1887 Comptometer. Each decimal place has its own keys, and pressing a key adds that many to its column: type 47 by pressing 4 in the tens and 7 in the ones.\n\n' +
      'How does key 7 send seven pulses? The keys in each top arch form a chain, 9 → 8 → … → 1, and every key also connects to the collector in the middle of the arch. Press 7 and a pulse runs along the chain through 7, 6, 5, 4, 3, 2 and 1, and each of those seven keys drops one pulse into the collector, which passes it down to the display.\n\n' +
      'The display digits are Digit neurons with threshold 10. Each pulse adds one; the tenth resets the digit to 0 and sends a carry pulse to the digit on its left. Every pulse is counted exactly once, so you can press keys while earlier pulses are still flying and the total still comes out exact.\n\n' +
      'Subtraction is the clever part. Taking charge away from a digit cannot borrow: a 0 would just go negative, and nothing would tell the column on its left. So the bottom keys only ever add, using ten\'s complement, the trick mechanical calculators used. In the ones column, −3 adds 7 and then borrows: its pulse leaves the end of the − keys and runs through the − keys of every column to the left, adding 9 to each. That adds 9997 in total, and in a four-digit machine adding 9997 is the same as subtracting 3, because the carry that would make 10000 falls off the left end. Go below zero and it wraps round to 9999, like a real adding machine.\n\n' +
      'Comptometer operators multiplied by repeated adding with shifting: for 12 × 13, press 12 three times, then once more one column to the left (that is 120).',
    tryThis: [
      'Press 9 in the hundreds, tens and ones, then 1 in the ones, and watch one carry ripple all the way to the thousands.',
      'With the display at 0000, press −1 in the ones: the borrow runs through all four columns and leaves 9999.',
      'Multiply 12 × 13: press 1 (tens) and 2 (ones) three times, then 1 (hundreds) and 2 (tens) once. Press as fast as you like; no pulse is lost.',
      'The display settles on the exact answer once the pulses land. Reset the simulation to clear it.',
    ],
    network: addingMachine(),
    speed: 2,
    demo: ADDING_MACHINE_DEMO,
  },
  {
    id: 'pulse-dial',
    title: 'Pulse dial',
    category: 'Calculators',
    summary: 'A rotary telephone dial that adds: dial 7 and seven pulses reach the counter.',
    description:
      'Old rotary telephones dialled by sending pulses down the line: dial 7 and the exchange heard seven clicks. This dial does the same.\n\n' +
      'The ten keys form a chain, 0 → 9 → 8 → … → 1, and every key also connects to the collector in the middle. Click 7 and a pulse runs round the ring through 7, 6, 5, 4, 3, 2 and 1, and each of those keys drops one pulse into the collector: seven pulses. Like a telephone, 0 sends ten.\n\n' +
      'The collector passes each pulse to a two-digit counter. The ones digit is a Digit neuron with threshold 10: on the tenth pulse it resets to 0 and carries one pulse into the tens. So the dial is an adding machine: dial 7, then 5, and it shows 12.',
    tryThis: [
      'Dial 0 a few times: each one adds exactly ten, so only the tens digit changes.',
      'Click several numbers quickly. The pulses overlap but every one is counted.',
      'The counter goes up to 99 and then wraps round to 00. The Adding machine example adds more digits, and subtraction.',
    ],
    network: pulseDial(),
    speed: 2,
    demo: PULSE_DIAL_DEMO,
  },
];

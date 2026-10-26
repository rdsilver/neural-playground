import { fromLegacy, type LegacyNeuron } from '../engine';
import type { Example } from './types';
import aMajorScale from './legacy/a-major-scale.json';
import bellCurve from './legacy/bell-curve.json';
import countTo1000 from './legacy/count-to-1000.json';
import randomJamz from './legacy/random-jamz.json';
import stableExamples from './legacy/stable-examples.json';
import suppression from './legacy/suppression.json';

const legacy = (data: unknown) => fromLegacy(data as LegacyNeuron[]);

// The six networks that shipped with the 2016 version, converted unchanged.
// Each one writes its own title: timers firing 1, 2, 4, 8, 16 and 32 times
// add up to the charge that makes a Digit neuron show the right letter.
export const CLASSIC_EXAMPLES: Example[] = [
  {
    id: 'count-to-1000',
    title: 'Count to 1000 in bases 2–10',
    category: 'Classics',
    summary: 'Nine counters, one per base, all racing to 1000.',
    description:
      'Each row is a counter made of Digit neurons whose threshold is the base: when a digit reaches the base it resets to 0 and sends a carry pulse to its left-hand neighbour. A timer feeds every row 1000 pulses, four per second.\n\n' +
      'Even the title is computed: binary-weighted timers (firing 1, 2, 4, 8, 16 and 32 times) charge each letter until it shows the right character.',
    tryThis: ['Speed the simulation up and watch base 2 carry ripple across the whole row.', 'Every row ends on 1000 written in its own base.'],
    network: legacy(countTo1000),
    speed: 4,
  },
  {
    id: 'stable-loops',
    title: 'Stable loops',
    category: 'Classics',
    summary: 'Eight self-sustaining circuits that never stop once started.',
    description:
      'Each cluster is fully connected and every neuron\'s threshold equals the number of neurons feeding it: 2 neurons with threshold 1, 3 with threshold 2, and so on up to 9 with threshold 8. A timer kicks each one off; after that the activity sustains itself forever.\n\n' +
      'Loops like these are the simplest kind of memory a network can have: activity that keeps circulating.',
    tryThis: ['Stop one of the loops by lowering a single neuron\'s threshold, or by deleting a connection.', 'Add an Inhibitor pointing at a loop and fire it.'],
    network: legacy(stableExamples),
  },
  {
    id: 'bell-curve',
    title: 'Bell curve',
    category: 'Classics',
    summary: 'Pascal\'s triangle, built from neurons, piles up into a bell curve.',
    description:
      'Every neuron in the triangle passes each pulse to both neurons below it, so the number of pulses reaching each position follows Pascal\'s triangle. The lower rows only fire on every tenth pulse to keep the numbers small.\n\n' +
      'The Digit neurons at the bottom count the arrivals. The middle bins fill fastest: a binomial distribution, the discrete cousin of the bell curve.',
    tryThis: ['Slow the simulation down to watch each pulse split in two at every level.'],
    network: legacy(bellCurve),
  },
  {
    id: 'suppression',
    title: 'Suppression',
    category: 'Classics',
    summary: 'Inhibitory neurons keep a runaway square under control.',
    description:
      'Four timers drive a square of neurons that excite each other. Every time a corner fires it also triggers a bank of Inhibitors that send negative pulses back, draining the charge before it can run away.\n\n' +
      'The title uses an Inhibitor too: some letters are written by adding charge and then taking a little away.',
    tryThis: ['Delete a few Inhibitors and watch the square fire faster.'],
    network: legacy(suppression),
  },
  {
    id: 'a-major-scale',
    title: 'A major scale',
    category: 'Classics',
    summary: 'A chain of Note neurons plays a scale every eight seconds.',
    description:
      'A timer fires into a chain of eight Note neurons. Each one plays its note and passes the pulse on, and because the neurons are four cells apart the notes come one second apart: the layout is the rhythm.',
    tryThis: ['Move a note neuron closer to its neighbour to shorten that gap.', 'Turn on sound first (the speaker button).'],
    network: legacy(aMajorScale),
  },
  {
    id: 'random-jamz',
    title: 'Random jamz',
    category: 'Classics',
    summary: 'A Random neuron improvises on four notes.',
    description:
      'A timer fires a Random neuron four times a second. Each time it sends its pulse down just one of its connections, chosen at random: one of four Note neurons, or one of four Digit neurons that count how often their direction was picked.',
    tryThis: ['Change the notes to build your own scale.'],
    network: legacy(randomJamz),
  },
];

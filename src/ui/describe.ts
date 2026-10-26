// Plain-language sentences for what a neuron does with its current settings,
// shown at the top of the inspector ("Fires on its 2nd charge, then resets
// to zero"). Pure, so the wording is tested.

import { digitText, KIND_INFO, noteName, type NeuronSpec } from '../engine';

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 102nd … */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "0.5 s", "1 s", "2.25 s" */
export function seconds(value: number): string {
  return `${Number(value.toFixed(2))} s`;
}

/** When a threshold neuron fires, as the start of a sentence. */
function firesOn(threshold: number): string {
  return threshold <= 1 ? 'Fires on every pulse it receives' : `Fires on its ${ordinal(threshold)} charge, then resets to zero`;
}

/** One or two short sentences: what this neuron does when the network runs. */
export function describeNeuron(n: NeuronSpec): string {
  const t = Math.max(1, Math.round(n.threshold));
  switch (n.kind) {
    case 'normal':
      return t <= 1 ? 'Fires on every pulse it receives and passes it straight on: a relay.' : `${firesOn(t)}.`;
    case 'character':
      return t <= 1
        ? 'Shows 0 and passes every pulse straight on.'
        : `Counts 0–${digitText(t - 1)}, then rolls over to 0 and sends a carry pulse.`;
    case 'negative':
      return `${firesOn(t)}. Each fire removes 1 charge from its targets.`;
    case 'random':
      return `${firesOn(t)}. Each fire sends one pulse down a connection picked at random.`;
    case 'timer': {
      const every = seconds(n.interval ?? KIND_INFO.timer.defaults.interval ?? 1);
      const times = n.times ?? -1;
      if (times < 0) return `Fires every ${every}, forever. Pulses and pokes do not change it.`;
      if (times === 0) return 'Never fires (set to 0 times).';
      if (times === 1) return 'Fires once, as soon as the network starts.';
      return `Fires every ${every}, ${times} times.`;
    }
    case 'note': {
      const name = noteName(n.note ?? KIND_INFO.note.defaults.note ?? 60);
      return t <= 1 ? `Plays ${name} every time it fires, on every pulse it receives.` : `Plays ${name} every time it fires: on its ${ordinal(t)} charge.`;
    }
    case 'lamp':
      return `Glows while it holds charge: +1 turns it on, −1 turns it off. ${firesOn(t)}.`;
  }
}

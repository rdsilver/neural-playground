import type { NeuronKind, NeuronSpec } from './types';

export interface KindInfo {
  kind: NeuronKind;
  /** Name shown in the UI. */
  name: string;
  /** One-sentence explanation for tooltips and the legend. */
  description: string;
  /** Glyph drawn on the neuron when it has no label (empty for none). */
  glyph: string;
  /** Suggested fill color (dark-theme friendly). Renderers may restyle. */
  color: string;
  /** Charge each outgoing pulse carries. */
  pulseCharge: 1 | -1;
  /** Which editable parameters apply to this kind. */
  params: ReadonlyArray<'threshold' | 'interval' | 'times' | 'note' | 'label'>;
  /** Defaults for a freshly placed neuron of this kind. */
  defaults: Omit<NeuronSpec, 'id' | 'x' | 'y' | 'kind'>;
}

export const KIND_INFO: Record<NeuronKind, KindInfo> = {
  normal: {
    kind: 'normal',
    name: 'Neuron',
    description: 'Collects charge. When it reaches its threshold it resets to zero and fires a +1 pulse down every outgoing connection.',
    glyph: '',
    color: '#6fd35b',
    pulseCharge: 1,
    params: ['threshold', 'label'],
    defaults: { threshold: 2 },
  },
  character: {
    kind: 'character',
    name: 'Digit',
    description: 'A neuron that shows its current charge as a digit (0-9, then A-Z). Chain them with thresholds of 10 to build a decimal counter.',
    glyph: '',
    color: '#f2f2f2',
    pulseCharge: 1,
    params: ['threshold', 'label'],
    defaults: { threshold: 10 },
  },
  negative: {
    kind: 'negative',
    name: 'Inhibitor',
    description: 'Fires -1 pulses that remove charge from the neurons it connects to.',
    glyph: '−',
    color: '#3d8bfd',
    pulseCharge: -1,
    params: ['threshold', 'label'],
    defaults: { threshold: 1 },
  },
  random: {
    kind: 'random',
    name: 'Random',
    description: 'When it fires, sends a single pulse down one of its outgoing connections, chosen at random.',
    glyph: 'R',
    color: '#ff9fb2',
    pulseCharge: 1,
    params: ['threshold', 'label'],
    defaults: { threshold: 1 },
  },
  timer: {
    kind: 'timer',
    name: 'Timer',
    description: 'Ignores incoming pulses and fires on its own every few seconds, a set number of times (or forever).',
    glyph: 'T',
    color: '#a08cfa',
    pulseCharge: 1,
    params: ['interval', 'times', 'label'],
    defaults: { threshold: 1, interval: 1, times: -1 },
  },
  note: {
    kind: 'note',
    name: 'Note',
    description: 'Plays a musical note every time it fires, then passes the pulse on.',
    glyph: '♪',
    color: '#2fd6d6',
    pulseCharge: 1,
    params: ['threshold', 'note', 'label'],
    defaults: { threshold: 1, note: 60 },
  },
  lamp: {
    kind: 'lamp',
    name: 'Lamp',
    description: 'A pixel: it glows while it holds charge (+1 turns it on, -1 off). A grid of Lamps makes a dot-matrix display.',
    glyph: '',
    color: '#ffb43d',
    pulseCharge: 1,
    params: ['threshold', 'label'],
    defaults: { threshold: 9 },
  },
};

/** Characters a Digit neuron uses to show charges 0..35. */
export const DIGIT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Text a Digit neuron displays for a given charge. */
export function digitText(charge: number): string {
  if (charge >= 0 && charge < DIGIT_CHARS.length && Number.isInteger(charge)) return DIGIT_CHARS[charge]!;
  return String(charge);
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Scientific pitch name for a MIDI note number, e.g. 60 -> "C4". */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

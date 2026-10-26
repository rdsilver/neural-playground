import { KIND_INFO } from './kinds';
import { mulberry32 } from './rng';
import type { Network, NeuronKind, NeuronSpec } from './types';

/** Simulation steps per simulated second. */
export const TICKS_PER_SECOND = 60;
/**
 * Ticks a pulse needs to travel one cell. 15 ticks per cell = 4 cells per
 * second, the speed of the original p5.js version (2px per frame with 30px
 * cells at 60fps). Travel time grows with distance, so layout is timing.
 */
export const TICKS_PER_CELL = 15;

export interface Pulse {
  readonly id: number;
  readonly from: string;
  readonly to: string;
  /** +1 for excitatory pulses, -1 for inhibitory ones. */
  readonly charge: number;
  readonly startTick: number;
  readonly arrivalTick: number;
}

export interface FireEvent {
  type: 'fire';
  neuron: string;
  kind: NeuronKind;
  tick: number;
  /** Set for note neurons: the MIDI note to play. */
  note?: number;
}

export interface NeuronState {
  charge: number;
  /** Tick of the most recent fire, or -Infinity if it never fired. */
  lastFired: number;
  fireCount: number;
  /** Timers only: how many times it has fired since the last reset. */
  timerFires: number;
  /** Timers only: tick at which it fires next. */
  nextTimerTick: number;
}

export interface SimulationOptions {
  /** Seed for Random neurons. Same seed + same inputs = same run. */
  seed?: number;
}

/** Ticks a pulse takes between two cells (always at least one). */
export function travelTicks(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(1, Math.ceil(distance * TICKS_PER_CELL - 1e-9));
}

/** Ticks between fires for a timer neuron. */
export function timerIntervalTicks(spec: NeuronSpec): number {
  const seconds = spec.interval ?? KIND_INFO.timer.defaults.interval ?? 1;
  return Math.max(1, Math.round(seconds * TICKS_PER_SECOND));
}

function freshState(): NeuronState {
  return { charge: 0, lastFired: -Infinity, fireCount: 0, timerFires: 0, nextTimerTick: 1 };
}

/**
 * Deterministic, DOM-free simulation of a network of integrate-and-fire
 * neurons. Each call to step() advances time by one tick:
 *   1. pulses that have reached their target deliver their charge, in order
 *      of arrival (ties broken by creation order);
 *   2. timer neurons that are due fire, in network order.
 * A neuron whose charge reaches its threshold resets to zero and fires.
 */
export class Simulation {
  private net!: Network;
  private specs = new Map<string, NeuronSpec>();
  private outgoing = new Map<string, string[]>();
  private timers: NeuronSpec[] = [];
  private states = new Map<string, NeuronState>();
  private queue = new PulseQueue();
  private nextPulseId = 1;
  private rng: () => number;
  private readonly seed: number;
  private currentTick = 0;

  constructor(network: Network, options: SimulationOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.load(network);
  }

  /** The network currently being simulated. */
  get network(): Network {
    return this.net;
  }

  /** Ticks elapsed since the last reset. */
  get tick(): number {
    return this.currentTick;
  }

  /** Simulated seconds elapsed since the last reset. */
  get seconds(): number {
    return this.currentTick / TICKS_PER_SECOND;
  }

  /**
   * Swap in an edited network without losing the run: neurons that still
   * exist keep their charge, and pulses keep flying unless their connection
   * was removed.
   */
  load(network: Network): void {
    this.net = network;
    this.specs = new Map(network.neurons.map((n) => [n.id, n]));
    this.outgoing = new Map(network.neurons.map((n) => [n.id, []]));
    const seen = new Set<string>();
    for (const c of network.connections) {
      const key = `${c.from}\u0000${c.to}`;
      if (c.from === c.to || seen.has(key) || !this.specs.has(c.from) || !this.specs.has(c.to)) continue;
      seen.add(key);
      this.outgoing.get(c.from)!.push(c.to);
    }
    this.timers = network.neurons.filter((n) => n.kind === 'timer');

    const states = new Map<string, NeuronState>();
    for (const n of network.neurons) states.set(n.id, this.states.get(n.id) ?? freshState());
    this.states = states;
    this.queue.retain((p) => seen.has(`${p.from}\u0000${p.to}`));
  }

  /** Clear all charge, pulses and timers, and rewind the clock and RNG. */
  reset(): void {
    this.states = new Map(this.net.neurons.map((n) => [n.id, freshState()]));
    this.queue = new PulseQueue();
    this.nextPulseId = 1;
    this.currentTick = 0;
    this.rng = mulberry32(this.seed);
  }

  state(id: string): Readonly<NeuronState> | undefined {
    return this.states.get(id);
  }

  charge(id: string): number {
    return this.states.get(id)?.charge ?? 0;
  }

  /** Pulses currently in flight (unordered). */
  pulses(): readonly Pulse[] {
    return this.queue.items;
  }

  /** Targets of a neuron's outgoing connections, in connection order. */
  targets(id: string): readonly string[] {
    return this.outgoing.get(id) ?? [];
  }

  /** How far a pulse has travelled at the current tick, from 0 to 1. */
  progress(pulse: Pulse, tick = this.currentTick): number {
    const span = pulse.arrivalTick - pulse.startTick;
    return Math.min(1, Math.max(0, (tick - pulse.startTick) / span));
  }

  /**
   * Add charge to a neuron right now, as if the user clicked it. Timers
   * ignore it, like any other incoming charge. Returns any fires it caused.
   */
  stimulate(id: string, charge = 1): FireEvent[] {
    const events: FireEvent[] = [];
    this.deliver(id, charge, events);
    return events;
  }

  /** Make a neuron fire immediately, regardless of its charge or kind. */
  fire(id: string): FireEvent[] {
    const events: FireEvent[] = [];
    if (this.specs.has(id)) this.emit(id, events);
    return events;
  }

  /** Advance one tick. Returns the fires that happened during it. */
  step(): FireEvent[] {
    const tick = ++this.currentTick;
    const events: FireEvent[] = [];

    let pulse: Pulse | undefined;
    while ((pulse = this.queue.popDue(tick))) this.deliver(pulse.to, pulse.charge, events);

    for (const timer of this.timers) {
      const state = this.states.get(timer.id)!;
      const times = timer.times ?? -1;
      if (times >= 0 && state.timerFires >= times) continue;
      if (tick < state.nextTimerTick) continue;
      state.timerFires++;
      state.nextTimerTick = tick + timerIntervalTicks(timer);
      this.emit(timer.id, events);
    }
    return events;
  }

  /** Advance several ticks, returning every fire along the way. */
  run(ticks: number): FireEvent[] {
    const events: FireEvent[] = [];
    for (let i = 0; i < ticks; i++) events.push(...this.step());
    return events;
  }

  /** Advance by a number of simulated seconds. */
  runSeconds(seconds: number): FireEvent[] {
    return this.run(Math.round(seconds * TICKS_PER_SECOND));
  }

  /** True when nothing is in flight and no timer will fire again. */
  isIdle(): boolean {
    if (this.queue.items.length > 0) return false;
    return this.timers.every((t) => {
      const times = t.times ?? -1;
      return times >= 0 && this.states.get(t.id)!.timerFires >= times;
    });
  }

  /** Run until idle (or a tick limit). Returns the ticks advanced. */
  runUntilIdle(maxTicks = 1_000_000): number {
    let ticks = 0;
    while (!this.isIdle() && ticks < maxTicks) {
      this.step();
      ticks++;
    }
    return ticks;
  }

  private deliver(id: string, charge: number, events: FireEvent[]): void {
    const spec = this.specs.get(id);
    if (!spec || spec.kind === 'timer') return;
    const state = this.states.get(id)!;
    state.charge += charge;
    if (state.charge >= Math.max(1, spec.threshold)) {
      state.charge = 0;
      this.emit(id, events);
    }
  }

  private emit(id: string, events: FireEvent[]): void {
    const spec = this.specs.get(id)!;
    const state = this.states.get(id)!;
    state.lastFired = this.currentTick;
    state.fireCount++;
    const event: FireEvent = { type: 'fire', neuron: id, kind: spec.kind, tick: this.currentTick };
    if (spec.kind === 'note') event.note = spec.note ?? KIND_INFO.note.defaults.note;
    events.push(event);

    let targets = this.outgoing.get(id) ?? [];
    if (spec.kind === 'random') {
      targets = targets.length ? [targets[Math.floor(this.rng() * targets.length)]!] : [];
    }
    const charge = KIND_INFO[spec.kind].pulseCharge;
    for (const to of targets) {
      this.queue.push({
        id: this.nextPulseId++,
        from: id,
        to,
        charge,
        startTick: this.currentTick,
        arrivalTick: this.currentTick + travelTicks(spec, this.specs.get(to)!),
      });
    }
  }
}

/** Binary min-heap of pulses ordered by (arrivalTick, id). */
class PulseQueue {
  items: Pulse[] = [];

  push(pulse: Pulse): void {
    const items = this.items;
    items.push(pulse);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  /** Remove and return the earliest pulse if it arrives by `tick`. */
  popDue(tick: number): Pulse | undefined {
    const items = this.items;
    if (!items.length || items[0]!.arrivalTick > tick) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && before(items[l]!, items[m]!)) m = l;
        if (r < items.length && before(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }

  retain(keep: (pulse: Pulse) => boolean): void {
    const kept = this.items.filter(keep);
    this.items = [];
    for (const p of kept) this.push(p);
  }
}

function before(a: Pulse, b: Pulse): boolean {
  return a.arrivalTick < b.arrivalTick || (a.arrivalTick === b.arrivalTick && a.id < b.id);
}

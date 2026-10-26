// Drives the Simulation in real time: play/pause, speed, single steps and
// example demos. Work per frame is capped so a slow frame or a tab coming
// back from the background never triggers a catch-up spiral.

import { Simulation, TICKS_PER_SECOND, type FireEvent, type Network } from '../engine';
import { demoCaptionAt, scheduleDemo, type DemoStep } from '../examples';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;

/** Real time considered per frame at most (longer gaps are dropped). */
const MAX_FRAME_SECONDS = 0.1;
/** Hard cap on ticks per frame. */
export const MAX_TICKS_PER_FRAME = 96;
/** Stop stepping once a frame has spent this long simulating. */
const FRAME_BUDGET_MS = 10;
/**
 * Runaway guard: a network that multiplies pulses (say, a grid of
 * threshold-1 neurons wired both ways) grows without bound. Past this many
 * pulses in flight the runner pauses itself instead of freezing the tab.
 */
export const MAX_PULSES = 20_000;

/**
 * Seconds a demo's captions stay up after its last step, so the final
 * caption can be read while its pulses land. (calculator.test.ts checks the
 * calculator demos settle within this tail: keep the two in step.)
 */
export const DEMO_CAPTION_TAIL = 6;

/** Simulation speed of an animated step, at least (see Runner.beginStep). */
export const STEP_MIN_SPEED = 3;
/** An animated step to the next event takes at most this long in real time. */
const STEP_MAX_SECONDS = 0.45;
/** A step to an event further away than this (20 s) jumps instead of animating. */
export const STEP_JUMP_TICKS = 20 * TICKS_PER_SECOND;
/** Speed of an animated step to the next fire, and how far ahead it looks. */
const FIRE_STEP_SPEED = 8;
const FIRE_STEP_LIMIT_SECONDS = 10;

export interface DemoState {
  steps: readonly DemoStep[];
  /** Distinct times (seconds) at which something happens: steps sharing a time count once. */
  beats: readonly number[];
  /** Tick at which the demo was scheduled. */
  startTick: number;
}

/**
 * An animated step: the simulation runs quickly until something happens,
 * then pauses, so a step is something you can watch rather than 1/60 s.
 */
export interface StepRun {
  /** 'event': stop once tick `until` has run. 'fire': stop after the first tick with a fire (or at `until`). */
  mode: 'event' | 'fire';
  until: number;
  /** Simulation speed while it runs. */
  speed: number;
}

/** The distinct moments of a demo: a key pair, or a caption with its press, is one beat. */
export function demoBeats(steps: readonly DemoStep[]): number[] {
  return [...new Set(steps.map((s) => s.at))].sort((a, b) => a - b);
}

export class Runner {
  readonly sim: Simulation;
  playing = false;
  speed = 1;
  demo: DemoState | null = null;
  /** Set when the runaway guard paused the simulation (cleared on reset). */
  overloaded = false;
  /** The animated step in progress, if any (see beginStep). */
  stepping: StepRun | null = null;
  /** Called when an animated step ends; `found` is false if a fire-step found nothing. */
  onStepEnd: ((found: boolean) => void) | null = null;
  /**
   * Neurons a demo poked since the app last drained this list (the board
   * shows a "ghost finger" tap on each so viewers see which key was pressed).
   */
  readonly taps: string[] = [];
  /** Fractional ticks carried over between frames (0..1 after advance). */
  private carry = 0;

  constructor(network: Network, private readonly clock: () => number = () => performance.now()) {
    this.sim = new Simulation(network);
  }

  /**
   * Advance by `dtSeconds` of real time at the current speed, returning the
   * fires that happened. Does nothing while paused.
   */
  advance(dtSeconds: number): FireEvent[] {
    const step = this.stepping;
    if (!this.playing && !step) return [];
    const speed = step ? step.speed : this.speed;
    this.carry += Math.min(Math.max(dtSeconds, 0), MAX_FRAME_SECONDS) * TICKS_PER_SECOND * speed;
    let ticks = Math.floor(this.carry);
    this.carry -= ticks;
    if (ticks > MAX_TICKS_PER_FRAME) ticks = MAX_TICKS_PER_FRAME;
    const events: FireEvent[] = [];
    const start = this.clock();
    for (let i = 0; i < ticks; i++) {
      const fired = this.stepSim();
      for (const e of fired) events.push(e);
      if (step && this.stepDone(step, fired.length > 0)) break;
      if (this.sim.pulses().length > MAX_PULSES) {
        this.playing = false;
        this.stepping = null;
        this.overloaded = true;
        break;
      }
      if (this.clock() - start > FRAME_BUDGET_MS) {
        this.carry = 0;
        break;
      }
    }
    return events;
  }

  /**
   * Fractional tick for drawing pulses between simulation steps, so they
   * glide smoothly even at slow speeds.
   */
  get renderTick(): number {
    return this.sim.tick + (this.playing || this.stepping ? this.carry : 0);
  }

  /** Advance exactly one tick from here (Shift+Step), cancelling any animated step. */
  step(): FireEvent[] {
    this.playing = false;
    this.stepping = null;
    this.carry = 0;
    return this.stepSim();
  }

  /**
   * Start an animated step: to the next tick on which anything happens (a
   * pulse lands, a timer or demo fires) or, in 'fire' mode, to the next
   * tick on which a neuron fires. Pauses the simulation. A step already
   * running is finished at once first (its fires are returned). Returns
   * null when nothing is ever going to happen.
   */
  beginStep(mode: 'event' | 'fire' = 'event'): FireEvent[] | null {
    this.playing = false;
    const events = this.finishStep();
    this.carry = 0;
    const now = this.sim.tick;
    if (mode === 'event') {
      const next = this.sim.nextEventTick();
      if (next === undefined) return null;
      const until = Math.max(now + 1, next);
      // Quick enough to keep up with clicks, slow enough to watch pulses land.
      const speed = Math.max(STEP_MIN_SPEED, (until - now) / (STEP_MAX_SECONDS * TICKS_PER_SECOND));
      this.stepping = { mode, until, speed };
      // Nothing to watch on the way to a far-off event (a slow timer): jump.
      if (until - now > STEP_JUMP_TICKS) for (const e of this.finishStep()) events.push(e);
    } else {
      if (this.sim.nextEventTick() === undefined) return null;
      this.stepping = { mode, until: now + FIRE_STEP_LIMIT_SECONDS * TICKS_PER_SECOND, speed: FIRE_STEP_SPEED };
    }
    return events;
  }

  /** Run the animated step in progress to its end right away. */
  finishStep(): FireEvent[] {
    const events: FireEvent[] = [];
    const step = this.stepping;
    if (!step) return events;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const fired = this.stepSim();
      for (const e of fired) events.push(e);
      if (this.stepDone(step, fired.length > 0)) break;
    }
    this.stepping = null;
    return events;
  }

  /** After one tick of an animated step: is it over? */
  private stepDone(step: StepRun, fired: boolean): boolean {
    const reached = this.sim.tick >= step.until;
    const found = step.mode === 'fire' ? fired : reached;
    if (!found && !reached) return false;
    this.stepping = null;
    this.carry = 0;
    this.onStepEnd?.(found);
    return true;
  }

  /** One simulation tick, noting the demo stimuli it applies (see `taps`). */
  private stepSim(): FireEvent[] {
    const due = this.sim.tick + 1;
    for (const s of this.sim.pendingStimuli()) {
      if (s.tick > due) break;
      // Cap the backlog in case nobody drains it (a background tab).
      if (this.taps.length < 64) this.taps.push(s.neuron);
    }
    return this.sim.step();
  }

  /** Clear charge and pulses, rewind the clock and restart the demo, if any. */
  reset(): void {
    this.sim.reset();
    this.carry = 0;
    this.stepping = null;
    this.overloaded = false;
    this.taps.length = 0;
    if (this.demo) this.startDemo(this.demo.steps);
  }

  /** The same document was edited: keep the run going on the new network. */
  load(network: Network): void {
    this.sim.load(network);
  }

  /**
   * A different document was opened (an example, a file, a link, or undo /
   * redo crossing one): start from a clean slate, with no demo running, so
   * nothing of the old run (charges on matching ids, captions, scheduled
   * presses) leaks into the new one.
   */
  open(network: Network): void {
    this.demo = null;
    this.sim.load(network);
    this.reset();
  }

  /** Schedule a demo from the current tick. */
  startDemo(steps: readonly DemoStep[]): void {
    this.sim.clearSchedule();
    this.demo = steps.length ? { steps, beats: demoBeats(steps), startTick: this.sim.tick } : null;
    if (this.demo) scheduleDemo(this.sim, steps);
  }

  stopDemo(): void {
    this.demo = null;
    this.taps.length = 0;
    this.sim.clearSchedule();
  }

  /** Seconds since the demo started (0 if none). */
  get demoSeconds(): number {
    return this.demo ? (this.sim.tick - this.demo.startTick) / TICKS_PER_SECOND : 0;
  }

  /** Caption to show right now, if a demo is running. */
  get caption(): string | undefined {
    return this.demo ? demoCaptionAt(this.demo.steps, this.demoSeconds) : undefined;
  }

  /**
   * Demo progress in beats (moments when something happens), so a key pair
   * pressed together, or a caption-only step, each count once.
   */
  get demoProgress(): { done: number; total: number } | null {
    if (!this.demo) return null;
    const t = this.demoSeconds;
    return { done: this.demo.beats.filter((at) => at <= t).length, total: this.demo.beats.length };
  }

  /** Seconds into the demo of its last step (caption-only steps included). */
  get demoEndsAt(): number {
    return this.demo?.beats[this.demo.beats.length - 1] ?? 0;
  }

  /** True while the demo is playing or its last caption is still up. */
  get demoLive(): boolean {
    return !!this.demo && this.demoSeconds <= this.demoEndsAt + DEMO_CAPTION_TAIL;
  }

  /** How far through the demo (including the caption tail) we are, 0..1. */
  get demoFraction(): number {
    if (!this.demo) return 0;
    return Math.min(1, Math.max(0, this.demoSeconds / (this.demoEndsAt + DEMO_CAPTION_TAIL)));
  }

  /**
   * Demo stimuli due within the next `ticks` ticks, soonest first, with how
   * many ticks away each is (for drawing the ghost finger before a press).
   */
  upcomingTaps(ticks: number): { neuron: string; inTicks: number }[] {
    const out: { neuron: string; inTicks: number }[] = [];
    if (!this.demo) return out;
    const now = this.renderTick;
    for (const s of this.sim.pendingStimuli()) {
      const inTicks = s.tick - now;
      if (inTicks > ticks) break;
      out.push({ neuron: s.neuron, inTicks: Math.max(0, inTicks) });
    }
    return out;
  }
}

/** Next faster/slower speed in SPEEDS. */
export function nudgeSpeed(speed: number, direction: 1 | -1): number {
  const i = SPEEDS.findIndex((s) => s >= speed - 1e-9);
  const current = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, current + direction))]!;
}

/** An example's suggested speed, kept within the supported range (default 1). */
export function clampSpeed(speed: number | undefined): number {
  if (!speed || !Number.isFinite(speed)) return 1;
  return Math.min(SPEEDS[SPEEDS.length - 1]!, Math.max(SPEEDS[0], speed));
}

export function formatSpeed(speed: number): string {
  return speed === 0.25 ? '¼×' : speed === 0.5 ? '½×' : `${Math.round(speed * 100) / 100}×`;
}

/** "1:05.3"-style simulated clock. */
export function formatSimTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

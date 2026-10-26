import { TICKS_PER_SECOND, type Simulation } from '../engine';
import type { DemoStep } from './types';

/** Queue an example's demo on a simulation, relative to its current tick. */
export function scheduleDemo(sim: Simulation, demo: readonly DemoStep[]): void {
  const start = sim.tick;
  for (const step of demo) {
    if (step.neuron !== undefined) sim.schedule(start + Math.max(1, Math.round(step.at * TICKS_PER_SECOND)), step.neuron);
  }
}

/** The caption that should be showing at a given number of seconds into a demo. */
export function demoCaptionAt(demo: readonly DemoStep[], seconds: number): string | undefined {
  let caption: string | undefined;
  for (const step of demo) if (step.at <= seconds && step.caption !== undefined) caption = step.caption;
  return caption;
}

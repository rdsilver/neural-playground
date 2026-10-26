// Small Web Audio synth for Note neurons: a soft plucked bell (triangle
// body with a fast filter sweep plus two quiet sine partials), polyphonic,
// through a compressor so a burst of notes never clips. Notes can start a
// little in the future, so each one sounds at its own simulation tick (see
// scheduleNotes in music.ts).

import { midiToFrequency } from '../engine';
import type { ScheduledNote } from './music';

const MAX_VOICES = 24;
/** Scheduling slack: notes start this far ahead, so none is late. */
const LOOKAHEAD = 0.01;

interface Voice {
  out: GainNode;
  oscs: OscillatorNode[];
}

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Where voices connect: the compressor in front of the master gain. */
  private input: AudioNode | null = null;
  private voices: Voice[] = [];
  private _muted: boolean;
  private _volume: number;

  constructor(muted: boolean, volume: number) {
    this._muted = muted;
    this._volume = volume;
  }

  /** Create or resume the AudioContext. Must run inside a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.outputGain;
      comp.connect(this.master).connect(this.ctx.destination);
      this.input = comp;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  get muted(): boolean {
    return this._muted;
  }

  /** True until a user gesture has let the browser start audio. */
  get locked(): boolean {
    return this.ctx?.state !== 'running';
  }

  get volume(): number {
    return this._volume;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.applyGain();
    if (muted) this.silence();
  }

  setVolume(volume: number): void {
    this._volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  private get outputGain(): number {
    return this._muted ? 0 : this._volume * this._volume * 0.9;
  }

  private applyGain(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.outputGain, this.ctx.currentTime, 0.02);
  }

  /** Play one frame's notes, each at its own offset (see scheduleNotes). */
  playMany(notes: readonly ScheduledNote[]): void {
    for (const n of notes) this.play(n.midi, n.gain, n.delay);
  }

  /** Play one MIDI note, `delay` seconds from now. `gain` scales its loudness (0..1). */
  play(midi: number, gain = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.input || this._muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + LOOKAHEAD + Math.max(0, delay);
    const f = midiToFrequency(midi);
    // Higher notes decay faster, like a real plucked string or bell.
    const decay = Math.max(0.45, Math.min(1.6, 1.6 - (midi - 48) * 0.022));

    const out = ctx.createGain();
    // Silent until it starts (a stolen voice that never started stays silent).
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.26 * gain, t + 0.004);
    out.gain.setTargetAtTime(0, t + 0.004, decay / 4);
    out.connect(this.input);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(16000, f * 8), t);
    filter.frequency.setTargetAtTime(Math.min(16000, f * 2.2), t, 0.08);
    filter.connect(out);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = f;
    body.connect(filter);

    const partial = (ratio: number, level: number, tau: number) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.setTargetAtTime(0, t, tau);
      osc.connect(g).connect(out);
      return osc;
    };
    const oscs = [body, partial(2, 0.35, decay / 6), partial(3.98, 0.12, decay / 14)];
    const end = t + decay * 1.6;
    for (const o of oscs) {
      o.start(t);
      o.stop(end);
    }
    const voice: Voice = { out, oscs };
    body.onended = () => {
      out.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    this.voices.push(voice);
    while (this.voices.length > MAX_VOICES) this.release(this.voices.shift()!);
  }

  /** Quickly fade out a voice (voice stealing / mute). */
  private release(voice: Voice): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setTargetAtTime(0, now, 0.015);
    for (const o of voice.oscs) {
      try {
        o.stop(now + 0.08);
      } catch {
        // Already stopped.
      }
    }
  }

  private silence(): void {
    if (!this.ctx) return;
    for (const v of this.voices) this.release(v);
    this.voices = [];
  }
}

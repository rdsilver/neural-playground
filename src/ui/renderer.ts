// Canvas 2D renderer for the board. Stateless about the network (it is
// handed a Scene every frame) except for short-lived visual effects: fire
// flashes, poke ripples and the demo's ghost-finger taps, which are timed in
// real milliseconds so they look the same at every simulation speed. With
// prefers-reduced-motion it drops the decorative motion (pulse trails,
// growing rings, floating "+1"s) and keeps only what carries meaning.

import {
  digitText,
  noteName,
  timerIntervalTicks,
  type FireEvent,
  type Network,
  type NeuronKind,
  type NeuronSpec,
  type Simulation,
  type TextSpec,
} from '../engine';
import type { Bounds, Camera } from './camera';
import { prefersReducedMotion } from './dom';
import { connectionPath, endTangent, isSquare, pathBounds, pathLength, type ConnectionPath } from './geometry';
import { cellKey, pairKey, type NetIndex } from './netops';
import type { Selection, Tool } from './store';
import { withAlpha, type Palette } from './theme';

const TAU = Math.PI * 2;
const FLASH_MS = 340;
const RIPPLE_MS = 700;
/** How long a demo's ghost-finger tap stays on a neuron. */
const TAP_MS = 650;
/** Length of a pulse's comet tail, in cells. */
const TRAIL_CELLS = 0.5;
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

export type Hover =
  | { type: 'neuron'; id: string }
  | { type: 'handle'; id: string }
  | { type: 'text'; id: string }
  | { type: 'connection'; from: string; to: string }
  | { type: 'cell'; x: number; y: number };

/** In-progress gesture drawn on top of the board. */
export type Preview =
  | { type: 'move'; dx: number; dy: number; neurons: ReadonlySet<string>; texts: ReadonlySet<string>; valid: boolean }
  | { type: 'connect'; from: string; x: number; y: number; target: string | null; newCell: { x: number; y: number } | null; removing: boolean }
  | { type: 'marquee'; x0: number; y0: number; x1: number; y1: number };

export interface Scene {
  network: Network;
  index: NetIndex;
  selection: Selection;
  tool: Tool;
  kind: NeuronKind;
  hover: Hover | null;
  preview: Preview | null;
  /** Connect tool: neuron picked as the source of the next connection. */
  pendingSource: string | null;
  /** Pointer position in world units, if over the board. */
  pointer: { x: number; y: number } | null;
  sim: Simulation;
  /** Fractional simulation tick to draw (smooth pulses between steps). */
  tick: number;
  camera: Camera;
  /** Neuron whose connection handle is visible, if any. */
  handleFor: string | null;
  /** Demo presses coming up within `tapLead` ticks (the ghost finger hovers over them). */
  upcomingTaps: readonly { neuron: string; inTicks: number }[];
  tapLead: number;
  /** The keyboard's cell cursor, while the board has keyboard focus. */
  keyCursor: { x: number; y: number } | null;
}

interface Ripple {
  id: string;
  start: number;
  /** Charge added; 0 for a poke the neuron ignored (a timer). */
  charge: number;
}

/** Connection paths by pairKey(from, to), and by source then target (pulse lookup and hit-testing). */
export interface PathSet {
  byKey: Map<string, ConnectionPath>;
  byFrom: Map<string, Map<string, ConnectionPath>>;
}

interface PulseLayout {
  /** Flat [headX, headY, tailX, tailY, …] screen positions of excitatory pulses. */
  pos: number[];
  neg: number[];
  active: Set<ConnectionPath>;
}

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private palette!: Palette;
  private flashes = new Map<string, number>();
  private ripples: Ripple[] = [];
  private taps: { id: string; start: number }[] = [];
  private reduced = prefersReducedMotion();
  private pathCache: { network: Network | null; paths: PathSet } = { network: null, paths: { byKey: new Map(), byFrom: new Map() } };
  private widthCache = new Map<string, number>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => (this.reduced = e.matches));
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Remember fires so neurons flash. */
  noteFires(events: readonly FireEvent[], now: number): void {
    for (const e of events) this.flashes.set(e.neuron, now);
  }

  /** Show a "+1" ripple where the user poked (charge 0: a quiet "ignored" ring). */
  poke(id: string, charge: number, now: number): void {
    this.ripples.push({ id, start: now, charge });
  }

  /** A demo pressed this neuron: show a ghost-finger tap on it. */
  demoTap(id: string, now: number): void {
    this.taps.push({ id, start: now });
  }

  clearEffects(): void {
    this.flashes.clear();
    this.ripples = [];
    this.taps = [];
  }

  /** True while flashes, ripples or taps are still fading (keep redrawing). */
  animating(now: number): boolean {
    for (const t of this.flashes.values()) if (now - t < FLASH_MS) return true;
    return this.ripples.some((r) => now - r.start < RIPPLE_MS) || this.taps.some((t) => now - t.start < TAP_MS);
  }

  /** Connection paths for the current network (cached until it changes). */
  paths(network: Network, index: NetIndex): PathSet {
    if (this.pathCache.network !== network) this.pathCache = { network, paths: buildPaths(network, index, null) };
    return this.pathCache.paths;
  }

  /** World-space box of a text annotation (for hit-testing and selection). */
  textBox(t: TextSpec): TextBox {
    const size = t.size ?? 0.6;
    const lines = t.text.split('\n');
    const w = Math.max(0.3, ...lines.map((l) => this.measure(l))) * size;
    const h = lines.length * size * 1.25;
    const x = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
    return { x, y: t.y, w, h };
  }

  /** Width of a line of annotation text at font size 1 (world units). */
  private measure(line: string): number {
    let w = this.widthCache.get(line);
    if (w === undefined) {
      this.ctx.font = `500 100px ${UI_FONT}`;
      w = this.ctx.measureText(line).width / 100;
      if (this.widthCache.size > 500) this.widthCache.clear();
      this.widthCache.set(line, w);
    }
    return w;
  }

  draw(scene: Scene, now: number): void {
    const { ctx, palette: p } = this;
    const cam = scene.camera;
    const s = cam.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.canvas;
    ctx.fillRect(0, 0, this.width, this.height);
    const view = cam.visible(this.width, this.height);
    this.drawGrid(cam, view);

    const move = scene.preview?.type === 'move' ? scene.preview : null;
    const paths = move ? buildPaths(scene.network, scene.index, move) : this.paths(scene.network, scene.index);
    const pos = (n: NeuronSpec) => (move && move.neurons.has(n.id) ? { x: n.x + move.dx, y: n.y + move.dy } : n);

    // Texts sit underneath the circuit.
    for (const t of scene.network.texts ?? []) {
      const moved = move && move.texts.has(t.id) ? { ...t, x: t.x + move.dx, y: t.y + move.dy } : t;
      this.drawText(moved, cam);
    }

    const pulses = this.layoutPulses(scene, paths, view);
    this.drawWires(scene, paths.byKey, view, pulses.active);
    this.drawPulses(scene, pulses);

    for (const n of scene.network.neurons) {
      const at = pos(n);
      if (at.x + 1 < view.minX - 1 || at.x > view.maxX + 1 || at.y + 1 < view.minY - 1 || at.y > view.maxY + 1) continue;
      const sc = cam.toScreen(at.x + 0.5, at.y + 0.5);
      const flash = this.flashLevel(n.id, now);
      this.drawNeuron(n, sc.x, sc.y, s, scene, flash);
    }

    this.drawOverlays(scene, pos, now);
    this.drawTaps(scene, now);
    this.ripples = this.ripples.filter((r) => now - r.start < RIPPLE_MS);
    this.taps = this.taps.filter((t) => now - t.start < TAP_MS);
  }

  private flashLevel(id: string, now: number): number {
    const t = this.flashes.get(id);
    if (t === undefined) return 0;
    const age = now - t;
    if (age >= FLASH_MS) {
      this.flashes.delete(id);
      return 0;
    }
    return 1 - age / FLASH_MS;
  }

  /**
   * A quiet dot grid: a dot on every cell corner when zoomed in close enough
   * to place neurons, and a slightly larger one every 8 cells for scale.
   * All dots of a size go into one path, so this stays cheap per frame.
   */
  private drawGrid(cam: Camera, view: Bounds): void {
    const { ctx, palette: p, dpr } = this;
    const s = cam.scale;
    const x0 = Math.floor(view.minX);
    const y0 = Math.floor(view.minY);
    const x1 = Math.ceil(view.maxX);
    const y1 = Math.ceil(view.maxY);
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const dots = (major: boolean, r: number) => {
      ctx.beginPath();
      const stepX = major ? 8 : 1;
      const startX = major ? Math.ceil(x0 / 8) * 8 : x0;
      const startY = major ? Math.ceil(y0 / 8) * 8 : y0;
      for (let y = startY; y <= y1; y += stepX) {
        const sy = snap((y - cam.y) * s);
        for (let x = startX; x <= x1; x += stepX) {
          if (!major && x % 8 === 0 && y % 8 === 0) continue;
          ctx.rect(snap((x - cam.x) * s) - r, sy - r, r * 2, r * 2);
        }
      }
      ctx.fill();
    };
    if (s >= 16) {
      ctx.globalAlpha = Math.min(1, (s - 16) / 12);
      ctx.fillStyle = p.grid;
      dots(false, Math.max(0.75, Math.min(1.1, s / 36)));
      ctx.globalAlpha = 1;
    }
    if (s * 8 >= 20) {
      ctx.fillStyle = p.gridMajor;
      dots(true, Math.max(1, Math.min(1.6, s / 26)));
    }
  }

  private drawWires(scene: Scene, paths: Map<string, ConnectionPath>, view: Bounds, active: ReadonlySet<ConnectionPath>): void {
    const { palette: p } = this;
    const cam = scene.camera;

    // Wires touching the selected / hovered neurons are highlighted.
    const focus = new Set(scene.selection.neurons.size <= 40 ? scene.selection.neurons : []);
    if (scene.hover?.type === 'neuron' || scene.hover?.type === 'handle') focus.add(scene.hover.id);
    const sel = scene.selection.connection;
    const selKey = sel ? pairKey(sel.from, sel.to) : '';
    const hov = scene.hover?.type === 'connection' ? pairKey(scene.hover.from, scene.hover.to) : '';

    const groups: Record<'base' | 'active' | 'in' | 'out', ConnectionPath[]> = { base: [], active: [], in: [], out: [] };
    for (const c of scene.network.connections) {
      const key = pairKey(c.from, c.to);
      const path = paths.get(key);
      if (!path) continue;
      const b = pathBounds(path);
      if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;
      if (key === selKey || key === hov) continue;
      if (focus.has(c.from)) groups.out.push(path);
      else if (focus.has(c.to)) groups.in.push(path);
      else if (active.has(path)) groups.active.push(path);
      else groups.base.push(path);
    }
    const width = Math.max(1, cam.scale * 0.034);
    this.strokeWires(groups.base, cam, p.wire, width);
    this.strokeWires(groups.active, cam, p.wireActive, width);
    this.strokeWires(groups.in, cam, p.wireIn, width * 1.15);
    this.strokeWires(groups.out, cam, p.accent, width * 1.3);
    if (hov && paths.get(hov)) this.strokeWires([paths.get(hov)!], cam, withAlpha(p.accent, 0.75), width * 1.8);
    if (selKey && paths.get(selKey)) this.strokeWires([paths.get(selKey)!], cam, p.accent, width * 2.2);
  }

  /** Stroke a batch of wires in one colour, then fill their arrowheads in one go. */
  private strokeWires(paths: ConnectionPath[], cam: Camera, color: string, width: number): void {
    if (!paths.length) return;
    const { ctx } = this;
    const s = cam.scale;
    const arrowLen = Math.min(11, Math.max(4.5, s * 0.2)) * (width > 2 ? 1.15 : 1);
    ctx.beginPath();
    const heads: number[] = [];
    for (const path of paths) {
      const a = cam.toScreen(path.x0, path.y0);
      const c = cam.toScreen(path.cx, path.cy);
      const e = cam.toScreen(path.x1, path.y1);
      const len = pathLength(path) * s;
      const dir = endTangent(path);
      const L = Math.min(arrowLen, len * 0.9);
      // Stop the line inside the arrowhead so its tip stays sharp.
      const back = Math.min(L * 0.6, len);
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, e.x - dir.x * back, e.y - dir.y * back);
      if (s >= 7) heads.push(e.x, e.y, dir.x, dir.y, L);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < heads.length; i += 5) {
      const [x, y, dx, dy, L] = [heads[i]!, heads[i + 1]!, heads[i + 2]!, heads[i + 3]!, heads[i + 4]!];
      const hw = L * 0.52;
      ctx.moveTo(x, y);
      ctx.lineTo(x - dx * L - dy * hw, y - dy * L + dx * hw);
      ctx.lineTo(x - dx * L * 0.78, y - dy * L * 0.78);
      ctx.lineTo(x - dx * L + dy * hw, y - dy * L - dx * hw);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * Screen positions of visible pulses (allocation-free maths: this runs
   * for every pulse every frame), plus the set of wires carrying one. Each
   * pulse is stored as head x, y and tail x, y: the tail trails a short way
   * behind along the wire, so pulses read as comets moving in a direction.
   */
  private layoutPulses(scene: Scene, paths: PathSet, view: Bounds): PulseLayout {
    const cam = scene.camera;
    const s = cam.scale;
    const sim = scene.sim;
    const pos: number[] = [];
    const neg: number[] = [];
    const active = new Set<ConnectionPath>();
    for (const pulse of sim.pulses()) {
      const path = paths.byFrom.get(pulse.from)?.get(pulse.to);
      if (!path) continue;
      active.add(path);
      const t = sim.progress(pulse, scene.tick);
      let u = 1 - t;
      const wx = u * u * path.x0 + 2 * u * t * path.cx + t * t * path.x1;
      const wy = u * u * path.y0 + 2 * u * t * path.cy + t * t * path.y1;
      if (wx < view.minX - 1 || wx > view.maxX + 1 || wy < view.minY - 1 || wy > view.maxY + 1) continue;
      const tt = Math.max(0, t - TRAIL_CELLS / Math.max(0.2, Math.hypot(path.x1 - path.x0, path.y1 - path.y0)));
      u = 1 - tt;
      const tx = u * u * path.x0 + 2 * u * tt * path.cx + tt * tt * path.x1;
      const ty = u * u * path.y0 + 2 * u * tt * path.cy + tt * tt * path.y1;
      (pulse.charge > 0 ? pos : neg).push((wx - cam.x) * s, (wy - cam.y) * s, (tx - cam.x) * s, (ty - cam.y) * s);
    }
    return { pos, neg, active };
  }

  private drawPulses(scene: Scene, { pos, neg }: PulseLayout): void {
    const { ctx, palette: p } = this;
    const s = scene.camera.scale;
    const core = Math.max(2.2, s * 0.085);
    // Thousands of pulses: drop the trails; tens of thousands: squares (cheaper than arcs).
    const count = (pos.length + neg.length) / 4;
    // Trails are decoration: dropped for reduced motion and for crowds.
    const plain = count > 2500 || this.reduced;
    const cheap = count > 8000;
    // Two passes fake a fading tail: the whole tail thin and faint, the half
    // nearest the head wider. Additive blending makes it glow on dark boards.
    const trails = (list: number[], color: string) => {
      ctx.save();
      ctx.globalCompositeOperation = p.glowBlend;
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      for (const [reach, width] of [
        [1, 0.9],
        [0.45, 1.5],
      ] as const) {
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 4) {
          const hx = list[i]!;
          const hy = list[i + 1]!;
          ctx.moveTo(hx + (list[i + 2]! - hx) * reach, hy + (list[i + 3]! - hy) * reach);
          ctx.lineTo(hx, hy);
        }
        ctx.lineWidth = core * width;
        ctx.stroke();
      }
      ctx.restore();
    };
    const heads = (list: number[], r: number) => {
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 4) {
        if (cheap) ctx.rect(list[i]! - r, list[i + 1]! - r, r * 2, r * 2);
        else {
          ctx.moveTo(list[i]! + r, list[i + 1]!);
          ctx.arc(list[i]!, list[i + 1]!, r, 0, TAU);
        }
      }
    };
    if (pos.length) {
      if (!plain) trails(pos, p.pulsePosGlow);
      heads(pos, core);
      ctx.fillStyle = p.pulsePos;
      ctx.fill();
    }
    if (neg.length) {
      if (!plain) trails(neg, p.pulseNegGlow);
      heads(neg, core * 1.05);
      ctx.fillStyle = p.canvas;
      ctx.fill();
      ctx.lineWidth = Math.max(1.4, s * 0.04);
      ctx.strokeStyle = p.pulseNeg;
      ctx.stroke();
    }
  }

  private drawNeuron(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number): void {
    if (isSquare(n.kind)) this.drawDigit(n, cx, cy, s, scene, flash);
    else this.drawRound(n, cx, cy, s, scene, flash);
  }

  private drawDigit(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number): void {
    const { ctx, palette: p } = this;
    const color = p.kinds.character;
    const half = s * 0.42;
    const charge = scene.sim.charge(n.id);
    if (flash > 0) {
      const grow = s * 0.08 * (this.reduced ? 1 : flash);
      ctx.beginPath();
      ctx.roundRect(cx - half - grow, cy - half - grow, 2 * (half + grow), 2 * (half + grow), s * 0.2);
      ctx.fillStyle = withAlpha(p.accent, 0.3 * flash);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(cx - half, cy - half, half * 2, half * 2, s * 0.14);
    ctx.fillStyle = p.digitTile;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeStyle = flash > 0 ? withAlpha(p.accent, 0.5 + 0.5 * flash) : withAlpha(color, 0.38);
    ctx.stroke();
    if (s < 6) return;

    const text = digitText(charge);
    const size = s * (text.length > 2 ? 0.34 : text.length > 1 ? 0.46 : 0.62);
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = charge < 0 ? p.negCharge : p.digitInk;
    ctx.fillText(text, cx, cy + s * 0.03);

    if (n.label && s >= 16) {
      ctx.font = `500 ${Math.max(9, s * 0.24)}px ${UI_FONT}`;
      ctx.fillStyle = withAlpha(p.ink, 0.6);
      ctx.textBaseline = 'top';
      ctx.fillText(n.label, cx, cy + half + s * 0.06);
    }
  }

  private drawRound(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number): void {
    const { ctx, palette: p } = this;
    const color = p.kinds[n.kind];
    const core = s * 0.3;
    const ringR = s * 0.395;
    const ringW = Math.max(1.4, s * 0.06);
    const state = scene.sim.state(n.id);
    let dim = false;
    let timerFrac = 0;
    if (n.kind === 'timer' && state) {
      const interval = timerIntervalTicks(n);
      const times = n.times ?? -1;
      dim = times >= 0 && state.timerFires >= times;
      timerFrac = dim ? 0 : Math.min(1, Math.max(0, 1 - (state.nextTimerTick - scene.tick) / interval));
    }

    if (flash > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + s * (this.reduced ? 0.08 : 0.06 + 0.16 * (1 - flash)), 0, TAU);
      ctx.fillStyle = withAlpha(color, 0.28 * flash);
      ctx.fill();
    }

    // Core.
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, TAU);
    ctx.fillStyle = withAlpha(color, dim ? 0.08 : 0.2 + 0.8 * flash);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.strokeStyle = dim ? withAlpha(color, 0.45) : color;
    ctx.stroke();
    if (s < 6) return;

    // Ring: charge towards threshold, or a timer's countdown.
    const charge = scene.sim.charge(n.id);
    if (s >= 10) {
      if (n.kind === 'timer') this.drawTimerRing(cx, cy, ringR, ringW, color, timerFrac, dim);
      else this.drawChargeRing(cx, cy, ringR, ringW, color, charge, n.threshold);
    }
    if (s < 14) return;
    if (charge < 0 && n.kind !== 'timer' && s >= 16) this.drawNegativeBadge(charge, cx + ringR * 0.8, cy - ringR * 0.8, s);

    const ink = flash > 0.45 ? p.inkOnKind : color;
    const focused = scene.selection.neurons.has(n.id) || (scene.hover?.type === 'neuron' && scene.hover.id === n.id);
    if (n.label) {
      this.drawLabel(n.label, cx, cy, core, flash > 0.45 ? p.inkOnKind : p.ink);
    } else if (n.kind === 'negative') {
      ctx.beginPath();
      ctx.moveTo(cx - core * 0.45, cy);
      ctx.lineTo(cx + core * 0.45, cy);
      ctx.lineWidth = Math.max(1.5, s * 0.065);
      ctx.lineCap = 'round';
      ctx.strokeStyle = ink;
      ctx.stroke();
    } else if (n.kind === 'random') {
      ctx.beginPath();
      const d = core * 0.36;
      const r = Math.max(1, s * 0.034);
      for (const k of [-1, 0, 1]) {
        ctx.moveTo(cx + k * d + r, cy + k * d);
        ctx.arc(cx + k * d, cy + k * d, r, 0, TAU);
      }
      ctx.fillStyle = ink;
      ctx.fill();
    } else if (n.kind === 'timer') {
      const angle = -Math.PI / 2 + TAU * timerFrac;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * core * 0.62, cy + Math.sin(angle) * core * 0.62);
      ctx.lineWidth = Math.max(1.2, s * 0.045);
      ctx.lineCap = 'round';
      ctx.strokeStyle = dim ? withAlpha(color, 0.5) : ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, s * 0.03), 0, TAU);
      ctx.fillStyle = dim ? withAlpha(color, 0.5) : ink;
      ctx.fill();
    } else if (n.kind === 'note') {
      const name = noteName(n.note ?? 60);
      if (s >= 26 || focused) this.drawLabel(name, cx, cy, core, ink, true);
      else {
        ctx.font = `600 ${core * 1.2}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = ink;
        ctx.fillText('♪', cx, cy + core * 0.06);
      }
    }

    // Captions under the neuron (when zoomed in, or focused): note names for
    // labelled notes, repeats left for timers.
    if (s >= 48 || (s >= 20 && focused)) {
      let caption = '';
      if (n.kind === 'note' && n.label) caption = noteName(n.note ?? 60);
      if (n.kind === 'timer' && (n.times ?? -1) >= 0 && state) caption = dim ? 'done' : `×${(n.times ?? 0) - state.timerFires}`;
      if (caption) {
        ctx.font = `600 ${Math.max(9, s * 0.2)}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = withAlpha(color, 0.85);
        ctx.fillText(caption, cx, cy + ringR + ringW);
      }
    }
  }

  /** A small red "−5" pill: an inhibited neuron's (negative) charge, at a glance. */
  private drawNegativeBadge(charge: number, x: number, y: number, s: number): void {
    const { ctx, palette: p } = this;
    const text = `−${-charge}`;
    const size = Math.max(9, Math.min(14, s * 0.22));
    ctx.font = `700 ${size}px ${UI_FONT}`;
    const w = ctx.measureText(text).width + size * 0.8;
    const hgt = size * 1.45;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt / 2);
    ctx.fillStyle = p.negCharge;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.strokeStyle = p.canvas;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.inkOnKind;
    ctx.fillText(text, x, y + size * 0.04);
  }

  /** Centred text inside a neuron, shrunk to fit. */
  private drawLabel(text: string, cx: number, cy: number, core: number, color: string, compact = false): void {
    const { ctx } = this;
    let size = core * (text.length <= 1 ? 1.15 : text.length === 2 ? 0.92 : 0.72) * (compact ? 0.88 : 1);
    ctx.font = `650 ${size}px ${UI_FONT}`;
    const w = ctx.measureText(text).width;
    const max = core * 1.75;
    if (w > max) {
      size *= max / w;
      ctx.font = `650 ${size}px ${UI_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy + size * 0.04);
  }

  /**
   * Segmented ring: one segment per unit of threshold, filled clockwise
   * as charge builds up; negative charge fills anticlockwise in red.
   */
  private drawChargeRing(cx: number, cy: number, r: number, w: number, color: string, charge: number, threshold: number): void {
    const { ctx, palette: p } = this;
    const top = -Math.PI / 2;
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    const segmented = threshold > 1 && threshold <= 24 && r * TAU / threshold > w * 1.6;
    const filled = Math.min(threshold, Math.abs(charge));
    const sign = charge < 0 ? -1 : 1;
    if (!segmented) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = withAlpha(color, 0.16);
      ctx.stroke();
      if (filled > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, top, top + (sign * TAU * filled) / threshold, sign < 0);
        ctx.strokeStyle = sign < 0 ? p.negCharge : color;
        ctx.stroke();
      }
      return;
    }
    const step = TAU / threshold;
    const gap = Math.min(0.22, step * 0.28);
    const track = new Path2D();
    const fill = new Path2D();
    for (let i = 0; i < threshold; i++) {
      // Positive charge fills segments clockwise from the top, negative anticlockwise.
      const index = sign > 0 ? i : threshold - 1 - i;
      const a0 = top + index * step + gap / 2;
      const a1 = a0 + step - gap;
      const target = i < filled ? fill : track;
      target.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      target.arc(cx, cy, r, a0, a1);
    }
    ctx.strokeStyle = withAlpha(color, 0.18);
    ctx.stroke(track);
    if (filled > 0) {
      ctx.strokeStyle = sign < 0 ? p.negCharge : color;
      ctx.stroke(fill);
    }
  }

  private drawTimerRing(cx: number, cy: number, r: number, w: number, color: string, frac: number, dim: boolean): void {
    const { ctx } = this;
    const top = -Math.PI / 2;
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = withAlpha(color, dim ? 0.1 : 0.18);
    ctx.stroke();
    if (frac > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, top, top + TAU * frac);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  private drawText(t: TextSpec, cam: Camera): void {
    const { ctx, palette: p } = this;
    const size = (t.size ?? 0.6) * cam.scale;
    if (size < 3.5) return;
    const at = cam.toScreen(t.x, t.y);
    if (at.y > this.height || at.y + size * 40 < 0) return;
    ctx.font = `500 ${size}px ${UI_FONT}`;
    ctx.textAlign = t.align ?? 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = p.text[t.tone ?? 'default'];
    t.text.split('\n').forEach((line, i) => ctx.fillText(line, at.x, at.y + i * size * 1.25));
  }

  private drawOverlays(scene: Scene, pos: (n: NeuronSpec) => { x: number; y: number }, now: number): void {
    const { ctx, palette: p } = this;
    const cam = scene.camera;
    const s = cam.scale;
    const { selection, hover, preview } = scene;
    const ring = (n: NeuronSpec, color: string, width: number, grow = 0) => {
      const at = pos(n);
      const c = cam.toScreen(at.x + 0.5, at.y + 0.5);
      ctx.beginPath();
      if (isSquare(n.kind)) {
        const h = s * (0.5 + grow) - 1;
        ctx.roundRect(c.x - h, c.y - h, h * 2, h * 2, s * 0.18);
      } else ctx.arc(c.x, c.y, s * (0.5 + grow) - 1, 0, TAU);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    // Hover.
    if (hover?.type === 'neuron' && !selection.neurons.has(hover.id)) {
      const n = scene.index.byId.get(hover.id);
      if (n) ring(n, withAlpha(p.accent, 0.45), 1.25);
    }
    if (hover?.type === 'text' && !selection.texts.has(hover.id)) {
      const t = scene.index.texts.get(hover.id);
      if (t) this.textOutline(t, cam, withAlpha(p.accent, 0.4), false);
    }
    if (hover?.type === 'cell' && scene.tool === 'place' && !preview) this.ghost(scene, hover.x, hover.y);

    // Selection (while dragging, the items being dragged, which only become
    // the selection once they have moved).
    const moving = preview?.type === 'move' ? preview : null;
    const invalid = !!moving && !moving.valid;
    for (const id of moving ? moving.neurons : selection.neurons) {
      const n = scene.index.byId.get(id);
      if (n) ring(n, invalid ? p.danger : p.accent, 1.75);
    }
    for (const id of moving ? moving.texts : selection.texts) {
      const t = scene.index.texts.get(id);
      if (!t) continue;
      const moved = preview?.type === 'move' ? { ...t, x: t.x + preview.dx, y: t.y + preview.dy } : t;
      this.textOutline(moved, cam, p.accent, true);
    }

    // Connect tool: picked source.
    if (scene.pendingSource) {
      const n = scene.index.byId.get(scene.pendingSource);
      if (n) {
        ring(n, p.accent, 2, 0.06);
        if (scene.pointer && !preview) {
          const target = hover?.type === 'neuron' || hover?.type === 'handle' ? scene.index.byId.get(hover.id) : undefined;
          this.rubberBand(n, target ? { x: target.x + 0.5, y: target.y + 0.5 } : scene.pointer, cam, p.accent, !!target);
        }
      }
    }

    // Connection handle.
    if (scene.handleFor && !preview) {
      const n = scene.index.byId.get(scene.handleFor);
      if (n) {
        const c = cam.toScreen(n.x + 1, n.y + 0.5);
        const r = Math.max(5, s * 0.11);
        const hot = hover?.type === 'handle';
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + (hot ? 1.5 : 0), 0, TAU);
        ctx.fillStyle = p.accent;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.canvas;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - r * 0.3, c.y - r * 0.42);
        ctx.lineTo(c.x + r * 0.32, c.y);
        ctx.lineTo(c.x - r * 0.3, c.y + r * 0.42);
        ctx.lineWidth = Math.max(1.4, r * 0.28);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = p.canvas;
        ctx.stroke();
      }
    }

    if (preview?.type === 'connect') {
      const from = scene.index.byId.get(preview.from);
      if (from) {
        const color = preview.removing ? p.danger : p.accent;
        let end = { x: preview.x, y: preview.y };
        if (preview.target) {
          const t = scene.index.byId.get(preview.target)!;
          end = { x: t.x + 0.5, y: t.y + 0.5 };
          ring(t, color, 2, 0.04);
        } else if (preview.newCell) {
          this.ghost(scene, preview.newCell.x, preview.newCell.y);
          end = { x: preview.newCell.x + 0.5, y: preview.newCell.y + 0.5 };
        }
        ring(from, color, 2, 0.04);
        this.rubberBand(from, end, cam, color, !!(preview.target || preview.newCell));
      }
    }

    if (preview?.type === 'marquee') {
      const a = cam.toScreen(Math.min(preview.x0, preview.x1), Math.min(preview.y0, preview.y1));
      const b = cam.toScreen(Math.max(preview.x0, preview.x1), Math.max(preview.y0, preview.y1));
      ctx.fillStyle = withAlpha(p.accent, 0.08);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(p.accent, 0.8);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    }

    if (scene.keyCursor) this.drawKeyCursor(scene, scene.keyCursor.x, scene.keyCursor.y);

    // Poke ripples with a floating "+1".
    for (const r of this.ripples) {
      const n = scene.index.byId.get(r.id);
      if (!n) continue;
      const t = (now - r.start) / RIPPLE_MS;
      if (t >= 1) continue;
      const c = cam.toScreen(n.x + 0.5, n.y + 0.5);
      if (r.charge === 0) {
        // Ignored (a timer): a muted ring that does not grow.
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.55, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = withAlpha(p.ink, 0.45 * (1 - t));
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // Reduced motion: the ring and the "+1" stay put and simply fade.
      const grow = this.reduced ? 0 : t;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * (0.5 + 0.45 * grow), 0, TAU);
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.strokeStyle = withAlpha(p.accent, 0.8 * (1 - t));
      ctx.stroke();
      ctx.font = `700 ${Math.max(11, s * 0.3)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = withAlpha(p.accent, 1 - t * t);
      ctx.fillText(r.charge > 0 ? `+${r.charge}` : `${r.charge}`, c.x, c.y - s * (0.5 + 0.35 * grow));
    }
  }

  /**
   * The demo's "ghost finger", like a phone's show-taps: a soft pad settles
   * onto a key just before the demo presses it, then lifts off with a ring.
   */
  private drawTaps(scene: Scene, now: number): void {
    const { ctx, palette: p } = this;
    const cam = scene.camera;
    const s = cam.scale;
    if (s < 6) return;
    const pad = (n: NeuronSpec, r: number, alpha: number) => {
      const c = cam.toScreen(n.x + 0.5, n.y + 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, TAU);
      ctx.fillStyle = withAlpha(p.ink, 0.22 * alpha);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.strokeStyle = withAlpha(p.ink, 0.7 * alpha);
      ctx.stroke();
      return c;
    };
    for (const t of scene.upcomingTaps) {
      const n = scene.index.byId.get(t.neuron);
      if (!n) continue;
      const k = 1 - Math.min(1, t.inTicks / Math.max(1, scene.tapLead));
      pad(n, s * 0.46 * (this.reduced ? 1 : 1 + 0.5 * (1 - k)), k * k);
    }
    for (const tap of this.taps) {
      const n = scene.index.byId.get(tap.id);
      if (!n) continue;
      const t = (now - tap.start) / TAP_MS;
      if (t >= 1) continue;
      const c = pad(n, s * 0.46, 1 - t);
      if (this.reduced) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * (0.5 + 0.55 * t), 0, TAU);
      ctx.lineWidth = Math.max(1, 2.5 * (1 - t));
      ctx.strokeStyle = withAlpha(p.ink, 0.55 * (1 - t));
      ctx.stroke();
    }
  }

  /**
   * The keyboard's cell cursor: corner brackets around a cell, with a faint
   * preview of the kind that 1-6 / Enter would place when the cell is free.
   */
  private drawKeyCursor(scene: Scene, x: number, y: number): void {
    const { ctx, palette: p } = this;
    const cam = scene.camera;
    const s = cam.scale;
    const free = !scene.index.byCell.has(cellKey(x, y));
    if (free && s >= 14) {
      const c = cam.toScreen(x + 0.5, y + 0.5);
      ctx.save();
      ctx.globalAlpha = 0.28;
      const ghost: NeuronSpec = { id: '', kind: scene.kind, x, y, threshold: 1 };
      if (scene.kind === 'note') ghost.note = 60;
      this.drawNeuron(ghost, c.x, c.y, s, scene, 0);
      ctx.restore();
    }
    const tl = cam.toScreen(x, y);
    const pad = Math.max(1, s * 0.02);
    const x0 = tl.x + pad;
    const y0 = tl.y + pad;
    const x1 = tl.x + s - pad;
    const y1 = tl.y + s - pad;
    const arm = Math.max(5, s * 0.26);
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
    }
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = p.accent;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private ghost(scene: Scene, x: number, y: number): void {
    const { ctx, palette: p } = this;
    const cam = scene.camera;
    const s = cam.scale;
    const c = cam.toScreen(x + 0.5, y + 0.5);
    ctx.save();
    ctx.globalAlpha = 0.5;
    const ghost: NeuronSpec = { id: '', kind: scene.kind, x, y, threshold: 1 };
    if (scene.kind === 'note') ghost.note = 60;
    this.drawNeuron(ghost, c.x, c.y, s, scene, 0);
    ctx.restore();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(p.accent, 0.6);
    const tl = cam.toScreen(x, y);
    ctx.strokeRect(tl.x + 1.5, tl.y + 1.5, s - 3, s - 3);
    ctx.setLineDash([]);
  }

  private rubberBand(from: NeuronSpec, to: { x: number; y: number }, cam: Camera, color: string, snapped: boolean): void {
    const { ctx } = this;
    const a = cam.toScreen(from.x + 0.5, from.y + 0.5);
    const b = cam.toScreen(to.x, to.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 4) return;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const start = cam.scale * 0.45;
    const end = snapped ? cam.scale * 0.5 : 0;
    const tip = { x: b.x - ux * end, y: b.y - uy * end };
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x + ux * start, a.y + uy * start);
    ctx.lineTo(tip.x - ux * 6, tip.y - uy * 6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
    const L = 11;
    const hw = 5.5;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * L - uy * hw, tip.y - uy * L + ux * hw);
    ctx.lineTo(tip.x - ux * L + uy * hw, tip.y - uy * L - ux * hw);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private textOutline(t: TextSpec, cam: Camera, color: string, solid: boolean): void {
    const { ctx } = this;
    const box = this.textBox(t);
    const pad = 0.12;
    const a = cam.toScreen(box.x - pad, box.y - pad);
    const w = (box.w + pad * 2) * cam.scale;
    const h = (box.h + pad * 2) * cam.scale;
    if (!solid) ctx.setLineDash([4, 3]);
    ctx.lineWidth = solid ? 1.5 : 1;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.roundRect(a.x, a.y, w, h, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Paths for every connection, optionally with some neurons shifted (move preview). */
function buildPaths(network: Network, index: NetIndex, move: Extract<Preview, { type: 'move' }> | null): PathSet {
  const byKey = new Map<string, ConnectionPath>();
  const byFrom = new Map<string, Map<string, ConnectionPath>>();
  const at = (n: NeuronSpec) => (move && move.neurons.has(n.id) ? { x: n.x + move.dx, y: n.y + move.dy, kind: n.kind } : n);
  for (const c of network.connections) {
    const from = index.byId.get(c.from);
    const to = index.byId.get(c.to);
    if (!from || !to) continue;
    const path = connectionPath(at(from), at(to), index.pairs.has(pairKey(c.to, c.from)));
    byKey.set(pairKey(c.from, c.to), path);
    if (!byFrom.has(c.from)) byFrom.set(c.from, new Map());
    byFrom.get(c.from)!.set(c.to, path);
  }
  return { byKey, byFrom };
}

/** Draw one neuron kind as an icon (tool rail, legend, inspector). */
export function drawKindIcon(canvas: HTMLCanvasElement, kind: NeuronKind, palette: Palette, cssSize: number): void {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  const s = cssSize;
  const c = s / 2;
  const color = palette.kinds[kind];
  if (kind === 'character') {
    const h = s * 0.4;
    ctx.beginPath();
    ctx.roundRect(c - h, c - h, h * 2, h * 2, s * 0.14);
    ctx.fillStyle = palette.digitTile;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(color, 0.5);
    ctx.stroke();
    ctx.font = `600 ${s * 0.56}px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.digitInk;
    ctx.fillText('7', c, c + s * 0.03);
    return;
  }
  const core = s * 0.29;
  ctx.beginPath();
  ctx.arc(c, c, core, 0, TAU);
  ctx.fillStyle = withAlpha(color, 0.22);
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = color;
  ctx.stroke();
  // A partly charged ring, so the icon reads as "integrates charge".
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.arc(c, c, s * 0.42, 0, TAU);
  ctx.strokeStyle = withAlpha(color, 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, s * 0.42, -Math.PI / 2, -Math.PI / 2 + (kind === 'timer' ? TAU * 0.7 : TAU * 0.4));
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  if (kind === 'negative') {
    ctx.beginPath();
    ctx.moveTo(c - core * 0.5, c);
    ctx.lineTo(c + core * 0.5, c);
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.stroke();
  } else if (kind === 'random') {
    ctx.beginPath();
    for (const k of [-1, 0, 1]) {
      ctx.moveTo(c + k * core * 0.38 + 1.3, c + k * core * 0.38);
      ctx.arc(c + k * core * 0.38, c + k * core * 0.38, Math.max(1, s * 0.04), 0, TAU);
    }
    ctx.fill();
  } else if (kind === 'timer') {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + core * 0.45, c - core * 0.45);
    ctx.lineWidth = Math.max(1.2, s * 0.055);
    ctx.stroke();
  } else if (kind === 'note') {
    ctx.font = `600 ${core * 1.3}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', c, c + core * 0.08);
  }
}

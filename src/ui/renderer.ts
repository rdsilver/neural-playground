// Canvas 2D renderer for the board. Stateless about the network (it is
// handed a Scene every frame) except for short-lived visual effects: fire
// flashes, poke ripples and the demo's ghost-finger taps, which are timed in
// real milliseconds so they look the same at every simulation speed. With
// prefers-reduced-motion it drops the decorative motion (pulse trails,
// growing rings, floating "+1"s) and keeps only what carries meaning.
//
// Big networks (thousands of neurons and wires, a display of Lamps) stay
// smooth: wire geometry is computed once per network, what holds still while
// the simulation runs (resting wires; neurons' cores, ring tracks and labels)
// is kept as bitmaps while the view holds still, and the rest is drawn with
// as few style changes as possible, each shape in its own draw call where a
// canvas is fastest that way.

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
import { connectionPath, endTangent, isSquare, pathLength, type ConnectionPath } from './geometry';
import { cellKey, pairKey, type NetIndex } from './netops';
import type { Selection, Tool } from './store';
import { mixColors, withAlpha, type Palette } from './theme';
import { CORNER_BL, CORNER_BR, CORNER_TL, CORNER_TR, lampCorners, restingStyle, wireStyle } from './wires';

const TAU = Math.PI * 2;
const FLASH_MS = 340;
const RIPPLE_MS = 700;
/** How long a demo's ghost-finger tap stays on a neuron. */
const TAP_MS = 650;
/** Length of a pulse's comet tail, in cells. */
const TRAIL_CELLS = 0.5;
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Wires per stroke() and arrowheads per fill(). Canvas rasterizes a path as
 * one shape, and thousands of overlapping contours in one path (say, every
 * arrow converging on a display) cost far more than the same work split
 * into batches: hundreds of milliseconds instead of a few.
 */
const STROKE_BATCH = 256;
const FILL_BATCH = 48;
/** From this many wires (round neurons) on, they are kept as a bitmap while the view holds still. */
const LAYER_MIN_WIRES = 400;
const LAYER_MIN_NEURONS = 300;
/** Frames the view must hold still before the layers are built. */
const STILL_FRAMES = 3;
/**
 * Wires into lamps: how far their colour fades towards the board's, and
 * the zoom (px per cell) from which they get arrowheads. They are drawn one
 * device pixel wide in an opaque colour, so hundreds of them converging on
 * a display stay faint where they overlap (and stay cheap to draw).
 */
const FAINT_FADE = 0.5;
const FAINT_ARROW_SCALE = 24;
/** Radius of a Lamp's LED and of its bloom, in cells. */
const LED_RADIUS = 0.36;
const GLOW_RADIUS = 1.05;

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

/** A connection's path plus what drawing and hit-testing need, computed once per network. */
export interface Wire extends ConnectionPath {
  from: string;
  to: string;
  /** Ends at a Lamp: drawn faint unless the lamp or the source is in focus (see wireStyle). */
  toLamp: boolean;
  /** One-way connections are straight; each half of a two-way pair is bowed. */
  straight: boolean;
  /** Bounding box, for culling and hit-testing. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Unit direction at the arrow tip, and the drawable length (world units). */
  dx: number;
  dy: number;
  len: number;
}

/** A lamp's tile on a screen: its (possibly dragged) cell and which corners are rounded. */
export interface LampTile {
  n: NeuronSpec;
  x: number;
  y: number;
  corners: number;
}

/**
 * Geometry for the current network, cached until it changes: connection
 * paths by pairKey(from, to), by source then target (pulse lookup and
 * hit-testing) and as a flat list, plus the lamps' screen tiles.
 */
export interface PathSet {
  byKey: Map<string, Wire>;
  byFrom: Map<string, Map<string, Wire>>;
  wires: Wire[];
  lamps: LampTile[];
}

interface PulseLayout {
  /** Flat [headX, headY, tailX, tailY, …] screen positions of excitatory pulses. */
  pos: number[];
  neg: number[];
  /** Wires carrying a pulse. */
  active: Set<Wire>;
}

/** A neuron to draw this frame, at its screen centre. */
interface NeuronItem {
  n: NeuronSpec;
  cx: number;
  cy: number;
  flash: number;
}

/** Round neurons of one kind to draw this frame: specs, and their screen centres as x, y pairs. */
interface RoundBatch {
  ns: NeuronSpec[];
  xy: number[];
}

/** Is a charge ring drawn as one segment per unit of threshold (or as a plain ring)? */
const isSegmented = (threshold: number, r: number, w: number) => threshold > 1 && threshold <= 24 && (r * TAU) / threshold > w * 1.6;

/** Part of the board kept as a bitmap while the view holds still, and what it was drawn for. */
interface Layer {
  canvas: HTMLCanvasElement;
  key: string;
  /** The paths or network it shows. */
  of: object | null;
  palette: Palette | null;
  selection?: Selection;
}

const newLayer = (): Layer => ({ canvas: document.createElement('canvas'), key: '', of: null, palette: null });

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
  private pathCache: { network: Network | null; paths: PathSet } = { network: null, paths: { byKey: new Map(), byFrom: new Map(), wires: [], lamps: [] } };
  private widthCache = new Map<string, number>();
  /** Camera (and canvas size) of the previous frame, and for how many frames it has not changed. */
  private lastViewKey = '';
  private stillFrames = 0;
  private wireLayer: Layer | null = null;
  private neuronLayer: Layer | null = null;
  private singles: NeuronItem[] = [];
  private flashing: NeuronItem[] = [];
  /** Bloom and LED sprites, drawn for the current palette. */
  private sprites: { palette: Palette; glow: HTMLCanvasElement; core: HTMLCanvasElement } | null = null;
  /** The lit lamps' bloom at low resolution (see drawBloom). */
  private bloom: { canvas: HTMLCanvasElement; key: string; palette: Palette | null } | null = null;
  /** withAlpha() results: the same few colours are asked for thousands of times a frame. */
  private alphaCache = new Map<string, string>();
  private faintWire = '';
  // Scratch lists reused every frame (no per-frame allocation for big networks).
  private scratch = { base: [] as Wire[], faint: [] as Wire[], active: [] as Wire[], in: [] as Wire[], out: [] as Wire[] };
  private lampItems: NeuronItem[] = [];
  private lampOn: NeuronItem[] = [];
  private lampOff: NeuronItem[] = [];
  private lampNeg: NeuronItem[] = [];
  private activeWires = new Set<Wire>();
  /** Round neurons to draw this frame, per kind, with their screen x, y (see drawRoundBatch). */
  private roundBatches = new Map<NeuronKind, RoundBatch>();
  private focus = new Set<string>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => (this.reduced = e.matches));
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.alphaCache.clear();
    this.faintWire = mixColors(palette.wire, palette.canvas, FAINT_FADE);
  }

  /** withAlpha, memoised (alpha rounded to 1/100). */
  private alpha(hex: string, a: number): string {
    const q = Math.round(a * 100);
    const key = `${hex}|${q}`;
    let c = this.alphaCache.get(key);
    if (c === undefined) {
      if (this.alphaCache.size > 4000) this.alphaCache.clear();
      c = withAlpha(hex, q / 100);
      this.alphaCache.set(key, c);
    }
    return c;
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

    // Wires (resting, then those carrying pulses), the lamps' screens over
    // them, wires in focus over the screens, then pulses: a display hides
    // the wiring behind it, but pulses still write across it like a beam.
    const pulses = this.layoutPulses(scene, paths, view);
    const focus = this.focusSet(scene);
    // The view has held still for a few frames: the cached layers can be
    // used (while it pans or zooms, building them every frame would only
    // add work).
    const viewKey = `${cam.x}|${cam.y}|${s}|${this.width}|${this.height}|${this.dpr}`;
    this.stillFrames = !move && viewKey === this.lastViewKey ? this.stillFrames + 1 : 0;
    this.lastViewKey = move ? '' : viewKey;
    const steady = this.stillFrames >= STILL_FRAMES;
    this.drawRestingWires(scene, paths, view, steady);
    this.drawLiveWires(scene, paths, view, pulses.active, focus, false);
    this.drawScreens(scene, paths.lamps, view);
    this.drawLiveWires(scene, paths, view, pulses.active, focus, true);
    this.drawPulses(scene, pulses);

    const lamps = this.lampItems;
    lamps.length = 0;
    // Round neurons are drawn in batches, a kind at a time (see drawRoundBatch).
    const batch = this.roundBatches;
    for (const b of batch.values()) b.ns.length = b.xy.length = 0;
    // Digits and timers one by one, after the round ones; flashing round
    // neurons get their flash drawn over them.
    const singles = this.singles;
    const flashes = this.flashing;
    singles.length = flashes.length = 0;
    const flashing = this.flashes.size > 0;
    for (const n of scene.network.neurons) {
      const at = pos(n);
      if (at.x + 1 < view.minX - 1 || at.x > view.maxX + 1 || at.y + 1 < view.minY - 1 || at.y > view.maxY + 1) continue;
      const cx = (at.x + 0.5 - cam.x) * s;
      const cy = (at.y + 0.5 - cam.y) * s;
      const flash = flashing ? this.flashLevel(n.id, now) : 0;
      if (n.kind === 'lamp') lamps.push({ n, cx, cy, flash });
      else if (n.kind === 'timer' || isSquare(n.kind)) singles.push({ n, cx, cy, flash });
      else {
        let b = batch.get(n.kind);
        if (!b) batch.set(n.kind, (b = { ns: [], xy: [] }));
        b.ns.push(n);
        b.xy.push(cx, cy);
        if (flash > 0) flashes.push({ n, cx, cy, flash });
      }
    }
    this.drawRoundNeurons(batch, s, scene, steady);
    for (const it of flashes) this.drawRoundFlash(it.n, it.cx, it.cy, s, scene, it.flash);
    for (const it of singles) this.drawNeuron(it.n, it.cx, it.cy, s, scene, it.flash);
    this.drawLamps(lamps, s, scene);

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

  /** Neurons whose wires are highlighted: the hovered one and a (not huge) selection. */
  private focusSet(scene: Scene): ReadonlySet<string> {
    const focus = this.focus;
    focus.clear();
    if (scene.selection.neurons.size <= 40) for (const id of scene.selection.neurons) focus.add(id);
    if (scene.hover?.type === 'neuron' || scene.hover?.type === 'handle') focus.add(scene.hover.id);
    return focus;
  }

  private wireWidth(s: number): number {
    return Math.max(1, s * 0.034);
  }

  /**
   * Every wire in its resting style (plain, or faint into a lamp). Big
   * networks keep this as a bitmap while the view holds still, so a running
   * board with thousands of wires redraws only what moves: while the view
   * pans or zooms they are drawn directly, once it has held still for a few
   * frames (STILL_FRAMES) the layer is built, and later frames copy it.
   */
  private drawRestingWires(scene: Scene, paths: PathSet, view: Bounds, steady: boolean): void {
    const cam = scene.camera;
    if (!steady || paths.wires.length < LAYER_MIN_WIRES) {
      this.strokeResting(this.ctx, paths, cam, view);
      return;
    }
    const layer = (this.wireLayer ??= newLayer());
    const key = this.lastViewKey;
    if (layer.key !== key || layer.of !== paths || layer.palette !== this.palette) {
      this.paintLayer(layer, () => this.strokeResting(this.ctx, paths, cam, view));
      layer.key = key;
      layer.of = paths;
    }
    this.blit(layer);
  }

  /** Redraw a layer: `paint` draws into it through this.ctx, at the board's size and scale. */
  private paintLayer(layer: Layer, paint: () => void): void {
    const c = layer.canvas;
    if (c.width !== this.canvas.width || c.height !== this.canvas.height) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    const lctx = c.getContext('2d')!;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, c.width, c.height);
    lctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const main = this.ctx;
    this.ctx = lctx;
    try {
      paint();
    } finally {
      this.ctx = main;
    }
    layer.palette = this.palette;
  }

  private blit(layer: Layer): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  /**
   * Round neurons. Big networks keep everything about them that holds still
   * while running (cores, ring tracks, labels) as a bitmap while the view
   * holds still, and draw only their charge live.
   */
  private drawRoundNeurons(batch: ReadonlyMap<NeuronKind, RoundBatch>, s: number, scene: Scene, steady: boolean): void {
    let count = 0;
    for (const b of batch.values()) count += b.ns.length;
    if (!steady || count < LAYER_MIN_NEURONS) {
      this.drawRoundBatch(batch, s, scene, 'all');
      return;
    }
    // Labels depend on focus (a hovered Note shows its note name).
    const hover = scene.hover?.type === 'neuron' ? scene.hover.id : '';
    const key = `${this.lastViewKey}|${hover}`;
    const layer = (this.neuronLayer ??= newLayer());
    if (layer.key !== key || layer.of !== scene.network || layer.palette !== this.palette || layer.selection !== scene.selection) {
      this.paintLayer(layer, () => this.drawRoundBatch(batch, s, scene, 'static'));
      layer.key = key;
      layer.of = scene.network;
      layer.selection = scene.selection;
    }
    this.blit(layer);
    this.drawRoundBatch(batch, s, scene, 'charge');
  }

  /** A round neuron's fire flash, over it: a glow around it, a brighter core, its label in contrast. */
  private drawRoundFlash(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number): void {
    const { ctx } = this;
    const color = this.palette.kinds[n.kind];
    const core = s * 0.3;
    const outer = s * 0.395 + s * (this.reduced ? 0.08 : 0.06 + 0.16 * (1 - flash));
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.moveTo(cx + core, cy);
    ctx.arc(cx, cy, core, 0, TAU, true);
    ctx.fillStyle = this.alpha(color, 0.28 * flash);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, TAU);
    ctx.fillStyle = this.alpha(color, 0.8 * flash);
    ctx.fill();
    if (s >= 14 && flash > 0.45) this.drawRoundDetails(n, cx, cy, s, scene, flash, 0, false, 0);
  }

  private strokeResting(ctx: CanvasRenderingContext2D, paths: PathSet, cam: Camera, view: Bounds): void {
    const { base, faint } = this.scratch;
    base.length = 0;
    faint.length = 0;
    for (const w of paths.wires) {
      if (w.maxX < view.minX || w.minX > view.maxX || w.maxY < view.minY || w.minY > view.maxY) continue;
      (restingStyle(w.toLamp) === 'faint' ? faint : base).push(w);
    }
    const s = cam.scale;
    const width = this.wireWidth(s);
    this.strokeWires(ctx, faint, cam, this.faintWire, 1 / this.dpr, s >= FAINT_ARROW_SCALE);
    this.strokeWires(ctx, base, cam, this.palette.wire, width, s >= 7);
    base.length = 0;
    faint.length = 0;
  }

  /**
   * Wires drawn over the resting ones: under the lamp screens, those
   * carrying a pulse; over them, those of focused neurons and the hovered
   * and selected wire. Only these wires are visited (via the network
   * index), never the whole list.
   */
  private drawLiveWires(scene: Scene, paths: PathSet, view: Bounds, active: ReadonlySet<Wire>, focus: ReadonlySet<string>, over: boolean): void {
    const { palette: p, ctx } = this;
    const cam = scene.camera;
    const s = cam.scale;
    const width = this.wireWidth(s);
    const visible = (w: Wire) => !(w.maxX < view.minX || w.minX > view.maxX || w.maxY < view.minY || w.minY > view.maxY);
    const sel = scene.selection.connection;
    const selWire = sel ? paths.byKey.get(pairKey(sel.from, sel.to)) : undefined;
    const hov = scene.hover?.type === 'connection' ? paths.byKey.get(pairKey(scene.hover.from, scene.hover.to)) : undefined;
    if (!over) {
      const list = this.scratch.active;
      list.length = 0;
      for (const w of active) {
        if (w !== selWire && w !== hov && wireStyle(w.from, w.to, w.toLamp, focus, true) === 'active' && visible(w)) list.push(w);
      }
      this.strokeWires(ctx, list, cam, p.wireActive, width, s >= 7);
      list.length = 0;
      return;
    }
    const ins = this.scratch.in;
    const outs = this.scratch.out;
    ins.length = 0;
    outs.length = 0;
    for (const id of focus) {
      for (const to of scene.index.outgoing.get(id) ?? []) {
        const w = paths.byFrom.get(id)?.get(to);
        if (w && w !== selWire && w !== hov && visible(w)) outs.push(w);
      }
      for (const from of scene.index.incoming.get(id) ?? []) {
        // A wire between two focused neurons is drawn once, as outgoing.
        if (focus.has(from)) continue;
        const w = paths.byFrom.get(from)?.get(id);
        if (w && w !== selWire && w !== hov && visible(w)) ins.push(w);
      }
    }
    this.strokeWires(ctx, ins, cam, p.wireIn, width * 1.15, s >= 7);
    this.strokeWires(ctx, outs, cam, p.accent, width * 1.3, s >= 7);
    ins.length = 0;
    outs.length = 0;
    if (hov) this.strokeWires(ctx, [hov], cam, this.alpha(p.accent, 0.75), width * 1.8, true);
    if (selWire) this.strokeWires(ctx, [selWire], cam, p.accent, width * 2.2, true);
  }

  /** Stroke wires in one colour (in batches, see STROKE_BATCH), then fill their arrowheads. */
  private strokeWires(ctx: CanvasRenderingContext2D, wires: readonly Wire[], cam: Camera, color: string, width: number, arrows: boolean): void {
    if (!wires.length) return;
    const s = cam.scale;
    const ox = cam.x;
    const oy = cam.y;
    const arrowLen = Math.min(11, Math.max(4.5, s * 0.2)) * (width > 2 ? 1.15 : 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let n = 0;
    for (const w of wires) {
      const len = w.len * s;
      // Stop the line inside the arrowhead so its tip stays sharp.
      const back = arrows ? Math.min(Math.min(arrowLen, len * 0.9) * 0.6, len) : 0;
      const ex = (w.x1 - ox) * s - w.dx * back;
      const ey = (w.y1 - oy) * s - w.dy * back;
      ctx.moveTo((w.x0 - ox) * s, (w.y0 - oy) * s);
      if (w.straight) ctx.lineTo(ex, ey);
      else ctx.quadraticCurveTo((w.cx - ox) * s, (w.cy - oy) * s, ex, ey);
      if (++n === STROKE_BATCH) {
        ctx.stroke();
        ctx.beginPath();
        n = 0;
      }
    }
    if (n) ctx.stroke();
    if (!arrows) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    n = 0;
    for (const w of wires) {
      const L = Math.min(arrowLen, w.len * s * 0.9);
      const hw = L * 0.52;
      const x = (w.x1 - ox) * s;
      const y = (w.y1 - oy) * s;
      const { dx, dy } = w;
      ctx.moveTo(x, y);
      ctx.lineTo(x - dx * L - dy * hw, y - dy * L + dx * hw);
      ctx.lineTo(x - dx * L * 0.78, y - dy * L * 0.78);
      ctx.lineTo(x - dx * L + dy * hw, y - dy * L - dx * hw);
      ctx.closePath();
      if (++n === FILL_BATCH) {
        ctx.fill();
        ctx.beginPath();
        n = 0;
      }
    }
    if (n) ctx.fill();
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
    const active = this.activeWires;
    active.clear();
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
    // Each trail and head is its own draw: a canvas draws a lone line or dot
    // much faster than one path of hundreds of them (dense screens most).
    const trails = (list: number[], color: string) => {
      ctx.save();
      ctx.globalCompositeOperation = p.glowBlend;
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      for (const [reach, width] of [
        [1, 0.9],
        [0.45, 1.5],
      ] as const) {
        ctx.lineWidth = core * width;
        for (let i = 0; i < list.length; i += 4) {
          const hx = list[i]!;
          const hy = list[i + 1]!;
          ctx.beginPath();
          ctx.moveTo(hx + (list[i + 2]! - hx) * reach, hy + (list[i + 3]! - hy) * reach);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    /** Heads: one draw each (fill, and the outline for inhibitory pulses), or squares in one path for crowds. */
    const heads = (list: number[], r: number, outline: boolean) => {
      if (cheap) {
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 4) ctx.rect(list[i]! - r, list[i + 1]! - r, r * 2, r * 2);
        ctx.fill();
        if (outline) ctx.stroke();
        return;
      }
      for (let i = 0; i < list.length; i += 4) {
        ctx.beginPath();
        ctx.arc(list[i]!, list[i + 1]!, r, 0, TAU);
        ctx.fill();
        if (outline) ctx.stroke();
      }
    };
    if (pos.length) {
      if (!plain) trails(pos, p.pulsePosGlow);
      ctx.fillStyle = p.pulsePos;
      heads(pos, core, false);
    }
    if (neg.length) {
      if (!plain) trails(neg, p.pulseNegGlow);
      ctx.fillStyle = p.canvas;
      ctx.lineWidth = Math.max(1.4, s * 0.04);
      ctx.strokeStyle = p.pulseNeg;
      heads(neg, core * 1.05, true);
    }
  }

  private drawNeuron(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number): void {
    if (n.kind === 'lamp') {
      // One lamp on its own (a placement ghost): its tile, then its LED.
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(cx - s / 2, cy - s / 2, s, s, Math.min(s * 0.2, 10));
      ctx.fillStyle = this.palette.lampScreen;
      ctx.fill();
      this.drawLamps([{ n, cx, cy, flash }], s, scene);
    } else if (isSquare(n.kind)) this.drawDigit(n, cx, cy, s, scene, flash);
    else this.drawRound(n, cx, cy, s, scene, flash);
  }

  /**
   * The dark screen behind lamps: a whole-cell tile per lamp, all in one
   * path so neighbouring tiles merge into one panel without seams, rounded
   * only at the panel's outer corners.
   */
  private drawScreens(scene: Scene, tiles: readonly LampTile[], view: Bounds): void {
    if (!tiles.length) return;
    const { ctx } = this;
    const cam = scene.camera;
    const s = cam.scale;
    const r = Math.min(s * 0.2, 10);
    // Tiles overlap their right and bottom neighbours by a hair, so
    // anti-aliasing never shows a seam between them.
    const size = s + Math.min(0.5, s * 0.05);
    ctx.beginPath();
    for (const t of tiles) {
      if (t.x + 1 < view.minX || t.x > view.maxX || t.y + 1 < view.minY || t.y > view.maxY) continue;
      const x = (t.x - cam.x) * s;
      const y = (t.y - cam.y) * s;
      const c = t.corners;
      if (!c || s < 4) ctx.rect(x, y, size, size);
      else ctx.roundRect(x, y, size, size, [c & CORNER_TL ? r : 0, c & CORNER_TR ? r : 0, c & CORNER_BR ? r : 0, c & CORNER_BL ? r : 0]);
    }
    ctx.fillStyle = this.palette.lampScreen;
    ctx.fill();
  }

  /**
   * Lamps as LEDs on their screen: unlit ones dark with a faint rim (a red
   * rim when their charge is negative), lit ones amber with a hot centre
   * and a soft bloom that runs into lit neighbours, so a lit row reads as
   * one bright stroke. Drawn in a few batched paths whatever the count; at
   * low zoom just filled dots.
   */
  private drawLamps(items: readonly NeuronItem[], s: number, scene: Scene): void {
    if (!items.length) return;
    const { ctx, palette: p } = this;
    const on = this.lampOn;
    const off = this.lampOff;
    const neg = this.lampNeg;
    on.length = off.length = neg.length = 0;
    for (const it of items) {
      const c = scene.sim.charge(it.n.id);
      (c > 0 ? on : c < 0 ? neg : off).push(it);
    }
    const r = s * LED_RADIUS;
    /** Fill (and/or stroke) a dot per lamp, in the current styles: one draw each, as a canvas draws lone circles fastest; tiny squares in one path when zoomed far out. */
    const dots = (list: readonly NeuronItem[], radius: number, fill: boolean, stroke: boolean) => {
      if (s < 4) {
        ctx.beginPath();
        for (const it of list) ctx.rect(it.cx - radius, it.cy - radius, radius * 2, radius * 2);
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
        return;
      }
      for (const it of list) {
        ctx.beginPath();
        ctx.arc(it.cx, it.cy, radius, 0, TAU);
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
      }
    };

    // Unlit LEDs with a faint rim; negative ones tinted, with a red rim.
    const rim = Math.max(1, s * 0.035);
    if (off.length) {
      ctx.fillStyle = p.lampOff;
      ctx.lineWidth = rim;
      ctx.strokeStyle = p.lampRim;
      if (s >= 8) {
        dots(off, r, true, false);
        dots(off, r - rim / 2, false, true);
      } else dots(off, r, true, false);
    }
    if (neg.length) {
      ctx.fillStyle = p.lampOff;
      dots(neg, r, true, false);
      ctx.fillStyle = this.alpha(p.negCharge, 0.2);
      if (s >= 4) {
        const w = Math.max(1, s * 0.05);
        ctx.lineWidth = w;
        ctx.strokeStyle = this.alpha(p.negCharge, 0.8);
        dots(neg, r - w / 2, true, true);
      } else dots(neg, r, true, false);
    }

    // Lit LEDs: bloom (added light), then the LED with its hot centre.
    if (on.length) {
      if (s >= 5) this.drawBloom(on, s);
      if (s >= 10) {
        const { core } = this.lampSprites();
        for (const it of on) ctx.drawImage(core, it.cx - r, it.cy - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = p.lampOn;
        dots(on, r, true, false);
      }
    }

    // A lamp that fires (its charge reached the threshold) flashes a ring.
    for (const it of items) {
      if (it.flash <= 0 || s < 5) continue;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, r + s * (this.reduced ? 0.07 : 0.04 + 0.14 * (1 - it.flash)), 0, TAU);
      ctx.lineWidth = Math.max(1.2, s * 0.05);
      ctx.strokeStyle = this.alpha(p.lampHot, 0.85 * it.flash);
      ctx.stroke();
    }
    if (s < 14) return;
    for (const it of items) {
      if (!it.n.label) continue;
      const lit = scene.sim.charge(it.n.id) > 0;
      this.drawLabel(it.n.label, it.cx, it.cy, r * 0.84, lit ? p.lampInk : p.lampLabel);
    }
  }

  /**
   * The lit lamps' bloom, drawn at low resolution into a small canvas
   * (a smooth glow loses nothing) and laid over the board in one draw.
   * Redrawn only when the lit lamps or the view change.
   */
  private drawBloom(on: readonly NeuronItem[], s: number): void {
    const g = s * GLOW_RADIUS;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let hash = on.length;
    for (const it of on) {
      if (it.cx - g < x0) x0 = it.cx - g;
      if (it.cy - g < y0) y0 = it.cy - g;
      if (it.cx + g > x1) x1 = it.cx + g;
      if (it.cy + g > y1) y1 = it.cy + g;
      hash = (Math.imul(hash, 31) + Math.round(it.cx * 4)) | 0;
      hash = (Math.imul(hash, 31) + Math.round(it.cy * 4)) | 0;
    }
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.width, Math.ceil(x1));
    y1 = Math.min(this.height, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    // Bloom pixels per CSS pixel: about a dozen per cell is plenty.
    const q = Math.min(this.dpr, 12 / s, 2048 / (x1 - x0), 2048 / (y1 - y0));
    const bw = Math.ceil((x1 - x0) * q);
    const bh = Math.ceil((y1 - y0) * q);
    const key = `${hash}|${x0}|${y0}|${x1}|${y1}|${q}`;
    const bloom = (this.bloom ??= { canvas: document.createElement('canvas'), key: '', palette: null });
    if (bloom.key !== key || bloom.palette !== this.palette) {
      const c = bloom.canvas;
      if (c.width < bw || c.height < bh) {
        c.width = Math.max(c.width, bw);
        c.height = Math.max(c.height, bh);
      }
      const b = c.getContext('2d')!;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.clearRect(0, 0, bw, bh);
      b.globalCompositeOperation = 'lighter';
      const { glow } = this.lampSprites();
      for (const it of on) b.drawImage(glow, (it.cx - g - x0) * q, (it.cy - g - y0) * q, g * 2 * q, g * 2 * q);
      bloom.key = key;
      bloom.palette = this.palette;
    }
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = this.palette.glowBlend;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bloom.canvas, 0, 0, bw, bh, x0, y0, bw / q, bh / q);
    ctx.restore();
  }

  /** The bloom and the lit LED, drawn once per palette and scaled per frame. */
  private lampSprites(): { glow: HTMLCanvasElement; core: HTMLCanvasElement } {
    const p = this.palette;
    if (this.sprites?.palette === p) return this.sprites;
    const make = (size: number, paint: (ctx: CanvasRenderingContext2D, c: number) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      paint(canvas.getContext('2d')!, size / 2);
      return canvas;
    };
    const a = p.lampGlow;
    const glow = make(128, (ctx, c) => {
      // The LED's edge sits at LED_RADIUS / GLOW_RADIUS of the sprite's radius.
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, withAlpha(p.lampOn, a));
      g.addColorStop(0.3, withAlpha(p.lampOn, a * 0.7));
      g.addColorStop(0.55, withAlpha(p.lampOn, a * 0.22));
      g.addColorStop(1, withAlpha(p.lampOn, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c * 2, c * 2);
    });
    const core = make(96, (ctx, c) => {
      const g = ctx.createRadialGradient(c * 0.86, c * 0.84, 0, c, c, c);
      g.addColorStop(0, p.lampHot);
      g.addColorStop(0.42, p.lampOn);
      g.addColorStop(1, p.lampOn);
      ctx.beginPath();
      ctx.arc(c, c, c, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
    });
    this.sprites = { palette: p, glow, core };
    return this.sprites;
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
      ctx.fillStyle = this.alpha(p.accent, 0.3 * flash);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(cx - half, cy - half, half * 2, half * 2, s * 0.14);
    ctx.fillStyle = p.digitTile;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeStyle = flash > 0 ? this.alpha(p.accent, 0.5 + 0.5 * flash) : this.alpha(color, 0.38);
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
      ctx.fillStyle = this.alpha(p.ink, 0.6);
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
      ctx.fillStyle = this.alpha(color, 0.28 * flash);
      ctx.fill();
    }

    // Core.
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, TAU);
    ctx.fillStyle = this.alpha(color, dim ? 0.08 : 0.2 + 0.8 * flash);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.strokeStyle = dim ? this.alpha(color, 0.45) : color;
    ctx.stroke();
    if (s < 6) return;

    // Ring: charge towards threshold, or a timer's countdown.
    const charge = scene.sim.charge(n.id);
    if (s >= 10) {
      if (n.kind === 'timer') this.drawTimerRing(cx, cy, ringR, ringW, color, timerFrac, dim);
      else this.drawChargeRing(cx, cy, ringR, ringW, color, charge, n.threshold);
    }
    if (s < 14) return;
    this.drawRoundDetails(n, cx, cy, s, scene, flash, charge, dim, timerFrac);
  }

  /** What a round neuron shows from 14 px per cell: a negative badge, its label or glyph, a caption. */
  private drawRoundDetails(n: NeuronSpec, cx: number, cy: number, s: number, scene: Scene, flash: number, charge: number, dim: boolean, timerFrac: number): void {
    const { ctx, palette: p } = this;
    const color = p.kinds[n.kind];
    const core = s * 0.3;
    const ringR = s * 0.395;
    const ringW = Math.max(1.4, s * 0.06);
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
      ctx.strokeStyle = dim ? this.alpha(color, 0.5) : ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, s * 0.03), 0, TAU);
      ctx.fillStyle = dim ? this.alpha(color, 0.5) : ink;
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
      const state = n.kind === 'timer' ? scene.sim.state(n.id) : undefined;
      if (n.kind === 'timer' && (n.times ?? -1) >= 0 && state) caption = dim ? 'done' : `×${(n.times ?? 0) - state.timerFires}`;
      if (caption) {
        ctx.font = `600 ${Math.max(9, s * 0.2)}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = this.alpha(color, 0.85);
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
  /**
   * Segmented ring: one segment per unit of threshold, filled clockwise as
   * charge builds up; negative charge fills anticlockwise in red.
   */
  private drawChargeRing(cx: number, cy: number, r: number, w: number, color: string, charge: number, threshold: number): void {
    const { ctx, palette: p } = this;
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = this.alpha(color, isSegmented(threshold, r, w) ? 0.18 : 0.16);
    this.ringTrack(cx, cy, r, w, threshold);
    if (charge === 0) return;
    ctx.strokeStyle = charge < 0 ? p.negCharge : color;
    this.ringCharge(cx, cy, r, w, charge, threshold);
  }

  /** Stroke a ring's track (in the current style): a plain circle, or one arc per unit of threshold. */
  private ringTrack(cx: number, cy: number, r: number, w: number, threshold: number): void {
    const { ctx } = this;
    ctx.beginPath();
    if (!isSegmented(threshold, r, w)) ctx.arc(cx, cy, r, 0, TAU);
    else this.ringSegments(cx, cy, r, threshold, 0, threshold);
    ctx.stroke();
  }

  /** Stroke the charged part of a ring (in the current style), over its track. */
  private ringCharge(cx: number, cy: number, r: number, w: number, charge: number, threshold: number): void {
    const { ctx } = this;
    const filled = Math.min(threshold, Math.abs(charge));
    const top = -Math.PI / 2;
    ctx.beginPath();
    if (!isSegmented(threshold, r, w)) {
      const sweep = (TAU * filled) / threshold;
      ctx.arc(cx, cy, r, top, charge < 0 ? top - sweep : top + sweep, charge < 0);
    } else if (charge > 0) this.ringSegments(cx, cy, r, threshold, 0, filled);
    else this.ringSegments(cx, cy, r, threshold, threshold - filled, threshold);
    ctx.stroke();
  }

  /** Add ring segments [from, to) to the current path, clockwise from the top. */
  private ringSegments(cx: number, cy: number, r: number, threshold: number, from: number, to: number): void {
    const { ctx } = this;
    const step = TAU / threshold;
    const gap = Math.min(0.22, step * 0.28);
    for (let i = from; i < to; i++) {
      const a0 = -Math.PI / 2 + i * step + gap / 2;
      ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      ctx.arc(cx, cy, r, a0, a0 + step - gap);
    }
  }

  /**
   * Round neurons (not timers), a kind at a time, with one style per pass:
   * cores, ring tracks, charge, then the per-neuron details (labels,
   * glyphs) when zoomed in enough to show them. `part` picks what to draw:
   * everything, only what holds still while the network runs (for the
   * neuron layer, see drawRoundNeurons), or only the charge on the rings.
   * Every ring is its own draw call: a canvas draws a lone circle or arc far
   * faster than one path holding many.
   */
  private drawRoundBatch(batch: ReadonlyMap<NeuronKind, RoundBatch>, s: number, scene: Scene, part: 'all' | 'static' | 'charge'): void {
    const { ctx, palette: p } = this;
    const core = s * 0.3;
    const ringR = s * 0.395;
    const ringW = Math.max(1.4, s * 0.06);
    const outline = Math.max(1, s * 0.035);
    const statics = part !== 'charge';
    for (const [kind, { ns, xy }] of batch) {
      if (!ns.length) continue;
      const color = p.kinds[kind];
      if (statics) {
        ctx.lineWidth = outline;
        ctx.fillStyle = this.alpha(color, 0.2);
        ctx.strokeStyle = color;
        // Many outlines in one path are cheap only as hairlines (one device pixel).
        const step = outline * this.dpr <= 1 ? 800 : 2;
        for (let start = 0; start < xy.length; start += step) {
          ctx.beginPath();
          const end = Math.min(xy.length, start + step);
          for (let i = start; i < end; i += 2) {
            ctx.moveTo(xy[i]! + core, xy[i + 1]!);
            ctx.arc(xy[i]!, xy[i + 1]!, core, 0, TAU);
          }
          ctx.fill();
          ctx.stroke();
        }
      }
      if (s < 10) continue;
      ctx.lineWidth = ringW;
      ctx.lineCap = 'butt';
      if (statics) {
        for (const segmented of [false, true]) {
          ctx.strokeStyle = this.alpha(color, segmented ? 0.18 : 0.16);
          for (let i = 0; i < ns.length; i++) {
            if (isSegmented(ns[i]!.threshold, ringR, ringW) === segmented) this.ringTrack(xy[2 * i]!, xy[2 * i + 1]!, ringR, ringW, ns[i]!.threshold);
          }
        }
      }
      if (part === 'static') continue;
      for (const negative of [false, true]) {
        ctx.strokeStyle = negative ? p.negCharge : color;
        for (let i = 0; i < ns.length; i++) {
          const charge = scene.sim.charge(ns[i]!.id);
          if (charge !== 0 && charge < 0 === negative) this.ringCharge(xy[2 * i]!, xy[2 * i + 1]!, ringR, ringW, charge, ns[i]!.threshold);
        }
      }
    }
    if (s < 14) return;
    for (const { ns, xy } of batch.values()) {
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]!;
        const charge = part === 'static' ? 0 : scene.sim.charge(n.id);
        if (statics) this.drawRoundDetails(n, xy[2 * i]!, xy[2 * i + 1]!, s, scene, 0, charge, false, 0);
        else if (charge < 0 && s >= 16) this.drawNegativeBadge(charge, xy[2 * i]! + ringR * 0.8, xy[2 * i + 1]! - ringR * 0.8, s);
      }
    }
  }

  private drawTimerRing(cx: number, cy: number, r: number, w: number, color: string, frac: number, dim: boolean): void {
    const { ctx } = this;
    const top = -Math.PI / 2;
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = this.alpha(color, dim ? 0.1 : 0.18);
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
      if (n) ring(n, this.alpha(p.accent, 0.45), 1.25);
    }
    if (hover?.type === 'text' && !selection.texts.has(hover.id)) {
      const t = scene.index.texts.get(hover.id);
      if (t) this.textOutline(t, cam, this.alpha(p.accent, 0.4), false);
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
      ctx.fillStyle = this.alpha(p.accent, 0.08);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.alpha(p.accent, 0.8);
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
        ctx.strokeStyle = this.alpha(p.ink, 0.45 * (1 - t));
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // Reduced motion: the ring and the "+1" stay put and simply fade.
      const grow = this.reduced ? 0 : t;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * (0.5 + 0.45 * grow), 0, TAU);
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.strokeStyle = this.alpha(p.accent, 0.8 * (1 - t));
      ctx.stroke();
      ctx.font = `700 ${Math.max(11, s * 0.3)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = this.alpha(p.accent, 1 - t * t);
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
      ctx.fillStyle = this.alpha(p.ink, 0.22 * alpha);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.strokeStyle = this.alpha(p.ink, 0.7 * alpha);
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
      ctx.strokeStyle = this.alpha(p.ink, 0.55 * (1 - t));
      ctx.stroke();
    }
  }

  /**
   * The keyboard's cell cursor: corner brackets around a cell, with a faint
   * preview of the kind that a number key / Enter would place when the cell is free.
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
    ctx.strokeStyle = this.alpha(p.accent, 0.6);
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
  const byKey = new Map<string, Wire>();
  const byFrom = new Map<string, Map<string, Wire>>();
  const wires: Wire[] = [];
  const at = (n: NeuronSpec) => (move && move.neurons.has(n.id) ? { x: n.x + move.dx, y: n.y + move.dy, kind: n.kind } : n);
  for (const c of network.connections) {
    const from = index.byId.get(c.from);
    const to = index.byId.get(c.to);
    const key = pairKey(c.from, c.to);
    if (!from || !to || byKey.has(key)) continue;
    const twoWay = index.pairs.has(pairKey(c.to, c.from));
    const path = connectionPath(at(from), at(to), twoWay);
    const tip = endTangent(path);
    const wire: Wire = {
      ...path,
      from: c.from,
      to: c.to,
      toLamp: to.kind === 'lamp',
      straight: !twoWay,
      minX: Math.min(path.x0, path.cx, path.x1),
      minY: Math.min(path.y0, path.cy, path.y1),
      maxX: Math.max(path.x0, path.cx, path.x1),
      maxY: Math.max(path.y0, path.cy, path.y1),
      dx: tip.x,
      dy: tip.y,
      len: pathLength(path),
    };
    wires.push(wire);
    byKey.set(key, wire);
    let targets = byFrom.get(c.from);
    if (!targets) byFrom.set(c.from, (targets = new Map()));
    targets.set(c.to, wire);
  }
  const lampSpecs = network.neurons.filter((n) => n.kind === 'lamp');
  const cells = lampSpecs.map(at);
  const corners = lampCorners(cells);
  const lamps = lampSpecs.map((n, i) => ({ n, x: cells[i]!.x, y: cells[i]!.y, corners: corners[i]! }));
  return { byKey, byFrom, wires, lamps };
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
  if (kind === 'lamp') {
    // A tiny dot-matrix screen with a lit snake on it.
    const h = s * 0.44;
    ctx.beginPath();
    ctx.roundRect(c - h, c - h, h * 2, h * 2, s * 0.14);
    ctx.fillStyle = palette.lampScreen;
    ctx.fill();
    const lit = [1, 1, 0, 0, 1, 0, 0, 1, 1];
    const pitch = (h * 2) / 3;
    const r = pitch * 0.36;
    for (let i = 0; i < 9; i++) {
      const x = c - h + pitch * ((i % 3) + 0.5);
      const y = c - h + pitch * (Math.floor(i / 3) + 0.5);
      if (lit[i]) {
        ctx.beginPath();
        ctx.arc(x, y, r * 1.7, 0, TAU);
        ctx.fillStyle = withAlpha(palette.lampOn, 0.22);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = lit[i] ? palette.lampOn : palette.lampOff;
      ctx.fill();
    }
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

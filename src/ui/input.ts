// Pointer and wheel input on the board: a small gesture state machine that
// turns presses, drags, pinches and clicks into tool actions. Keyboard
// shortcuts live in app.ts; this file only knows about the canvas.

import type { Camera, Point } from './camera';
import { distanceToPath } from './geometry';
import { canMove, cellKey, hasConnection } from './netops';
import type { Hover, Preview, Renderer } from './renderer';
import type { Store } from './store';

/** What the app does in response to board gestures. */
export interface BoardHost {
  readonly running: boolean;
  poke(id: string): void;
  /** Place a neuron of the current kind; returns its id (null if the cell is taken). */
  place(x: number, y: number): string | null;
  /** Toggle from -> to (both directions when twoWay). */
  connect(from: string, to: string, twoWay: boolean): void;
  /** Place a new neuron at (x, y) and connect `from` to it. */
  connectToNew(from: string, x: number, y: number, twoWay: boolean): void;
  /** Move the selection by whole cells; false if blocked. */
  moveSelection(dx: number, dy: number): boolean;
  addText(x: number, y: number): void;
  editText(id: string): void;
  /** Right-click (or long gesture equivalent): show the board's context menu. */
  contextMenu(clientX: number, clientY: number, hit: Hit, keyboard?: boolean): void;
  /** Something visual changed: draw a frame. */
  invalidate(): void;
}

export type Hit = Hover | { type: 'empty'; x: number; y: number };

type Press = { type: 'press'; hit: Hit; start: Point; shift: boolean; alt: boolean; touch: boolean };

/** Drags remember the press they grew from, so a drag that goes nowhere still counts as a click. */
type Gesture =
  | Press
  /** menuAt: where a right-button press started, until it moves (then it is just a pan). */
  | { type: 'pan'; last: Point; menuAt?: Point }
  | { type: 'pinch'; mid: Point; dist: number }
  | { type: 'move'; from: Point; startCell: Point; press: Press }
  | { type: 'connect'; from: string; press: Press }
  | { type: 'marquee'; start: Point; additive: boolean };

const DRAG_PX = 4;
const TOUCH_DRAG_PX = 9;

export class BoardInput {
  hover: Hover | null = null;
  preview: Preview | null = null;
  pendingSource: string | null = null;
  pointer: Point | null = null;
  private gesture: Gesture | null = null;
  private pointers = new Map<number, Point>();
  private spaceHeld = false;
  private spacePanned = false;
  private shiftHeld = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly store: Store,
    private readonly renderer: Renderer,
    private readonly host: BoardHost,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onCancel(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.gesture) {
        this.pointer = null;
        this.setHover(null);
      }
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      const hit = this.hitTest(this.local(e));
      if (hit.type === 'text') this.host.editText(hit.id);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // A touch long-press (mouse right-clicks are handled on pointerup).
      const g = this.gesture;
      if (g?.type === 'press' && g.touch) {
        this.gesture = null;
        this.host.contextMenu(e.clientX, e.clientY, g.hit);
      }
    });
  }

  /** Neuron whose connection handle is shown (select tool only). */
  get handleFor(): string | null {
    if (this.store.tool !== 'select' || this.gesture?.type === 'move') return null;
    if (this.hover?.type === 'neuron' || this.hover?.type === 'handle') return this.hover.id;
    return this.store.selectedNeuron?.id ?? null;
  }

  /** True while a drag or pinch is in progress. */
  get busy(): boolean {
    return this.gesture !== null && this.gesture.type !== 'press';
  }

  /** Space bar held: drags pan. Returns true on release if it was used to pan. */
  setSpace(held: boolean): boolean {
    this.spaceHeld = held;
    if (held) {
      this.spacePanned = false;
      this.canvas.style.cursor = 'grab';
      return false;
    }
    this.updateCursor();
    return this.spacePanned;
  }

  setShift(held: boolean): void {
    if (this.shiftHeld === held) return;
    this.shiftHeld = held;
    if (this.preview?.type === 'connect') this.refreshConnectPreview();
  }

  /** Abort the current gesture or pending connection (Escape). Returns true if something was cancelled. */
  cancel(): boolean {
    const had = this.gesture !== null || this.pendingSource !== null;
    this.gesture = null;
    this.preview = null;
    this.pendingSource = null;
    this.host.invalidate();
    return had;
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** What is under a screen point, honouring the active tool. */
  hitTest(sp: Point): Hit {
    const cam = this.camera;
    const w = cam.toWorld(sp.x, sp.y);
    const tool = this.store.tool;
    const { index } = this.store;

    const handle = this.handleFor;
    if (handle) {
      const n = index.byId.get(handle);
      if (n) {
        const c = cam.toScreen(n.x + 1, n.y + 0.5);
        if (Math.hypot(sp.x - c.x, sp.y - c.y) <= Math.max(9, cam.scale * 0.16)) return { type: 'handle', id: handle };
      }
    }
    const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
    const neuron = index.byCell.get(cellKey(cell.x, cell.y));
    if (neuron) return { type: 'neuron', id: neuron.id };
    // Placing ignores texts and wires so any empty cell can take a neuron.
    if (tool === 'place') return { type: 'empty', ...cell };

    const texts = this.store.network.texts ?? [];
    for (let i = texts.length - 1; i >= 0; i--) {
      const b = this.renderer.textBox(texts[i]!);
      const pad = 0.1;
      if (w.x >= b.x - pad && w.x <= b.x + b.w + pad && w.y >= b.y - pad && w.y <= b.y + b.h + pad) return { type: 'text', id: texts[i]!.id };
    }
    if (tool !== 'text') {
      const tol = Math.max(5, Math.min(9, cam.scale * 0.15)) / cam.scale;
      let best: { from: string; to: string } | null = null;
      let bestD = tol;
      for (const [key, path] of this.renderer.paths(this.store.network, index).byKey) {
        if (w.x < Math.min(path.x0, path.cx, path.x1) - tol || w.x > Math.max(path.x0, path.cx, path.x1) + tol) continue;
        if (w.y < Math.min(path.y0, path.cy, path.y1) - tol || w.y > Math.max(path.y0, path.cy, path.y1) + tol) continue;
        const d = distanceToPath(path, w.x, w.y);
        if (d < bestD) {
          bestD = d;
          const [from, to] = key.split('>') as [string, string];
          best = { from, to };
        }
      }
      if (best) return { type: 'connection', ...best };
    }
    return { type: 'empty', ...cell };
  }

  private setHover(hover: Hover | null): void {
    const same = JSON.stringify(hover) === JSON.stringify(this.hover);
    this.hover = hover;
    if (!same) {
      this.updateCursor();
      this.host.invalidate();
    }
  }

  private updateCursor(): void {
    const g = this.gesture;
    let cursor = 'default';
    const tool = this.store.tool;
    const h = this.hover;
    if (g?.type === 'pan' || g?.type === 'pinch') cursor = 'grabbing';
    else if (g?.type === 'move') cursor = 'move';
    else if (g?.type === 'connect') cursor = 'crosshair';
    else if (this.spaceHeld) cursor = 'grab';
    else if (h?.type === 'handle') cursor = 'crosshair';
    else if (h?.type === 'neuron') cursor = tool === 'connect' ? 'crosshair' : 'pointer';
    else if (h?.type === 'text') cursor = tool === 'select' || tool === 'text' ? 'move' : 'default';
    else if (h?.type === 'connection') cursor = 'pointer';
    else if (tool === 'place') cursor = 'cell';
    else if (tool === 'text') cursor = 'text';
    else if (tool === 'hand') cursor = 'grab';
    this.canvas.style.cursor = cursor;
  }

  private onDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.canvas.setPointerCapture(e.pointerId);

    if (this.pointers.size === 2) {
      // Second finger: whatever the first one was doing becomes a pinch.
      const [a, b] = [...this.pointers.values()] as [Point, Point];
      this.preview = null;
      this.gesture = { type: 'pinch', mid: midpoint(a, b), dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
      this.host.invalidate();
      return;
    }
    if (this.pointers.size > 2) return;

    if (e.button === 1 || e.button === 2 || this.spaceHeld) {
      e.preventDefault();
      if (this.spaceHeld) this.spacePanned = true;
      this.gesture = { type: 'pan', last: p, menuAt: e.button === 2 && !this.spaceHeld ? p : undefined };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    this.gesture = { type: 'press', hit: this.hitTest(p), start: p, shift: e.shiftKey, alt: e.altKey, touch: e.pointerType !== 'mouse' };
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    this.pointer = this.camera.toWorld(p.x, p.y);
    const g = this.gesture;

    if (!g) {
      if (e.pointerType === 'mouse') this.setHover(asHover(this.hitTest(p)));
      if (this.pendingSource) this.host.invalidate();
      return;
    }
    switch (g.type) {
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()] as [Point, Point];
        const mid = midpoint(a, b);
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.camera.zoomAt(g.mid.x, g.mid.y, dist / g.dist);
        this.camera.panBy(mid.x - g.mid.x, mid.y - g.mid.y);
        g.mid = mid;
        g.dist = dist;
        this.host.invalidate();
        return;
      }
      case 'pan':
        if (g.menuAt && Math.hypot(p.x - g.menuAt.x, p.y - g.menuAt.y) > DRAG_PX) g.menuAt = undefined;
        this.camera.panBy(p.x - g.last.x, p.y - g.last.y);
        g.last = p;
        this.host.invalidate();
        return;
      case 'press':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > (g.touch ? TOUCH_DRAG_PX : DRAG_PX)) this.beginDrag(g, e);
        return;
      case 'move': {
        const w = this.camera.toWorld(p.x, p.y);
        const dx = Math.floor(w.x) - g.startCell.x;
        const dy = Math.floor(w.y) - g.startCell.y;
        // Texts follow the pointer in half-cell steps when moved on their own.
        const onlyTexts = this.store.selection.neurons.size === 0;
        const tdx = onlyTexts ? Math.round((w.x - g.from.x) * 2) / 2 : dx;
        const tdy = onlyTexts ? Math.round((w.y - g.from.y) * 2) / 2 : dy;
        const sel = this.store.selection;
        const valid = canMove(this.store.network, sel.neurons, dx, dy);
        this.preview = { type: 'move', dx: tdx, dy: tdy, neurons: sel.neurons, texts: sel.texts, valid };
        this.host.invalidate();
        return;
      }
      case 'connect':
        this.refreshConnectPreview();
        return;
      case 'marquee': {
        const w = this.camera.toWorld(p.x, p.y);
        this.preview = { type: 'marquee', x0: g.start.x, y0: g.start.y, x1: w.x, y1: w.y };
        this.host.invalidate();
        return;
      }
    }
  }

  /** A press moved far enough to become a drag: decide which kind. */
  private beginDrag(g: Press, e: PointerEvent): void {
    const tool = this.store.tool;
    const hit = g.hit;
    const panInstead = () => {
      this.gesture = { type: 'pan', last: g.start };
      this.onMove(e);
    };
    if (tool === 'hand') return panInstead();

    if (hit.type === 'handle' || (hit.type === 'neuron' && (tool === 'place' || tool === 'connect' || g.alt))) {
      this.gesture = { type: 'connect', from: hit.id, press: g };
      this.pendingSource = null;
      this.refreshConnectPreview();
      this.updateCursor();
      return;
    }
    if ((hit.type === 'neuron' && tool === 'select') || (hit.type === 'text' && (tool === 'select' || tool === 'text'))) {
      const sel = this.store.selection;
      const selected = hit.type === 'neuron' ? sel.neurons.has(hit.id) : sel.texts.has(hit.id);
      if (!selected) {
        if (g.shift) this.store.toggleSelected(hit.type, hit.id);
        else this.store.selectOnly(hit.type, hit.id);
      }
      const from = this.camera.toWorld(g.start.x, g.start.y);
      this.gesture = { type: 'move', from, startCell: { x: Math.floor(from.x), y: Math.floor(from.y) }, press: g };
      this.updateCursor();
      this.onMove(e);
      return;
    }
    if (tool === 'select' && g.shift && (hit.type === 'empty' || hit.type === 'connection')) {
      const w = this.camera.toWorld(g.start.x, g.start.y);
      this.gesture = { type: 'marquee', start: w, additive: true };
      this.onMove(e);
      return;
    }
    panInstead();
  }

  private refreshConnectPreview(): void {
    const g = this.gesture;
    if (g?.type !== 'connect' || !this.pointer) return;
    const { index } = this.store;
    const cell = { x: Math.floor(this.pointer.x), y: Math.floor(this.pointer.y) };
    const under = index.byCell.get(cellKey(cell.x, cell.y));
    const target = under && under.id !== g.from ? under.id : null;
    const net = this.store.network;
    const twoWay = this.shiftHeld;
    const removing = !!target && hasConnection(net, g.from, target) && (!twoWay || hasConnection(net, target, g.from));
    const newCell = !under && this.store.tool === 'place' ? cell : null;
    this.preview = { type: 'connect', from: g.from, x: this.pointer.x, y: this.pointer.y, target, newCell, removing };
    this.host.invalidate();
  }

  private onUp(e: PointerEvent): void {
    const g = this.gesture;
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (g?.type === 'pinch') {
      // Lifting one finger of a pinch ends it; the other finger does nothing more.
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    if (this.pointers.size > 0) return;
    this.gesture = null;
    const preview = this.preview;
    this.preview = null;

    if (g?.type === 'press') this.click(g);
    else if (g?.type === 'pan' && g.menuAt) this.host.contextMenu(e.clientX, e.clientY, this.hitTest(g.menuAt));
    else if (g?.type === 'move' && preview?.type === 'move') {
      if (preview.valid && (preview.dx || preview.dy)) this.host.moveSelection(preview.dx, preview.dy);
      // A wobble that stayed inside the cell is a click (pokes still land).
      else if (!preview.dx && !preview.dy && !g.press.shift) this.click(g.press);
    } else if (g?.type === 'connect' && preview?.type === 'connect') {
      if (preview.target) this.host.connect(g.from, preview.target, e.shiftKey);
      else if (preview.newCell) this.host.connectToNew(g.from, preview.newCell.x, preview.newCell.y, e.shiftKey);
      else if (this.overSource(g.from)) this.click(g.press);
    } else if (g?.type === 'marquee' && preview?.type === 'marquee') this.selectInRect(preview, g.additive);

    if (e.pointerType === 'mouse') this.setHover(asHover(this.hitTest(this.local(e))));
    else this.hover = null;
    this.updateCursor();
    this.host.invalidate();
  }

  /** Is the pointer still over the neuron a connection drag started from? */
  private overSource(id: string): boolean {
    const n = this.store.index.byId.get(id);
    return !!n && !!this.pointer && Math.floor(this.pointer.x) === n.x && Math.floor(this.pointer.y) === n.y;
  }

  private onCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.gesture = null;
      this.preview = null;
      this.host.invalidate();
    }
  }

  /** A press released without dragging. */
  private click(g: Press): void {
    const { store, host } = this;
    const hit = g.hit;
    const tool = store.tool;

    if (tool === 'connect') {
      if (hit.type === 'neuron') {
        if (!this.pendingSource) this.pendingSource = hit.id;
        else if (this.pendingSource === hit.id) this.pendingSource = null;
        else {
          host.connect(this.pendingSource, hit.id, g.shift);
          this.pendingSource = null;
        }
      } else if (hit.type === 'connection') store.selectConnection({ from: hit.from, to: hit.to });
      else this.pendingSource = null;
      return;
    }
    if (tool === 'hand') {
      if (hit.type === 'neuron') host.poke(hit.id);
      return;
    }

    switch (hit.type) {
      case 'neuron':
      case 'handle':
        if (g.shift && tool === 'select') store.toggleSelected('neuron', hit.id);
        else store.selectOnly('neuron', hit.id);
        if (host.running) host.poke(hit.id);
        break;
      case 'text':
        if (g.shift) store.toggleSelected('text', hit.id);
        else store.selectOnly('text', hit.id);
        break;
      case 'connection':
        store.selectConnection({ from: hit.from, to: hit.to });
        break;
      case 'empty':
        if (tool === 'place') {
          const id = host.place(hit.x, hit.y);
          if (id) store.selectOnly('neuron', id);
        } else if (tool === 'text') {
          const w = this.camera.toWorld(g.start.x, g.start.y);
          host.addText(Math.round(w.x * 2) / 2, Math.round(w.y * 2) / 2);
        } else if (!g.shift) store.clearSelection();
        break;
    }
  }

  private selectInRect(r: Extract<Preview, { type: 'marquee' }>, additive: boolean): void {
    const minX = Math.min(r.x0, r.x1);
    const maxX = Math.max(r.x0, r.x1);
    const minY = Math.min(r.y0, r.y1);
    const maxY = Math.max(r.y0, r.y1);
    const neurons = new Set(additive ? this.store.selection.neurons : []);
    const texts = new Set(additive ? this.store.selection.texts : []);
    for (const n of this.store.network.neurons) {
      if (n.x + 0.5 >= minX && n.x + 0.5 <= maxX && n.y + 0.5 >= minY && n.y + 0.5 <= maxY) neurons.add(n.id);
    }
    for (const t of this.store.network.texts ?? []) {
      const b = this.renderer.textBox(t);
      if (b.x < maxX && b.x + b.w > minX && b.y < maxY && b.y + b.h > minY) texts.add(t.id);
    }
    this.store.select({ neurons, texts, connection: null });
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch (reported as ctrl+wheel) or ctrl+scroll: fine zoom.
      this.camera.zoomAt(p.x, p.y, Math.exp(-dy * 0.01));
    } else if (e.shiftKey) {
      this.camera.panBy(-(dx || dy), 0);
    } else if (Math.abs(dx) > Math.abs(dy)) {
      this.camera.panBy(-dx, 0);
    } else {
      this.camera.zoomAt(p.x, p.y, Math.exp(-dy * 0.0018));
    }
    this.pointer = this.camera.toWorld(p.x, p.y);
    this.host.invalidate();
  }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function asHover(hit: Hit): Hover | null {
  return hit.type === 'empty' ? { type: 'cell', x: hit.x, y: hit.y } : hit;
}

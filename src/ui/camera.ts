// Board camera: maps world coordinates (grid cells, fractional) to screen
// coordinates (CSS pixels relative to the canvas' top-left corner).
//
//   screen = (world - origin) * scale

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface View {
  /** World coordinate shown at the canvas' top-left corner. */
  x: number;
  y: number;
  /** CSS pixels per grid cell. */
  scale: number;
}

export const MIN_SCALE = 5;
export const MAX_SCALE = 160;
export const DEFAULT_SCALE = 36;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export class Camera implements View {
  x = -4;
  y = -4;
  scale = DEFAULT_SCALE;
  private anim: { from: View; to: View; start: number; duration: number } | null = null;

  toScreen(wx: number, wy: number): Point {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  toWorld(sx: number, sy: number): Point {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }

  /** The grid cell under a screen point. */
  cellAt(sx: number, sy: number): Point {
    const w = this.toWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null;
    const before = this.toWorld(sx, sy);
    this.scale = clampScale(this.scale * factor);
    this.x = before.x - sx / this.scale;
    this.y = before.y - sy / this.scale;
  }

  /** Move the view by a screen-space delta (drag direction). */
  panBy(dx: number, dy: number): void {
    this.anim = null;
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }

  set(view: View): void {
    this.x = view.x;
    this.y = view.y;
    this.scale = clampScale(view.scale);
  }

  get view(): View {
    return { x: this.x, y: this.y, scale: this.scale };
  }

  /** Visible world rectangle for a viewport size. */
  visible(width: number, height: number): Bounds {
    return { minX: this.x, minY: this.y, maxX: this.x + width / this.scale, maxY: this.y + height / this.scale };
  }

  /** Glide to a view over `duration` ms (0 jumps there). Call tick() each frame. */
  animateTo(to: View, duration: number, now = performance.now()): void {
    if (duration <= 0) {
      this.anim = null;
      this.set(to);
      return;
    }
    this.anim = { from: this.view, to: { ...to, scale: clampScale(to.scale) }, start: now, duration };
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  /** Advance a running animation. Returns true if the view changed. */
  tick(now: number): boolean {
    if (!this.anim) return false;
    const { from, to, start, duration } = this.anim;
    const t = Math.min(1, (now - start) / duration);
    this.set(interpolateView(from, to, easeOutCubic(t)));
    if (t >= 1) this.anim = null;
    return true;
  }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Interpolate two views: the zoom changes geometrically, and the origin is
 * blended linearly in 1/scale. For a pure zoom about a fixed screen point
 * (origin = W - P / scale) that keeps the point exactly still, so glides
 * look like a camera zooming rather than sliding sideways.
 */
export function interpolateView(a: View, b: View, t: number): View {
  const scale = a.scale * Math.pow(b.scale / a.scale, t);
  const wa = 1 / a.scale;
  const wb = 1 / b.scale;
  const w = 1 / scale;
  const k = wa === wb ? t : (w - wa) / (wb - wa);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, scale };
}

/**
 * The view that fits `bounds` (world units) inside a viewport, leaving
 * `padding` CSS pixels on every side and never zooming in past `maxScale`.
 */
export function fitView(bounds: Bounds, width: number, height: number, padding = 48, maxScale = 56): View {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(40, width - padding * 2);
  const availH = Math.max(40, height - padding * 2);
  const scale = clampScale(Math.min(availW / bw, availH / bh, maxScale));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - width / 2 / scale, y: cy - height / 2 / scale, scale };
}

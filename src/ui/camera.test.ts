import { describe, expect, it } from 'vitest';
import { Camera, fitView, interpolateView, MAX_SCALE, MIN_SCALE } from './camera';

describe('Camera', () => {
  it('round-trips between world and screen', () => {
    const c = new Camera();
    c.set({ x: -3, y: 2, scale: 20 });
    const s = c.toScreen(4.5, -1);
    expect(s).toEqual({ x: 150, y: -60 });
    expect(c.toWorld(s.x, s.y)).toEqual({ x: 4.5, y: -1 });
    expect(c.cellAt(150, -60)).toEqual({ x: 4, y: -1 });
  });

  it('zooms about the cursor and clamps the scale', () => {
    const c = new Camera();
    c.set({ x: 0, y: 0, scale: 30 });
    const before = c.toWorld(200, 120);
    c.zoomAt(200, 120, 2);
    expect(c.scale).toBe(60);
    const after = c.toWorld(200, 120);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    c.zoomAt(0, 0, 1000);
    expect(c.scale).toBe(MAX_SCALE);
    c.zoomAt(0, 0, 1e-6);
    expect(c.scale).toBe(MIN_SCALE);
  });

  it('pans by screen deltas', () => {
    const c = new Camera();
    c.set({ x: 0, y: 0, scale: 10 });
    c.panBy(50, -20);
    expect(c.x).toBeCloseTo(-5);
    expect(c.y).toBeCloseTo(2);
  });

  it('animates towards a target view and finishes exactly on it', () => {
    const c = new Camera();
    c.set({ x: 0, y: 0, scale: 10 });
    c.animateTo({ x: 10, y: 5, scale: 40 }, 200, 0);
    expect(c.tick(100)).toBe(true);
    expect(c.scale).toBeGreaterThan(10);
    expect(c.scale).toBeLessThan(40);
    c.tick(250);
    expect(c.view).toEqual({ x: 10, y: 5, scale: 40 });
    expect(c.animating).toBe(false);
    expect(c.tick(300)).toBe(false);
  });
});

describe('fitView', () => {
  it('centres the bounds and fits the tighter dimension', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 600, 400, 50, 1000);
    expect(v.scale).toBe(50);
    expect(v.x + 300 / v.scale).toBeCloseTo(5);
    expect(v.y + 200 / v.scale).toBeCloseTo(2.5);
  });

  it('does not zoom in past maxScale for tiny networks', () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 800, 600, 40, 48).scale).toBe(48);
  });
});

describe('interpolateView', () => {
  it('keeps the fixed point of a pure zoom still', () => {
    const a = { x: 0, y: 0, scale: 10 };
    // Zoom x4 about screen point (100, 50): world (10, 5) stays put.
    const b = { x: 10 - 100 / 40, y: 5 - 50 / 40, scale: 40 };
    const mid = interpolateView(a, b, 0.5);
    expect(mid.scale).toBeCloseTo(20);
    expect(mid.x + 100 / mid.scale).toBeCloseTo(10);
    expect(mid.y + 50 / mid.scale).toBeCloseTo(5);
  });
});

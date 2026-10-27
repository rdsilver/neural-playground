import { describe, expect, it } from 'vitest';
import { connectionPath, DIGIT_HALF, distanceToPath, endTangent, LAMP_HALF, NEURON_RADIUS, pointOnPath, shapeExtent } from './geometry';

describe('connectionPath', () => {
  const a = { x: 0, y: 0, kind: 'normal' as const };
  const b = { x: 4, y: 0, kind: 'normal' as const };

  it('runs straight between outlines for one-way connections', () => {
    const p = connectionPath(a, b, false);
    expect(p.y0).toBeCloseTo(0.5);
    expect(p.y1).toBeCloseTo(0.5);
    expect(p.x0).toBeGreaterThan(0.5);
    expect(p.x1).toBeLessThan(4.5 - NEURON_RADIUS);
    expect(endTangent(p).x).toBeCloseTo(1);
    expect(endTangent(p).y).toBeCloseTo(0);
  });

  it('separates the two halves of a two-way pair', () => {
    const ab = connectionPath(a, b, true);
    const ba = connectionPath(b, a, true);
    const m1 = pointOnPath(ab, 0.5);
    const m2 = pointOnPath(ba, 0.5);
    expect(Math.abs(m1.y - m2.y)).toBeGreaterThan(0.2);
    // Each arrow still points along its own direction of travel.
    expect(endTangent(ab).x).toBeGreaterThan(0.9);
    expect(endTangent(ba).x).toBeLessThan(-0.9);
  });

  it('stops at the edge of square Digit neurons, even diagonally', () => {
    expect(shapeExtent('character', 1, 0)).toBeCloseTo(DIGIT_HALF);
    expect(shapeExtent('character', Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(DIGIT_HALF * Math.SQRT2);
    const p = connectionPath(a, { x: 3, y: 3, kind: 'character' }, false);
    expect(3.5 - p.x1).toBeGreaterThan(DIGIT_HALF);
  });

  it('stops arrows outside a Lamp\'s whole-cell tile', () => {
    expect(shapeExtent('lamp', 0, 1)).toBeCloseTo(LAMP_HALF);
    const p = connectionPath(a, { x: 0, y: 5, kind: 'lamp' }, false);
    expect(5 - p.y1).toBeGreaterThan(0);
  });

  it('measures distance to the drawn curve', () => {
    const p = connectionPath(a, b, false);
    expect(distanceToPath(p, 2.5, 0.5)).toBeCloseTo(0);
    expect(distanceToPath(p, 2.5, 1.5)).toBeCloseTo(1);
  });
});

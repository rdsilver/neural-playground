// World-space geometry shared by the renderer and hit-testing, so what you
// see is exactly what you can click. Units are grid cells; a neuron at cell
// (x, y) is centred on (x + 0.5, y + 0.5).

import type { NeuronKind } from '../engine';
import type { Point } from './camera';

/** Outer radius of round neurons (core plus charge ring), in cells. */
export const NEURON_RADIUS = 0.43;
/** Half the side of square (Digit) neurons, in cells. */
export const DIGIT_HALF = 0.42;
/** Gap between a neuron's outline and the tip of an arrow pointing at it. */
const ARROW_GAP = 0.04;
/** Sideways offset of each half of a two-way pair, in cells. */
const PAIR_OFFSET = 0.13;

export const isSquare = (kind: NeuronKind) => kind === 'character';

/** Distance from a neuron's centre to its outline in direction (ux, uy). */
export function shapeExtent(kind: NeuronKind, ux: number, uy: number): number {
  if (!isSquare(kind)) return NEURON_RADIUS;
  return DIGIT_HALF / Math.max(Math.abs(ux), Math.abs(uy), 1e-6);
}

export interface Endpoint {
  x: number;
  y: number;
  kind: NeuronKind;
}

/** A connection drawn as a quadratic Bézier from p0 (source) to p1 (arrow tip). */
export interface ConnectionPath {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}

/**
 * Path for a connection between two neurons. One-way connections are
 * straight; each half of a two-way pair is pushed to its own side (its
 * left, looking along the direction of travel) and bowed slightly, so the
 * two directions never overlap and each keeps its own arrowhead.
 */
export function connectionPath(from: Endpoint, to: Endpoint, twoWay: boolean): ConnectionPath {
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const bx = to.x + 0.5;
  const by = to.y + 0.5;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // Normal pointing to the left of the direction of travel (screen y is down).
  const nx = uy;
  const ny = -ux;
  const side = twoWay ? PAIR_OFFSET : 0;
  const bow = twoWay ? Math.min(0.5, len * 0.05) : 0;
  const s = shapeExtent(from.kind, ux, uy) * 0.92;
  const e = shapeExtent(to.kind, ux, uy) + ARROW_GAP;
  const x0 = ax + ux * s + nx * side;
  const y0 = ay + uy * s + ny * side;
  const x1 = bx - ux * e + nx * side;
  const y1 = by - uy * e + ny * side;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2 + nx * bow, cy: (y0 + y1) / 2 + ny * bow };
}

/** Point at parameter t (0..1) along a path. */
export function pointOnPath(p: ConnectionPath, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1,
    y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1,
  };
}

/** Unit tangent at the arrow tip. */
export function endTangent(p: ConnectionPath): Point {
  let dx = p.x1 - p.cx;
  let dy = p.y1 - p.cy;
  if (Math.hypot(dx, dy) < 1e-9) {
    dx = p.x1 - p.x0;
    dy = p.y1 - p.y0;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Straight-line distance between a path's ends (its drawable length). */
export function pathLength(p: ConnectionPath): number {
  return Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Approximate distance from a point to a path (sampled polyline). */
export function distanceToPath(p: ConnectionPath, x: number, y: number, samples = 12): number {
  let best = Infinity;
  let prev = pointOnPath(p, 0);
  for (let i = 1; i <= samples; i++) {
    const next = pointOnPath(p, i / samples);
    best = Math.min(best, distanceToSegment(x, y, prev.x, prev.y, next.x, next.y));
    prev = next;
  }
  return best;
}

/** Bounding box of a path, used for culling. */
export function pathBounds(p: ConnectionPath): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(p.x0, p.cx, p.x1),
    minY: Math.min(p.y0, p.cy, p.y1),
    maxX: Math.max(p.x0, p.cx, p.x1),
    maxY: Math.max(p.y0, p.cy, p.y1),
  };
}

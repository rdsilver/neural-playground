import { digitText, KIND_INFO } from './kinds';
import type { Simulation } from './simulation';
import type { Network } from './types';

export interface SvgOptions {
  /** Pixels per grid cell (default 32). */
  cell?: number;
  /** Cells of empty margin around the content (default 1). */
  margin?: number;
  /** Draw the grid lines (default true). */
  grid?: boolean;
  /** Draw text annotations (default true). */
  texts?: boolean;
  /** If given, digits show live charges and in-flight pulses are drawn. */
  simulation?: Simulation;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Content bounds in cells: neurons plus (roughly) text annotations. */
export function networkBounds(network: Network): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of network.neurons) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + 1); maxY = Math.max(maxY, n.y + 1);
  }
  for (const t of network.texts ?? []) {
    const size = t.size ?? 0.6;
    const lines = t.text.split('\n');
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.55;
    const left = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
    minX = Math.min(minX, left); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, left + width); maxY = Math.max(maxY, t.y + lines.length * size * 1.25);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/**
 * Render a network as a standalone SVG string. Simple and dependency-free:
 * good for thumbnails, docs and for eyeballing an example's layout.
 */
export function networkToSvg(network: Network, options: SvgOptions = {}): string {
  const cell = options.cell ?? 32;
  const margin = options.margin ?? 1;
  const sim = options.simulation;
  const b = networkBounds(network);
  const ox = (b.minX - margin) * cell;
  const oy = (b.minY - margin) * cell;
  const width = (b.maxX - b.minX + 2 * margin) * cell;
  const height = (b.maxY - b.minY + 2 * margin) * cell;
  const byId = new Map(network.neurons.map((n) => [n.id, n]));
  const pairs = new Set(network.connections.map((c) => `${c.from}>${c.to}`));
  const out: string[] = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${ox} ${oy} ${width} ${height}" font-family="system-ui, sans-serif">`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${cell / 5}" markerHeight="${cell / 5}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c2417a"/></marker></defs>`);
  out.push(`<rect x="${ox}" y="${oy}" width="${width}" height="${height}" fill="#1b1d23"/>`);

  if (options.grid ?? true) {
    const lines: string[] = [];
    for (let x = Math.floor(ox / cell); x * cell <= ox + width; x++) lines.push(`M${x * cell},${oy}V${oy + height}`);
    for (let y = Math.floor(oy / cell); y * cell <= oy + height; y++) lines.push(`M${ox},${y * cell}H${ox + width}`);
    out.push(`<path d="${lines.join('')}" stroke="#2a2d36" stroke-width="1"/>`);
  }

  // Connections: straight when one-way, bowed apart when both directions exist.
  for (const c of network.connections) {
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    const x1 = (from.x + 0.5) * cell, y1 = (from.y + 0.5) * cell;
    const x2 = (to.x + 0.5) * cell, y2 = (to.y + 0.5) * cell;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const inset = cell * 0.5;
    const bow = pairs.has(`${c.to}>${c.from}`) ? cell * 0.18 : 0;
    const sx = x1 + ux * inset - uy * bow, sy = y1 + uy * inset + ux * bow;
    const ex = x2 - ux * inset - uy * bow, ey = y2 - uy * inset + ux * bow;
    out.push(`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#c2417a" stroke-opacity="0.75" stroke-width="${Math.max(1, cell / 20)}" marker-end="url(#arrow)"/>`);
  }

  // Pulses go under the neurons so they never hide a digit.
  if (sim) {
    for (const p of sim.pulses()) {
      const from = byId.get(p.from), to = byId.get(p.to);
      if (!from || !to) continue;
      const t = sim.progress(p);
      const px = (from.x + 0.5 + (to.x - from.x) * t) * cell, py = (from.y + 0.5 + (to.y - from.y) * t) * cell;
      out.push(`<circle cx="${px}" cy="${py}" r="${cell * 0.12}" fill="${p.charge > 0 ? '#fff' : '#0a0a0a'}" stroke="${p.charge > 0 ? 'none' : '#fff'}"/>`);
    }
  }

  for (const n of network.neurons) {
    const info = KIND_INFO[n.kind];
    const x = n.x * cell + cell * 0.08, y = n.y * cell + cell * 0.08, s = cell * 0.84;
    if (n.kind === 'lamp') {
      // A dot-matrix pixel: lit while it holds charge, a dark dot otherwise.
      const lit = (sim ? sim.charge(n.id) : 0) > 0;
      const cx = (n.x + 0.5) * cell, cy = (n.y + 0.5) * cell;
      if (lit) out.push(`<circle cx="${cx}" cy="${cy}" r="${cell * 0.5}" fill="${info.color}" fill-opacity="0.25"/>`);
      out.push(`<circle cx="${cx}" cy="${cy}" r="${cell * 0.38}" fill="${lit ? info.color : '#2b2416'}" stroke="${info.color}" stroke-opacity="${lit ? 1 : 0.35}" stroke-width="${cell / 24}"/>`);
      continue;
    }
    out.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${cell * 0.16}" fill="${info.color}"/>`);
    let text = n.label ?? info.glyph;
    if (n.kind === 'character') text = digitText(sim ? sim.charge(n.id) : 0);
    if (text) {
      const fs = (text.length > 2 ? 0.38 : text.length > 1 ? 0.5 : 0.64) * cell;
      out.push(`<text x="${(n.x + 0.5) * cell}" y="${(n.y + 0.5) * cell}" font-size="${fs}" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="#111">${esc(text)}</text>`);
    }
    if (n.kind === 'character' && n.label) {
      out.push(`<text x="${(n.x + 0.5) * cell}" y="${(n.y + 1.12) * cell}" font-size="${cell * 0.28}" text-anchor="middle" dominant-baseline="hanging" fill="#9aa0ad">${esc(n.label)}</text>`);
    }
  }

  if (options.texts ?? true) {
    const tones = { default: '#e6e8ee', muted: '#8b91a0', accent: '#ffd166', warning: '#ff7b72' };
    for (const t of network.texts ?? []) {
      const size = (t.size ?? 0.6) * cell;
      const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
      t.text.split('\n').forEach((line, i) => {
        out.push(`<text x="${t.x * cell}" y="${t.y * cell + i * size * 1.25}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="hanging" fill="${tones[t.tone ?? 'default']}">${esc(line)}</text>`);
      });
    }
  }

  out.push('</svg>');
  return out.join('\n');
}

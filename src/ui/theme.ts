// Canvas colours come from the same CSS custom properties as the rest of
// the UI (see styles.css), so a theme switch restyles both at once.

import { NEURON_KINDS, type NeuronKind, type TextSpec } from '../engine';

export interface Palette {
  canvas: string;
  grid: string;
  gridMajor: string;
  wire: string;
  wireActive: string;
  wireIn: string;
  accent: string;
  danger: string;
  pulsePos: string;
  pulsePosGlow: string;
  pulseNeg: string;
  pulseNegGlow: string;
  /** How trails and glows combine with the board: additive on dark themes. */
  glowBlend: GlobalCompositeOperation;
  negCharge: string;
  digitTile: string;
  digitInk: string;
  /**
   * Lamps: the dark screen behind them, an unlit LED and its rim, a lit LED
   * and its hot centre, the bloom's strength (alpha), and label inks on an
   * unlit and a lit LED.
   */
  lampScreen: string;
  lampOff: string;
  lampRim: string;
  lampOn: string;
  lampHot: string;
  lampGlow: number;
  lampLabel: string;
  lampInk: string;
  ink: string;
  inkOnKind: string;
  text: Record<NonNullable<TextSpec['tone']>, string>;
  kinds: Record<NeuronKind, string>;
}

export type ThemeName = 'dark' | 'light';

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0d11' : '#eef0f3');
}

/** Read the canvas palette from the current CSS tokens. */
export function readPalette(el: Element = document.documentElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim() || '#888';
  const kinds = {} as Record<NeuronKind, string>;
  for (const kind of NEURON_KINDS) kinds[kind] = v(`kind-${kind}`);
  return {
    canvas: v('canvas'),
    grid: v('grid'),
    gridMajor: v('grid-major'),
    wire: v('wire'),
    wireActive: v('wire-active'),
    wireIn: v('wire-in'),
    accent: v('accent'),
    danger: v('danger'),
    pulsePos: v('pulse-pos'),
    pulsePosGlow: v('pulse-pos-glow'),
    pulseNeg: v('pulse-neg'),
    pulseNegGlow: v('pulse-neg-glow'),
    glowBlend: v('glow-blend') === 'lighter' ? 'lighter' : 'source-over',
    negCharge: v('neg-charge'),
    digitTile: v('digit-tile'),
    digitInk: v('digit-ink'),
    lampScreen: v('lamp-screen'),
    lampOff: v('lamp-off'),
    lampRim: v('lamp-rim'),
    lampOn: v('lamp-on'),
    lampHot: v('lamp-hot'),
    lampGlow: Number.parseFloat(v('lamp-glow')) || 0.5,
    lampLabel: v('lamp-label'),
    lampInk: v('lamp-ink'),
    ink: v('text'),
    inkOnKind: v('ink-on-kind'),
    text: { default: v('note-default'), muted: v('note-muted'), accent: v('note-accent'), warning: v('note-warning') },
    kinds,
  };
}

/** `#rrggbb` / `#rgb` as [r, g, b], or null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * An opaque colour `t` of the way from `a` to `b` (both hex). Faint lines
 * use it instead of transparency, so where many of them overlap they do
 * not add up into a bright one. Falls back to `a` at alpha 1 - t.
 */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return withAlpha(a, 1 - t);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** `#rrggbb` (or `#rgb`) plus alpha as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : hex;
}

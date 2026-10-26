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
    ink: v('text'),
    inkOnKind: v('ink-on-kind'),
    text: { default: v('note-default'), muted: v('note-muted'), accent: v('note-accent'), warning: v('note-warning') },
    kinds,
  };
}

/** `#rrggbb` (or `#rgb`) plus alpha as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return hex;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

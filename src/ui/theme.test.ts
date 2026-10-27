import { describe, expect, it } from 'vitest';
import { mixColors, withAlpha } from './theme';

describe('colour helpers', () => {
  it('adds alpha to hex colours and leaves others alone', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(withAlpha('#f80', 0.25)).toBe('rgba(255, 136, 0, 0.25)');
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
  });

  it('mixes two hex colours into an opaque one', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('rgb(255, 255, 255)');
    expect(mixColors('#3f4657', '#0d0f14', 0.5)).toBe('rgb(38, 43, 54)');
    // Not hex: fall back to transparency.
    expect(mixColors('#3f4657', 'white', 0.25)).toBe('rgba(63, 70, 87, 0.75)');
  });
});

import { describe, expect, it } from 'vitest';
import { CORNER_BL, CORNER_BR, CORNER_TL, CORNER_TR, lampCorners, restingStyle, wireStyle } from './wires';

describe('wireStyle', () => {
  const none = new Set<string>();

  it('draws wires into lamps faint, even while a pulse is on them', () => {
    expect(wireStyle('drv', 'lamp', true, none, false)).toBe('faint');
    expect(wireStyle('drv', 'lamp', true, none, true)).toBe('faint');
    expect(restingStyle(true)).toBe('faint');
  });

  it('keeps wires out of lamps (and between other neurons) normal', () => {
    expect(wireStyle('lamp', 'relay', false, none, false)).toBe('base');
    expect(wireStyle('lamp', 'relay', false, none, true)).toBe('active');
    expect(wireStyle('a', 'b', false, none, true)).toBe('active');
    expect(restingStyle(false)).toBe('base');
  });

  it('shows a lamp wire normally while the lamp or its source is focused', () => {
    expect(wireStyle('drv', 'lamp', true, new Set(['lamp']), false)).toBe('in');
    expect(wireStyle('drv', 'lamp', true, new Set(['drv']), false)).toBe('out');
    // A focused source wins over a focused target, as for any wire.
    expect(wireStyle('drv', 'lamp', true, new Set(['drv', 'lamp']), true)).toBe('out');
    // Focus on some other neuron changes nothing.
    expect(wireStyle('drv', 'lamp', true, new Set(['other']), false)).toBe('faint');
  });
});

describe('lampCorners', () => {
  it('rounds every corner of a lone lamp', () => {
    expect(lampCorners([{ x: 3, y: 4 }])).toEqual([CORNER_TL | CORNER_TR | CORNER_BR | CORNER_BL]);
  });

  it('merges a grid of lamps into one screen with rounded outer corners only', () => {
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) cells.push({ x, y });
    const masks = lampCorners(cells);
    const at = (x: number, y: number) => masks[y * 4 + x];
    expect(at(0, 0)).toBe(CORNER_TL);
    expect(at(3, 0)).toBe(CORNER_TR);
    expect(at(3, 2)).toBe(CORNER_BR);
    expect(at(0, 2)).toBe(CORNER_BL);
    // Edges and the middle stay square, so the tiles join without gaps.
    expect(at(1, 0)).toBe(0);
    expect(at(0, 1)).toBe(0);
    expect(at(2, 1)).toBe(0);
  });

  it('treats diagonal neighbours as separate', () => {
    expect(lampCorners([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([15, 15]);
  });
});

import { describe, expect, it } from 'vitest';
import { FIT_GAP, insetOptions } from './layout';

describe('insetOptions', () => {
  const chrome = { width: 1440, height: 900, top: 60, left: 84, right: 1440, bottom: 760 };

  it('keeps clear of the islands on every side', () => {
    expect(insetOptions(chrome)).toEqual([{ top: 60 + FIT_GAP, left: 84 + FIT_GAP, bottom: 140 + FIT_GAP, right: FIT_GAP }]);
  });

  it('offers framing beside and below a card', () => {
    const card = { left: 96, top: 72, right: 436, bottom: 600 };
    const [beside, below] = insetOptions({ ...chrome, right: 1100, card }, 10);
    expect(beside).toEqual({ top: 70, left: 446, bottom: 150, right: 350 });
    expect(below).toEqual({ top: 610, left: 94, bottom: 150, right: 350 });
  });

  it('never lets a small card shrink the free area', () => {
    const card = { left: 96, top: 20, right: 60, bottom: 40 };
    const [beside, below] = insetOptions({ ...chrome, card }, 10);
    expect(beside!.left).toBe(94);
    expect(below!.top).toBe(70);
  });
});

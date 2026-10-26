import { describe, expect, it } from 'vitest';
import { FIT_GAP, insetOptions, revealOffset } from './layout';

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

describe('revealOffset', () => {
  const chrome = { width: 1000, height: 800, top: 60, left: 80, right: 1000, bottom: 700 };

  it('leaves a point in the free area alone', () => {
    expect(revealOffset({ x: 500, y: 400 }, chrome, 40)).toEqual({ dx: 0, dy: 0 });
  });

  it('brings points in from under the edges of the chrome', () => {
    expect(revealOffset({ x: 90, y: 400 }, chrome, 40)).toEqual({ dx: -30, dy: 0 });
    expect(revealOffset({ x: 990, y: 790 }, chrome, 40)).toEqual({ dx: 30, dy: 130 });
    expect(revealOffset({ x: 500, y: 20 }, { ...chrome, right: 700 }, 40)).toEqual({ dx: 0, dy: -80 });
  });

  it('moves a point out from under the card by the shorter way', () => {
    const card = { left: 90, top: 70, right: 400, bottom: 300 };
    // Near the card's right edge: slide right.
    expect(revealOffset({ x: 380, y: 120 }, { ...chrome, card }, 20)).toEqual({ dx: -40, dy: 0 });
    // Near its bottom: slide down.
    expect(revealOffset({ x: 200, y: 290 }, { ...chrome, card }, 20)).toEqual({ dx: 0, dy: -30 });
    // No room beside it: go below.
    expect(revealOffset({ x: 380, y: 120 }, { ...chrome, right: 430, card }, 20)).toEqual({ dx: 0, dy: -200 });
  });

  it('centres a point when the free area is too small for the margin', () => {
    expect(revealOffset({ x: 100, y: 400 }, { ...chrome, left: 0, right: 60 }, 40)).toEqual({ dx: 70, dy: 0 });
  });
});

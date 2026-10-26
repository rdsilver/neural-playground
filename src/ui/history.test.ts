import { describe, expect, it } from 'vitest';
import { COALESCE_MS, History } from './history';

describe('History', () => {
  it('undoes and redoes snapshots in order', () => {
    const h = new History<number>();
    let state = 0;
    const edit = (next: number, label: string) => {
      h.record(state, label);
      state = next;
    };
    edit(1, 'one');
    edit(2, 'two');
    expect(h.undoLabel).toBe('two');
    state = h.undo(state)!.state;
    expect(state).toBe(1);
    state = h.undo(state)!.state;
    expect(state).toBe(0);
    expect(h.undo(state)).toBeUndefined();
    expect(h.redoLabel).toBe('one');
    state = h.redo(state)!.state;
    state = h.redo(state)!.state;
    expect(state).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it('drops the redo branch after a new edit', () => {
    const h = new History<string>();
    h.record('a', 'x');
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.record('a', 'y');
    expect(h.canRedo).toBe(false);
  });

  it('coalesces edits with the same key inside the window', () => {
    const h = new History<number>();
    expect(h.record(0, 'threshold', 'k', 1000)).toBe(true);
    expect(h.record(1, 'threshold', 'k', 1500)).toBe(false);
    expect(h.record(2, 'threshold', 'k', 1500 + COALESCE_MS + 1)).toBe(true);
    expect(h.undo(3)!.state).toBe(2);
    expect(h.undo(2)!.state).toBe(0);
  });

  it('only coalesces matching keys, and trims the oldest steps past the limit', () => {
    const h = new History<number>(3);
    h.record(0, 'a', 'k', 0);
    expect(h.record(1, 'a', 'other', 10)).toBe(true);
    h.record(2, 'b');
    h.record(3, 'c');
    let s = 4;
    const seen: number[] = [];
    for (let u = h.undo(s); u; u = h.undo(s)) seen.push((s = u.state));
    expect(seen).toEqual([3, 2, 1]);
  });
});

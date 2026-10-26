// Generic undo/redo stack of immutable snapshots.
//
// The store records the state *before* each edit. Consecutive edits that
// share a coalesce key (e.g. typing into the same threshold field) within a
// short window collapse into one undo step, so undo jumps back to before the
// whole burst instead of one keystroke at a time.

interface Entry<T> {
  state: T;
  label: string;
  key?: string;
  time: number;
}

export interface Undone<T> {
  state: T;
  label: string;
}

/** Edits with the same coalesce key closer together than this merge. */
export const COALESCE_MS = 1200;

export class History<T> {
  private past: Entry<T>[] = [];
  private future: Entry<T>[] = [];

  constructor(private readonly limit = 200) {}

  /**
   * Record `previous` (the state before an edit) as an undo point.
   * Returns false when the edit was merged into the previous undo step.
   */
  record(previous: T, label: string, coalesceKey?: string, now = Date.now()): boolean {
    this.future = [];
    const last = this.past[this.past.length - 1];
    if (coalesceKey !== undefined && last && last.key === coalesceKey && now - last.time < COALESCE_MS) {
      last.time = now;
      return false;
    }
    this.past.push({ state: previous, label, key: coalesceKey, time: now });
    if (this.past.length > this.limit) this.past.shift();
    return true;
  }

  /** Step back: returns the state to restore, given the current one. */
  undo(current: T): Undone<T> | undefined {
    const entry = this.past.pop();
    if (!entry) return undefined;
    this.future.push({ state: current, label: entry.label, time: 0 });
    return { state: entry.state, label: entry.label };
  }

  redo(current: T): Undone<T> | undefined {
    const entry = this.future.pop();
    if (!entry) return undefined;
    this.past.push({ state: current, label: entry.label, time: 0 });
    return { state: entry.state, label: entry.label };
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

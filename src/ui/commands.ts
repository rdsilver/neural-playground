// Commands: every action the app offers, with its shortcut. One list feeds
// the keyboard handler, the command palette (Ctrl/⌘+K) and the help sheet.

export interface Command {
  id: string;
  title: string;
  group: 'Simulation' | 'Edit' | 'Tools' | 'View' | 'File' | 'Help' | 'Examples';
  /** Shortcut spec (see shortcuts.ts), shown in menus and tooltips. */
  keys?: string;
  /** Extra words the palette should match (e.g. "delete" for "Clear canvas"). */
  aliases?: string;
  run(): void;
  enabled?(): boolean;
  /** Hidden from the palette (still reachable by its shortcut). */
  paletteHidden?: boolean;
}

/**
 * Fuzzy subsequence score of `query` in `text` (higher is better), or null
 * when the query's letters do not all appear in order. Matches at word
 * starts and consecutive runs score extra, so "ztf" finds "Zoom to fit".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-:/(]/.test(t[found - 1]!);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + run * 2 - Math.min(3, (found - ti) * 0.1);
    ti = found + 1;
  }
  // Letters scattered all over a long text are not a real match.
  if (score < q.length * 1.6) return null;
  // Prefer shorter texts and matches that start early.
  return score - t.length * 0.01 - (t.indexOf(q[0]!) > 0 ? 0.5 : 0);
}

/** Commands matching a query, best first (all commands, in order, for an empty query). */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const visible = commands.filter((c) => !c.paletteHidden);
  if (!query.trim()) return visible;
  const scored: { c: Command; s: number }[] = [];
  for (const c of visible) {
    const s = Math.max(fuzzyScore(query, c.title) ?? -Infinity, (fuzzyScore(query, `${c.group} ${c.title} ${c.aliases ?? ''}`) ?? -Infinity) - 2);
    if (s > -Infinity) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}

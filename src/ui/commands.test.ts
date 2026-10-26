import { describe, expect, it } from 'vitest';
import { filterCommands, fuzzyScore, type Command } from './commands';

const cmd = (title: string, group: Command['group'] = 'View', aliases?: string): Command => ({ id: title, title, group, aliases, run: () => {} });

describe('fuzzyScore', () => {
  it('requires letters in order', () => {
    expect(fuzzyScore('ztf', 'Zoom to fit')).not.toBeNull();
    expect(fuzzyScore('ftz', 'Zoom to fit')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('prefers word starts and contiguous runs', () => {
    expect(fuzzyScore('play', 'Play / pause')!).toBeGreaterThan(fuzzyScore('play', 'Replay demo')!);
  });
});

describe('filterCommands', () => {
  const commands = [cmd('Zoom in'), cmd('Zoom to fit'), cmd('Clear canvas', 'Edit', 'delete everything'), { ...cmd('Secret'), paletteHidden: true }];

  it('returns everything visible for an empty query', () => {
    expect(filterCommands(commands, '  ').map((c) => c.title)).toEqual(['Zoom in', 'Zoom to fit', 'Clear canvas']);
  });

  it('ranks matches and searches groups and aliases', () => {
    expect(filterCommands(commands, 'fit')[0]!.title).toBe('Zoom to fit');
    expect(filterCommands(commands, 'delete').map((c) => c.title)).toEqual(['Clear canvas']);
    expect(filterCommands(commands, 'secret')).toEqual([]);
  });
});

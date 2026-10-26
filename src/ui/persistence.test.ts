import { describe, expect, it } from 'vitest';
import { NetworkBuilder } from '../engine';
import { EXAMPLES } from '../examples';
import { DEFAULT_SETTINGS, exampleUrl, isPristineExample, parseHash, readAutosave, readSettings, setTried, shareUrl, shouldAutosave, slugify, writeAutosave, writeSettings } from './persistence';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('URL hashes', () => {
  it('parses share and example links', () => {
    expect(parseHash('#net=abc_-123')).toEqual({ type: 'net', code: 'abc_-123' });
    expect(parseHash('#example=bell-curve')).toEqual({ type: 'example', id: 'bell-curve' });
    expect(parseHash('')).toBeNull();
    expect(parseHash('#something')).toBeNull();
  });

  it('builds links that replace any existing hash', () => {
    expect(shareUrl('https://x.dev/np/?a=1#example=foo', 'CODE')).toBe('https://x.dev/np/?a=1#net=CODE');
    expect(exampleUrl('https://x.dev/np/', 'bell-curve')).toBe('https://x.dev/np/#example=bell-curve');
    const parsed = parseHash(new URL(shareUrl('https://x.dev/', 'a-b_c')).hash);
    expect(parsed).toEqual({ type: 'net', code: 'a-b_c' });
  });
});

describe('storage', () => {
  it('round-trips the autosave and rejects garbage', () => {
    const storage = new MemoryStorage();
    expect(readAutosave(storage)).toBeNull();
    const b = new NetworkBuilder();
    b.normal(1, 1, 3);
    const network = b.build();
    writeAutosave({ network, doc: { title: 'Mine', exampleId: 'bell-curve' } }, storage);
    expect(readAutosave(storage)).toEqual({ network, doc: { title: 'Mine', exampleId: 'bell-curve' } });
    storage.setItem('neural-playground:autosave:v2', '{"network": 5}');
    expect(readAutosave(storage)).toBeNull();
  });

  it('reads settings with defaults for anything missing or invalid', () => {
    const storage = new MemoryStorage();
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
    writeSettings({ ...DEFAULT_SETTINGS, muted: true, theme: 'light' }, storage);
    expect(readSettings(storage)).toMatchObject({ muted: true, theme: 'light' });
    storage.setItem('neural-playground:settings:v2', '{"volume": 7, "theme": "neon"}');
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the Try this checklist per example and drops junk', () => {
    const storage = new MemoryStorage();
    let tried = setTried({}, 'adding-machine', 2, true);
    tried = setTried(tried, 'adding-machine', 0, true);
    tried = setTried(tried, 'pulse-dial', 1, true);
    expect(tried).toEqual({ 'adding-machine': [0, 2], 'pulse-dial': [1] });
    tried = setTried(tried, 'pulse-dial', 1, false);
    expect(tried).toEqual({ 'adding-machine': [0, 2] });
    writeSettings({ ...DEFAULT_SETTINGS, tried }, storage);
    expect(readSettings(storage).tried).toEqual({ 'adding-machine': [0, 2] });
    storage.setItem('neural-playground:settings:v2', JSON.stringify({ tried: { a: [1, 1, -1, 'x', 2.5, 3], b: 'no', c: [] } }));
    expect(readSettings(storage).tried).toEqual({ a: [1, 3] });
    storage.setItem('neural-playground:settings:v2', JSON.stringify({ tried: [1, 2] }));
    expect(readSettings(storage).tried).toEqual({});
  });

  it('survives storage that throws', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('denied');
    };
    broken.setItem = () => {
      throw new Error('quota');
    };
    expect(readAutosave(broken)).toBeNull();
    expect(readSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => writeSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});

describe('autosave protection', () => {
  const example = EXAMPLES[0]!;
  const pristine = { network: example.network, doc: { title: example.title, exampleId: example.id } };
  const edited = { ...pristine, network: { ...example.network, neurons: example.network.neurons.slice(1) } };
  const own = { network: { version: 2 as const, neurons: [{ id: 'a', kind: 'normal' as const, x: 0, y: 0, threshold: 2 }], connections: [], texts: [] }, doc: { title: 'Untitled network' } };

  it('recognises an untouched example, even after a save/load round trip', () => {
    expect(isPristineExample(pristine)).toBe(true);
    const storage = new MemoryStorage();
    writeAutosave(pristine, storage);
    expect(isPristineExample(readAutosave(storage)!)).toBe(true);
    expect(isPristineExample(edited)).toBe(false);
    expect(isPristineExample(own)).toBe(false);
    expect(isPristineExample({ ...pristine, doc: { title: 'x', exampleId: 'no-such-example' } })).toBe(false);
  });

  it('never lets an untouched example or link replace your own work', () => {
    expect(shouldAutosave(true, own)).toBe(false);
    expect(shouldAutosave(true, edited)).toBe(false);
    expect(shouldAutosave(true, pristine)).toBe(true);
    expect(shouldAutosave(true, null)).toBe(true);
    expect(shouldAutosave(false, own)).toBe(true);
  });
});

describe('slugify', () => {
  it('makes file-name friendly names', () => {
    expect(slugify('Count to 1000 in bases 2–10')).toBe('count-to-1000-in-bases-2-10');
    expect(slugify('!!!')).toBe('network');
  });
});

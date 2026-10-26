// Autosave, settings and share-link URLs. Storage can be unavailable
// (private mode, quota, sandboxed iframes), so every access is guarded and
// failures simply mean "nothing saved".

import { normalizeNetwork, type Network } from '../engine';
import { findExample } from '../examples';

const AUTOSAVE_KEY = 'neural-playground:autosave:v2';
const SETTINGS_KEY = 'neural-playground:settings:v2';

/** What a URL hash asks the app to open. */
export type HashRequest = { type: 'net'; code: string } | { type: 'example'; id: string };

/** Parse "#net=<code>" or "#example=<id>" (anything else is ignored). */
export function parseHash(hash: string): HashRequest | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('net');
  if (code) return { type: 'net', code: code.trim() };
  const id = params.get('example');
  if (id) return { type: 'example', id: id.trim() };
  return null;
}

/** The page URL without its hash, plus `#net=<code>`. */
export function shareUrl(href: string, code: string): string {
  const url = new URL(href);
  url.hash = `net=${code}`;
  return url.toString();
}

export function exampleUrl(href: string, id: string): string {
  const url = new URL(href);
  url.hash = `example=${encodeURIComponent(id)}`;
  return url.toString();
}

/** Where the current network came from, shown as the document title. */
export interface DocInfo {
  title: string;
  /** Set while the network is (an edited copy of) a built-in example. */
  exampleId?: string;
}

export interface Autosave {
  network: Network;
  doc: DocInfo;
}

export function readAutosave(storage: Storage | undefined = safeStorage()): Autosave | null {
  try {
    const raw = storage?.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { network?: unknown; doc?: { title?: unknown; exampleId?: unknown } };
    const network = normalizeNetwork(data.network);
    const title = typeof data.doc?.title === 'string' ? data.doc.title : 'Untitled network';
    const doc: DocInfo = { title };
    if (typeof data.doc?.exampleId === 'string') doc.exampleId = data.doc.exampleId;
    return { network, doc };
  } catch {
    return null;
  }
}

/** Same neurons, connections and texts, regardless of key order. */
export function sameNetwork(a: Network, b: Network): boolean {
  try {
    return JSON.stringify(normalizeNetwork(a)) === JSON.stringify(normalizeNetwork(b));
  } catch {
    return false;
  }
}

/** True when a save is a built-in example exactly as shipped: none of the user's work is in it. */
export function isPristineExample(save: Autosave): boolean {
  const example = save.doc.exampleId ? findExample(save.doc.exampleId) : undefined;
  return example !== undefined && sameNetwork(save.network, example.network);
}

/**
 * Whether to write an autosave. The slot holds the user's own work, so an
 * untouched example or shared link (nothing the user made) may only replace
 * an empty slot or another untouched example, never their own network.
 */
export function shouldAutosave(untouched: boolean, existing: Autosave | null): boolean {
  return !untouched || existing === null || isPristineExample(existing);
}

export function writeAutosave(save: Autosave, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(AUTOSAVE_KEY, JSON.stringify(save));
  } catch {
    // Quota or privacy mode: autosave is best-effort.
  }
}

export interface Settings {
  muted: boolean;
  volume: number;
  theme: 'dark' | 'light';
  /** Example ids whose notes card the user collapsed. */
  dismissedNotes: string[];
  /** Set once the user has opened the examples gallery. */
  seenGallery: boolean;
  /** "Try this" items ticked off, by example id (indexes into tryThis). */
  tried: Record<string, number[]>;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.7, theme: 'dark', dismissedNotes: [], seenGallery: false, tried: {} };

export function readSettings(storage: Storage | undefined = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw) as Partial<Settings>;
    return {
      muted: typeof data.muted === 'boolean' ? data.muted : DEFAULT_SETTINGS.muted,
      volume: typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 1 ? data.volume : DEFAULT_SETTINGS.volume,
      theme: data.theme === 'light' ? 'light' : 'dark',
      dismissedNotes: Array.isArray(data.dismissedNotes) ? data.dismissedNotes.filter((s) => typeof s === 'string').slice(-50) : [],
      seenGallery: data.seenGallery === true,
      tried: readTried(data.tried),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Validate a stored checklist map: string keys, small non-negative integer lists. */
function readTried(value: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, list] of Object.entries(value).slice(0, 100)) {
    if (!Array.isArray(list)) continue;
    const items = [...new Set(list.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < 50))].sort((a, b) => a - b);
    if (items.length) out[id] = items;
  }
  return out;
}

/** Tick or untick a "Try this" item, returning the new checklist map. */
export function setTried(tried: Record<string, number[]>, exampleId: string, index: number, done: boolean): Record<string, number[]> {
  const items = new Set(tried[exampleId] ?? []);
  if (done) items.add(index);
  else items.delete(index);
  const next = { ...tried };
  if (items.size) next[exampleId] = [...items].sort((a, b) => a - b);
  else delete next[exampleId];
  return next;
}

export function writeSettings(settings: Settings, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A file-name friendly slug of a title. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'network'
  );
}

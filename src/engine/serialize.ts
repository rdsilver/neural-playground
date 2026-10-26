import { KIND_INFO } from './kinds';
import { fromLegacy, isLegacyNetwork } from './legacy';
import { NEURON_KINDS, type ConnectionSpec, type Network, type NeuronKind, type NeuronSpec, type TextSpec } from './types';

export class NetworkFormatError extends Error {
  override name = 'NetworkFormatError';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Turn untrusted JSON (a saved file, a shared link, a legacy example) into a
 * clean Network: unknown fields dropped, numbers clamped, duplicate cells,
 * dangling and duplicate connections removed. Throws NetworkFormatError if
 * the input is not recognisably a network.
 */
export function normalizeNetwork(input: unknown): Network {
  if (isLegacyNetwork(input)) return normalizeNetwork(fromLegacy(input));
  if (!isObject(input) || !Array.isArray(input.neurons) || !Array.isArray(input.connections)) {
    throw new NetworkFormatError('Not a neural playground network.');
  }

  const neurons: NeuronSpec[] = [];
  const ids = new Set<string>();
  const cells = new Set<string>();
  for (const raw of input.neurons) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) continue;
    if (!NEURON_KINDS.includes(raw.kind as NeuronKind)) continue;
    if (!finite(raw.x) || !finite(raw.y)) continue;
    const kind = raw.kind as NeuronKind;
    const x = Math.round(raw.x);
    const y = Math.round(raw.y);
    const cell = `${x},${y}`;
    if (ids.has(raw.id) || cells.has(cell)) continue;
    ids.add(raw.id);
    cells.add(cell);

    const defaults = KIND_INFO[kind].defaults;
    const spec: NeuronSpec = {
      id: raw.id,
      kind,
      x,
      y,
      threshold: finite(raw.threshold) ? Math.max(1, Math.round(raw.threshold)) : defaults.threshold,
    };
    if (typeof raw.label === 'string' && raw.label.trim()) spec.label = raw.label.trim().slice(0, 12);
    if (kind === 'timer') {
      spec.interval = finite(raw.interval) && raw.interval > 0 ? raw.interval : defaults.interval;
      spec.times = finite(raw.times) && raw.times >= 0 ? Math.round(raw.times) : -1;
    }
    if (kind === 'note') {
      spec.note = finite(raw.note) ? Math.min(127, Math.max(0, Math.round(raw.note))) : defaults.note;
    }
    neurons.push(spec);
  }

  const connections: ConnectionSpec[] = [];
  const seen = new Set<string>();
  for (const raw of input.connections) {
    if (!isObject(raw) || typeof raw.from !== 'string' || typeof raw.to !== 'string') continue;
    const key = `${raw.from}\u0000${raw.to}`;
    if (raw.from === raw.to || seen.has(key) || !ids.has(raw.from) || !ids.has(raw.to)) continue;
    seen.add(key);
    connections.push({ from: raw.from, to: raw.to });
  }

  const texts: TextSpec[] = [];
  if (Array.isArray(input.texts)) {
    const textIds = new Set<string>();
    for (const raw of input.texts) {
      if (!isObject(raw) || typeof raw.text !== 'string' || !finite(raw.x) || !finite(raw.y)) continue;
      const id = typeof raw.id === 'string' && raw.id && !textIds.has(raw.id) ? raw.id : `t${textIds.size + 1}`;
      textIds.add(id);
      const text: TextSpec = { id, x: raw.x, y: raw.y, text: raw.text.slice(0, 500) };
      if (finite(raw.size) && raw.size > 0) text.size = Math.min(4, raw.size);
      if (raw.align === 'left' || raw.align === 'center' || raw.align === 'right') text.align = raw.align;
      if (raw.tone === 'default' || raw.tone === 'muted' || raw.tone === 'accent' || raw.tone === 'warning') text.tone = raw.tone;
      texts.push(text);
    }
  }

  return { version: 2, neurons, connections, texts };
}

/** Pretty JSON for saving to a file. */
export function networkToJson(network: Network): string {
  return JSON.stringify(network, null, 2);
}

export function networkFromJson(json: string): Network {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new NetworkFormatError('That file is not valid JSON.');
  }
  return normalizeNetwork(parsed);
}

// ---- Share links -------------------------------------------------------
// A network is encoded as base64url(deflate-raw(JSON)) so it fits in a URL.

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Compact, URL-safe encoding of a network. */
export async function encodeShareCode(network: Network): Promise<string> {
  const json = JSON.stringify(network);
  return toBase64Url(await pipeThrough(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

export async function decodeShareCode(code: string): Promise<Network> {
  let json: string;
  try {
    json = new TextDecoder().decode(await pipeThrough(fromBase64Url(code), new DecompressionStream('deflate-raw')));
  } catch {
    throw new NetworkFormatError('That share link is damaged or incomplete.');
  }
  return networkFromJson(json);
}

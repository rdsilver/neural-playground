// Pure editing operations on a Network. Every function returns a new
// Network (inputs are never mutated) so snapshots can go straight onto the
// undo stack and the simulation can be re-loaded with the result.

import { KIND_INFO, type ConnectionSpec, type Network, type NeuronKind, type NeuronSpec, type TextSpec } from '../engine';

export const cellKey = (x: number, y: number) => `${x},${y}`;
/**
 * Lookup key for a directed connection. Ids may contain any printable
 * character (imports and links accept arbitrary strings), so the separator
 * is NUL: 'a>b' -> 'c' and 'a' -> 'b>c' must never share a key. Keys are
 * only ever compared, never split back into ids.
 */
export const pairKey = (from: string, to: string) => `${from}\u0000${to}`;

/** Lookup tables for a network, rebuilt whenever it changes. */
export interface NetIndex {
  byId: Map<string, NeuronSpec>;
  byCell: Map<string, NeuronSpec>;
  pairs: Set<string>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  texts: Map<string, TextSpec>;
}

export function indexNetwork(net: Network): NetIndex {
  const byId = new Map<string, NeuronSpec>();
  const byCell = new Map<string, NeuronSpec>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of net.neurons) {
    byId.set(n.id, n);
    byCell.set(cellKey(n.x, n.y), n);
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  const pairs = new Set<string>();
  for (const c of net.connections) {
    if (!byId.has(c.from) || !byId.has(c.to)) continue;
    pairs.add(pairKey(c.from, c.to));
    outgoing.get(c.from)!.push(c.to);
    incoming.get(c.to)!.push(c.from);
  }
  return { byId, byCell, pairs, outgoing, incoming, texts: new Map((net.texts ?? []).map((t) => [t.id, t])) };
}

/** A fresh id like "n12" that is not in `taken`. */
export function nextId(taken: Iterable<string>, prefix: string): string {
  let max = 0;
  const set = new Set(taken);
  for (const id of set) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  let candidate = `${prefix}${max + 1}`;
  for (let i = max + 2; set.has(candidate); i++) candidate = `${prefix}${i}`;
  return candidate;
}

/** A neuron of `kind` with that kind's defaults. */
export function makeNeuron(kind: NeuronKind, id: string, x: number, y: number): NeuronSpec {
  return { ...KIND_INFO[kind].defaults, id, kind, x, y };
}

/** Place a neuron on an empty cell. Returns null if the cell is taken. */
export function addNeuron(net: Network, kind: NeuronKind, x: number, y: number): { net: Network; id: string } | null {
  if (net.neurons.some((n) => n.x === x && n.y === y)) return null;
  const id = nextId(net.neurons.map((n) => n.id), 'n');
  return { net: { ...net, neurons: [...net.neurons, makeNeuron(kind, id, x, y)] }, id };
}

export type NeuronPatch = Partial<Pick<NeuronSpec, 'kind' | 'threshold' | 'label' | 'interval' | 'times' | 'note'>>;

/**
 * Apply a patch to one neuron. Changing kind keeps position, label and
 * threshold, adds the new kind's defaults (e.g. a timer's interval) and
 * drops parameters that no longer apply. An empty label removes it.
 */
export function updateNeuron(net: Network, id: string, patch: NeuronPatch): Network {
  return {
    ...net,
    neurons: net.neurons.map((n) => {
      if (n.id !== id) return n;
      const kind = patch.kind ?? n.kind;
      const info = KIND_INFO[kind];
      const next: NeuronSpec = { id: n.id, kind, x: n.x, y: n.y, threshold: n.threshold };
      if (n.label) next.label = n.label;
      if (kind === 'timer') {
        next.interval = n.interval ?? info.defaults.interval;
        next.times = n.times ?? info.defaults.times;
      }
      if (kind === 'note') next.note = n.note ?? info.defaults.note;
      if (patch.threshold !== undefined) next.threshold = Math.max(1, Math.round(patch.threshold));
      if (patch.label !== undefined) {
        const label = patch.label.trim().slice(0, 12);
        if (label) next.label = label;
        else delete next.label;
      }
      if (kind === 'timer') {
        if (patch.interval !== undefined && patch.interval > 0) next.interval = patch.interval;
        if (patch.times !== undefined) next.times = patch.times < 0 ? -1 : Math.round(patch.times);
      }
      if (kind === 'note' && patch.note !== undefined) next.note = Math.min(127, Math.max(0, Math.round(patch.note)));
      return next;
    }),
  };
}

export interface ItemSet {
  neurons?: Iterable<string>;
  texts?: Iterable<string>;
  connections?: Iterable<ConnectionSpec>;
}

/** Delete neurons (and every connection touching them), texts and connections. */
export function deleteItems(net: Network, items: ItemSet): Network {
  const neurons = new Set(items.neurons ?? []);
  const texts = new Set(items.texts ?? []);
  const conns = new Set([...(items.connections ?? [])].map((c) => pairKey(c.from, c.to)));
  return {
    ...net,
    neurons: net.neurons.filter((n) => !neurons.has(n.id)),
    connections: net.connections.filter((c) => !neurons.has(c.from) && !neurons.has(c.to) && !conns.has(pairKey(c.from, c.to))),
    texts: (net.texts ?? []).filter((t) => !texts.has(t.id)),
  };
}

/** Would moving these neurons by (dx, dy) keep one neuron per cell? */
export function canMove(net: Network, ids: Iterable<string>, dx: number, dy: number): boolean {
  const moving = new Set(ids);
  const fixed = new Set(net.neurons.filter((n) => !moving.has(n.id)).map((n) => cellKey(n.x, n.y)));
  return net.neurons.every((n) => !moving.has(n.id) || !fixed.has(cellKey(n.x + dx, n.y + dy)));
}

/**
 * Move neurons by whole cells and texts by any amount. Returns null if a
 * moved neuron would land on a neuron that is not moving.
 */
export function moveItems(net: Network, neuronIds: Iterable<string>, textIds: Iterable<string>, dx: number, dy: number): Network | null {
  const moving = new Set(neuronIds);
  const texts = new Set(textIds);
  const cdx = Math.round(dx);
  const cdy = Math.round(dy);
  if (!canMove(net, moving, cdx, cdy)) return null;
  return {
    ...net,
    neurons: net.neurons.map((n) => (moving.has(n.id) ? { ...n, x: n.x + cdx, y: n.y + cdy } : n)),
    texts: (net.texts ?? []).map((t) => (texts.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
  };
}

export const hasConnection = (net: Network, from: string, to: string) => net.connections.some((c) => c.from === from && c.to === to);

/** Add from -> to (and to -> from when twoWay). Self-loops are ignored. */
export function connect(net: Network, from: string, to: string, twoWay = false): Network {
  if (from === to) return net;
  const add: ConnectionSpec[] = [];
  if (!hasConnection(net, from, to)) add.push({ from, to });
  if (twoWay && !hasConnection(net, to, from)) add.push({ from: to, to: from });
  return add.length ? { ...net, connections: [...net.connections, ...add] } : net;
}

export function disconnect(net: Network, from: string, to: string): Network {
  return { ...net, connections: net.connections.filter((c) => !(c.from === from && c.to === to)) };
}

/** Make a connection one-way or two-way. */
export function setTwoWay(net: Network, from: string, to: string, on: boolean): Network {
  return on ? connect(net, from, to, true) : disconnect(net, to, from);
}

/** Flip a connection's direction (a two-way pair stays as it is). */
export function reverseConnection(net: Network, from: string, to: string): Network {
  if (hasConnection(net, to, from)) return net;
  return { ...net, connections: net.connections.map((c) => (c.from === from && c.to === to ? { from: to, to: from } : c)) };
}

/** Add a text annotation; returns its id. */
export function addText(net: Network, x: number, y: number, text: string): { net: Network; id: string } {
  const texts = net.texts ?? [];
  const id = nextId(texts.map((t) => t.id), 't');
  return { net: { ...net, texts: [...texts, { id, x, y, text }] }, id };
}

export type TextPatch = Partial<Pick<TextSpec, 'text' | 'size' | 'align' | 'tone'>>;

export function updateText(net: Network, id: string, patch: TextPatch): Network {
  return {
    ...net,
    texts: (net.texts ?? []).map((t) => {
      if (t.id !== id) return t;
      const next: TextSpec = { ...t, ...patch };
      if (next.text !== undefined) next.text = next.text.slice(0, 500);
      if (next.size !== undefined) next.size = Math.min(4, Math.max(0.2, next.size));
      return next;
    }),
  };
}

/** A copied fragment of a network, positioned relative to its top-left neuron cell. */
export interface Clip {
  neurons: NeuronSpec[];
  connections: ConnectionSpec[];
  texts: TextSpec[];
}

/** Copy neurons (with the connections among them) and texts. */
export function copyItems(net: Network, neuronIds: Iterable<string>, textIds: Iterable<string>): Clip | null {
  const ids = new Set(neuronIds);
  const tids = new Set(textIds);
  const neurons = net.neurons.filter((n) => ids.has(n.id));
  const texts = (net.texts ?? []).filter((t) => tids.has(t.id));
  if (!neurons.length && !texts.length) return null;
  const xs = [...neurons.map((n) => n.x), ...texts.map((t) => Math.floor(t.x))];
  const ys = [...neurons.map((n) => n.y), ...texts.map((t) => Math.floor(t.y))];
  const ox = Math.min(...xs);
  const oy = Math.min(...ys);
  return {
    neurons: neurons.map((n) => ({ ...n, x: n.x - ox, y: n.y - oy })),
    connections: net.connections.filter((c) => ids.has(c.from) && ids.has(c.to)).map((c) => ({ ...c })),
    texts: texts.map((t) => ({ ...t, x: t.x - ox, y: t.y - oy })),
  };
}

/**
 * Paste a clip with its top-left at (x, y), sliding right a cell at a time
 * until no pasted neuron lands on an existing one. New ids are assigned.
 */
export function pasteClip(net: Network, clip: Clip, x: number, y: number): { net: Network; neurons: string[]; texts: string[] } {
  const taken = new Set(net.neurons.map((n) => cellKey(n.x, n.y)));
  let dx = x;
  while (clip.neurons.some((n) => taken.has(cellKey(n.x + dx, n.y + y)))) dx++;
  const ids = net.neurons.map((n) => n.id);
  const rename = new Map<string, string>();
  const neurons = clip.neurons.map((n) => {
    const id = nextId(ids, 'n');
    ids.push(id);
    rename.set(n.id, id);
    return { ...n, id, x: n.x + dx, y: n.y + y };
  });
  const textIds = (net.texts ?? []).map((t) => t.id);
  const texts = clip.texts.map((t) => {
    const id = nextId(textIds, 't');
    textIds.push(id);
    return { ...t, id, x: t.x + dx, y: t.y + y };
  });
  const connections = clip.connections.map((c) => ({ from: rename.get(c.from)!, to: rename.get(c.to)! }));
  return {
    net: {
      ...net,
      neurons: [...net.neurons, ...neurons],
      connections: [...net.connections, ...connections],
      texts: [...(net.texts ?? []), ...texts],
    },
    neurons: neurons.map((n) => n.id),
    texts: texts.map((t) => t.id),
  };
}

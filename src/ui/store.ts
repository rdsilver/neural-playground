// Editor state: the network being edited (with undo history), what is
// selected, and the active tool. Panels and the canvas subscribe to
// change events; nothing else mutates this state directly.

import type { ConnectionSpec, Network, NeuronKind } from '../engine';
import { History } from './history';
import { indexNetwork, pairKey, type NetIndex } from './netops';
import type { DocInfo } from './persistence';

export type Tool = 'select' | 'place' | 'connect' | 'text' | 'hand';

export interface Selection {
  neurons: ReadonlySet<string>;
  texts: ReadonlySet<string>;
  connection: ConnectionSpec | null;
}

export const EMPTY_SELECTION: Selection = { neurons: new Set(), texts: new Set(), connection: null };

export const selectionSize = (s: Selection) => s.neurons.size + s.texts.size + (s.connection ? 1 : 0);

interface Snapshot {
  network: Network;
  doc: DocInfo;
}

export interface NetworkChange {
  /** The document itself was swapped (example loaded, file imported, or undo across one). */
  docChanged: boolean;
}

interface Events {
  network: NetworkChange;
  selection: Selection;
  tool: Tool;
  history: void;
}

type Listener<T> = (value: T) => void;

export class Store {
  network: Network;
  doc: DocInfo;
  index: NetIndex;
  selection: Selection = EMPTY_SELECTION;
  /**
   * The current selection was made in passing (a neuron clicked to poke it
   * while running): show it on the board, but do not open the inspector.
   */
  selectionQuiet = false;
  tool: Tool = 'select';
  kind: NeuronKind = 'normal';
  readonly history = new History<Snapshot>();
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(network: Network, doc: DocInfo) {
    this.network = network;
    this.doc = doc;
    this.index = indexNetwork(network);
  }

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<never>);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<Events[K]>)(value);
  }

  /**
   * Apply an edit as one undo step. Edits sharing `coalesce` within a short
   * window merge into one step (typing in a field, nudging with arrows).
   */
  commit(network: Network, label: string, coalesce?: string): void {
    if (network === this.network) return;
    this.history.record({ network: this.network, doc: this.doc }, label, coalesce);
    this.setNetwork(network, false);
    this.emit('history', undefined);
  }

  /** Swap in a whole new document (example, import, share link): undoable. */
  replace(network: Network, doc: DocInfo, label: string): void {
    this.history.record({ network: this.network, doc: this.doc }, label);
    this.doc = doc;
    this.selection = EMPTY_SELECTION;
    this.setNetwork(network, true);
    this.emit('selection', this.selection);
    this.emit('history', undefined);
  }

  undo(): string | undefined {
    const step = this.history.undo({ network: this.network, doc: this.doc });
    if (step) this.restore(step.state);
    return step?.label;
  }

  redo(): string | undefined {
    const step = this.history.redo({ network: this.network, doc: this.doc });
    if (step) this.restore(step.state);
    return step?.label;
  }

  private restore(snapshot: Snapshot): void {
    const docChanged = snapshot.doc !== this.doc;
    this.doc = snapshot.doc;
    this.setNetwork(snapshot.network, docChanged);
    this.emit('history', undefined);
  }

  private setNetwork(network: Network, docChanged: boolean): void {
    this.network = network;
    this.index = indexNetwork(network);
    this.emit('network', { docChanged });
    this.pruneSelection();
  }

  /** Drop selected items that no longer exist. */
  private pruneSelection(): void {
    const s = this.selection;
    const neurons = [...s.neurons].filter((id) => this.index.byId.has(id));
    const texts = [...s.texts].filter((id) => this.index.texts.has(id));
    const c = s.connection;
    const connection = c && this.index.pairs.has(pairKey(c.from, c.to)) ? c : null;
    if (neurons.length !== s.neurons.size || texts.length !== s.texts.size || connection !== c) {
      this.select({ neurons: new Set(neurons), texts: new Set(texts), connection }, this.selectionQuiet);
    }
  }

  select(selection: Selection, quiet = false): void {
    this.selection = selection;
    this.selectionQuiet = quiet;
    this.emit('selection', selection);
  }

  selectOnly(kind: 'neuron' | 'text', id: string, quiet = false): void {
    this.select({ neurons: new Set(kind === 'neuron' ? [id] : []), texts: new Set(kind === 'text' ? [id] : []), connection: null }, quiet);
  }

  /** Add or remove one item from a multi-selection (shift-click). */
  toggleSelected(kind: 'neuron' | 'text', id: string): void {
    const neurons = new Set(this.selection.neurons);
    const texts = new Set(this.selection.texts);
    const set = kind === 'neuron' ? neurons : texts;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.select({ neurons, texts, connection: null });
  }

  selectConnection(connection: ConnectionSpec | null): void {
    this.select({ neurons: new Set(), texts: new Set(), connection });
  }

  clearSelection(): void {
    if (selectionSize(this.selection)) this.select(EMPTY_SELECTION);
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.emit('tool', tool);
  }

  /** Pick a neuron kind: switches to the place tool. */
  setKind(kind: NeuronKind): void {
    this.kind = kind;
    this.tool = 'place';
    this.emit('tool', this.tool);
  }

  /** The single selected neuron, if exactly one neuron is selected. */
  get selectedNeuron() {
    const s = this.selection;
    if (s.neurons.size !== 1 || s.texts.size) return undefined;
    return this.index.byId.get([...s.neurons][0]!);
  }
}

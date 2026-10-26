// The board's right-click menu: selects what was clicked (so the actions
// apply to it) and returns the matching entries.

import { KIND_INFO, NEURON_KINDS } from '../../engine';
import type { App } from '../app';
import type { Hit } from '../input';
import { pairKey, reverseConnection, setTwoWay } from '../netops';
import { selectionSize } from '../store';
import type { MenuEntry } from './menu';

export function boardMenuEntries(app: App, hit: Hit): MenuEntry[] {
  const s = app.store;
  if (hit.type === 'neuron' || hit.type === 'handle') {
    if (!s.selection.neurons.has(hit.id)) s.selectOnly('neuron', hit.id);
    const count = selectionSize(s.selection);
    const many = count > 1;
    return [
      { icon: 'poke', label: many ? 'Poke selected (+1)' : 'Poke (+1 charge)', keys: 'enter', run: () => app.pokeSelection() },
      { icon: 'fire', label: many ? 'Fire selected now' : 'Fire now', keys: 'shift+enter', run: () => app.fireSelection() },
      'separator',
      { icon: 'connect', label: 'Connect from here…', disabled: many, run: () => app.connectFrom(hit.id) },
      { icon: 'copy', label: 'Duplicate', keys: 'mod+d', run: () => app.duplicate() },
      'separator',
      { icon: 'trash', label: many ? `Delete ${count} items` : 'Delete', keys: 'delete', danger: true, run: () => app.deleteSelection() },
    ];
  } else if (hit.type === 'connection') {
    const { from, to } = hit;
    s.selectConnection({ from, to });
    const twoWay = s.index.pairs.has(pairKey(to, from));
    return [
      { icon: 'swap', label: twoWay ? 'Make one-way' : 'Make two-way', run: () => s.commit(setTwoWay(s.network, from, to, !twoWay), twoWay ? 'Make one-way' : 'Make two-way') },
      {
        icon: 'swap',
        label: 'Reverse direction',
        disabled: twoWay,
        run: () => {
          s.commit(reverseConnection(s.network, from, to), 'Reverse connection');
          s.selectConnection({ from: to, to: from });
        },
      },
      'separator',
      { icon: 'trash', label: 'Delete connection', keys: 'delete', danger: true, run: () => app.deleteSelection() },
    ];
  } else if (hit.type === 'text') {
    s.selectOnly('text', hit.id);
    return [
      { icon: 'text', label: 'Edit text', run: () => app.editText(hit.id) },
      { icon: 'copy', label: 'Duplicate', keys: 'mod+d', run: () => app.duplicate() },
      'separator',
      { icon: 'trash', label: 'Delete', keys: 'delete', danger: true, run: () => app.deleteSelection() },
    ];
  } else {
    const { x, y } = hit;
    const kind = KIND_INFO[s.kind];
    return [
      {
        icon: 'plus',
        label: `Place ${kind.name} here`,
        keys: String(NEURON_KINDS.indexOf(s.kind) + 1),
        run: () => {
          const id = app.place(x, y);
          if (id) s.selectOnly('neuron', id);
        },
      },
      { icon: 'text', label: 'Add text here', run: () => app.addText(x, y + 0.2) },
      { icon: 'copy', label: 'Paste here', keys: 'mod+v', disabled: !app.hasClip, run: () => app.paste(undefined, { x, y }) },
      'separator',
      { icon: 'fit', label: 'Zoom to fit', keys: 'f', run: () => app.zoomToFit() },
      { icon: 'select', label: 'Select all', keys: 'mod+a', run: () => app.selectAll() },
    ];
  }
}

// The board's right-click (and long-press, and Shift+F10) menu. It acts on
// what was clicked without changing the selection first, so right-clicking a
// calculator key to look at it never presses it or rearranges the selection;
// "Inspect" selects it and opens the inspector. A neuron that is part of a
// multi-selection stands for the whole selection.

import { KIND_INFO, NEURON_KINDS } from '../../engine';
import type { App } from '../app';
import type { Hit } from '../input';
import { pairKey, reverseConnection, setTwoWay } from '../netops';
import { selectionSize } from '../store';
import type { MenuEntry } from './menu';

export function boardMenuEntries(app: App, hit: Hit): MenuEntry[] {
  const s = app.store;
  if (hit.type === 'neuron' || hit.type === 'handle') {
    const id = hit.id;
    const inSelection = s.selection.neurons.has(id);
    const count = inSelection ? selectionSize(s.selection) : 1;
    const many = count > 1;
    const ids = () => (inSelection ? [...s.selection.neurons] : [id]);
    /** Run a selection command on this neuron (selecting it first if needed). */
    const onSelection = (run: () => void) => () => {
      if (!inSelection) s.selectOnly('neuron', id);
      run();
    };
    const timer = !many && s.index.byId.get(id)?.kind === 'timer';
    return [
      { icon: 'inspect', label: many ? `Inspect ${count} items` : 'Inspect', run: onSelection(() => app.inspector.setOpen(true)) },
      'separator',
      { icon: 'poke', label: many ? 'Poke selected (+1)' : timer ? 'Poke (timers ignore it)' : 'Poke (+1 charge)', keys: 'enter', run: () => app.pokeIds(ids()) },
      { icon: 'fire', label: many ? 'Fire selected now' : 'Fire now', keys: 'shift+enter', run: () => app.fireIds(ids()) },
      'separator',
      { icon: 'connect', label: 'Connect from here…', disabled: many, run: () => app.connectFrom(id) },
      { icon: 'copy', label: 'Duplicate', keys: 'mod+d', run: onSelection(() => app.duplicate()) },
      'separator',
      { icon: 'trash', label: many ? `Delete ${count} items` : 'Delete', keys: 'delete', danger: true, run: onSelection(() => app.deleteSelection()) },
    ];
  } else if (hit.type === 'connection') {
    const { from, to } = hit;
    const twoWay = s.index.pairs.has(pairKey(to, from));
    return [
      { icon: 'inspect', label: 'Inspect', run: () => s.selectConnection({ from, to }) },
      'separator',
      { icon: 'swap', label: twoWay ? 'Make one-way' : 'Make two-way', run: () => s.commit(setTwoWay(s.network, from, to, !twoWay), twoWay ? 'Make one-way' : 'Make two-way') },
      {
        icon: 'swap',
        label: 'Reverse direction',
        disabled: twoWay,
        run: () => {
          s.commit(reverseConnection(s.network, from, to), 'Reverse connection');
          if (s.selection.connection?.from === from && s.selection.connection.to === to) s.selectConnection({ from: to, to: from });
        },
      },
      'separator',
      { icon: 'trash', label: 'Delete connection', keys: 'delete', danger: true, run: () => app.deleteItems({ connections: [{ from, to }] }) },
    ];
  } else if (hit.type === 'text') {
    const id = hit.id;
    return [
      { icon: 'text', label: 'Edit text', run: () => app.editText(id) },
      {
        icon: 'copy',
        label: 'Duplicate',
        keys: 'mod+d',
        run: () => {
          s.selectOnly('text', id);
          app.duplicate();
        },
      },
      'separator',
      { icon: 'trash', label: 'Delete', keys: 'delete', danger: true, run: () => app.deleteItems({ texts: [id] }) },
    ];
  } else {
    const { x, y } = hit;
    const kind = KIND_INFO[s.kind];
    return [
      { icon: 'plus', label: `Place ${kind.name} here`, keys: String(NEURON_KINDS.indexOf(s.kind) + 1), run: () => app.placeAndSelect(x, y) },
      { icon: 'text', label: 'Add text here', run: () => app.addText(x, y + 0.2) },
      { icon: 'copy', label: 'Paste here', keys: 'mod+v', disabled: !app.hasClip, run: () => app.paste(undefined, { x, y }) },
      'separator',
      { icon: 'fit', label: 'Zoom to fit', keys: 'f', run: () => app.zoomToFit() },
      { icon: 'select', label: 'Select all', keys: 'mod+a', run: () => app.selectAll() },
    ];
  }
}

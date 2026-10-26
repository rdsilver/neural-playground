// Right-hand inspector: properties of whatever is selected, notes for the
// current example, and network stats. Rebuilt on every change (it is
// small), keeping focus and scroll position so typing is never disturbed.
// On phones it becomes a bottom sheet.

import { KIND_INFO, NEURON_KINDS, noteName, TICKS_PER_SECOND, travelTicks, type NeuronKind, type NeuronSpec, type TextSpec } from '../../engine';
import type { App } from '../app';
import { h } from '../dom';
import { icons } from '../icons';
import { BLACK_KEYS, parseNote } from '../music';
import { deleteItems, pairKey, reverseConnection, setTwoWay, updateNeuron, updateText } from '../netops';
import { drawKindIcon } from '../renderer';
import { selectionSize } from '../store';
import { iconButton, prop, section, segmented, stacked, stepper, textInput, toggle } from './controls';
import { tipped } from './tooltip';

type SheetState = 'closed' | 'peek' | 'open';

export class Inspector {
  readonly el: HTMLElement;
  private scroll = h('div', { class: 'insp-scroll' });
  private sheetTitle = h('b');
  private sheetSub = h('span');
  private liveUpdaters: (() => void)[] = [];
  private sheet: SheetState = 'closed';
  private sheetReason: 'selection' | 'user' = 'user';
  private readonly phone = matchMedia('(max-width: 760px)');
  /** Examples whose long notes the user unfolded. */
  private expandedNotes = new Set<string>();
  /** What was selected at the last render (scroll resets when it changes). */
  private shownSelection = '';

  constructor(private readonly app: App) {
    const sheetToggle = h(
      'button',
      { class: 'sheet-title', type: 'button', 'aria-label': 'Expand or collapse the inspector', onclick: () => this.setSheet(this.sheet === 'open' ? 'peek' : 'open', 'user') },
      this.sheetTitle,
      this.sheetSub,
    );
    const close = h('button', { class: 'btn', type: 'button', html: icons.close, 'aria-label': 'Close inspector', onclick: () => this.setSheet('closed', 'user') });
    this.el = h('aside', { class: 'inspector', 'aria-label': 'Inspector', 'data-sheet': 'closed' }, h('div', { class: 'sheet-bar' }, sheetToggle, close), this.scroll);

    app.store.on('selection', () => {
      this.render();
      const size = selectionSize(app.store.selection);
      if (size && !app.running && this.sheet === 'closed') this.setSheet('peek', 'selection');
      if (!size && this.sheetReason === 'selection') this.setSheet('closed', 'user');
    });
    app.store.on('network', () => this.render());
    this.render();
  }

  // --------------------------------------------------------------- sheet

  private setSheet(state: SheetState, reason: 'selection' | 'user'): void {
    this.sheet = state;
    this.sheetReason = reason;
    this.el.dataset.sheet = state;
  }

  /** Pixels at the bottom of the board hidden by the peeking sheet (phones). */
  get coveredHeight(): number {
    return this.phone.matches && this.sheet === 'peek' ? this.el.offsetHeight : 0;
  }

  /** Bring the example notes into view (and un-dismiss them when asked to). */
  showExample(expand = false): void {
    const example = this.app.currentExample;
    if (expand && example) this.app.restoreNotes(example.id);
    this.render();
    if (this.phone.matches) this.setSheet(expand ? 'open' : 'peek', 'user');
    else if (expand) this.scroll.querySelector('.example-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  focusTextEditor(): void {
    this.render();
    if (this.phone.matches) this.setSheet('open', 'user');
    const area = this.scroll.querySelector<HTMLTextAreaElement>('[data-field="text-body"]');
    area?.focus();
    area?.select();
  }

  // -------------------------------------------------------------- render

  /** Rebuild, preserving focus, caret and scroll. */
  render(): void {
    const active = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement) ? document.activeElement : null;
    const field = active?.dataset.field;
    const typed = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    const caret = typed ? { value: typed.value, start: typed.selectionStart, end: typed.selectionEnd } : null;
    const { store } = this.app;
    const sel = store.selection;
    const selectionKey = [...sel.neurons, '|', ...sel.texts, '|', sel.connection ? pairKey(sel.connection.from, sel.connection.to) : ''].join(',');
    const scrollTop = selectionKey === this.shownSelection ? this.scroll.scrollTop : 0;
    this.shownSelection = selectionKey;

    this.liveUpdaters = [];
    const parts: HTMLElement[] = [];
    const neuron = store.selectedNeuron;
    if (neuron) parts.push(this.neuronSection(neuron));
    else if (sel.connection && store.index.pairs.has(pairKey(sel.connection.from, sel.connection.to))) parts.push(this.connectionSection(sel.connection.from, sel.connection.to));
    else if (sel.texts.size === 1 && !sel.neurons.size) {
      const text = store.index.texts.get([...sel.texts][0]!);
      if (text) parts.push(this.textSection(text));
    } else if (selectionSize(sel) > 1) parts.push(this.multiSection());

    const notes = this.exampleSection();
    if (notes) parts.push(notes);
    parts.push(this.networkSection());
    if (!selectionSize(sel)) parts.push(this.tipsSection());
    this.scroll.replaceChildren(...parts);
    this.updateSheetTitle();

    this.scroll.scrollTop = scrollTop;
    if (field) {
      const next = this.scroll.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
      if (next) {
        if (caret && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
          next.value = caret.value;
          next.focus({ preventScroll: true });
          try {
            next.setSelectionRange(caret.start, caret.end);
          } catch {
            // Number inputs do not support selection ranges.
          }
        } else next.focus({ preventScroll: true });
      }
    }
    this.live();
  }

  /** Refresh live readouts (charge, fire counts, pulses). */
  live(): void {
    for (const fn of this.liveUpdaters) fn();
  }

  private updateSheetTitle(): void {
    const { store } = this.app;
    const sel = store.selection;
    const n = store.selectedNeuron;
    let title = 'Network';
    let sub = `${store.network.neurons.length} neurons · ${store.network.connections.length} connections`;
    if (n) {
      title = `${KIND_INFO[n.kind].name}${n.label ? ` “${n.label}”` : ''}`;
      sub = n.kind === 'timer' ? `every ${n.interval}s` : n.kind === 'note' ? `${noteName(n.note ?? 60)} · threshold ${n.threshold}` : `threshold ${n.threshold}`;
    } else if (sel.connection) {
      title = 'Connection';
      sub = `${sel.connection.from} → ${sel.connection.to}`;
    } else if (selectionSize(sel) > 1) {
      title = `${selectionSize(sel)} items selected`;
      sub = 'Tap to edit them together';
    } else if (sel.texts.size) {
      title = 'Text note';
      sub = 'Tap to edit';
    } else if (this.app.currentExample) {
      title = this.app.currentExample.title;
      sub = 'About this example';
    }
    this.sheetTitle.textContent = title;
    this.sheetSub.textContent = sub;
  }

  // ------------------------------------------------------------ sections

  private kindIcon(kind: NeuronKind, size: number): HTMLCanvasElement {
    const c = h('canvas', { 'aria-hidden': 'true' });
    drawKindIcon(c, kind, this.app.palette, size);
    return c;
  }

  private kindGrid(field: string, current: NeuronKind | null, onPick: (k: NeuronKind) => void): HTMLElement {
    const grid = h('div', { class: 'kind-grid', role: 'group', 'aria-label': 'Kind' });
    for (const kind of NEURON_KINDS) {
      grid.append(
        tipped(
          h(
            'button',
            { type: 'button', 'data-field': `${field}-${kind}`, 'aria-pressed': String(kind === current), onclick: () => onPick(kind) },
            this.kindIcon(kind, 16),
            KIND_INFO[kind].name,
          ),
          KIND_INFO[kind].name,
          undefined,
          KIND_INFO[kind].description,
        ),
      );
    }
    return grid;
  }

  private neuronSection(n: NeuronSpec): HTMLElement {
    const app = this.app;
    const info = KIND_INFO[n.kind];
    const edit = (patch: Parameters<typeof updateNeuron>[2], label: string, key?: string) => app.updateNeuron(n.id, patch, label, key && `${key}:${n.id}`);

    const hero = h(
      'div',
      { class: 'insp-hero' },
      this.kindIcon(n.kind, 34),
      h('div', { class: 'insp-hero-text' }, h('h3', { text: n.label ? `${info.name} “${n.label}”` : info.name }), h('div', { class: 'sub', text: `${n.id} · cell ${n.x}, ${n.y}` })),
    );
    const body: HTMLElement[] = [hero, stacked('Kind', this.kindGrid('kind', n.kind, (k) => k !== n.kind && edit({ kind: k }, `Change to ${KIND_INFO[k].name.toLowerCase()}`)))];
    body.push(
      prop('Label', textInput('label', 'Label', n.label ?? '', n.kind === 'character' ? 'Shown under the digit' : 'Text on the neuron', 12, (v) => edit({ label: v }, 'Edit label', 'label')), undefined, 'f-label'),
    );

    if (n.kind === 'timer') {
      const forever = (n.times ?? -1) < 0;
      body.push(
        prop(
          'Every',
          stepper({ field: 'interval', label: 'Interval in seconds', value: n.interval ?? 1, step: 0.25, min: 0.05, max: 600, unit: 's', onChange: (v) => edit({ interval: v }, 'Change interval', 'interval') }),
          undefined,
          'f-interval',
        ),
        prop('Repeat', toggle('forever', 'Forever', forever, (on) => edit({ times: on ? -1 : 10 }, on ? 'Repeat forever' : 'Repeat 10 times'))),
      );
      if (!forever) {
        body.push(
          prop('Times', stepper({ field: 'times', label: 'Number of fires', value: n.times ?? 10, step: 1, min: 0, max: 100000, onChange: (v) => edit({ times: Math.round(v) }, 'Change repeat count', 'times') }), undefined, 'f-times'),
        );
      }
    } else {
      body.push(
        prop(
          'Threshold',
          stepper({ field: 'threshold', label: 'Threshold', value: n.threshold, step: 1, min: 1, max: 9999, onChange: (v) => edit({ threshold: Math.round(v) }, 'Change threshold', 'threshold') }),
          n.kind === 'character' ? 'The base it counts in: it carries at this charge.' : 'Charge needed to fire.',
          'f-threshold',
        ),
      );
    }
    if (n.kind === 'note') body.push(this.noteEditor(n, edit));

    // Live state.
    const meterFill = h('div', { class: 'meter-fill' });
    const meterLeft = h('span');
    const meterRight = h('span');
    const meter = h('div', { class: 'meter', role: 'meter', 'aria-label': n.kind === 'timer' ? 'Time to next fire' : 'Charge' }, meterFill, h('div', { class: 'meter-text' }, meterLeft, meterRight));
    meter.style.setProperty('--meter', app.palette.kinds[n.kind]);
    const fires = h('b', { text: '0' });
    const last = h('b', { text: '—' });
    this.liveUpdaters.push(() => {
      const sim = app.runner.sim;
      const st = sim.state(n.id);
      if (!st) return;
      if (n.kind === 'timer') {
        const times = n.times ?? -1;
        const done = times >= 0 && st.timerFires >= times;
        const interval = Math.max(1, Math.round((n.interval ?? 1) * TICKS_PER_SECOND));
        const left = Math.max(0, st.nextTimerTick - sim.tick);
        meterFill.style.width = done ? '0%' : `${(100 * (1 - left / interval)).toFixed(1)}%`;
        meterLeft.textContent = done ? 'finished' : `next in ${(left / TICKS_PER_SECOND).toFixed(2)}s`;
        meterRight.textContent = times >= 0 ? `${st.timerFires} / ${times}` : `${st.timerFires} fired`;
      } else {
        const c = st.charge;
        meterFill.classList.toggle('neg', c < 0);
        meterFill.style.width = `${Math.min(100, (100 * Math.abs(c)) / n.threshold).toFixed(1)}%`;
        meterLeft.textContent = `charge ${c}`;
        meterRight.textContent = `/ ${n.threshold}`;
        meter.setAttribute('aria-valuenow', String(c));
      }
      fires.textContent = st.fireCount.toLocaleString('en-US');
      last.textContent = st.lastFired === -Infinity ? 'never' : `${((sim.tick - st.lastFired) / TICKS_PER_SECOND).toFixed(1)}s ago`;
    });
    body.push(
      h('div', { class: 'sub-head', text: 'Live' }),
      meter,
      h('div', { class: 'stats', style: 'margin-top:8px' }, h('div', { class: 'stat' }, fires, h('span', { text: 'times fired' })), h('div', { class: 'stat' }, last, h('span', { text: 'last fire' }))),
      h(
        'div',
        { class: 'row wrap', style: 'margin-top:10px' },
        iconButton('poke', 'poke', 'Poke +1', () => app.poke(n.id), 'btn small outline', 'enter'),
        iconButton('fire', 'fire', 'Fire', () => app.fireSelection(), 'btn small outline', 'shift+enter'),
        h('span', { class: 'grow' }),
        iconButton('delete', 'trash', 'Delete', () => app.deleteSelection(), 'btn small danger', 'delete'),
      ),
    );
    body.push(this.connectionsList(n));
    return section('Neuron', [], ...body);
  }

  private noteEditor(n: NeuronSpec, edit: (patch: { note: number }, label: string, key?: string) => void): HTMLElement {
    const app = this.app;
    const note = n.note ?? 60;
    const set = (v: number) => {
      edit({ note: v }, 'Change note', 'note');
      app.previewNote(v);
    };
    const octaveStart = Math.floor(note / 12) * 12;
    const piano = h('div', { class: 'piano', role: 'group', 'aria-label': `Piano, octave ${Math.floor(note / 12) - 1}` });
    const whiteWidth = 100 / 7;
    let white = 0;
    for (let i = 0; i < 12; i++) {
      const midi = octaveStart + i;
      if (midi > 127) break;
      const black = BLACK_KEYS.has(i);
      const key = h('button', {
        type: 'button',
        class: black ? 'black' : 'white',
        'data-field': `key-${i}`,
        'aria-label': noteName(midi),
        'aria-pressed': String(midi === note),
        onclick: () => set(midi),
      });
      if (black) key.style.left = `${white * whiteWidth - 4.5}%`;
      else white++;
      piano.append(key);
    }
    const octave = (dir: 1 | -1) =>
      tipped(
        h('button', {
          class: 'btn outline',
          type: 'button',
          'data-field': dir > 0 ? 'oct-up' : 'oct-down',
          text: dir > 0 ? '8va' : '8vb',
          'aria-label': dir > 0 ? 'Octave up' : 'Octave down',
          onclick: () => set(Math.min(127, Math.max(0, note + 12 * dir))),
        }),
        dir > 0 ? 'Octave up' : 'Octave down',
      );
    const row = h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'grow' },
        stepper({ field: 'note', label: 'Note', value: noteName(note), step: 1, min: 0, max: 127, parse: parseNote, format: noteName, onChange: (v) => edit({ note: v }, 'Change note', 'note') }),
      ),
      octave(-1),
      octave(1),
      tipped(h('button', { class: 'btn outline', type: 'button', 'data-field': 'preview', html: icons.play, 'aria-label': 'Preview note', onclick: () => app.previewNote(note) }), 'Preview note'),
    );
    return h('div', { class: 'prop-stack' }, h('label', { class: 'prop-label', for: 'f-note', text: 'Note' }), row, piano);
  }

  private connectionsList(n: NeuronSpec): HTMLElement {
    const { store } = this.app;
    const out = store.index.outgoing.get(n.id) ?? [];
    const inc = store.index.incoming.get(n.id) ?? [];
    const wrap = h('div');
    const list = (title: string, ids: string[], outgoing: boolean) => {
      wrap.append(h('div', { class: 'sub-head', text: `${title} · ${ids.length}` }));
      if (!ids.length) {
        wrap.append(h('div', { class: 'empty-note', text: outgoing ? 'Drag from the handle on the right of the neuron to connect it.' : 'Nothing connects to this neuron yet.' }));
        return;
      }
      const ul = h('ul', { class: 'conn-list' });
      const shown = ids.slice(0, 8);
      for (const id of shown) {
        const other = store.index.byId.get(id)!;
        const from = outgoing ? n : other;
        const to = outgoing ? other : n;
        const twoWay = store.index.pairs.has(pairKey(to.id, from.id));
        const delay = travelTicks(from, to) / TICKS_PER_SECOND;
        ul.append(
          h(
            'li',
            {},
            h('span', { class: `swatch${other.kind === 'character' ? ' square' : ''}`, style: `background:${this.app.palette.kinds[other.kind]}` }),
            h(
              'button',
              { class: 'grow btn small', style: 'justify-content:flex-start;padding:0 2px', type: 'button', 'data-field': `goto-${id}`, onclick: () => store.selectOnly('neuron', id) },
              h('span', { class: 'dir', text: outgoing ? '→' : '←' }),
              ` ${other.label ? `“${other.label}”` : KIND_INFO[other.kind].name} `,
              h('span', { class: 'muted', text: `${other.id} · ${delay.toFixed(2)}s` }),
            ),
            tipped(
              h('button', {
                class: 'btn small',
                type: 'button',
                'data-field': `two-${id}`,
                'aria-pressed': String(twoWay),
                html: icons.swap,
                onclick: () => store.commit(setTwoWay(store.network, from.id, to.id, !twoWay), twoWay ? 'Make one-way' : 'Make two-way'),
              }),
              twoWay ? 'Two-way: make one-way' : 'Make two-way',
            ),
            tipped(
              h('button', {
                class: 'btn small danger',
                type: 'button',
                'data-field': `rm-${id}`,
                html: icons.close,
                onclick: () => store.commit(deleteItems(store.network, { connections: [{ from: from.id, to: to.id }] }), 'Remove connection'),
              }),
              'Remove connection',
            ),
          ),
        );
      }
      wrap.append(ul);
      if (ids.length > shown.length) wrap.append(h('div', { class: 'empty-note', style: 'margin-top:4px', text: `+ ${ids.length - shown.length} more` }));
    };
    list('Outgoing', out, true);
    list('Incoming', inc, false);
    return wrap;
  }

  private connectionSection(fromId: string, toId: string): HTMLElement {
    const { store } = this.app;
    const from = store.index.byId.get(fromId)!;
    const to = store.index.byId.get(toId)!;
    const twoWay = store.index.pairs.has(pairKey(toId, fromId));
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const delay = travelTicks(from, to) / TICKS_PER_SECOND;
    const end = (n: NeuronSpec) =>
      h(
        'button',
        { class: 'btn small outline', type: 'button', style: 'justify-content:flex-start', 'data-field': `end-${n.id}`, onclick: () => store.selectOnly('neuron', n.id) },
        h('span', { class: `swatch${n.kind === 'character' ? ' square' : ''}`, style: `background:${this.app.palette.kinds[n.kind]}` }),
        `${n.label ? `“${n.label}”` : KIND_INFO[n.kind].name} `,
        h('span', { class: 'muted', text: n.id }),
      );
    const inFlight = h('b', { text: '0' });
    this.liveUpdaters.push(() => {
      let count = 0;
      for (const p of this.app.runner.sim.pulses()) if (p.from === fromId && p.to === toId) count++;
      inFlight.textContent = String(count);
    });
    return section(
      'Connection',
      [],
      h('div', { class: 'insp-hero' }, h('span', { class: 'brand-mark', style: 'background:var(--panel-3);color:var(--accent)', html: icons.connect }), h('div', { class: 'insp-hero-text' }, h('h3', { text: `${fromId} → ${toId}` }), h('div', { class: 'sub', text: twoWay ? 'two-way pair' : 'one-way' }))),
      prop('From', end(from)),
      prop('To', end(to)),
      prop('Length', h('span', { class: 'mono', text: `${distance.toFixed(2)} cells` })),
      prop('Delay', h('span', { text: `${delay.toFixed(2)} s` }), 'Pulses travel 4 cells per second: distance is delay.'),
      h('div', { class: 'stats', style: 'margin:4px 0 12px' }, h('div', { class: 'stat' }, inFlight, h('span', { text: 'pulses on this wire' })), h('div', { class: 'stat' }, h('b', { text: KIND_INFO[from.kind].pulseCharge > 0 ? '+1' : '−1' }), h('span', { text: 'charge per pulse' }))),
      prop('Two-way', toggle('two-way', twoWay ? 'Both directions' : 'One direction', twoWay, (on) => store.commit(setTwoWay(store.network, fromId, toId, on), on ? 'Make two-way' : 'Make one-way'))),
      h(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        iconButton('reverse', 'swap', 'Reverse', () => {
          store.commit(reverseConnection(store.network, fromId, toId), 'Reverse connection');
          if (!twoWay) store.selectConnection({ from: toId, to: fromId });
        }),
        h('span', { class: 'grow' }),
        iconButton('delete', 'trash', 'Delete', () => this.app.deleteSelection(), 'btn small danger', 'delete'),
      ),
    );
  }

  private textSection(t: TextSpec): HTMLElement {
    const { store } = this.app;
    const edit = (patch: Parameters<typeof updateText>[2], label: string, key?: string) => store.commit(updateText(store.network, t.id, patch), label, key && `${key}:${t.id}`);
    const area = h('textarea', { class: 'input', id: 'f-text-body', 'data-field': 'text-body', rows: 3, 'aria-label': 'Text', value: t.text, maxlength: 500 });
    area.addEventListener('input', () => edit({ text: area.value }, 'Edit text', 'text'));
    return section(
      'Text note',
      [],
      area,
      h('div', { style: 'height:10px' }),
      prop('Size', stepper({ field: 'size', label: 'Text size in cells', value: t.size ?? 0.6, step: 0.1, min: 0.2, max: 4, format: (v) => v.toFixed(1), onChange: (v) => edit({ size: v }, 'Resize text', 'size') }), undefined, 'f-size'),
      prop(
        'Tone',
        segmented(
          'tone',
          'Tone',
          [
            { value: 'default', label: 'Plain' },
            { value: 'muted', label: 'Muted' },
            { value: 'accent', label: 'Accent' },
            { value: 'warning', label: 'Warn' },
          ],
          t.tone ?? 'default',
          (v) => edit({ tone: v }, 'Change text tone'),
        ),
      ),
      prop(
        'Align',
        segmented(
          'align',
          'Alignment',
          [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ],
          t.align ?? 'left',
          (v) => edit({ align: v }, 'Align text'),
        ),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('span', { class: 'grow' }), iconButton('delete', 'trash', 'Delete', () => this.app.deleteSelection(), 'btn small danger', 'delete')),
    );
  }

  private multiSection(): HTMLElement {
    const app = this.app;
    const { store } = app;
    const neurons = [...store.selection.neurons].map((id) => store.index.byId.get(id)!).filter(Boolean);
    const counts = new Map<NeuronKind, number>();
    for (const n of neurons) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    const thresholds = new Set(neurons.filter((n) => n.kind !== 'timer').map((n) => n.threshold));
    const common = thresholds.size === 1 ? [...thresholds][0]! : null;
    const editAll = (patch: Parameters<typeof updateNeuron>[2], label: string, key?: string) => {
      let net = store.network;
      for (const n of neurons) if (patch.kind || n.kind !== 'timer') net = updateNeuron(net, n.id, patch);
      store.commit(net, label, key);
    };
    const summary = h('div', { class: 'legend-inline', style: 'margin:0 0 12px' });
    for (const [kind, count] of counts) summary.append(h('span', {}, h('i', { style: `background:${app.palette.kinds[kind]}` }), `${count} ${KIND_INFO[kind].name}${count === 1 ? '' : 's'}`));
    if (store.selection.texts.size) summary.append(h('span', { text: `${store.selection.texts.size} text${store.selection.texts.size === 1 ? '' : 's'}` }));

    const body: HTMLElement[] = [h('div', { class: 'insp-hero' }, h('div', { class: 'insp-hero-text' }, h('h3', { text: `${selectionSize(store.selection)} items selected` }), h('div', { class: 'sub plain', text: 'Shift-click or Shift-drag to add more' }))), summary];
    if (neurons.length) {
      body.push(stacked('Kind', this.kindGrid('multi-kind', counts.size === 1 ? [...counts.keys()][0]! : null, (k) => editAll({ kind: k }, `Change ${neurons.length} to ${KIND_INFO[k].name.toLowerCase()}`))));
      if (thresholds.size) {
        body.push(
          prop(
            'Threshold',
            stepper({ field: 'multi-threshold', label: 'Threshold for all', value: common ?? '', step: 1, min: 1, max: 9999, onChange: (v) => editAll({ threshold: Math.round(v) }, 'Change thresholds', 'multi-threshold') }),
            common === null ? 'Mixed values: typing sets them all.' : undefined,
            'f-multi-threshold',
          ),
        );
      }
    }
    body.push(
      h(
        'div',
        { class: 'row wrap', style: 'margin-top:10px' },
        neurons.length ? iconButton('poke', 'poke', 'Poke all', () => app.pokeSelection(), 'btn small outline', 'enter') : null,
        iconButton('duplicate', 'copy', 'Duplicate', () => app.duplicate(), 'btn small outline', 'mod+d'),
        h('span', { class: 'grow' }),
        iconButton('delete', 'trash', 'Delete', () => app.deleteSelection(), 'btn small danger', 'delete'),
      ),
    );
    return section('Selection', [], ...body);
  }

  private exampleSection(): HTMLElement | null {
    const app = this.app;
    const ex = app.currentExample;
    if (!ex || app.settings.dismissedNotes.includes(ex.id)) return null;
    const dismiss = tipped(
      h('button', {
        class: 'btn small',
        type: 'button',
        'data-field': 'dismiss-notes',
        html: icons.close,
        onclick: () => {
          app.dismissNotes(ex.id);
          this.render();
        },
      }),
      'Hide these notes',
    );
    const card = h('div', { class: 'example-card' });
    card.append(
      h('div', { class: 'ex-meta' }, h('span', { class: 'badge', text: ex.category }), ex.demo?.length ? h('span', { class: 'badge accent', text: 'Demo' }) : null),
      h('h3', { text: ex.title }),
      h(
        'div',
        { class: 'row wrap ex-actions' },
        ex.demo?.length ? iconButton('replay', 'replay', 'Replay demo', () => app.replayDemo(), 'btn small primary') : null,
        iconButton('browse', 'examples', 'Examples', () => app.openGallery(), 'btn small outline', 'e'),
        tipped(
          h('button', { class: 'btn small', type: 'button', 'data-field': 'example-link', html: icons.share, 'aria-label': 'Copy a link to this example', onclick: () => void app.copyExampleLink(ex.id) }),
          'Copy a link to this example',
        ),
      ),
    );
    // Long write-ups start folded to their first paragraph so "Try this" stays in view.
    const paragraphs = ex.description.split(/\n\s*\n/).map((p) => p.trim());
    const long = paragraphs.length > 1 && ex.description.length > 420;
    const open = !long || this.expandedNotes.has(ex.id);
    for (const para of open ? paragraphs : paragraphs.slice(0, 1)) card.append(h('p', { text: para }));
    if (long) {
      card.append(
        h('button', {
          class: 'link-btn',
          type: 'button',
          'data-field': 'more-notes',
          'aria-expanded': String(open),
          text: open ? 'Show less' : `Read more (${paragraphs.length - 1} more paragraph${paragraphs.length > 2 ? 's' : ''})`,
          onclick: () => {
            if (open) this.expandedNotes.delete(ex.id);
            else this.expandedNotes.add(ex.id);
            this.render();
          },
        }),
      );
    }
    if (ex.tryThis?.length) {
      card.append(h('div', { class: 'try' }, h('h4', { text: 'Try this' }), h('ul', {}, ...ex.tryThis.map((t) => h('li', { text: t })))));
    }
    return section('Example', [dismiss], card);
  }

  private networkSection(): HTMLElement {
    const app = this.app;
    const net = app.store.network;
    const counts = new Map<NeuronKind, number>();
    for (const n of net.neurons) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    const pulses = h('b', { text: '0' });
    const fires = h('b', { text: '0' });
    this.liveUpdaters.push(() => {
      const sim = app.runner.sim;
      pulses.textContent = sim.pulses().length.toLocaleString('en-US');
      let total = 0;
      for (const n of net.neurons) total += sim.state(n.id)?.fireCount ?? 0;
      fires.textContent = total.toLocaleString('en-US');
    });
    const bars = h('div', { class: 'kind-bars', 'aria-hidden': 'true' });
    const legend = h('div', { class: 'legend-inline' });
    for (const kind of NEURON_KINDS) {
      const c = counts.get(kind);
      if (!c) continue;
      bars.append(h('span', { style: `width:${(100 * c) / net.neurons.length}%;background:${app.palette.kinds[kind]}` }));
      legend.append(h('span', {}, h('i', { style: `background:${app.palette.kinds[kind]}` }), `${c} ${KIND_INFO[kind].name}`));
    }
    const ex = app.currentExample;
    const restore =
      ex && app.settings.dismissedNotes.includes(ex.id)
        ? h('button', { class: 'btn small', type: 'button', 'data-field': 'show-notes', html: icons.info, 'aria-label': 'Show example notes', onclick: () => this.showExample(true) })
        : null;
    if (restore) tipped(restore, 'Show example notes');
    return section(
      'Network',
      restore ? [restore] : [],
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: net.neurons.length.toLocaleString('en-US') }), h('span', { text: 'neurons' })),
        h('div', { class: 'stat' }, h('b', { text: net.connections.length.toLocaleString('en-US') }), h('span', { text: 'connections' })),
        h('div', { class: 'stat' }, pulses, h('span', { text: 'pulses in flight' })),
        h('div', { class: 'stat' }, fires, h('span', { text: 'fires since reset' })),
      ),
      net.neurons.length ? bars : null,
      net.neurons.length ? legend : null,
    );
  }

  private tipsSection(): HTMLElement {
    const tip = (keys: string[], text: string) => h('li', {}, h('span', {}, ...keys.map((k) => h('kbd', { text: k }))), h('span', { text }));
    const mod = this.app.isMac ? '⌘' : 'Ctrl';
    return section(
      'Quick tips',
      [],
      h(
        'ul',
        { class: 'tips' },
        tip(['Click'], 'a neuron while running to poke it (+1 charge)'),
        tip(['1', '–', '6'], 'pick a neuron kind, then click the grid'),
        tip(['Drag'], 'from a neuron’s handle to connect it'),
        tip(['Space'], 'play or pause · drag empty space to pan'),
        tip([mod, 'K'], 'search every command'),
      ),
    );
  }
}

// Bottom-left islands: zoom (out, level, in, fit) and undo / redo. Also
// exports the undo / redo pair, which the phone dock reuses.

import type { App } from '../app';
import { DEFAULT_SCALE } from '../camera';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { tipped } from './tooltip';

/** Undo and redo buttons that keep their enabled state and labels current. */
export function historyButtons(app: App): HTMLButtonElement[] {
  const make = (icon: IconName, title: string, command: string, run: () => void) =>
    tipped(h('button', { class: 'btn icon-btn', type: 'button', html: icons[icon], onclick: run }), title, app.keysFor(command));
  const undo = make('undo', 'Undo', 'undo', () => app.undo());
  const redo = make('redo', 'Redo', 'redo', () => app.redo());
  const refresh = () => {
    const { history } = app.store;
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
    undo.dataset.tip = history.undoLabel ? `Undo ${history.undoLabel.toLowerCase()}` : 'Undo';
    redo.dataset.tip = history.redoLabel ? `Redo ${history.redoLabel.toLowerCase()}` : 'Redo';
  };
  app.store.on('history', refresh);
  refresh();
  return [undo, redo];
}

export class ViewControls {
  readonly el: HTMLElement;
  private zoomVal: HTMLButtonElement;
  private shown = -1;

  constructor(private readonly app: App) {
    const btn = (icon: IconName, title: string, command: string, run: () => void, cls = '') =>
      tipped(h('button', { class: `btn icon-btn ${cls}`, type: 'button', html: icons[icon], onclick: run }), title, app.keysFor(command));
    this.zoomVal = tipped(h('button', { class: 'zoom-val wide-only', type: 'button', onclick: () => app.zoomTo(DEFAULT_SCALE) }), 'Zoom to 100%', app.keysFor('zoom-reset'));
    this.el = h(
      'div',
      { class: 'view-controls', 'data-tip-side': 'top' },
      h(
        'div',
        { class: 'island zoom-island', role: 'group', 'aria-label': 'Zoom' },
        btn('zoomOut', 'Zoom out', 'zoom-out', () => app.zoomBy(0.8), 'wide-only'),
        this.zoomVal,
        btn('zoomIn', 'Zoom in', 'zoom-in', () => app.zoomBy(1.25), 'wide-only'),
        btn('fit', 'Zoom to fit', 'fit', () => app.zoomToFit()),
      ),
      h('div', { class: 'island history-island', role: 'group', 'aria-label': 'History' }, ...historyButtons(app)),
    );
  }

  /** Refresh the zoom readout (cheap: only touches the DOM when it changes). */
  update(): void {
    const pct = Math.round((this.app.camera.scale / DEFAULT_SCALE) * 100);
    if (pct === this.shown) return;
    this.shown = pct;
    this.zoomVal.textContent = `${pct}%`;
  }
}

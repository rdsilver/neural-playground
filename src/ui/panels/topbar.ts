// Slim top bar: brand, document title, examples, command search, history,
// file actions and app settings. On phones the secondary actions move into
// an overflow menu.

import type { App } from '../app';
import { h, isMac } from '../dom';
import { icons, type IconName } from '../icons';
import { formatKeys } from '../shortcuts';
import { Menu } from './menu';
import { tipped } from './tooltip';

export class TopBar {
  readonly el: HTMLElement;
  private title = h('span', { class: 'doc-title' });
  private chip = h('span', { class: 'doc-chip' });
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private themeBtn: HTMLButtonElement;
  private volume = h('input', { type: 'range', class: 'volume tb-desktop', min: 0, max: 1, step: 0.01, 'aria-label': 'Volume' });
  private examplesBtn: HTMLButtonElement;
  private menu = new Menu('More actions');

  constructor(private readonly app: App) {
    const btn = (icon: IconName, title: string, command: string | null, run: () => void, extra = '') =>
      tipped(h('button', { class: `btn ${extra}`, type: 'button', html: icons[icon], onclick: run }), title, command ? app.keysFor(command) : undefined);

    this.examplesBtn = tipped(
      h('button', { class: 'btn examples-btn', type: 'button', onclick: () => app.openGallery() }),
      'Examples',
      app.keysFor('examples'),
      'Browse ready-made networks, from counters to music.',
    );
    this.examplesBtn.innerHTML = `${icons.examples}<span class="btn-label">Examples</span>`;

    const cmdk = h('button', { class: 'cmdk', type: 'button', 'aria-label': 'Search commands', onclick: () => app.openPalette() });
    cmdk.innerHTML = icons.search;
    cmdk.append(h('span', { text: 'Search commands…' }));
    for (const k of formatKeys('mod+k', isMac)) cmdk.append(h('kbd', { text: k }));

    this.undoBtn = btn('undo', 'Undo', 'undo', () => app.undo());
    this.redoBtn = btn('redo', 'Redo', 'redo', () => app.redo());
    this.soundBtn = btn('soundOn', 'Sound', 'mute', () => app.toggleMute(), 'tb-desktop quiet');
    this.themeBtn = btn('moon', 'Theme', null, () => app.toggleTheme(), 'tb-desktop');
    this.volume.addEventListener('input', () => app.setVolume(Number(this.volume.value)));

    const share = tipped(
      h('button', { class: 'btn', type: 'button', onclick: () => void app.shareLink() }),
      'Copy share link',
      undefined,
      'A link that opens exactly this network.',
    );
    share.innerHTML = `${icons.share}<span class="btn-label">Share</span>`;

    const doc = h('button', { class: 'doc btn', type: 'button', onclick: () => app.inspector.showExample(true) }, this.title, this.chip);
    tipped(doc, 'Document', undefined, 'Show notes for this network');

    const more: HTMLButtonElement = tipped(
      // detail === 0: activated from the keyboard, so focus the first item.
      h('button', { class: 'btn more-btn', type: 'button', html: icons.more, onclick: (e: MouseEvent) => this.toggleMenu(more, e.detail === 0) }),
      'More',
    );
    more.setAttribute('aria-haspopup', 'menu');

    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: icons.logo }), h('span', { class: 'brand-name', text: 'Neural Playground' })),
      h('span', { class: 'tb-sep' }),
      doc,
      this.examplesBtn,
      h('span', { class: 'tb-spacer' }),
      cmdk,
      h('span', { class: 'tb-spacer' }),
      h('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      h('span', { class: 'tb-sep' }),
      h(
        'div',
        { class: 'tb-group tb-desktop' },
        share,
        btn('import', 'Import JSON', 'import', () => app.openImport()),
        btn('export', 'Export JSON', 'export', () => app.exportJson()),
      ),
      h('span', { class: 'tb-sep' }),
      h('div', { class: 'tb-group tb-desktop' }, this.soundBtn, this.volume, this.themeBtn, btn('help', 'Help and shortcuts', 'help', () => app.openHelp())),
      more,
      this.menu.el,
    );

    app.store.on('history', () => this.refreshHistory());
    app.store.on('network', () => this.refreshDoc());
    this.refresh();
  }

  /** Re-read everything (theme, sound, history, document). */
  refresh(): void {
    const { synth, settings } = this.app;
    this.soundBtn.innerHTML = synth.muted ? icons.soundOff : icons.soundOn;
    this.soundBtn.setAttribute('aria-pressed', String(!synth.muted));
    this.soundBtn.dataset.tip = synth.muted ? 'Sound is off' : 'Sound is on';
    this.soundBtn.setAttribute('aria-label', synth.muted ? 'Turn sound on' : 'Turn sound off');
    this.volume.value = String(synth.muted ? 0 : synth.volume);
    const dark = settings.theme === 'dark';
    this.themeBtn.innerHTML = dark ? icons.sun : icons.moon;
    this.themeBtn.dataset.tip = dark ? 'Light theme' : 'Dark theme';
    this.themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    this.refreshHistory();
    this.refreshDoc();
  }

  private refreshHistory(): void {
    const { history } = this.app.store;
    this.undoBtn.disabled = !history.canUndo;
    this.redoBtn.disabled = !history.canRedo;
    this.undoBtn.dataset.tip = history.undoLabel ? `Undo ${history.undoLabel.toLowerCase()}` : 'Undo';
    this.redoBtn.dataset.tip = history.redoLabel ? `Redo ${history.redoLabel.toLowerCase()}` : 'Redo';
  }

  private refreshDoc(): void {
    const { doc } = this.app.store;
    this.title.textContent = doc.title;
    const example = this.app.currentExample;
    this.chip.textContent = example?.category ?? '';
    this.chip.hidden = !example;
    document.title = `${doc.title} · Neural Playground`;
  }

  /** Draw attention to the examples button (first visit). */
  flagExamples(on = true): void {
    this.examplesBtn.classList.toggle('attention', on);
  }

  private toggleMenu(anchor: HTMLElement, keyboard: boolean): void {
    if (this.menu.open) {
      this.menu.close();
      return;
    }
    const app = this.app;
    const r = anchor.getBoundingClientRect();
    this.menu.show(
      r.right,
      r.bottom + 6,
      [
        { icon: 'share', label: 'Copy share link', run: () => void app.shareLink() },
        { icon: 'import', label: 'Import JSON…', keys: app.keysFor('import'), run: () => app.openImport() },
        { icon: 'export', label: 'Export JSON', keys: app.keysFor('export'), run: () => app.exportJson() },
        'separator',
        { icon: app.synth.muted ? 'soundOn' : 'soundOff', label: app.synth.muted ? 'Turn sound on' : 'Turn sound off', run: () => app.toggleMute() },
        { icon: app.settings.theme === 'dark' ? 'sun' : 'moon', label: app.settings.theme === 'dark' ? 'Light theme' : 'Dark theme', run: () => app.toggleTheme() },
        'separator',
        { icon: 'search', label: 'Commands…', run: () => app.openPalette() },
        { icon: 'help', label: 'Help and shortcuts', run: () => app.openHelp() },
        'separator',
        { icon: 'trash', label: 'Clear canvas', danger: true, run: () => app.clearCanvas() },
      ],
      { opener: anchor, alignRight: true, keyboard },
    );
  }
}

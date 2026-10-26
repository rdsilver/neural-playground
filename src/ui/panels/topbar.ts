// The two floating islands along the top. Left: brand, the document title
// and its category (the title also folds the example card in and out).
// Right: examples, command search, help, sound (with a volume popover),
// an overflow menu for file and app actions, and Share.

import type { App } from '../app';
import { h } from '../dom';
import { icons, type IconName } from '../icons';
import { Menu, type MenuEntry } from './menu';
import { attachPopover } from './popover';
import { tipped } from './tooltip';

export class TopBar {
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  /**
   * Floating layers (menu, volume popover) to mount at the root: inside an
   * island they would be positioned against its backdrop filter.
   */
  readonly layers: HTMLElement[];
  private title = h('span', { class: 'doc-title' });
  private chip = h('span', { class: 'doc-chip' });
  private docBtn: HTMLButtonElement;
  private docIcon = h('span', { class: 'doc-icon', 'aria-hidden': 'true' });
  private soundBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private volume = h('input', { type: 'range', class: 'volume', min: 0, max: 1, step: 0.01, 'aria-label': 'Volume' });
  private volumeVal = h('span', { class: 'volume-val' });
  private examplesBtn: HTMLButtonElement;
  private menu = new Menu('More actions');

  constructor(private readonly app: App) {
    const btn = (icon: IconName, title: string, command: string | null, run: () => void, extra = '') =>
      tipped(h('button', { class: `btn icon-btn ${extra}`, type: 'button', html: icons[icon], onclick: run }), title, command ? app.keysFor(command) : undefined);

    // Left island.
    this.docBtn = h('button', { class: 'doc-btn', type: 'button', onclick: (e: MouseEvent) => app.card.toggle(e.detail === 0) }, this.title, this.chip, this.docIcon);
    tipped(this.docBtn, 'About this network', undefined, 'Show or hide the notes card');
    this.left = h(
      'div',
      { class: 'island title-island' },
      h('span', { class: 'brand-mark', html: icons.logo, 'aria-hidden': 'true' }),
      h('span', { class: 'brand-name', text: 'Neural Playground' }),
      h('span', { class: 'island-sep brand-sep', 'aria-hidden': 'true' }),
      this.docBtn,
    );

    // Right island.
    this.examplesBtn = tipped(
      h('button', { class: 'btn pill-btn examples-btn', type: 'button', onclick: () => app.openGallery() }),
      'Examples',
      app.keysFor('examples'),
      'Browse ready-made networks, from counters to music.',
    );
    this.examplesBtn.innerHTML = `${icons.examples}<span class="btn-label">Examples</span>`;

    const share = tipped(
      h('button', { class: 'btn pill-btn primary share-btn', type: 'button', onclick: () => void app.shareLink() }),
      'Copy share link',
      undefined,
      'A link that opens exactly this network.',
    );
    share.innerHTML = `${icons.share}<span class="btn-label">Share</span>`;

    // Sound: the button opens a small popover with mute and volume.
    this.soundBtn = btn('soundOn', 'Sound', 'mute', () => undefined, 'wide-only');
    this.muteBtn = h('button', { class: 'btn icon-btn', type: 'button', onclick: () => app.toggleMute() });
    this.volume.addEventListener('input', () => app.setVolume(Number(this.volume.value)));
    const volumePop = h('div', { class: 'popover volume-pop', role: 'group', 'aria-label': 'Sound' }, this.muteBtn, this.volume, this.volumeVal);
    attachPopover(this.soundBtn, volumePop, 'below-end');

    const more: HTMLButtonElement = tipped(
      // detail === 0: activated from the keyboard, so focus the first item.
      h('button', { class: 'btn icon-btn more-btn', type: 'button', html: icons.more, onclick: (e: MouseEvent) => this.toggleMenu(more, e.detail === 0) }),
      'More',
    );
    more.setAttribute('aria-haspopup', 'menu');

    this.right = h(
      'div',
      { class: 'island actions-island', role: 'toolbar', 'aria-label': 'App actions' },
      this.examplesBtn,
      btn('search', 'Search commands', 'palette', () => app.openPalette(), 'wide-only'),
      btn('help', 'Help and shortcuts', 'help', () => app.openHelp(), 'wide-only'),
      this.soundBtn,
      more,
      share,
    );
    this.layers = [volumePop, this.menu.el];

    app.store.on('network', () => this.refreshDoc());
    this.refresh();
  }

  /** Re-read everything (sound, document, card state). */
  refresh(): void {
    const { synth } = this.app;
    const muted = synth.muted || synth.volume === 0;
    this.soundBtn.innerHTML = muted ? icons.soundOff : icons.soundOn;
    this.soundBtn.dataset.tip = muted ? 'Sound is off' : 'Sound';
    this.soundBtn.setAttribute('aria-label', muted ? 'Sound is off: volume' : 'Sound and volume');
    this.muteBtn.innerHTML = synth.muted ? icons.soundOff : icons.soundOn;
    this.muteBtn.setAttribute('aria-label', synth.muted ? 'Turn sound on' : 'Mute');
    this.muteBtn.setAttribute('aria-pressed', String(synth.muted));
    this.volume.value = String(synth.muted ? 0 : synth.volume);
    this.volumeVal.textContent = `${Math.round((synth.muted ? 0 : synth.volume) * 100)}%`;
    this.refreshDoc();
  }

  refreshDoc(): void {
    const { doc } = this.app.store;
    this.title.textContent = doc.title;
    const example = this.app.currentExample;
    this.chip.textContent = example?.category ?? '';
    this.chip.hidden = !example;
    document.title = `${doc.title} · Neural Playground`;
    const open = this.app.card.isOpen;
    this.docBtn.setAttribute('aria-expanded', String(open));
    this.docBtn.disabled = !this.app.card.available;
    this.docIcon.innerHTML = open ? icons.chevronUp : icons.chevronDown;
  }

  /** Mark the examples button for first-time visitors (a static dot: no idle animation). */
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
    const example = app.currentExample;
    const dark = app.settings.theme === 'dark';
    const entries: MenuEntry[] = [
      { icon: 'search', label: 'Search commands…', keys: app.keysFor('palette'), run: () => app.openPalette() },
      'separator',
      { icon: 'import', label: 'Import JSON…', keys: app.keysFor('import'), run: () => app.openImport() },
      { icon: 'export', label: 'Export JSON', keys: app.keysFor('export'), run: () => app.exportJson() },
    ];
    if (example) entries.push({ icon: 'share', label: 'Copy link to this example', run: () => void app.copyExampleLink(example.id) });
    entries.push(
      'separator',
      { icon: app.synth.muted ? 'soundOn' : 'soundOff', label: app.synth.muted ? 'Turn sound on' : 'Turn sound off', keys: app.keysFor('mute'), run: () => app.toggleMute() },
      { icon: dark ? 'sun' : 'moon', label: dark ? 'Light theme' : 'Dark theme', run: () => app.toggleTheme() },
      { icon: 'help', label: 'Help and shortcuts', keys: app.keysFor('help'), run: () => app.openHelp() },
      'separator',
      { icon: 'trash', label: 'Clear canvas', danger: true, run: () => app.clearCanvas() },
    );
    this.menu.show(r.right, r.bottom + 8, entries, { opener: anchor, alignRight: true, keyboard });
  }
}

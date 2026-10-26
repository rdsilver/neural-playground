// Composition root: builds the layout (a full-bleed board with floating
// islands of chrome over it), owns the frame loop and implements every
// user-facing action (the panels and keyboard call these).

import {
  decodeShareCode,
  emptyNetwork,
  encodeShareCode,
  KIND_INFO,
  networkBounds,
  networkFromJson,
  networkToJson,
  TICKS_PER_SECOND,
  type FireEvent,
  type Network,
} from '../engine';
import { EXAMPLES, findExample, type Example } from '../examples';
import { Synth } from './audio';
import { bestFit, Camera, DEFAULT_SCALE } from './camera';
import type { Command } from './commands';
import { h, isMac, isTyping, prefersReducedMotion } from './dom';
import { icons } from './icons';
import { BoardInput, type BoardHost, type Hit } from './input';
import {
  addNeuron,
  addText,
  connect,
  copyItems,
  deleteItems,
  disconnect,
  hasConnection,
  moveItems,
  pasteClip,
  updateNeuron,
  type Clip,
  type NeuronPatch,
} from './netops';
import { appCommands } from './app-commands';
import { insetOptions, type Chrome } from './layout';
import { ExampleCard } from './panels/card';
import { Gallery } from './panels/gallery';
import { HelpDialog } from './panels/help';
import { HoverCard } from './panels/hovercard';
import { Hud } from './panels/hud';
import { boardMenuEntries } from './panels/boardmenu';
import { Menu } from './panels/menu';
import { Inspector } from './panels/inspector';
import { CommandPalette } from './panels/palette';
import { ShareDialog } from './panels/share';
import { Toasts } from './panels/toast';
import { installTooltips } from './panels/tooltip';
import { ToolRail } from './panels/toolrail';
import { TopBar } from './panels/topbar';
import { Transport } from './panels/transport';
import { ViewControls } from './panels/viewcontrols';
import { exampleUrl, parseHash, readAutosave, readSettings, setTried, shareUrl, slugify, writeAutosave, writeSettings, type DocInfo, type Settings } from './persistence';
import { Renderer, type Scene } from './renderer';
import { clampSpeed, MAX_PULSES, nudgeSpeed, Runner } from './runner';
import { matches, parseKeys } from './shortcuts';
import { selectionSize, Store, type Tool } from './store';
import { applyTheme, readPalette, type Palette } from './theme';

const AUTOSAVE_DELAY = 400;
/** The demo's ghost finger appears this long (real time) before it presses. */
const TAP_LEAD_SECONDS = 0.35;

export class App implements BoardHost {
  readonly store: Store;
  readonly runner: Runner;
  readonly camera = new Camera();
  readonly synth: Synth;
  readonly toasts = new Toasts();
  settings: Settings;
  palette!: Palette;
  commands: Command[] = [];

  readonly root: HTMLElement;
  readonly shell = h('div', { class: 'app' });
  readonly stage = h('main', { class: 'stage', 'aria-label': 'Board' });
  readonly canvas = h('canvas', {
    class: 'board',
    tabindex: 0,
    role: 'application',
    'aria-roledescription': 'neural network board',
    'aria-label': 'Neural network board. Use the tool rail or number keys to choose a neuron kind, click to place, Space to play or pause.',
  });
  private renderer: Renderer;
  readonly input: BoardInput;
  private topbar!: TopBar;
  private rail!: ToolRail;
  inspector!: Inspector;
  card!: ExampleCard;
  private hud!: Hud;
  private transport!: Transport;
  private viewControls!: ViewControls;
  private gallery!: Gallery;
  private help!: HelpDialog;
  private cmdPalette!: CommandPalette;
  private share!: ShareDialog;
  private hoverCard!: HoverCard;
  private boardMenu = new Menu('Board actions');
  private stageHint = h('div', { class: 'stage-hint', hidden: true });
  private dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', { text: 'Drop a .json network to open it' }));
  private fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });

  private dirty = true;
  private lastFrame = 0;
  private lastLive = 0;
  private autosaveTimer = 0;
  private clip: Clip | null = null;
  private overloadShown = false;
  private wasAnimating = false;

  private constructor(root: HTMLElement, network: Network, doc: DocInfo, settings: Settings) {
    this.root = root;
    this.settings = settings;
    this.store = new Store(network, doc);
    this.runner = new Runner(network);
    this.synth = new Synth(settings.muted, settings.volume);
    this.renderer = new Renderer(this.canvas);
    this.input = new BoardInput(this.canvas, this.camera, this.store, this.renderer, this);
  }

  /** Decide what to open (share link, example link, autosave or the first example) and start. */
  static async create(root: HTMLElement): Promise<App> {
    const settings = readSettings();
    applyTheme(settings.theme);
    const request = parseHash(location.hash);
    let error: string | null = null;
    let initial: { network: Network; doc: DocInfo; example?: Example } | null = null;

    if (request?.type === 'net') {
      try {
        initial = { network: await decodeShareCode(request.code), doc: { title: 'Shared network' } };
      } catch (e) {
        error = e instanceof Error ? e.message : 'That share link could not be opened.';
      }
    } else if (request?.type === 'example') {
      const example = findExample(request.id);
      if (example) initial = { network: example.network, doc: { title: example.title, exampleId: example.id }, example };
      else error = `There is no example called “${request.id}”.`;
    }
    if (request) clearHash();
    initial ??= readAutosave();
    if (!initial) {
      const example = EXAMPLES[0]!;
      initial = { network: example.network, doc: { title: example.title, exampleId: example.id }, example };
    }

    const app = new App(root, initial.network, initial.doc, settings);
    app.build();
    if (initial.example) app.startExample(initial.example, false);
    else app.zoomToFit(false);
    // A link's network is saved right away, so a reload comes back to it.
    if (request && !error) app.scheduleAutosave();
    if (request?.type === 'net' && !error) app.toasts.show('Opened a shared network');
    if (error) app.toasts.show(error, { error: true });
    // Point newcomers at the gallery until they have opened it once.
    if (!settings.seenGallery) app.topbar.flagExamples();
    app.start();
    return app;
  }

  // ---------------------------------------------------------------- layout

  private build(): void {
    this.palette = readPalette();
    this.renderer.setPalette(this.palette);
    this.commands = appCommands(this);

    this.hoverCard = new HoverCard(this);
    this.stage.append(this.canvas, this.stageHint, this.hoverCard.el);

    // The card first: the title island reads its state.
    this.card = new ExampleCard(this);
    this.topbar = new TopBar(this);
    this.rail = new ToolRail(this);
    this.inspector = new Inspector(this);
    this.hud = new Hud(this);
    this.transport = new Transport(this);
    this.viewControls = new ViewControls(this);
    this.gallery = new Gallery(this);
    this.help = new HelpDialog(this);
    this.cmdPalette = new CommandPalette(this);
    this.share = new ShareDialog();

    // On phones the rail and the transport stack into one bottom dock; on
    // wider screens the dock wrapper is display: contents and each floats.
    const dock = h('div', { class: 'dock' }, this.rail.el, this.transport.el);
    this.shell.append(
      this.stage,
      h('header', { class: 'topbar' }, this.topbar.left, this.topbar.right),
      this.card.el,
      this.inspector.el,
      this.viewControls.el,
      this.hud.el,
      dock,
    );
    this.root.replaceChildren(
      this.shell,
      this.toasts.el,
      this.dropOverlay,
      this.fileInput,
      this.boardMenu.el,
      this.rail.sheet,
      ...this.topbar.layers,
      this.gallery.el,
      this.help.el,
      this.cmdPalette.el,
      this.share.el,
    );
    installTooltips(this.root);
    this.buildStageHint();

    this.store.on('network', ({ docChanged }) => {
      this.runner.load(this.store.network);
      if (docChanged) {
        this.runner.sim.reset();
        this.runner.stopDemo();
        this.renderer.clearEffects();
      }
      this.scheduleAutosave();
      this.updateStageHint();
      this.invalidate();
    });
    this.store.on('selection', () => this.invalidate());
    this.store.on('tool', () => {
      if (this.store.tool !== 'connect') this.input.pendingSource = null;
      this.updateStageHint();
      this.invalidate();
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.importFile(file);
      this.fileInput.value = '';
    });
    this.installKeyboard();
    this.installDragAndDrop();
    this.installAudioUnlock();
    window.addEventListener('hashchange', () => void this.openHash());
    new ResizeObserver(() => this.resize()).observe(this.stage);
    matchMedia('(resolution: 1dppx), (resolution: 2dppx), (resolution: 3dppx)').addEventListener?.('change', () => this.resize());
    this.resize();
    this.card.reset();
    this.updateStageHint();
  }

  private start(): void {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame((now) => {
      this.lastFrame = now;
      loop(now);
    });
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const before = this.renderer.size;
    this.renderer.resize(r.width, r.height, dpr);
    // Keep the centre of the view fixed when the stage changes size.
    if (before.width && before.height) {
      this.camera.panBy((r.width - before.width) / 2, (r.height - before.height) / 2);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------ frame loop

  private frame(now: number): void {
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const events = this.runner.advance(dt);
    if (events.length) this.onFires(events, now);
    if (this.runner.overloaded !== this.overloadShown) {
      this.overloadShown = this.runner.overloaded;
      if (this.overloadShown)
        this.toasts.show(`Paused: over ${MAX_PULSES.toLocaleString('en-US')} pulses in flight. This network multiplies pulses without limit.`, {
        error: true,
        duration: 12000,
        action: { label: 'Reset', run: () => this.reset() },
      });
    }
    this.drainTaps(now);
    const cameraMoved = this.camera.tick(now);
    const animating = this.renderer.animating(now);
    // One extra frame after effects finish, so their last trace is cleared.
    if (this.runner.playing || this.dirty || cameraMoved || animating || this.wasAnimating) {
      this.renderer.draw(this.scene(), now);
      this.dirty = false;
    }
    this.wasAnimating = animating;
    this.hud.update(now);
    this.hoverCard.update(now);
    if (now - this.lastLive > 90) {
      this.lastLive = now;
      this.transport.update();
      this.viewControls.update();
      this.inspector.live();
      this.card.live();
      this.hud.updateHint(now);
    }
  }

  /** Show a ghost-finger tap on each neuron the demo just pressed. */
  private drainTaps(now: number): void {
    const taps = this.runner.taps;
    if (!taps.length) return;
    for (const id of taps) this.renderer.demoTap(id, now);
    taps.length = 0;
  }

  private onFires(events: readonly FireEvent[], now: number): void {
    this.renderer.noteFires(events, now);
    const notes: number[] = [];
    for (const e of events) if (e.note !== undefined) notes.push(e.note);
    this.synth.playMany(notes);
  }

  private scene(): Scene {
    const s = this.store;
    return {
      network: s.network,
      index: s.index,
      selection: s.selection,
      tool: s.tool,
      kind: s.kind,
      hover: this.input.hover,
      preview: this.input.preview,
      pendingSource: this.input.pendingSource,
      pointer: this.input.pointer,
      sim: this.runner.sim,
      tick: this.runner.renderTick,
      camera: this.camera,
      handleFor: this.input.handleFor,
      upcomingTaps: this.runner.playing ? this.runner.upcomingTaps(this.tapLead) : [],
      tapLead: this.tapLead,
    };
  }

  /** How many ticks ahead the ghost finger shows a coming demo press. */
  private get tapLead(): number {
    return Math.max(1, TAP_LEAD_SECONDS * TICKS_PER_SECOND * this.runner.speed);
  }

  /** Request a redraw on the next frame. */
  invalidate(): void {
    this.dirty = true;
  }

  // ------------------------------------------------------------ simulation

  get running(): boolean {
    return this.runner.playing;
  }

  setPlaying(playing: boolean): void {
    this.runner.playing = playing;
    // Let the runaway guard trip (and say so) again if it is still runaway.
    if (playing) this.runner.overloaded = false;
    this.transport.update();
    this.invalidate();
  }

  togglePlay(): void {
    this.setPlaying(!this.runner.playing);
  }

  step(toNextFire = false): void {
    this.setPlaying(false);
    const events = toNextFire ? this.runner.stepToNextFire() : this.runner.step();
    const now = performance.now();
    this.onFires(events, now);
    this.drainTaps(now);
    this.transport.update();
    this.inspector.live();
    this.invalidate();
  }

  reset(): void {
    this.runner.reset();
    this.renderer.clearEffects();
    this.transport.update();
    this.inspector.live();
    this.invalidate();
  }

  setSpeed(speed: number): void {
    this.runner.speed = speed;
    this.transport.update();
  }

  nudgeSpeed(direction: 1 | -1): void {
    this.setSpeed(nudgeSpeed(this.runner.speed, direction));
  }

  /** Reset and run (examples without a demo). */
  restart(): void {
    this.reset();
    this.setPlaying(true);
  }

  /** Stop the demo (captions and scripted presses); the simulation keeps running. */
  stopDemo(): void {
    this.runner.stopDemo();
    this.transport.update();
    this.invalidate();
  }

  /** Restart the current example's demo from a clean state and play it. */
  replayDemo(): void {
    const example = this.currentExample;
    if (!example?.demo) return;
    this.runner.sim.reset();
    this.runner.startDemo(example.demo);
    this.renderer.clearEffects();
    this.setPlaying(true);
  }

  /** The built-in example the current document came from, if any. */
  get currentExample(): Example | undefined {
    return this.store.doc.exampleId ? findExample(this.store.doc.exampleId) : undefined;
  }

  poke(id: string, charge = 1): void {
    const events = this.runner.sim.stimulate(id, charge);
    this.renderer.poke(id, charge, performance.now());
    if (events.length) this.onFires(events, performance.now());
    this.inspector.live();
    this.invalidate();
  }

  pokeSelection(): void {
    for (const id of this.store.selection.neurons) this.poke(id);
  }

  fireSelection(): void {
    const events: FireEvent[] = [];
    for (const id of this.store.selection.neurons) events.push(...this.runner.sim.fire(id));
    this.onFires(events, performance.now());
    this.inspector.live();
    this.invalidate();
  }

  // --------------------------------------------------------------- editing

  place(x: number, y: number): string | null {
    const kind = this.store.kind;
    const r = addNeuron(this.store.network, kind, x, y);
    if (!r) return null;
    this.store.commit(r.net, `Add ${KIND_INFO[kind].name.toLowerCase()}`);
    return r.id;
  }

  connect(from: string, to: string, twoWay: boolean): void {
    const net = this.store.network;
    const forward = hasConnection(net, from, to);
    const back = hasConnection(net, to, from);
    if (twoWay) {
      if (forward && back) this.store.commit(disconnect(disconnect(net, from, to), to, from), 'Remove two-way connection');
      else {
        this.store.commit(connect(net, from, to, true), 'Connect both ways');
        this.store.selectConnection({ from, to });
      }
    } else if (forward) {
      this.store.commit(disconnect(net, from, to), 'Remove connection');
    } else {
      this.store.commit(connect(net, from, to), 'Connect');
      this.store.selectConnection({ from, to });
    }
  }

  connectToNew(from: string, x: number, y: number, twoWay: boolean): void {
    const r = addNeuron(this.store.network, this.store.kind, x, y);
    if (!r) return;
    this.store.commit(connect(r.net, from, r.id, twoWay), 'Add connected neuron');
    this.store.selectOnly('neuron', r.id);
  }

  moveSelection(dx: number, dy: number, coalesce?: string): boolean {
    const sel = this.store.selection;
    const net = moveItems(this.store.network, sel.neurons, sel.texts, dx, dy);
    if (!net) return false;
    this.store.commit(net, selectionSize(sel) > 1 ? `Move ${selectionSize(sel)} items` : 'Move', coalesce);
    return true;
  }

  updateNeuron(id: string, patch: NeuronPatch, label: string, coalesce?: string): void {
    this.store.commit(updateNeuron(this.store.network, id, patch), label, coalesce);
  }

  addText(x: number, y: number): void {
    const r = addText(this.store.network, x, y, 'Text');
    this.store.commit(r.net, 'Add text');
    this.store.setTool('select');
    this.editText(r.id);
  }

  editText(id: string): void {
    this.store.selectOnly('text', id);
    this.inspector.focusTextEditor();
  }

  deleteSelection(): void {
    const sel = this.store.selection;
    const count = selectionSize(sel);
    if (!count) return;
    const net = deleteItems(this.store.network, { neurons: sel.neurons, texts: sel.texts, connections: sel.connection ? [sel.connection] : [] });
    this.store.commit(net, count > 1 ? `Delete ${count} items` : 'Delete');
    this.store.clearSelection();
  }

  selectAll(): void {
    this.store.select({
      neurons: new Set(this.store.network.neurons.map((n) => n.id)),
      texts: new Set((this.store.network.texts ?? []).map((t) => t.id)),
      connection: null,
    });
  }

  copy(cut = false): void {
    const sel = this.store.selection;
    const clip = copyItems(this.store.network, sel.neurons, sel.texts);
    if (!clip) return;
    this.clip = clip;
    if (cut) this.deleteSelection();
    else this.toasts.show(`Copied ${clip.neurons.length + clip.texts.length} item${clip.neurons.length + clip.texts.length === 1 ? '' : 's'}`);
  }

  /** Paste at the pointer if it is over the board, else next to the original. */
  get hasClip(): boolean {
    return this.clip !== null;
  }

  paste(clip = this.clip, at?: { x: number; y: number }): void {
    if (!clip) return;
    const target = at ?? (this.input.pointer ? { x: Math.floor(this.input.pointer.x), y: Math.floor(this.input.pointer.y) } : this.viewCenterCell());
    const r = pasteClip(this.store.network, clip, target.x, target.y);
    this.store.commit(r.net, 'Paste');
    this.store.select({ neurons: new Set(r.neurons), texts: new Set(r.texts), connection: null });
  }

  /** Copy the selection to just below itself. */
  duplicate(): void {
    const sel = this.store.selection;
    const clip = copyItems(this.store.network, sel.neurons, sel.texts);
    if (!clip) return;
    const ns = this.store.network.neurons.filter((n) => sel.neurons.has(n.id));
    const ts = (this.store.network.texts ?? []).filter((t) => sel.texts.has(t.id));
    const x = Math.min(...ns.map((n) => n.x), ...ts.map((t) => Math.floor(t.x)));
    const bottom = Math.max(...ns.map((n) => n.y), ...ts.map((t) => Math.floor(t.y)));
    this.paste(clip, { x, y: bottom + 1 });
  }

  undo(): void {
    const label = this.store.undo();
    if (label) this.toasts.show(`Undo: ${label}`, { duration: 1400, key: 'history' });
  }

  redo(): void {
    const label = this.store.redo();
    if (label) this.toasts.show(`Redo: ${label}`, { duration: 1400, key: 'history' });
  }

  clearCanvas(): void {
    if (!this.store.network.neurons.length && !this.store.network.texts?.length) return;
    this.store.replace(emptyNetwork(), { title: 'Untitled network' }, 'Clear canvas');
    this.store.setKind(this.store.kind);
    this.zoomToFit();
    this.toasts.show('Canvas cleared', { action: { label: 'Undo', run: () => this.undo() } });
  }

  setTool(tool: Tool): void {
    this.store.setTool(tool);
  }

  /** Switch to the Connect tool with `id` already picked as the source. */
  connectFrom(id: string): void {
    this.store.setTool('connect');
    this.input.pendingSource = id;
    this.invalidate();
  }

  /** Right-click menu for whatever is under the pointer (or the selection). */
  contextMenu(clientX: number, clientY: number, hit: Hit, keyboard = false): void {
    this.boardMenu.show(clientX, clientY, boardMenuEntries(this, hit), { opener: this.canvas, keyboard });
    // Right-clicking a neuron, wire or note also inspects it.
    if (hit.type !== 'empty' && hit.type !== 'cell') this.inspector.setOpen(true);
  }

  /** Long-press on touch: select the item and open the inspector on it. */
  inspect(hit: Hit): void {
    const s = this.store;
    if (hit.type === 'neuron' || hit.type === 'handle') s.selectOnly('neuron', hit.id);
    else if (hit.type === 'text') s.selectOnly('text', hit.id);
    else if (hit.type === 'connection') s.selectConnection({ from: hit.from, to: hit.to });
    else return;
    this.inspector.setOpen(true);
  }

  /** Context-menu key / Shift+F10: open the menu for the selection (or the view centre). */
  private keyboardContextMenu(): void {
    const r = this.canvas.getBoundingClientRect();
    const n = this.store.selectedNeuron;
    if (n) {
      const p = this.camera.toScreen(n.x + 0.5, n.y + 0.5);
      this.contextMenu(r.left + p.x, r.top + p.y, { type: 'neuron', id: n.id }, true);
      return;
    }
    const c = this.viewCenterCell();
    const p = this.camera.toScreen(c.x + 0.5, c.y + 0.5);
    this.contextMenu(r.left + p.x, r.top + p.y, { type: 'empty', ...c }, true);
  }

  // -------------------------------------------------------------- examples

  /** Load an example as an undoable document swap. */
  loadExample(example: Example): void {
    // Opening an example shows its notes again, even if they were folded.
    this.restoreNotes(example.id);
    this.store.replace(example.network, { title: example.title, exampleId: example.id }, `Open “${example.title}”`);
    this.startExample(example, true);
  }

  /** Apply an example's speed, autoplay and demo to the freshly loaded network. */
  private startExample(example: Example, animate: boolean): void {
    this.store.setTool('select');
    this.runner.sim.reset();
    this.runner.speed = clampSpeed(example.speed);
    if (example.demo?.length) this.runner.startDemo(example.demo);
    else this.runner.stopDemo();
    this.setPlaying(example.autoplay !== false);
    this.zoomToFit(animate);
  }

  dismissNotes(id: string): void {
    if (!this.settings.dismissedNotes.includes(id)) this.settings.dismissedNotes.push(id);
    this.saveSettings();
  }

  restoreNotes(id: string): void {
    if (!this.settings.dismissedNotes.includes(id)) return;
    this.settings.dismissedNotes = this.settings.dismissedNotes.filter((x) => x !== id);
    this.saveSettings();
  }

  /** Tick or untick a "Try this" item (remembered per example). */
  setTried(example: Example, index: number, done: boolean): void {
    this.settings.tried = setTried(this.settings.tried, example.id, index, done);
    this.saveSettings();
    this.card.render();
    const total = example.tryThis?.length ?? 0;
    if (done && total && this.settings.tried[example.id]?.length === total) {
      const next = EXAMPLES[(EXAMPLES.indexOf(example) + 1) % EXAMPLES.length]!;
      this.toasts.show('You tried everything here. Nice!', { duration: 6000, action: { label: `Next: ${next.title}`, run: () => this.loadExample(next) } });
    }
  }

  /** The notes card opened or folded. */
  onCardChange(): void {
    this.shell.classList.toggle('card-open', this.card.isOpen);
    this.topbar?.refreshDoc();
  }

  /** The inspector opened or closed. */
  onInspectorChange(open: boolean): void {
    this.shell.classList.toggle('inspecting', open);
    if (open) this.revealSelection();
  }

  openGallery(): void {
    if (!this.settings.seenGallery) {
      this.settings.seenGallery = true;
      this.saveSettings();
      this.topbar.flagExamples(false);
    }
    this.gallery.open();
  }

  openHelp(): void {
    this.help.open();
  }

  openPalette(): void {
    this.cmdPalette.open();
  }

  // ------------------------------------------------------------------ view

  zoomBy(factor: number): void {
    const { width, height } = this.renderer.size;
    const target = { ...this.camera.view };
    const cx = width / 2;
    const cy = height / 2;
    const wx = cx / target.scale + target.x;
    const wy = cy / target.scale + target.y;
    const scale = Math.min(160, Math.max(5, target.scale * factor));
    this.camera.animateTo({ x: wx - cx / scale, y: wy - cy / scale, scale }, prefersReducedMotion() ? 0 : 160);
    this.invalidate();
  }

  zoomTo(scale: number): void {
    this.zoomBy(scale / this.camera.scale);
  }

  zoomToFit(animate = true): void {
    const { width, height } = this.renderer.size;
    const net = this.store.network;
    let view;
    if (!net.neurons.length && !net.texts?.length) {
      view = { x: -width / 2 / DEFAULT_SCALE, y: -height / 2 / DEFAULT_SCALE, scale: DEFAULT_SCALE };
    } else {
      const b = networkBounds(net);
      const bounds = { minX: b.minX - 0.5, minY: b.minY - 0.5, maxX: b.maxX + 0.5, maxY: b.maxY + 0.5 };
      view = bestFit(bounds, width, height, insetOptions(this.measureChrome()), 64);
    }
    this.camera.animateTo(view, animate && !prefersReducedMotion() ? 320 : 0);
    this.invalidate();
  }

  /**
   * Where the floating chrome sits over the board, measured from the DOM so
   * the fit follows the real layout at every size: under the top islands,
   * right of the rail, above the dock and the demo's captions, and clear of
   * the notes card and an open inspector.
   */
  private measureChrome(): Chrome {
    const stage = this.stage.getBoundingClientRect();
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - stage.left, top: r.top - stage.top, right: r.right - stage.left, bottom: r.bottom - stage.top, width: r.width, height: r.height };
    };
    const { width, height } = stage;
    const top = Math.max(rect(this.topbar.left).bottom, rect(this.topbar.right).bottom);
    // The rail floats on the left on wide screens; on phones it is part of the bottom dock.
    const rail = rect(this.rail.el);
    const railOnLeft = rail.height > rail.width;
    let bottom = rect(this.transport.el).top;
    if (railOnLeft) bottom = Math.min(bottom, rect(this.viewControls.el).top);
    else bottom = Math.min(bottom, rail.top);
    // Room for the demo's captions (two lines) or the one-line hint.
    const phone = width <= 760;
    bottom -= this.runner.demoLive ? (phone ? 84 : 92) : 30;
    const chrome: Chrome = { width, height, top, left: railOnLeft ? rail.right : 0, right: width, bottom };
    if (this.inspector.isOpen && !phone) chrome.right = rect(this.inspector.el).left;
    const card = this.card.rect();
    if (card) chrome.card = { left: card.left - stage.left, top: card.top - stage.top, right: card.right - stage.left, bottom: card.bottom - stage.top };
    return chrome;
  }

  /**
   * After the inspector opens, glide the board so the selected neuron (or
   * wire, or note) is not hidden under it.
   */
  private revealSelection(): void {
    const s = this.store;
    const sel = s.selection;
    let at: { x: number; y: number } | null = null;
    const n = sel.neurons.size ? s.index.byId.get([...sel.neurons][0]!) : undefined;
    if (n) at = { x: n.x + 0.5, y: n.y + 0.5 };
    else if (sel.connection) {
      const a = s.index.byId.get(sel.connection.from);
      const b = s.index.byId.get(sel.connection.to);
      if (a && b) at = { x: (a.x + b.x) / 2 + 0.5, y: (a.y + b.y) / 2 + 0.5 };
    } else if (sel.texts.size) {
      const t = s.index.texts.get([...sel.texts][0]!);
      if (t) at = { x: t.x, y: t.y };
    }
    if (!at) return;
    const stage = this.stage.getBoundingClientRect();
    const panel = this.inspector.el.getBoundingClientRect();
    const p = this.camera.toScreen(at.x, at.y);
    const px = p.x + stage.left;
    const py = p.y + stage.top;
    const margin = this.camera.scale * 0.8 + 28;
    let dx = 0;
    let dy = 0;
    if (panel.width >= stage.width - 40) {
      // Phone sheet along the bottom: keep the item above it.
      if (py > panel.top - margin) dy = py - (panel.top - margin);
    } else if (px > panel.left - margin && py > panel.top - margin && py < panel.bottom + margin) {
      dx = px - (panel.left - margin);
    }
    if (!dx && !dy) return;
    const v = this.camera.view;
    this.camera.animateTo({ x: v.x + dx / v.scale, y: v.y + dy / v.scale, scale: v.scale }, prefersReducedMotion() ? 0 : 260);
    this.invalidate();
  }

  private viewCenterCell(): { x: number; y: number } {
    const { width, height } = this.renderer.size;
    const c = this.camera.toWorld(width / 2, height / 2);
    return { x: Math.floor(c.x), y: Math.floor(c.y) };
  }

  // ----------------------------------------------------------- appearance

  toggleTheme(): void {
    this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(this.settings.theme);
    this.palette = readPalette();
    this.renderer.setPalette(this.palette);
    this.saveSettings();
    this.rail.refresh();
    this.topbar.refresh();
    if (this.inspector.isOpen) this.inspector.render();
    this.card.render();
    this.invalidate();
  }

  toggleMute(): void {
    this.synth.setMuted(!this.synth.muted);
    this.settings.muted = this.synth.muted;
    this.saveSettings();
    this.topbar.refresh();
    this.toasts.show(this.synth.muted ? 'Sound off' : 'Sound on', { duration: 1400 });
  }

  setVolume(volume: number): void {
    this.synth.setVolume(volume);
    if (this.synth.muted && volume > 0) this.synth.setMuted(false);
    this.settings.volume = this.synth.volume;
    this.settings.muted = this.synth.muted;
    this.saveSettings();
    this.topbar.refresh();
  }

  /** Play a note now (inspector preview). */
  previewNote(midi: number): void {
    this.synth.play(midi);
  }

  private saveSettings(): void {
    writeSettings(this.settings);
  }

  // ------------------------------------------------------- files & sharing

  /** Copy a link that opens exactly the current network. */
  async shareLink(): Promise<void> {
    let url: string;
    try {
      url = shareUrl(location.href, await encodeShareCode(this.store.network));
    } catch {
      this.toasts.show('Could not create a share link in this browser.', { error: true });
      return;
    }
    await this.copyLink(url, 'Share link copied to clipboard');
  }

  /** Copy a short link to a built-in example (as shipped, without edits). */
  async copyExampleLink(id: string): Promise<void> {
    await this.copyLink(exampleUrl(location.href, id), 'Link to this example copied');
  }

  private async copyLink(url: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toasts.show(message);
    } catch {
      this.share.open(url);
    }
  }

  exportJson(): void {
    const blob = new Blob([networkToJson(this.store.network)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${slugify(this.store.doc.title)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toasts.show(`Exported ${a.download}`);
  }

  openImport(): void {
    this.fileInput.click();
  }

  async importFile(file: File): Promise<void> {
    try {
      const network = networkFromJson(await file.text());
      const title = file.name.replace(/\.json$/i, '') || 'Imported network';
      this.store.replace(network, { title }, `Import ${file.name}`);
      this.zoomToFit();
      this.toasts.show(`Opened ${file.name} · ${network.neurons.length} neurons`);
    } catch (e) {
      this.toasts.show(e instanceof Error ? `Could not open ${file.name}: ${e.message}` : `Could not open ${file.name}.`, { error: true });
    }
  }

  /** Handle a #net= or #example= hash added while the app is open. */
  private async openHash(): Promise<void> {
    const request = parseHash(location.hash);
    if (!request) return;
    clearHash();
    if (request.type === 'example') {
      const example = findExample(request.id);
      if (example) this.loadExample(example);
      else this.toasts.show(`There is no example called “${request.id}”.`, { error: true });
      return;
    }
    try {
      const network = await decodeShareCode(request.code);
      this.store.replace(network, { title: 'Shared network' }, 'Open shared link');
      this.zoomToFit();
      this.toasts.show('Opened a shared network');
    } catch (e) {
      this.toasts.show(e instanceof Error ? e.message : 'That share link could not be opened.', { error: true });
    }
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => writeAutosave({ network: this.store.network, doc: this.store.doc }), AUTOSAVE_DELAY);
  }

  // ----------------------------------------------------- input plumbing

  private installKeyboard(): void {
    const bindings = this.commands.flatMap((c) => (c.keys ? c.keys.split(' ').map((spec) => ({ c, b: parseKeys(spec) })) : []));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.input.setShift(true);
      if (document.querySelector('dialog[open]')) return;
      const typing = isTyping(e.target);
      const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && !typing);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openPalette();
        return;
      }
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === ' ') {
        if (onControl) return;
        e.preventDefault();
        if (!e.repeat) this.input.setSpace(true);
        return;
      }
      if (onControl && e.key === 'Enter') return;
      if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (onControl && e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        this.arrow(e.key, e.shiftKey);
        return;
      }
      if (e.key === 'Escape') {
        this.escape();
        return;
      }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        this.keyboardContextMenu();
        return;
      }
      for (const { c, b } of bindings) {
        if (!matches(b, e)) continue;
        e.preventDefault();
        if (!c.enabled || c.enabled()) c.run();
        return;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.input.setShift(false);
      if (e.key === ' ' && !isTyping(e.target) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        if (!this.input.setSpace(false)) this.togglePlay();
      }
    });
    window.addEventListener('blur', () => {
      this.input.setShift(false);
      this.input.setSpace(false);
    });
    // The board's focus ring is for keyboard navigation only: show it when
    // the board was reached with Tab, not after clicking it and then using
    // shortcuts (which would make the browser treat it as keyboard focus).
    let tabbed = false;
    window.addEventListener('keydown', (e) => (tabbed = e.key === 'Tab'), { capture: true });
    window.addEventListener('pointerdown', () => (tabbed = false), { capture: true });
    this.canvas.addEventListener('focus', () => this.canvas.classList.toggle('kbd-focus', tabbed));
    this.canvas.addEventListener('blur', () => this.canvas.classList.remove('kbd-focus'));
    // Toolbar buttons should not keep focus after a mouse click, so Space
    // keeps meaning play/pause instead of re-pressing the last button.
    document.addEventListener('mousedown', (e) => {
      const chrome = '.topbar button, .rail button, .transport button, .view-controls button, .caption button, .card-wrap button, .card-wrap label, .card-wrap summary';
      if (e.target instanceof Element && e.target.closest(chrome)) e.preventDefault();
    });
  }

  private arrow(key: string, shift: boolean): void {
    const step = shift ? 5 : 1;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    const sel = this.store.selection;
    if (sel.neurons.size || sel.texts.size) {
      if (!this.moveSelection(dx, dy, 'nudge')) this.toasts.show('Something is in the way', { duration: 1200 });
    } else {
      this.camera.panBy(-dx * 48, -dy * 48);
      this.invalidate();
    }
  }

  private escape(): void {
    if (this.input.cancel()) return;
    if (selectionSize(this.store.selection)) this.store.clearSelection();
    else if (this.store.tool !== 'select') this.store.setTool('select');
  }

  private installDragAndDrop(): void {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      this.dropOverlay.hidden = false;
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) this.dropOverlay.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.dropOverlay.hidden = true;
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.json$/i.test(f.name) || f.type === 'application/json') ?? e.dataTransfer?.files[0];
      if (file) void this.importFile(file);
    });
  }

  /** Browsers only allow audio after a user gesture: unlock on the first one. */
  private installAudioUnlock(): void {
    const unlock = () => this.synth.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  // ---------------------------------------------------------- stage hint

  private buildStageHint(): void {
    const card = h(
      'div',
      { class: 'stage-hint-card' },
      h('span', { class: 'stage-hint-mark', html: icons.logo, 'aria-hidden': 'true' }),
      h('h2', { text: 'An empty board' }),
      h('p', { text: 'Pick a neuron kind from the tools (keys 1–6) and click the grid to place it. Drag from one neuron to another to connect them.' }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', text: 'Browse examples', onclick: () => this.openGallery() }),
        h('button', { class: 'btn outline', text: 'Undo clear', onclick: () => this.undo() }),
      ),
    );
    this.stageHint.append(card);
  }

  private updateStageHint(): void {
    const empty = !this.store.network.neurons.length && !this.store.network.texts?.length;
    this.stageHint.hidden = !empty;
    const undo = this.stageHint.querySelector<HTMLButtonElement>('.row button:last-child');
    if (undo) undo.hidden = !this.store.history.canUndo;
  }

  // ------------------------------------------------------------- commands

  /** Shortcut spec for a command id (for tooltips). */
  keysFor(id: string): string | undefined {
    return this.commands.find((c) => c.id === id)?.keys;
  }

  get isMac(): boolean {
    return isMac;
  }
}

function clearHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
}

// The app's command list: every action with its shortcut, as used by the
// keyboard handler, the command palette and the help sheet.

import { KIND_INFO, NEURON_KINDS } from '../engine';
import { EXAMPLES } from '../examples';
import type { App } from './app';
import { DEFAULT_SCALE } from './camera';
import type { Command } from './commands';
import { selectionSize } from './store';

export function appCommands(app: App): Command[] {
  const sel = () => app.store.selection;
  const hasNeurons = () => sel().neurons.size > 0;
  const kinds: Command[] = NEURON_KINDS.map((kind, i) => ({
    id: `kind-${kind}`,
    title: `Place ${KIND_INFO[kind].name}`,
    group: 'Tools',
    keys: String(i + 1),
    aliases: KIND_INFO[kind].description,
    run: () => app.store.setKind(kind),
  }));
  const examples: Command[] = EXAMPLES.map((ex) => ({
    id: `example-${ex.id}`,
    title: `Open example: ${ex.title}`,
    group: 'Examples',
    aliases: `${ex.category} ${ex.summary}`,
    run: () => app.loadExample(ex),
  }));
  return [
    { id: 'play', title: 'Play / pause', group: 'Simulation', keys: 'space', run: () => app.togglePlay() },
    { id: 'step', title: 'Step one tick', group: 'Simulation', keys: '.', run: () => app.step() },
    { id: 'step-fire', title: 'Step to next fire', group: 'Simulation', keys: '>', run: () => app.step(true) },
    { id: 'reset', title: 'Reset simulation', group: 'Simulation', keys: 'r', aliases: 'restart clear charge', run: () => app.reset() },
    { id: 'faster', title: 'Faster', group: 'Simulation', keys: ']', aliases: 'speed up', run: () => app.nudgeSpeed(1) },
    { id: 'slower', title: 'Slower', group: 'Simulation', keys: '[', aliases: 'speed down', run: () => app.nudgeSpeed(-1) },
    { id: 'replay', title: 'Replay demo', group: 'Simulation', enabled: () => !!app.currentExample?.demo, run: () => app.replayDemo() },
    { id: 'poke', title: 'Poke selected (+1 charge)', group: 'Simulation', keys: 'enter', enabled: hasNeurons, run: () => app.pokeSelection() },
    { id: 'fire', title: 'Fire selected now', group: 'Simulation', keys: 'shift+enter', enabled: hasNeurons, run: () => app.fireSelection() },
    { id: 'select', title: 'Select / move tool', group: 'Tools', keys: 'v', run: () => app.setTool('select') },
    { id: 'connect', title: 'Connect tool', group: 'Tools', keys: 'c', aliases: 'wire axon link', run: () => app.setTool('connect') },
    { id: 'text', title: 'Text tool', group: 'Tools', keys: 't', aliases: 'annotation label', run: () => app.setTool('text') },
    { id: 'hand', title: 'Hand tool (pan and poke)', group: 'Tools', keys: 'h', run: () => app.setTool('hand') },
    ...kinds,
    { id: 'undo', title: 'Undo', group: 'Edit', keys: 'mod+z', enabled: () => app.store.history.canUndo, run: () => app.undo() },
    { id: 'redo', title: 'Redo', group: 'Edit', keys: 'mod+shift+z mod+y', enabled: () => app.store.history.canRedo, run: () => app.redo() },
    { id: 'delete', title: 'Delete selection', group: 'Edit', keys: 'delete backspace', enabled: () => selectionSize(sel()) > 0, run: () => app.deleteSelection() },
    { id: 'select-all', title: 'Select all', group: 'Edit', keys: 'mod+a', run: () => app.selectAll() },
    { id: 'copy', title: 'Copy', group: 'Edit', keys: 'mod+c', enabled: () => selectionSize(sel()) > 0, run: () => app.copy() },
    { id: 'cut', title: 'Cut', group: 'Edit', keys: 'mod+x', enabled: () => selectionSize(sel()) > 0, run: () => app.copy(true) },
    { id: 'paste', title: 'Paste', group: 'Edit', keys: 'mod+v', enabled: () => app.hasClip, run: () => app.paste() },
    { id: 'duplicate', title: 'Duplicate', group: 'Edit', keys: 'mod+d', enabled: () => selectionSize(sel()) > 0, run: () => app.duplicate() },
    { id: 'clear', title: 'Clear canvas', group: 'Edit', aliases: 'delete everything new empty', run: () => app.clearCanvas() },
    { id: 'zoom-in', title: 'Zoom in', group: 'View', keys: '= plus', run: () => app.zoomBy(1.25) },
    { id: 'zoom-out', title: 'Zoom out', group: 'View', keys: '-', run: () => app.zoomBy(0.8) },
    { id: 'fit', title: 'Zoom to fit', group: 'View', keys: 'f', run: () => app.zoomToFit() },
    { id: 'zoom-reset', title: 'Zoom to 100%', group: 'View', keys: '0', run: () => app.zoomTo(DEFAULT_SCALE) },
    { id: 'theme', title: 'Toggle light / dark theme', group: 'View', aliases: 'appearance', run: () => app.toggleTheme() },
    { id: 'mute', title: 'Sound on / off', group: 'View', keys: 'm', aliases: 'mute audio volume', run: () => app.toggleMute() },
    { id: 'examples', title: 'Browse examples', group: 'File', keys: 'e', aliases: 'gallery open', run: () => app.openGallery() },
    { id: 'share', title: 'Copy share link', group: 'File', aliases: 'url', run: () => void app.shareLink() },
    { id: 'export', title: 'Export JSON', group: 'File', keys: 'mod+s', aliases: 'save download', run: () => app.exportJson() },
    { id: 'import', title: 'Import JSON', group: 'File', keys: 'mod+o', aliases: 'open load upload', run: () => app.openImport() },
    { id: 'help', title: 'Help and shortcuts', group: 'Help', keys: '?', run: () => app.openHelp() },
    { id: 'palette', title: 'Command palette', group: 'Help', keys: 'mod+k', paletteHidden: true, run: () => app.openPalette() },
    ...examples,
  ];
}

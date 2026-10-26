// Placeholder entry point: the UI is built on top of src/engine.
import { EXAMPLES } from './examples';

document.querySelector('#app')!.textContent = `Neural Playground: ${EXAMPLES.length} examples loaded.`;

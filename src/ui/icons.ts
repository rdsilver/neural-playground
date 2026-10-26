// Inline SVG icons (20×20, stroked with currentColor). Hand-drawn for this
// app so there is no icon dependency.

const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const icons = {
  logo: svg(
    '<circle cx="5" cy="6" r="2.4"/><circle cx="15" cy="5" r="2.4"/><circle cx="10" cy="15" r="2.6"/><path d="M7.2 7.4 8.8 12.6M13.6 7 11.3 12.7M7.4 5.8h5.2"/>',
  ),
  select: svg('<path d="M5 3.5 15 10l-4.4 1.1L8.7 15.5z" fill="currentColor" fill-opacity=".15"/>'),
  connect: svg('<circle cx="4.5" cy="15.5" r="2"/><path d="M6.2 13.8 15 5"/><path d="M10.5 5H15v4.5"/>'),
  text: svg('<path d="M4.5 5.5V4h11v1.5M10 4v12M7.5 16h5"/>'),
  hand: svg(
    '<path d="M7 10V4.8a1.3 1.3 0 0 1 2.6 0V9m0-.5V3.8a1.3 1.3 0 0 1 2.6 0V9m0-.2V5a1.3 1.3 0 0 1 2.6 0v6.2c0 3.4-2.2 5.8-5.3 5.8-2.4 0-3.6-1.2-4.8-3.3L3.6 10.9a1.3 1.3 0 0 1 2.2-1.3L7 11.2"/>',
  ),
  play: svg('<path d="M6.5 4.2v11.6L16 10z" fill="currentColor"/>'),
  pause: svg('<path d="M6.5 4.5v11M13.5 4.5v11" stroke-width="2.6"/>'),
  step: svg('<path d="M5 4.5v11L12.5 10z" fill="currentColor"/><path d="M15 4.5v11" stroke-width="2"/>'),
  reset: svg('<path d="M4 10a6 6 0 1 0 1.8-4.3"/><path d="M4 3.5V7h3.5"/>'),
  undo: svg('<path d="M7.5 5 4 8.5 7.5 12"/><path d="M4.5 8.5H12a4 4 0 0 1 0 8H9"/>'),
  redo: svg('<path d="M12.5 5 16 8.5 12.5 12"/><path d="M15.5 8.5H8a4 4 0 0 0 0 8h3"/>'),
  share: svg('<path d="M8.5 11.5a3.2 3.2 0 0 0 4.6.2l2.4-2.4a3.2 3.2 0 0 0-4.6-4.6l-1 1"/><path d="M11.5 8.5a3.2 3.2 0 0 0-4.6-.2l-2.4 2.4a3.2 3.2 0 0 0 4.6 4.6l1-1"/>'),
  import: svg('<path d="M10 13V3.5M6.5 7 10 3.5 13.5 7"/><path d="M4 12.5V16h12v-3.5"/>'),
  export: svg('<path d="M10 3.5V13M6.5 9.5 10 13l3.5-3.5"/><path d="M4 12.5V16h12v-3.5"/>'),
  help: svg('<circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4"/><circle cx="10" cy="14" r=".4" fill="currentColor"/>'),
  soundOn: svg('<path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z" fill="currentColor" fill-opacity=".15"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.4 6.4 0 0 1 0 9"/>'),
  soundOff: svg('<path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z" fill="currentColor" fill-opacity=".15"/><path d="m13.5 8 4 4m0-4-4 4"/>'),
  sun: svg('<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/>'),
  moon: svg('<path d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z"/>'),
  examples: svg('<rect x="3" y="3" width="6" height="6" rx="1.4"/><rect x="11" y="3" width="6" height="6" rx="1.4"/><rect x="3" y="11" width="6" height="6" rx="1.4"/><rect x="11" y="11" width="6" height="6" rx="1.4"/>'),
  search: svg('<circle cx="8.8" cy="8.8" r="5"/><path d="m12.6 12.6 3.9 3.9"/>'),
  zoomIn: svg('<path d="M10 4.5v11M4.5 10h11"/>'),
  zoomOut: svg('<path d="M4.5 10h11"/>'),
  fit: svg('<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/><rect x="7" y="7" width="6" height="6" rx="1"/>'),
  trash: svg('<path d="M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.8 10.5h7.4l.8-10.5M8.5 8.5v5M11.5 8.5v5"/>'),
  close: svg('<path d="m5 5 10 10M15 5 5 15"/>'),
  plus: svg('<path d="M10 5v10M5 10h10"/>'),
  minus: svg('<path d="M5 10h10"/>'),
  poke: svg('<path d="M10.8 2.8 5 11h4.3l-1 6.2L15 8.6h-4.4z" fill="currentColor" fill-opacity=".15"/>'),
  fire: svg('<circle cx="10" cy="10" r="2.6" fill="currentColor"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.8 4.8l1.5 1.5M13.7 13.7l1.5 1.5M4.8 15.2l1.5-1.5M13.7 6.3l1.5-1.5"/>'),
  swap: svg('<path d="M4 7h11.5M12.5 4l3 3-3 3M16 13H4.5M7.5 10l-3 3 3 3"/>'),
  copy: svg('<rect x="7" y="7" width="9" height="9" rx="1.6"/><path d="M13 7V5.4c0-.9-.7-1.6-1.6-1.6H5.4c-.9 0-1.6.7-1.6 1.6v6c0 .9.7 1.6 1.6 1.6H7"/>'),
  more: svg('<circle cx="4.8" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15.2" cy="10" r=".9" fill="currentColor"/>'),
  chevronDown: svg('<path d="m5.5 8 4.5 4.5L14.5 8"/>'),
  chevronUp: svg('<path d="m5.5 12 4.5-4.5 4.5 4.5"/>'),
  arrowRight: svg('<path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5"/>'),
  check: svg('<path d="m4.5 10.5 3.5 3.5 7.5-8" stroke-width="2"/>'),
  stats: svg('<path d="M4 16V9.5M8.7 16V5M13.3 16v-4.5M18 16H2.5" transform="translate(.5 0)"/>'),
  inspect: svg('<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M11.5 4v12M13.8 7.5h1.2M13.8 10h1.2"/>'),
  replay: svg('<path d="M4 10a6 6 0 1 0 1.8-4.3"/><path d="M4 3.5V7h3.5"/><path d="M8.6 7.6v4.8l3.8-2.4z" fill="currentColor" stroke-width="1.2"/>'),
};

export type IconName = keyof typeof icons;

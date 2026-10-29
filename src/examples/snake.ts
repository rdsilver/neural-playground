import type { Network } from '../engine';
import board from './snake-board.json';
import type { Direction } from './snake-control';
import type { Example } from './types';

// Neural Snake: a little computer with a dot-matrix screen. The network is
// built by buildSnakeBoard() (snake-board.ts) and shipped precomputed.

/** Key neuron ids of the control unit (buildControl's default prefix). */
export const SNAKE_KEYS: Record<Direction, string> = { right: 'ctl-key-right', left: 'ctl-key-left', down: 'ctl-key-down', up: 'ctl-key-up' };
const k = SNAKE_KEYS;

export const SNAKE_EXAMPLES: Example[] = [
  {
    id: 'snake',
    title: 'Neural snake',
    category: 'Computers',
    summary: 'A snake game on a 10 × 8 dot-matrix screen, made only of neurons.',
    description: [
      'Steer the snake with the arrow keys or WASD, or click ◀ ▲ ▼ ▶ on the board. Every part of this little computer is made of the same neurons as the other examples; there are just more of them.',
      'KEYS: three flip-flops remember the direction: one for the axis (sideways or up/down) and one for each axis’s sign. A key sets the axis and its own sign, so two keys pressed together never mix into a third direction. Once per frame the clock reads them, and exactly one of four direction pulses fires.',
      'HEAD X and HEAD Y: two ring counters hold the head’s column and row as a single token that steps forward or back on each direction pulse, wrapping around the edges.',
      'Screen: the column and row lines meet in a grid of select neurons, like the core memory of early computers. Only the neuron where both lines arrive fires, and it lights its lamp.',
      'MOVE QUEUE and TAIL: every move also waits four frames in the move queue, then drives a second pair of ring counters that follows four steps behind the head and switches off the pixel the tail leaves. So the snake is always four pixels long.',
      'Pulses travel only four cells a second, so a turn shows up about a second after you press. It runs at 32×; slow it down to watch a move ripple through the machine.',
    ].join('\n\n'),
    tryThis: [
      'Press ▼ and follow the pulses from the keys to the screen before the snake turns.',
      'Slow down to 1× and watch one move step through a ring counter.',
      'Turn straight back: the snake passes through its own body.',
      'Watch the tail: it replays each of your moves four frames later.',
    ],
    network: board as Network,
    autoplay: true,
    speed: 32,
    keys: { ArrowRight: k.right, ArrowLeft: k.left, ArrowDown: k.down, ArrowUp: k.up, d: k.right, a: k.left, s: k.down, w: k.up },
  },
];

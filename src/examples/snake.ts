import { buildSnake } from './snake-machine';
import type { Example } from './types';

// PREVIEW ONLY: a quick wrapper so the machine can be play-tested.
const snake = buildSnake();
const { b, screen, blocks } = snake;
b.text(screen.x0 + screen.w / 2, screen.y0 - 1.6, 'NEURAL SNAKE', { size: 0.9, align: 'center', tone: 'accent' });
const label = (name: keyof typeof blocks, text: string) => b.text(blocks[name].box.x0, blocks[name].box.y0 - 1.2, text, { size: 0.7, tone: 'muted' });
label('control', 'KEYS');
label('queue', 'MOVE QUEUE');
label('headX', 'HEAD X');
label('headY', 'HEAD Y');
label('tailX', 'TAIL X');
label('tailY', 'TAIL Y');
const k = snake.keys;
export const SNAKE_EXAMPLES: Example[] = [
  {
    id: 'snake',
    title: 'Neural snake (preview)',
    category: 'Computers',
    summary: 'A snake game on a dot-matrix screen, made only of neurons.',
    description: 'Preview build for play-testing. Steer with the arrow keys or WASD (click the board first), or click the ◀ ▲ ▼ ▶ keys on the board.',
    tryThis: ['Press an arrow key and watch the snake turn about a second later.', 'Slow the speed down to see the pulses travel through the machine.'],
    network: b.build(),
    autoplay: true,
    speed: 32,
    keys: { ArrowRight: k.right, ArrowLeft: k.left, ArrowDown: k.down, ArrowUp: k.up, d: k.right, a: k.left, s: k.down, w: k.up },
  },
];

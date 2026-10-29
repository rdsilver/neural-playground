import type { Network } from '../engine';
import { buildSnake } from './snake-machine';

// The Neural Snake board: the machine from snake-machine.ts plus its title
// and block labels. Building it takes about a second (layout searches and
// glue routing), too slow for app start-up, so the example ships the result
// as snake-board.json. Regenerate it with `node scripts/snake-board.mjs`;
// snake.test.ts fails if the JSON and this builder ever disagree.

export function buildSnakeBoard(): Network {
  const snake = buildSnake();
  const { b, screen, blocks } = snake;
  // Title in the gap between the tail plane (above) and the screen.
  b.text(screen.x0 + (screen.w - 1) / 2, screen.y0 - 2.9, 'NEURAL SNAKE', { size: 0.9, align: 'center', tone: 'accent' });
  const label = (name: keyof typeof blocks, text: string) => b.text(blocks[name].box.x0, blocks[name].box.y0 - 1.3, text, { size: 0.7, tone: 'muted' });
  label('control', 'KEYS');
  label('queue', 'MOVE QUEUE');
  label('headX', 'HEAD X');
  label('headY', 'HEAD Y');
  label('tailX', 'TAIL X');
  label('tailY', 'TAIL Y');
  return b.build();
}

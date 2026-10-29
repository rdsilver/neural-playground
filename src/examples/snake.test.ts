import { describe, expect, it } from 'vitest';
import { normalizeNetwork } from '../engine';
import { SNAKE_EXAMPLES, SNAKE_KEYS } from './snake';
import board from './snake-board.json';
import { buildSnakeBoard } from './snake-board';
import { buildSnake } from './snake-machine';

describe('neural snake example', () => {
  it('ships exactly the network the builder makes (run node scripts/snake-board.mjs if not)', () => {
    expect(board).toEqual(buildSnakeBoard());
  });

  it('binds the control unit’s key neurons', () => {
    expect(SNAKE_KEYS).toEqual(buildSnake().keys);
    const ids = new Set(SNAKE_EXAMPLES[0]!.network.neurons.map((n) => n.id));
    for (const id of Object.values(SNAKE_EXAMPLES[0]!.keys!)) expect(ids.has(id)).toBe(true);
  });

  it('is already normalized', () => {
    const net = SNAKE_EXAMPLES[0]!.network;
    expect(normalizeNetwork(net)).toEqual(net);
  });
});

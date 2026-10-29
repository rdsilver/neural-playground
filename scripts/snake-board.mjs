// Regenerate src/examples/snake-board.json from the Neural Snake builder.
//
//   node scripts/snake-board.mjs
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildSnakeBoard } = await server.ssrLoadModule('/src/examples/snake-board.ts');
  const network = buildSnakeBoard();
  await writeFile('src/examples/snake-board.json', JSON.stringify(network) + '\n');
  console.log(`src/examples/snake-board.json: ${network.neurons.length} neurons, ${network.connections.length} connections`);
} finally {
  await server.close();
}

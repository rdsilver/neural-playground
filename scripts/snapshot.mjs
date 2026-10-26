// Render built-in examples to SVG + PNG after simulating them for a while.
//
//   node scripts/snapshot.mjs <example-id|all> [seconds=10] [outDir=snapshots]
//
// Useful for checking an example's layout without opening the app.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';

const [target = 'all', seconds = '10', outDir = 'snapshots'] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { EXAMPLES } = await server.ssrLoadModule('/src/examples/index.ts');
  const { Simulation, networkToSvg } = await server.ssrLoadModule('/src/engine/index.ts');
  const chosen = target === 'all' ? EXAMPLES : EXAMPLES.filter((e) => e.id === target);
  if (!chosen.length) throw new Error(`No example "${target}". Known: ${EXAMPLES.map((e) => e.id).join(', ')}`);
  await mkdir(outDir, { recursive: true });

  let browser;
  try {
    // require() so a globally installed Playwright (NODE_PATH) is found too.
    const { chromium } = createRequire(import.meta.url)('playwright');
    browser = await chromium.launch();
  } catch {
    console.warn('Playwright not available: writing SVG only.');
  }
  for (const example of chosen) {
    const sim = new Simulation(example.network);
    sim.runSeconds(Number(seconds));
    const svg = networkToSvg(example.network, { simulation: sim });
    const base = path.join(outDir, example.id);
    await writeFile(`${base}.svg`, svg);
    if (browser) {
      const page = await browser.newPage();
      await page.setContent(`<body style="margin:0;background:#111">${svg}</body>`);
      await page.locator('svg').screenshot({ path: `${base}.png` });
      await page.close();
    }
    console.log(`${base}.${browser ? 'png' : 'svg'}  (${example.title}, t=${seconds}s)`);
  }
  await browser?.close();
} finally {
  await server.close();
}

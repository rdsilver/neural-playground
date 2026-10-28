# Handoff: Neural Playground

You are picking up an ongoing project for the repo owner (GitHub `rdsilver`). This document is the state of play as of 2026-10-28.

## What this is

**Neural Playground** (github.com/rdsilver/neural-playground) lets you place neurons on a grid, wire them up and watch charge pulses travel between them. It started as a 2016 p5.js/jQuery toy. In October 2026 it was fully rewritten in TypeScript with zero runtime dependencies, a new UI and 13 new examples.

- **Live site:** https://rdsilver.github.io/neural-playground/ (the rewrite, working).
- **Default branch is `gh-pages`.** Pushing to it deploys the site (see Deployment below; there's a trap).

## Branches

| Branch | State |
| --- | --- |
| `gh-pages` @ `b24afdb` | Live site: rewrite plus pre-release QA fixes and README. Default branch. |
| `modern-rewrite` @ `b24afdb` | Same commit as `gh-pages`; the rewrite's working branch. Can be deleted. |
| `snake-computer` @ `fa93ac9` | `gh-pages` plus unreleased work: Lamp neuron kind, example keyboard bindings, "Computers" gallery category, big-network renderer performance, and `docs/snake/` (paused snake blueprint). 298 tests pass, typecheck clean. Not merged or deployed. |
| `snake/control` @ `bbced3c` | Paused work in progress: the Neural Snake control unit (`src/examples/snake-control.ts` plus 17 passing tests). Branched from `b24afdb`, not from `snake-computer`. |
| `master` | The untouched 2016 code. Ignore. |

## Deployment: read before pushing to `gh-pages`

- `.github/workflows/deploy.yml` ("Test and deploy") runs on every push to `gh-pages` (and on pull requests): `npm ci`, `npm test`, `npm run build`, then deploy `dist/` to Pages.
- The repo's Pages setting must be **Settings → Pages → Build and deployment → Source: GitHub Actions**. When the rewrite was last pushed, a branch-based "pages build and deployment" run also fired. It overwrote the built site with raw source and blanked the page. So the setting was apparently still "Deploy from a branch". The site was fixed by re-running the workflow by hand: `gh workflow run deploy.yml --ref gh-pages`.
- **Before the next push to `gh-pages`:** ask the owner to confirm the Pages source is "GitHub Actions". After pushing, check the Actions tab: if a "pages build and deployment" run appears, the setting is still wrong, and the site will serve `index.html` pointing at `./src/main.ts` (a blank page).
- To verify the live site, `curl` it and check that the script tag points to `./assets/index-*.js`, not `./src/main.ts`.
- The GitHub Pages API (`/repos/.../pages`) was not reachable from the previous session, so check the setting by asking the owner or by watching the Actions runs.

## Code map

```
src/engine/    DOM-free, deterministic simulation (unit-tested). Don't change semantics casually.
  types.ts       Network JSON: neurons {id, kind, x, y, threshold, label?, interval?, times?, note?}, connections, texts
  kinds.ts       KIND_INFO for the 7 kinds: normal, character ("Digit"), negative ("Inhibitor"), random, timer, note, lamp
  simulation.ts  Simulation: step/run/stimulate/fire/schedule/reset/load/pulses/progress/nextEventTick
  serialize.ts   normalize/JSON/share codes (deflate + base64url in the URL hash); imports the 2016 format
  builder.ts     NetworkBuilder DSL used by examples
  svg.ts         networkToSvg (thumbnails, snapshots)
src/examples/  19 examples (+ classics converted from 2016), each with vitest tests proving its claims
src/ui/        the app: app.ts (orchestration), store/history, runner (sim + demos), renderer (Canvas 2D),
               input (pointer/touch), camera/layout, audio (Web Audio), persistence, panels/*, styles.css
scripts/snapshot.mjs  render examples to PNG without the app: node scripts/snapshot.mjs <id|all> [seconds] [outDir]
```

**Engine semantics, which everything depends on:**
- 60 ticks per second.
- A pulse between cells at distance d arrives exactly `ceil(15*d)` ticks later (4 cells/s). Layout is timing.
- A neuron adds +1 per pulse (−1 from an Inhibitor). At the threshold its charge is set to 0 (not reduced) and it fires one pulse down every outgoing connection. There is no leak.
- Per-tick order: scheduled stimuli, then pulse arrivals by (tick, creation order), then timers.
- Timers fire on tick 1, then every interval.
- Random neurons use a seeded RNG, so every run is identical.

**Examples:**
- An `Example` has: id, title, category, summary, description, tryThis, network, autoplay, speed, `demo` (scripted pokes with captions; `neuron` may be omitted for caption-only steps) and `keys` (KeyboardEvent.key mapped to a neuron to poke).
- Every example has tests that check what its description claims, including exact timings of demo captions.

## Commands and testing

- `npm ci`
- `npm run dev`
- `npm test` (vitest; add `--silent=false` to see `console.log` output)
- `npm run typecheck`
- `npm run build`

Toolchain: Vite 8, TypeScript 7 (strict), Vitest 5, Node 22.

Browser testing:
- Playwright is used from scratch scripts outside the repo: `require('playwright')`, headless Chromium.
- Dev builds expose `window.__app` (the App instance: `store`, `runner`, `runner.sim`, `camera`, …), which is handy for assertions.
- The board canvas is `canvas.board`. There are also small kind-icon canvases, so don't use `querySelector('canvas')`.
- Gotcha: `pkill -f "<pattern>"` can kill your own shell if the pattern appears in your command line. Use `pkill -f "[v]ite ..."` or kill by PID.

## Open work

### 1. Neural Snake: paused (owner said to pause unless close; it isn't close)

The owner asked for "a little computer with a dot matrix display… like maybe a snake game… made from the neurons".
- **Blueprint and requirements:** `docs/snake/blueprint.md` and `docs/snake/brief.md` (on `snake-computer`); `docs/snake/STATUS.md` has a summary.
- **Design:** 10x8 Lamp screen, fixed length 4, wrap-around, absolute arrow/WASD keys. The parts:
  - a 2-bit direction register (axis, sign) robust to presses at any tick;
  - a synchronous read once per frame;
  - a 2→4 decoder that fires exactly one strobe per frame;
  - X/Y one-hot ring counters (f/b/h copies per position);
  - coincident row/column pixel selection (like core memory);
  - per-pixel delay lines that switch each lamp off exactly 4 frames later.
- **Done on `snake/control`:** `buildControl(b, origin, {F})` returns `{keys, strobes, clock, power, bits, F, readOffset, strobeOffset}`. Exactly one of `strobes.right/left/down/up` fires per frame at `strobeOffset` ticks after each frame-timer fire. It deviates usefully from the blueprint: each bit is stored as charge in a threshold-2 register and read non-destructively with a tight +1/−1 pair. 17 tests pass, including presses at every phase. Merge `snake-computer` into it, or cherry-pick, before continuing; it lacks the Lamp kind.
- **Not started:**
  - the datapath (blueprint P5–P7);
  - assembling both parts into `src/examples/snake.ts` (category 'Computers', keys, demo, layout);
  - integration tests against a reference snake model;
  - a browser play-test.
- **Hard-won lesson:** three agents given the open-ended version each exceeded the 128k output-token limit in a single reply. They tried to derive the whole circuit in one go and produced nothing. Build it in small tested steps; the deterministic engine makes tests the proof.
- **Shipping the groundwork alone is an option the owner hasn't decided on:** Lamp, keyboard bindings and the renderer speedup on `snake-computer`, released without the snake. The speedup took a 3000-neuron stress test from 3 to 60 fps.

### 2. QA follow-ups (from a six-reviewer pre-release pass; none fixed yet)

- **Layout:**
  - [high] Landscape phones (844x390): network tiny, kind rail clipped, no re-fit on rotate.
  - Safe-area insets under the notch.
  - A pinch that starts on a floating island zooms the whole page.
  - The inspector sheet covers about 46% of a phone screen on every placement.
  - "Next example" clipped at 1101–1331px widths.
  - Share fallback dialog on phones.
- **Accessibility:**
  - [high] Neurons can't be connected with the keyboard.
  - [high] At 200% browser zoom the network sits off-screen and Zoom to fit doesn't help.
  - Focus is lost to `<body>` after several controls.
  - Closing overlays drops keyboard mode.
  - Unannounced keyboard edits.
  - Help dialog not keyboard-scrollable.
  - Board graphics below 3:1 contrast.
  - Single-key shortcuts fire globally (WCAG 2.1.4).
- **Polish:**
  - Command palette search misses "add" and "new".
  - Random examples replay the identical run every load; they need a random UI seed.
  - Some demo captions run ahead of their results (binary-to-decimal, division, clock).
  - The hover card covers the Digit you're told to watch.
  - The Connect tool can commit a dangling connection after undo or delete.
  - Lowering a running timer's interval does nothing until its old countdown ends.
  - Light-OS users get the dark theme.
  - No SVG favicon or share-preview meta.
  - Two tabs overwrite each other's settings.
  - A `#net=` decompression bomb can blank the app (cap its size).
  - Undo back to an example keeps the later example's speed.
  - Polyrhythm tip says "threshold" but the inspector says "Base".

## Owner's preferences (observed)

- Wants things shipped. Prefers short status updates.
- Asked to pause work that isn't close to done.
- Once merged before the Pages setting was switched, which blanked the site. Be explicit about deploy prerequisites and confirm before anything that changes the live site.

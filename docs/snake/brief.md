# Neural Snake: shared brief for designers

## The ask
The owner of Neural Playground (github.com/rdsilver/neural-playground, live at https://rdsilver.github.io/neural-playground/) asked: "add a little computer with a dot matrix display as an example? Like maybe a snake game? Obviously made from the neurons."
You are designing that example: a SNAKE GAME running on a DOT-MATRIX DISPLAY, built entirely from the playground's neurons. It becomes the flagship of a new gallery category, 'Computers'.

## The engine (read src/engine/*.ts and the examples first; they are small)
- 60 ticks per simulated second. A pulse between cell centres at Euclidean distance d (cells) arrives exactly ceil(15·d) ticks after it is sent (min 1). Layout is timing; the engine is fully deterministic.
- Each neuron has an integer charge (starts 0) and a threshold >= 1. Arriving pulses add +1 (or -1 from an Inhibitor). When charge >= threshold the charge is SET TO 0 and the neuron fires one pulse down every outgoing connection. No leak, no decay; charge can go negative and stays there until pulses change it.
- Kinds: normal (+1 pulses), character "Digit" (+1 pulses; displays its charge 0-9A-Z: a base-b counter when threshold = b), negative "Inhibitor" (-1 pulses), random (one +1 pulse down ONE outgoing connection, chosen by a seeded RNG), timer (ignores input; fires on tick 1 and then every `interval` s, `times` times or forever with -1), note (plays a MIDI note when it fires), and NEW: lamp ("Lamp": a dot-matrix pixel drawn as an LED that glows while its charge > 0; otherwise a normal +1 neuron, default threshold 9 so it does not fire in normal use). +1 turns a lamp on, -1 off.
- Per tick: (1) scheduled stimuli (demo steps / Simulation.schedule), (2) pulse arrivals in (arrivalTick, creation order) — so on a tie, the pulse created earlier lands first, (3) timers due, in network order.
- The user pokes a neuron by clicking it while running (sim.stimulate, +1 now). Examples can also bind keyboard keys to neurons: `Example.keys = { ArrowLeft: 'key-left', ... }` (KeyboardEvent.key -> neuron id), poked on key press. One neuron per cell; directed connections; no self-connections; at most one connection per (from, to) pair.
- Builder: src/engine/builder.ts (NetworkBuilder). Example type: src/examples/types.ts (id, title, category 'Computers', summary, description, tryThis, network, autoplay, speed, demo steps with captions — `neuron` optional for caption-only steps — and keys).

## Building blocks already proven in this repo (read them)
1. Pulse ladder: R_k -> R_{k-1} -> ... -> R_1, each also wired to a target: poking R_k sends exactly k pulses. (src/examples/calculator.ts)
2. Digit register mod b: a Digit with threshold b counts mod b exactly whatever the pulse interleaving; "subtract 1" = add b-1 (ten's complement); wrap-around is free (a torus!). (calculator.ts)
3. Reverberating loop = stored activity / delay-line memory: a pulse circulating in a ring of relays forever; a ring can hold a whole pattern of pulses (early computers like EDSAC stored data exactly like this).
4. "Hole" gates with pulse pairs: a key reaches a gate as +1 then -1 in the same tick; a gate holding a -1 "hole" ignores presses, an open gate passes one press and becomes closed; gates can pass a hole between them. This makes presses idempotent and order-safe. (src/examples/basics.ts, flip-flop)

## Ideas that should work (derive and verify yourself before relying on them)
5. Exact-timing AND with self-restore: gate G (threshold 2). Input A lands +1 at t; an Inhibitor driven by A lands -1 on G at t+δ; input B must land in [t, t+δ). If B came, G reaches 2, fires (charge 0), the -1 makes it -1, and G's own output also feeds a relay that lands +1 back on G after t+δ: net 0. If B did not come: +1 then -1: net 0. Every frame ends with G at 0. B arriving outside its window breaks it, so timing must be designed (deterministic, so testable).
6. Non-destructive read by overflow timing: add b pulses (spaced in time) to a base-b Digit holding value v: it overflows exactly once, at the (b-v)-th pulse, and ends at v again. The TIME of the overflow encodes v.
7. Coincident row/column selection (as in magnetic core memory): pixel cell threshold 2 gets +1 from its row line and +1 from its column line; afterwards both lines send -1 to clean up the half-selected cells; the fully selected cell (which fired) is restored by +2 from relays it triggered. Exact charge accounting every frame.
8. Lamps as state: the body can simply be "lamp on" (charge 1); the tail is a -1 arriving later. A per-pixel delay (a long wire or relay chain from the event that lit it to an Inhibitor) can turn a pixel off exactly L frames later; or a tail process can replay the head's path.
9. Random neurons can place food.

## Requirements (MUST)
- Display: a grid of Lamps, at least 8x8 (10x10 or 12x8 is nicer), lamps at 1-cell pitch so it reads as a screen, with a bezel/frame (texts) and a title such as "NEURAL SNAKE".
- The snake's head moves one pixel per frame at a steady frame period (choose 0.4-1 s simulated; set Example.speed if it plays better faster) and wraps around the edges (torus) — or walls with a clean game over. The body has length L >= 3 and shows exactly the last L head positions as lit lamps; every other lamp is dark (at the settled moment of each frame).
- Controls: on-board key neurons labelled ◀ ▲ ▼ ▶ (or two turn keys ⟲ ⟳, if you prefer relative steering) that users click while it runs, plus `keys` bindings for ArrowLeft/ArrowRight/ArrowUp/ArrowDown and WASD. A press at ANY tick must take effect at the next move or the one after (state the latency). Several presses in one frame, repeated presses and reversals must have well-defined, documented results (classic snake ignores reversing straight back).
- No drift: charges return to a clean state every frame; no runaway pulses; it can run for thousands of frames.
- Proof (vitest): a pure TypeScript reference model of the snake. A property test drives the network and the model with seeded random key presses at random ticks (including same-tick and many-per-frame bursts, presses during transitions) for hundreds of frames, across several seeds, and asserts at each frame's settled moment that the set of lit lamps equals the model's body and that every lamp's charge is 0 or 1. Also a long run (>= 2000 frames) that stays clean, and tests that would fail if a wire or threshold were wrong (mutate one temporarily to confirm).
- Demo: a scripted `demo` with 3-5 captions that steers the snake around a little and explains the architecture ("The head is a pulse..."), and `autoplay`.
- Description (plain, accurate, friendly; explain each block) and 3-4 `tryThis` items.
- Size budget: <= 3000 neurons and <= 8000 connections (smaller is better, and it's judged). The UI must stay smooth.
- Layout: the display is the centrepiece; the circuitry sits around it in clearly labelled blocks (texts: CLOCK, DIRECTION, MEMORY...). The UI draws wires that END at Lamps faintly (pulses on them still show, like a CRT beam writing the screen), so route other wiring so it does not cross the screen.

## Stretch (bonus, only if robust and tested)
Food: one lit pixel placed at random (Random neurons); eating it grows the snake by 1 and increments a score shown on Digits; self-collision gives a clean GAME OVER (e.g. the snake stops and a GAME OVER indicator lights); a restart key.

## Practicalities
- Work in your own git worktree. `npm ci` first. Files: src/examples/snake.ts exporting `SNAKE_EXAMPLES: Example[]` (example id 'snake', category 'Computers') + src/examples/snake.test.ts; register in src/examples/index.ts. Generate structure with code (loops/helpers), not hand-placed coordinates; comment the clever parts.
- Look at it: `node scripts/snapshot.mjs snake <seconds> <outDir>` renders a PNG (lamps glow when charged). For frames with key presses, write your own scratch script (ssrLoadModule like scripts/snapshot.mjs, schedule stimuli, render several frames into a strip). Read the PNGs.
- `npm run typecheck && npm test` must pass. Commit on the branch named in your task with a message ending in exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M7mfk3dSXWnB3FMrJjq9iD
- Do not push. Do not modify src/engine or other examples (if you truly need an engine feature, stop and describe it in engineRequests).

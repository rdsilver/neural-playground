# Neural Snake: blueprint

Read `brief.md` (next to this file) for the engine semantics and context. Previous attempts failed because agents tried to design everything in one giant chain of reasoning and hit the output limit. This blueprint fixes the architecture; your job is to BUILD it in small, tested steps.

## Working rules (important)
- Never write more than ~250 lines in one tool call, and keep each of your replies short. Think in code: write a small builder function plus a test, run it, read the failure, adjust. Do not try to derive every tick on paper first. The engine is deterministic, so tests ARE the proof.
- Every timing claim must be checked by a test. For anything that interacts with a user press, enumerate EVERY phase: a press at each tick offset 0..F-1 within a frame, and pairs of presses at all offset combinations where feasible.
- Commit after each block works.

## Target
- Screen: 10 x 8 Lamps at 1-cell pitch (`kind: 'lamp'`, threshold 9).
- Frame period F ticks. Choose F between 60 and 120, as small as the timing allows. Set `Example.speed` so one move takes about 0.25-0.4 s of real time (e.g. F=90 with speed 6).
- Snake length L = 4, fixed (no food or growth: fixed-length delay lines can't grow). Wrap-around torus. The snake may cross itself: the lamp then holds charge 2 and stays lit, which is harmless.
- Absolute direction keys ◀ ▲ ▼ ▶ on the board, plus `keys`: ArrowLeft/ArrowUp/ArrowDown/ArrowRight and a/w/s/d. Reversing straight back is allowed (the snake passes through itself); document it.

## Blocks

### P1. Pair pulse (+1 then -1 at the same target)
- **Tight pair** (both in the same tick, +1 processed first): the `pairKey` square from src/examples/basics.ts. Source at one corner of a 2x2 square, relay P and Inhibitor M at the adjacent corners, target at the opposite corner. Source connects to P first, then to M. Use this where a gap between the +1 and the -1 would be dangerous (samplers, P2).
- **Broadcast pair** to many targets: relay P fires +1 to every target AND to an adjacent Inhibitor M', which fires -1 to every target. For each target, the -1 lands 0-30 ticks after the +1 (triangle inequality); on a tie the +1 goes first because it was created earlier. Use this for ring counters (P5) and keep other inputs out of each target's gap.

### P2. Sampler: synchronously read a flip-flop's loop
- A flip-flop (P3) whose state is a reverberating loop with period exactly F, which lands one +1 per F ticks on sampler G (threshold 2) while active, at an arbitrary phase.
- Each frame, at tick T, a TIGHT pair (+1, -1) hits G, and G's own firing feeds a restore relay that lands +1 on G later.
- **Active:** the loop pulse is stored as charge 1, the +1 makes 2, G fires exactly at T, the -1 leaves -1, and the restore brings it to 0.
- **Inactive:** +1 then -1, net 0, no fire.
- **A loop pulse on the same tick as the pair:** every processing order is consistent, counted either this frame or the next. Verify for all phases.
- Inverted output N ("inactive"): N (threshold 1) gets a -1 from G's fire through an Inhibitor (landing at about T+30) and the frame clock's +1 at about T+45. Active: -1 then +1, no fire. Inactive: +1, N fires. Both cases end at 0.
- So each sampler yields exactly one pulse per frame: G at T if active, N at T+45 if inactive.

### P3. Flip-flop with loop period F (two of them: AXIS and SIGN)
- Reuse the robust SET/RST design from src/examples/basics.ts (the shared "hole" gates and the power-on timer). Read it and its tests. Adapt the geometry so the loop period is exactly F, and one loop neuron feeds the sampler G.
- AXIS: active = vertical. SIGN: active = negative. Initial state (H, +) = RIGHT.
- Keys:
  - ▶ = RST AXIS + RST SIGN
  - ◀ = RST AXIS + SET SIGN
  - ▼ = SET AXIS + RST SIGN
  - ▲ = SET AXIS + SET SIGN
- Each key neuron fans out to its two flip-flop inputs. Both flip-flops are robust to presses at any tick. The known caveat: within the gate-to-gate news delay after a change, an opposite press on that same flip-flop is ignored. Keep that window short (adjacent gates, 15 ticks) and document it.

### P4. Decoder: 2 bits to 4 one-hot strobes, with exact accounting
- Branches RIGHT=(H,P), LEFT=(H,N), DOWN=(V,P), UP=(V,N): threshold 1, all resting at -1. Power-on digs these holes (one-shot Timer through an Inhibitor).
- **Stage 1** (tick D1): the axis pulse (G_axis = V or N_axis = H) gives +1 to both branches of that axis.
- **Stage 2** (D2 > D1): the sign pulse gives +1 to both branches of that sign. The branch with both reaches 1 and fires: that is THE direction strobe this frame. It also sends +1 to its complement branch (both bits flipped).
- **Stage 3** (D3, after everything): -1 to all four. Every branch is back to -1.
- Route the sampler outputs so they land at the decoder exactly in their stages, whichever of G/N fired (they fire at different ticks; compensate with distance).

### P5. Position registers: one-hot ring counters X (10) and Y (8), each position with 3 copies
- Position i has copy neurons S_i^f, S_i^b, S_i^h (threshold 2). The token is charge 1 in all three copies of the current position.
- Each frame each ring gets exactly one strobe: RIGHT → X.f & Y.h; LEFT → X.b & Y.h; DOWN → X.h & Y.f; UP → X.h & Y.b. The h-strobe source of a ring is an OR of two branches; exactly one fires.
- A strobe of type c is a broadcast pair (P1) to every S_j^c of that ring. The holder fires:
  - **c=f:** +1 to S_{i+1}^{f,b,h}; -1 (via an Inhibitor) to S_i^b and S_i^h (stale copies); restore +1 to S_i^f (it went 1, 2, fire 0, then -1, so restore brings 0); and +1 to output line i+1.
  - **c=b:** mirror, with i-1.
  - **c=h:** restore +2 to S_i^h (two relays: -1 back to token 1); +1 to output line i. Other copies untouched.
- Timing constraint: a token arriving at the destination copy of the same type must land AFTER that copy's pair -1 for this frame, or it would fire twice. Make ring spacing and pair geometry guarantee it, and test all positions. Everything settles before the next frame.
- Power-on: a one-shot Timer gives +1 to all three copies of X position 0 and Y position 0 (Y position 3 if you prefer the middle).
- Output lines: X → column lines c0..c9, Y → row lines r0..r7. Each fires exactly once per frame, for the NEW position.

### P6. Display write by coincident selection (as in magnetic core memory)
- Pixel select neuron Q_{x,y} (threshold 2), one per lamp, in its own grid (not on the screen).
- Column line x gives +1 to every Q_{x,*} and, δ ticks later (through its own Inhibitor), -1. Row lines likewise.
- The selected Q gets +1 and +1, fires, then -1 and -1 (charge -2), then a restore +2 (two relays) that must land AFTER both -1s (otherwise it fires again). Half-selected Q: +1 then -1.
- Choose δ larger than the worst skew between the column and row +1 arrivals.
- Q fires → +1 to its Lamp (the head lights up) and starts the tail eraser (P7).

### P7. Tail: a delay line per pixel (distance = delay)
- Each Q_{x,y} → Inhibitor E_{x,y} → Lamp_{x,y}, arranged so that (Q→E travel) + (E→Lamp travel) − (Q→Lamp travel) = L·F ticks exactly, for every pixel.
- Easiest: the Q grid, E grid and Lamp grid are translated copies of each other, so every pixel has the same three distances. Verify with a test that computes travelTicks for all 80.
- Result: each lamp stays lit for exactly L frames after the head passes. The lit lamps are exactly the last L head positions; overlaps add charge.

### P8. Clock and schedule
- One frame Timer (interval F/60 s, forever), plus a distribution of relays to deliver each stage at its tick: sampler pairs at T, N clocks, decoder stages D1/D2/D3, and so on.
- Ring strobes come from the decoder branches. Line cleanups are self-timed by each line's Inhibitor.
- Power-on Timer (times 1) for the initial holes and tokens.
- Document the full frame schedule (tick of every event) in a comment table, and make a test assert it.

## Tests (vitest, src/examples/snake.test.ts plus parts tests)
- Unit tests per block: sampler at all phases; flip-flop presses at all phases; decoder for all 4 states, plus sustained random sequences; ring counter for all positions × all strobe types, for hundreds of frames with random strobes; pixel select for all (x, y); tail delay exact for all pixels.
- Integration: a pure TS reference model. Direction comes from the presses; a press takes effect within at most 2 frames (define precisely what the model does with presses in each phase, or assert a looser invariant). Simplest strong check: run random key presses at random ticks and, after each frame settles, assert:
  - the lit lamps form a connected snake path of length L (with wrap), that the head moved by exactly one cell in the direction the flip-flops held at that frame's sample;
  - every lamp charge is 0..L;
  - exactly one Q fires per frame; exactly one strobe per frame;
  - all internal neurons are back at their resting charges at the end of each frame.
  - Also scripted presses that check exact behaviour, e.g. "press ▲ at tick k of frame n, so the head turns up at frame n+1 (or n+2)".
- Long run: 3000 frames with random presses. No drift, no runaway, pulses in flight bounded.
- Mutation check: temporarily break one wire or threshold and confirm a test fails.

## Example
- `src/examples/snake.ts` exports `SNAKE_EXAMPLES` with one example: id 'snake', category 'Computers', title like "Neural snake", autoplay, speed, keys.
  - A demo: caption-only steps plus key presses that steer a small square or zigzag.
  - A description that explains the blocks like a computer: clock, direction register (two flip-flops), sampler, decoder, X/Y ring counters, address decoder (coincident selection like core memory), delay-line memory for the tail.
  - tryThis: 3-4 items.
  - Register it in `src/examples/index.ts`.
- Layout:
  - The screen is the centrepiece, with a bezel made of texts ("NEURAL SNAKE").
  - Keys sit under the screen like a game controller.
  - The blocks sit around it with labels (CLOCK, DIRECTION, DECODER, X REGISTER, Y REGISTER, ADDRESS, TAIL DELAY). Wires into Lamps are drawn faint by the UI.
  - Keep other wiring off the screen.
  - Total size ≤ 3000 neurons and ≤ 8000 connections. This design should land around 700 neurons and 1500 connections.

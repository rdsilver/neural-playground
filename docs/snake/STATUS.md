# Neural Snake: paused work in progress

Goal: a "little computer" example with a dot-matrix display, playing snake, built only from neurons.

Done on this branch (`snake-computer`):
- Lamp neuron kind (dot-matrix pixel) in the engine, renderer, palette and help.
- Example keyboard bindings (`Example.keys`), so arrow keys/WASD can poke key neurons.
- 'Computers' gallery category.
- Renderer performance for networks of about 3000 neurons and 8000 wires.

In progress:
- Branch `snake/control`: the control unit (keys, direction flip-flops, samplers, decoder), partly done with tests.
- Not started: the datapath (ring counters, coincident pixel selection, tail delay lines), assembly, play-testing.

To resume: follow `blueprint.md` (architecture) and `brief.md` (engine semantics and requirements). Build in small tested steps; the open-ended version of this task ran agents past their output limit.

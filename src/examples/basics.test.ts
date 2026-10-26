import { describe, expect, it } from 'vitest';
import { digitText, networkBounds, Simulation, TICKS_PER_SECOND, travelTicks, type FireEvent, type Network } from '../engine';
import { mulberry32 } from '../engine/rng';
import { FIREWORKS, FLIP_FLOP, GALTON_BALLS, GALTON_DROPPED, GALTON_ROWS, HELLO, HELLO_ARPEGGIO, galtonBin } from './basics';
import { demoCaptionAt, scheduleDemo } from './demo';
import { EXAMPLES, findExample } from './index';

const hello = findExample('hello-neurons')!;
const flipFlop = findExample('flip-flop')!;
const galton = findExample('galton-board')!;
const fireworks = findExample('fireworks')!;

// ---- helpers ---------------------------------------------------------------

const fired = (events: FireEvent[], id: string) => events.filter((e) => e.neuron === id);

/** Ticks a pulse takes along a connection of the given network. */
function delay(network: Network, from: string, to: string): number {
  const at = new Map(network.neurons.map((n) => [n.id, n]));
  return travelTicks(at.get(from)!, at.get(to)!);
}

/** Smallest distance from a neuron centre to a connection it is not part of. */
function closestPass(network: Network): { distance: number; what: string } {
  const at = new Map(network.neurons.map((n) => [n.id, n]));
  let best = { distance: Infinity, what: '' };
  for (const c of network.connections) {
    const a = at.get(c.from)!, b = at.get(c.to)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const n of network.neurons) {
      if (n.id === c.from || n.id === c.to) continue;
      const t = Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + t * dx - n.x, a.y + t * dy - n.y);
      if (d < best.distance) best = { distance: d, what: `${c.from} -> ${c.to} passes ${n.id}` };
    }
  }
  return best;
}

/** Text annotations that overlap a neuron's square (using the renderer's rough text metrics). */
function textsOverNeurons(network: Network): string[] {
  const clashes: string[] = [];
  for (const t of network.texts ?? []) {
    const size = t.size ?? 0.6;
    t.text.split('\n').forEach((line, i) => {
      const width = line.length * size * 0.55;
      const left = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
      const top = t.y + i * size * 1.25;
      for (const n of network.neurons) {
        if (left < n.x + 0.92 && left + width > n.x + 0.08 && top < n.y + 0.92 && top + size > n.y + 0.08) clashes.push(`"${line}" covers ${n.id}`);
      }
    });
  }
  return clashes;
}

// ---- Hello, neurons ----------------------------------------------------------

describe('hello, neurons', () => {
  const net = hello.network;

  it('is the first example in the gallery', () => {
    expect(EXAMPLES[0]!.id).toBe('hello-neurons');
    expect(hello.category).toBe('Start here');
  });

  it('① fires on every third click, and its Digit counts the fires', () => {
    const sim = new Simulation(net);
    expect(fired(sim.stimulate(HELLO.clickMe), HELLO.clickMe)).toHaveLength(0);
    expect(fired(sim.stimulate(HELLO.clickMe), HELLO.clickMe)).toHaveLength(0);
    expect(sim.charge(HELLO.clickMe)).toBe(2);
    expect(fired(sim.stimulate(HELLO.clickMe), HELLO.clickMe)).toHaveLength(1);
    expect(sim.charge(HELLO.clickMe)).toBe(0); // reset, not reduced
    expect(sim.charge(HELLO.fires)).toBe(0); // the pulse is still on its way
    sim.run(delay(net, HELLO.clickMe, HELLO.fires));
    expect(sim.charge(HELLO.fires)).toBe(1);
  });

  it('① counts every third click even when clicks come on consecutive ticks', () => {
    const sim = new Simulation(net);
    for (let i = 0; i < 20; i++) {
      sim.stimulate(HELLO.clickMe);
      sim.step();
    }
    for (let i = 0; i < 5; i++) sim.stimulate(HELLO.clickMe); // five in the same tick
    sim.run(120);
    expect(sim.charge(HELLO.fires)).toBe(8); // 25 clicks = 8 fires, 1 left over
    expect(sim.charge(HELLO.clickMe)).toBe(1);
  });

  it('② hops of 2, 4 and 6 cells take ½, 1 and 1½ seconds, as labelled', () => {
    const labels = (net.texts ?? []).map((t) => t.text);
    expect(labels).toEqual(expect.arrayContaining(['½ s', '1 s', '1½ s']));
    const route = [HELLO.go, ...HELLO.hops];
    expect(route.slice(1).map((to, i) => delay(net, route[i]!, to) / TICKS_PER_SECOND)).toEqual([0.5, 1, 1.5]);

    const sim = new Simulation(net);
    sim.run(37); // any moment will do
    const start = sim.tick;
    sim.stimulate(HELLO.go);
    const events = sim.run(200);
    expect(HELLO.hops.map((id) => fired(events, id).map((e) => e.tick - start))).toEqual([[30], [90], [180]]);
  });

  it('② two quick clicks send two pulses down the line, one behind the other', () => {
    const sim = new Simulation(net);
    sim.stimulate(HELLO.go);
    sim.run(10);
    sim.stimulate(HELLO.go);
    const events = sim.run(300);
    for (const id of HELLO.hops) expect(fired(events, id).map((e) => e.tick)).toHaveLength(2);
    expect(fired(events, HELLO.hops[2]).map((e) => e.tick)).toEqual([180, 190]);
  });

  it('③ the Timer fires once a second and the Digits count, carrying into tens', () => {
    const sim = new Simulation(net);
    const read = () => 10 * sim.charge(HELLO.tens) + sim.charge(HELLO.ones);
    const travel = delay(net, HELLO.clock, HELLO.ones);
    const carry = delay(net, HELLO.ones, HELLO.tens);
    // The timer fires on ticks 1, 61, 121, ...; pulse n (from 1) reaches the
    // ones Digit `travel` ticks later, and every tenth one sends a carry.
    const arrival = (n: number) => 1 + 60 * (n - 1) + travel;
    const expected = (tick: number) => {
      let ones = 0, tens = 0;
      for (let n = 1; arrival(n) <= tick; n++) {
        ones = (ones + 1) % 10;
        if (n % 10 === 0 && arrival(n) + carry <= tick) tens = (tens + 1) % 10;
      }
      return 10 * tens + ones;
    };
    expect(travel).toBe(60); // the first count lands after 1 s, then one per second
    for (const seconds of [0.5, 1, 2, 9.9, 10, 10.5, 11, 30, 61, 99.5]) {
      sim.run(Math.round(seconds * 60) - sim.tick);
      expect(read(), `${seconds}s`).toBe(expected(sim.tick));
    }
    expect(read()).toBe(99);
    sim.runSeconds(1.5);
    expect(read()).toBe(0); // 100 wraps round to 00
  });

  it('③ ignores clicks: a Timer cannot be charged', () => {
    const clicked = new Simulation(net);
    const untouched = new Simulation(net);
    clicked.run(30);
    untouched.run(30);
    for (let i = 0; i < 5; i++) clicked.stimulate(HELLO.clock);
    clicked.runSeconds(5);
    untouched.runSeconds(5);
    expect(clicked.state(HELLO.clock)!.fireCount).toBe(untouched.state(HELLO.clock)!.fireCount);
    expect(clicked.charge(HELLO.ones)).toBe(untouched.charge(HELLO.ones));
  });

  it('④ +1 adds and the Inhibitor subtracts, even below zero', () => {
    const sim = new Simulation(net);
    const settle = () => sim.run(80);
    sim.stimulate(HELLO.plus);
    sim.stimulate(HELLO.plus);
    sim.stimulate(HELLO.plus);
    settle();
    expect(sim.charge(HELLO.charge)).toBe(3);
    sim.stimulate(HELLO.minus);
    settle();
    expect(sim.charge(HELLO.charge)).toBe(2);
    for (let i = 0; i < 5; i++) sim.stimulate(HELLO.minus);
    settle();
    expect(sim.charge(HELLO.charge)).toBe(-3);
    expect(digitText(sim.charge(HELLO.charge))).toBe('-3');
    for (let i = 0; i < 3; i++) sim.stimulate(HELLO.plus);
    settle();
    expect(sim.charge(HELLO.charge)).toBe(0);
  });

  it('④ keeps an exact running total through random, overlapping clicks', () => {
    const rand = mulberry32(4);
    const sim = new Simulation(net);
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const key = rand() < 0.5 ? HELLO.plus : HELLO.minus;
      // stay below 10 so the Digit never wraps round
      if ((key === HELLO.plus && total >= 9) || (key === HELLO.minus && total <= -9)) continue;
      total += key === HELLO.plus ? 1 : -1;
      sim.stimulate(key);
      sim.run(Math.floor(rand() * 8));
    }
    sim.run(80);
    expect(sim.charge(HELLO.charge)).toBe(total);
  });

  it('⑤ ▶ plays C, E, G, C rising, evenly spaced', () => {
    const sim = new Simulation(net);
    sim.run(5);
    sim.stimulate(HELLO.play);
    const notes = sim.run(300).filter((e) => e.kind === 'note');
    expect(notes.map((e) => e.note)).toEqual([...HELLO_ARPEGGIO]);
    const gaps = notes.slice(1).map((e, i) => e.tick - notes[i]!.tick);
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]! / TICKS_PER_SECOND).toBeGreaterThan(0.5);
    expect(gaps[0]! / TICKS_PER_SECOND).toBeLessThan(0.6);
  });

  it('⑥ the Random neuron sends every pulse one way only, about half each way', () => {
    const sim = new Simulation(net);
    const count = (ids: readonly string[]) => ids.reduce((n, id) => 10 * n + sim.charge(id), 0);
    const events = sim.runSeconds(90);
    const flips = fired(events, HELLO.coin).length;
    expect(flips).toBe(fired(events, HELLO.coinTimer).length - 1); // two a second; the last is still on its way
    expect(flips).toBe(179);
    // Stop the timer feeding new flips, then let the last ones land.
    const quiet = { ...net, connections: net.connections.filter((c) => c.from !== HELLO.coinTimer) };
    sim.load(quiet);
    sim.runSeconds(3);
    const heads = count(HELLO.heads), tails = count(HELLO.tails);
    expect(heads + tails).toBe(flips);
    expect(heads / flips).toBeGreaterThan(0.4);
    expect(heads / flips).toBeLessThan(0.6);
  });

  it('⑥ the coin counters have room for a long visit: no wrap round in 10 minutes', () => {
    const sim = new Simulation(net);
    const count = (ids: readonly string[]) => ids.reduce((n, id) => 10 * n + sim.charge(id), 0);
    const flips = fired(sim.runSeconds(600), HELLO.coin).length;
    sim.load({ ...net, connections: net.connections.filter((c) => c.from !== HELLO.coinTimer) });
    sim.runSeconds(3);
    // Over 500 a side, and nothing lost: a two-digit counter would have wrapped.
    expect(count(HELLO.heads) + count(HELLO.tails)).toBe(flips);
    expect(Math.min(count(HELLO.heads), count(HELLO.tails))).toBeGreaterThan(500);
  });

  it('⑤ clicking ▶ again mid-tune sends a second run of notes close behind the first', () => {
    const sim = new Simulation(net);
    sim.stimulate(HELLO.play);
    sim.run(40);
    sim.stimulate(HELLO.play);
    const notes = sim.run(400).filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(8);
    for (const midi of HELLO_ARPEGGIO) {
      const ticks = notes.filter((e) => e.note === midi).map((e) => e.tick);
      expect(ticks[1]! - ticks[0]!, `note ${midi}`).toBe(40); // each note plays twice, 40 ticks apart
    }
  });

  it('runs on its own without touching the click-me circuits', () => {
    const sim = new Simulation(net);
    const events = sim.runSeconds(180);
    const quiet = [HELLO.clickMe, HELLO.fires, HELLO.go, ...HELLO.hops, HELLO.plus, HELLO.minus, HELLO.charge, HELLO.play, ...HELLO.notes];
    for (const id of quiet) {
      expect(fired(events, id), id).toHaveLength(0);
      expect(sim.charge(id), id).toBe(0);
    }
    expect(fired(events, HELLO.clock).length).toBe(180);
  });

  it('demo: three captioned clicks make the first neuron fire once', () => {
    const sim = new Simulation(net);
    scheduleDemo(sim, hello.demo!);
    sim.runSeconds(2.5);
    expect(sim.charge(HELLO.clickMe)).toBe(2);
    expect(demoCaptionAt(hello.demo!, 2.5)).toMatch(/2 charge/);
    sim.runSeconds(1);
    expect(sim.charge(HELLO.clickMe)).toBe(0);
    expect(demoCaptionAt(hello.demo!, 3.5)).toMatch(/fires/);
    sim.runSeconds(2);
    expect(sim.charge(HELLO.fires)).toBe(1);
    // the demo leaves the click-me circuits for the visitor
    expect(new Set(hello.demo!.map((s) => s.neuron))).toEqual(new Set([HELLO.clickMe]));
  });

  it('after the demo, six more clicks (on consecutive ticks) add 2 to the Digit, as tryThis says', () => {
    const sim = new Simulation(net);
    scheduleDemo(sim, hello.demo!);
    sim.runSeconds(6);
    expect(sim.charge(HELLO.fires)).toBe(1);
    for (let i = 0; i < 6; i++) {
      sim.stimulate(HELLO.clickMe);
      sim.step();
    }
    sim.runSeconds(2);
    expect(sim.charge(HELLO.fires)).toBe(3);
    expect(sim.charge(HELLO.clickMe)).toBe(0);
  });

  it('demo replays identically after a reset, even after the visitor has clicked around', () => {
    const sim = new Simulation(net);
    const trace = () => {
      scheduleDemo(sim, hello.demo!);
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        sim.runSeconds(0.5);
        out.push(`${sim.charge(HELLO.clickMe)}/${sim.charge(HELLO.fires)}`);
      }
      return out;
    };
    const first = trace();
    for (const id of [HELLO.clickMe, HELLO.go, HELLO.minus, HELLO.play, HELLO.clickMe]) sim.stimulate(id);
    sim.runSeconds(3);
    sim.reset();
    expect(trace()).toEqual(first);
    expect(first.at(-1)).toBe('0/1');
  });

  it('keeps its six circuits separate: no connection crosses between panels', () => {
    const panelOf = (id: string) => {
      const n = net.neurons.find((m) => m.id === id)!;
      return `${Math.floor(n.x / 15)},${n.y < 12 ? 0 : 1}`;
    };
    for (const c of net.connections) expect(panelOf(c.from), `${c.from} -> ${c.to}`).toBe(panelOf(c.to));
    expect(new Set(net.neurons.map((n) => panelOf(n.id))).size).toBe(6);
  });
});

// ---- Flip-flop memory ---------------------------------------------------------

describe('flip-flop memory', () => {
  const net = flipFlop.network;
  const F = FLIP_FLOP;
  const isLoop = (from: string, to: string) => (F.loop as readonly string[]).includes(from) && (F.loop as readonly string[]).includes(to);
  const loopPulses = (sim: Simulation) => sim.pulses().filter((p) => isLoop(p.from, p.to)).length;

  /** A memory that has powered on (and optionally been set). */
  function memory(bit: 0 | 1 = 0, seed = 1): Simulation {
    const sim = new Simulation(net, { seed });
    sim.runSeconds(2);
    if (bit) {
      sim.stimulate(F.set);
      sim.runSeconds(6);
    }
    return sim;
  }

  /**
   * The settled state: one hole shared by the gates, no charge left in the
   * loop, and as many pulses bouncing as the display says. Returns the bit.
   */
  function bit(sim: Simulation): number {
    const g = sim.charge(F.setGate), r = sim.charge(F.resetGate), shown = sim.charge(F.bit);
    expect(shown === 0 || shown === 1, `display shows ${shown}`).toBe(true);
    expect([g, r]).toEqual(shown ? [-1, 0] : [0, -1]);
    expect([sim.charge(F.loop[0]), sim.charge(F.loop[1])]).toEqual([0, 0]);
    expect(loopPulses(sim)).toBe(shown);
    return shown;
  }

  /** Step, checking at every tick that the loop never holds two pulses and the display only shows 0 or 1. */
  function watch(sim: Simulation, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      const pulses = loopPulses(sim), shown = sim.charge(F.bit);
      if (pulses > 1 || (shown !== 0 && shown !== 1)) throw new Error(`tick ${sim.tick}: ${pulses} loop pulses, display ${shown}`);
    }
  }

  it('powers on at 0 with an empty loop', () => {
    const sim = new Simulation(net);
    sim.runSeconds(2);
    expect(bit(sim)).toBe(0);
    expect(sim.state(F.power)!.fireCount).toBe(1);
  });

  it('keys work from the very first tick, before power-on has finished', () => {
    for (const key of [F.set, F.reset]) {
      for (let tick = 0; tick < 90; tick++) {
        const sim = new Simulation(net);
        sim.run(tick);
        sim.stimulate(key);
        watch(sim, 400);
        expect(bit(sim), `${key} at tick ${tick}`).toBe(key === F.set ? 1 : 0);
      }
    }
  });

  it('presses reach their gate as +1 then −1 in the same tick', () => {
    for (const [key, plus, minus, gate] of [[F.set, F.setPlus, F.setMinus, F.setGate], [F.reset, F.resetPlus, F.resetMinus, F.resetGate]] as const) {
      expect(delay(net, key, plus) + delay(net, plus, gate)).toBe(delay(net, key, minus) + delay(net, minus, gate));
      // the relay is wired first, so its +1 is created (and delivered) first
      const targets = new Simulation(net).targets(key);
      expect(targets.indexOf(plus)).toBeLessThan(targets.indexOf(minus));
    }
    // So a closed gate never shows a charge of 0 between ticks, even mid-press.
    const sim = memory(1);
    for (let i = 0; i < 300; i++) {
      if (i % 7 === 0) sim.stimulate(F.set);
      sim.step();
      expect(sim.charge(F.setGate)).toBe(-1);
    }
  });

  it('all four transitions work, and repeats change nothing', () => {
    const sim = memory(0);
    const gateFires = () => sim.state(F.setGate)!.fireCount + sim.state(F.resetGate)!.fireCount;

    sim.stimulate(F.set); // 0 -> 1
    sim.runSeconds(5);
    expect(bit(sim)).toBe(1);
    expect(gateFires()).toBe(1);

    sim.stimulate(F.set); // 1 -> 1
    sim.runSeconds(5);
    expect(bit(sim)).toBe(1);
    expect(gateFires()).toBe(1);

    sim.stimulate(F.reset); // 1 -> 0
    sim.runSeconds(5);
    expect(bit(sim)).toBe(0);
    expect(gateFires()).toBe(2);

    sim.stimulate(F.reset); // 0 -> 0
    sim.runSeconds(5);
    expect(bit(sim)).toBe(0);
    expect(gateFires()).toBe(2);

    sim.stimulate(F.set); // and SET still works first time
    sim.runSeconds(5);
    expect(bit(sim)).toBe(1);
  });

  it('holds a 1 forever: one pulse, a steady display, one lap every 1.5 seconds', () => {
    const sim = memory(1);
    const before = sim.state(F.loop[0])!.fireCount;
    for (let i = 0; i < 120 * 60; i++) {
      sim.step();
      expect(loopPulses(sim)).toBe(1);
      expect(sim.charge(F.bit)).toBe(1);
    }
    const lap = 2 * delay(net, F.loop[0], F.loop[1]);
    expect(lap).toBe(1.5 * TICKS_PER_SECOND);
    expect(sim.state(F.loop[0])!.fireCount - before).toBe(80);
  });

  it('SET and RST work at every moment of the bounce', () => {
    const lap = 2 * delay(net, F.loop[0], F.loop[1]);
    for (let phase = 0; phase < lap; phase++) {
      const sim = memory(1);
      sim.run(phase);
      sim.stimulate(F.reset);
      watch(sim, 300);
      expect(bit(sim), `RST at phase ${phase}`).toBe(0);
      sim.run(phase);
      sim.stimulate(F.set);
      watch(sim, 300);
      expect(bit(sim), `SET at phase ${phase}`).toBe(1);
    }
  });

  it('hammering one key never adds a second pulse or leaves charge behind', () => {
    for (const key of [F.set, F.reset]) {
      for (const start of [0, 1] as const) {
        for (let gap = 0; gap <= 40; gap++) {
          const sim = memory(start);
          for (let i = 0; i < 6; i++) {
            sim.stimulate(key);
            watch(sim, gap);
          }
          watch(sim, 360);
          expect(bit(sim), `${key} x6, ${gap} ticks apart, from ${start}`).toBe(key === F.set ? 1 : 0);
        }
      }
    }
  });

  it('opposite presses at least half a second apart always land in order', () => {
    // Every pair of presses, from both states, at every gap from 30 ticks to 3.5 s.
    for (const start of [0, 1] as const) {
      for (const first of [F.set, F.reset]) {
        for (const second of [F.set, F.reset]) {
          for (let gap = 30; gap <= 210; gap++) {
            const sim = memory(start);
            sim.stimulate(first);
            sim.run(gap);
            sim.stimulate(second);
            sim.runSeconds(6);
            expect(bit(sim), `${first} then ${second} ${gap} ticks later, from ${start}`).toBe(second === F.set ? 1 : 0);
          }
        }
      }
    }
  });

  it('random press sequences: always a clean 0 or 1, and the last press wins when presses are ≥ ½ s apart', () => {
    const rand = mulberry32(2026);
    for (let run = 0; run < 300; run++) {
      const sim = memory(rand() < 0.5 ? 0 : 1);
      const slow = run % 2 === 0; // half the runs keep presses >= 30 ticks apart
      let last: string = F.reset;
      const presses = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < presses; i++) {
        last = rand() < 0.5 ? F.set : F.reset;
        sim.stimulate(last);
        watch(sim, slow ? 30 + Math.floor(rand() * 90) : Math.floor(rand() * 40));
      }
      watch(sim, 400);
      const result = bit(sim);
      if (slow) expect(result, `run ${run}`).toBe(last === F.set ? 1 : 0);
    }
  });

  it('within half a second, the first press that changes the bit wins', () => {
    for (const start of [0, 1] as const) {
      for (const first of [F.set, F.reset]) {
        for (const second of [F.set, F.reset]) {
          const firstChanges = (first === F.set ? 1 : 0) !== start;
          const want = firstChanges ? (first === F.set ? 1 : 0) : second === F.set ? 1 : 0;
          for (let gap = 0; gap < 30; gap++) {
            const sim = memory(start);
            sim.stimulate(first);
            sim.run(gap);
            sim.stimulate(second);
            watch(sim, 360);
            expect(bit(sim), `${first} then ${second} ${gap} ticks later, from ${start}`).toBe(want);
          }
        }
      }
    }
  });

  it('ignores an opposite press that comes less than half a second after a change', () => {
    const sim = memory(0);
    sim.stimulate(F.set);
    sim.run(20);
    sim.stimulate(F.reset); // too soon: the RST gate has not heard about the SET yet
    sim.runSeconds(6);
    expect(bit(sim)).toBe(1);
    sim.stimulate(F.reset); // pressed again later, it works
    sim.runSeconds(6);
    expect(bit(sim)).toBe(0);
  });

  it('a pulse sneaked into the loop by hand is beyond the keys', () => {
    const sim = memory(1);
    sim.stimulate(F.loop[0]);
    sim.runSeconds(3);
    expect(loopPulses(sim)).toBe(2);
    for (let i = 0; i < 3; i++) {
      sim.stimulate(F.reset);
      sim.runSeconds(6);
      expect(loopPulses(sim)).toBe(1);
      sim.stimulate(F.reset); // the gates already say 0, so this is ignored
      sim.runSeconds(6);
      expect(loopPulses(sim)).toBe(1);
      sim.stimulate(F.set);
      sim.runSeconds(6);
      expect(loopPulses(sim)).toBe(2);
    }
  });

  it('triples of presses, from power-on or later, at every gap on a grid: always clean', () => {
    for (const start of [0, 45, 120]) {
      for (const k1 of [F.set, F.reset]) for (const k2 of [F.set, F.reset]) for (const k3 of [F.set, F.reset]) {
        for (let g1 = 0; g1 <= 100; g1 += 3) {
          for (let g2 = 0; g2 <= 100; g2 += 4) {
            const sim = new Simulation(net);
            sim.run(start);
            sim.stimulate(k1);
            watch(sim, g1);
            sim.stimulate(k2);
            watch(sim, g2);
            sim.stimulate(k3);
            watch(sim, 420);
            bit(sim);
          }
        }
      }
    }
  });

  it('presses made while the demo plays still leave a clean 0 or 1', () => {
    const rand = mulberry32(5);
    for (let run = 0; run < 60; run++) {
      const sim = new Simulation(net);
      scheduleDemo(sim, flipFlop.demo!);
      for (let t = 0; t < 36 * TICKS_PER_SECOND; t++) {
        if (rand() < 0.01) sim.stimulate(rand() < 0.5 ? F.set : F.reset);
        watch(sim, 1);
      }
      watch(sim, 420);
      bit(sim);
    }
  });

  it('the left loop neuron, clicked by hand, shows on the display and cannot be cleared', () => {
    const sim = memory(0);
    sim.stimulate(F.loop[0]);
    sim.runSeconds(1);
    for (let i = 0; i < 6 * TICKS_PER_SECOND; i++) {
      sim.step();
      expect(sim.charge(F.bit)).toBe(1);
    }
    sim.stimulate(F.reset); // the gates say 0 already: ignored
    sim.runSeconds(6);
    expect(loopPulses(sim)).toBe(1);
    expect(sim.charge(F.bit)).toBe(1);
  });

  it('demo: SET, SET, RST, RST, SET with the display following along', () => {
    const sim = new Simulation(net);
    scheduleDemo(sim, flipFlop.demo!);
    const expectAt = [1, 1, 0, 0, 1];
    flipFlop.demo!.forEach((step, i) => {
      const next = flipFlop.demo![i + 1]?.at ?? step.at + 5;
      sim.run(Math.round((next - 0.1) * TICKS_PER_SECOND) - sim.tick);
      expect(bit(sim), step.caption).toBe(expectAt[i]);
      expect(demoCaptionAt(flipFlop.demo!, next - 0.1)).toBe(step.caption);
    });
    expect(sim.state(F.setGate)!.fireCount).toBe(2);
    expect(sim.state(F.resetGate)!.fireCount).toBe(1);
  });

  it('demo: each change shows on the display well before the next caption', () => {
    // At least 3.5 simulated seconds (1.75 s at the suggested 2x) to see it.
    const sim = new Simulation(net);
    scheduleDemo(sim, flipFlop.demo!);
    const changes: number[] = [];
    let shown = sim.charge(F.bit);
    for (let t = 0; t < 36 * TICKS_PER_SECOND; t++) {
      sim.step();
      if (sim.charge(F.bit) !== shown) changes.push(sim.tick / TICKS_PER_SECOND);
      shown = sim.charge(F.bit);
    }
    const steps = flipFlop.demo!;
    expect(changes).toHaveLength(3); // SET, RST, SET; the repeats change nothing
    for (const [i, at] of [[0, changes[0]!], [2, changes[1]!], [4, changes[2]!]] as const) {
      expect(at).toBeGreaterThan(steps[i]!.at);
      const next = steps[i + 1]?.at ?? Infinity;
      expect(next - at, `step ${i}`).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('demo replays identically after a reset', () => {
    const sim = new Simulation(net);
    const trace = () => {
      scheduleDemo(sim, flipFlop.demo!);
      const out: number[] = [];
      for (let i = 0; i < 36; i++) {
        sim.runSeconds(1);
        out.push(sim.charge(F.bit));
      }
      return out.join('');
    };
    const first = trace();
    sim.stimulate(F.reset);
    sim.stimulate(F.loop[0]);
    sim.runSeconds(2);
    sim.reset();
    expect(trace()).toBe(first);
  });
});

// ---- Galton board ---------------------------------------------------------------

describe('galton board', () => {
  const net = galton.network;
  const bins = (sim: Simulation) => Array.from({ length: GALTON_ROWS + 1 }, (_, i) => 10 * sim.charge(galtonBin(i, 'tens')) + sim.charge(galtonBin(i, 'ones')));
  const droppedCount = (sim: Simulation) => GALTON_DROPPED.reduce((n, id) => 10 * n + sim.charge(id), 0);

  it('every ball falls the same distance, so balls never overtake each other', () => {
    const pegHops = net.connections.filter((c) => c.from.startsWith('peg-')).map((c) => delay(net, c.from, c.to));
    expect(new Set(pegHops).size).toBe(1);
    expect(pegHops.length).toBe(GALTON_ROWS * (GALTON_ROWS + 1)); // two ways out of every peg
  });

  it('drops 256 balls and every one lands in exactly one bin (seed 1)', () => {
    const sim = new Simulation(net);
    const ticks = sim.runUntilIdle();
    expect(ticks / TICKS_PER_SECOND).toBeLessThan(80);
    expect(droppedCount(sim)).toBe(GALTON_BALLS);
    const counts = bins(sim);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GALTON_BALLS);
    expect(counts).toEqual([2, 7, 30, 59, 66, 58, 24, 10, 0]);
  });

  it('the middle bins dominate, as in row 8 of Pascal\'s triangle', () => {
    const sim = new Simulation(net);
    sim.runUntilIdle();
    const counts = bins(sim);
    const middle = counts[3]! + counts[4]! + counts[5]!;
    expect(Math.max(...counts)).toBe(counts[4]);
    expect(middle / GALTON_BALLS).toBeGreaterThan(0.6);
    expect(counts[0]! + counts[8]!).toBeLessThan(5);
  });

  it('over many seeds: totals always add up, no bin overflows, and the average is Pascal\'s row', () => {
    const pascal = [1, 8, 28, 56, 70, 56, 28, 8, 1];
    const sums = new Array(GALTON_ROWS + 1).fill(0);
    const seeds = 40;
    for (let seed = 1; seed <= seeds; seed++) {
      const sim = new Simulation(net, { seed });
      sim.runUntilIdle();
      const counts = bins(sim);
      expect(counts.reduce((a, b) => a + b, 0), `seed ${seed}`).toBe(GALTON_BALLS);
      expect(Math.max(...counts), `seed ${seed}`).toBeLessThan(100);
      counts.forEach((c, i) => (sums[i] += c));
    }
    sums.forEach((s, i) => expect(Math.abs(s / seeds - pascal[i]!), `bin ${i}`).toBeLessThan(4));
    // and the "≈" labels under the bins say the same
    const labels = (net.texts ?? []).filter((t) => t.text.startsWith('≈')).map((t) => Number(t.text.slice(1)));
    expect(labels).toEqual(pascal);
  });

  it('each bin mouth plays its note when a ball arrives', () => {
    const sim = new Simulation(net);
    const notes = sim.runSeconds(90).filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(GALTON_BALLS);
    expect(new Set(notes.map((e) => e.note)).size).toBeGreaterThanOrEqual(8);
  });
});

// ---- Fireworks ------------------------------------------------------------------

describe('fireworks', () => {
  const net = fireworks.network;
  const sparks = (name: string, ring: 'spark' | 'ember') => net.neurons.filter((n) => n.id.startsWith(`${name}-${ring}-`)).map((n) => n.id);

  /** Run, then cut the fuse and let every rocket in the air finish. */
  function show(seconds: number, seed = 1): { sim: Simulation; events: FireEvent[] } {
    const sim = new Simulation(net, { seed });
    const events = sim.runSeconds(seconds);
    sim.load({ ...net, connections: net.connections.filter((c) => c.from !== 'fuse-timer') });
    events.push(...sim.runSeconds(15));
    return { sim, events };
  }

  it('every fuse launches exactly one rocket, and every bang lights each of its 14 sparks once', () => {
    const { sim, events } = show(60);
    const launches = fired(events, 'launcher').length;
    expect(launches).toBe(60); // one a second (the fuse lit at the cut is put out)
    let bangs = 0;
    for (const f of FIREWORKS) {
      const bang = fired(events, `${f.name}-bang`);
      expect(bang.every((e) => e.note === f.note)).toBe(true);
      bangs += bang.length;
      const all = [...sparks(f.name, 'spark'), ...sparks(f.name, 'ember')];
      expect(all).toHaveLength(14);
      for (const id of all) expect(sim.state(id)!.fireCount, id).toBe(bang.length);
    }
    expect(bangs).toBe(launches);
  });

  it('bursts are round: each ring of sparks lights up within 1/15 s', () => {
    const { events } = show(30);
    for (const f of FIREWORKS) {
      const bangTicks = fired(events, `${f.name}-bang`).map((e) => e.tick);
      const firstBang = bangTicks[0]!;
      for (const ring of ['spark', 'ember'] as const) {
        const ticks = sparks(f.name, ring).map((id) => fired(events, id)[0]!.tick - firstBang);
        expect(Math.max(...ticks) - Math.min(...ticks), `${f.name} ${ring}s`).toBeLessThanOrEqual(TICKS_PER_SECOND / 15);
      }
    }
  });

  it('the Random launcher shares the launches between all three rockets', () => {
    const { events } = show(180, 7);
    const launches = fired(events, 'launcher').length;
    for (const f of FIREWORKS) {
      const share = fired(events, `${f.name}-bang`).length / launches;
      expect(share, f.name).toBeGreaterThan(0.25);
      expect(share, f.name).toBeLessThan(0.42);
    }
  });
});

// ---- Layout ---------------------------------------------------------------------

describe('basics layout', () => {
  for (const example of [hello, flipFlop, galton, fireworks]) {
    it(`${example.id} is compact, and no line passes through or near another neuron`, () => {
      const b = networkBounds(example.network);
      expect(b.maxX - b.minX).toBeLessThanOrEqual(45);
      expect(b.maxY - b.minY).toBeLessThanOrEqual(28);
      const pass = closestPass(example.network);
      expect(pass.distance, pass.what).toBeGreaterThanOrEqual(1);
    });

    it(`${example.id} has no text drawn over a neuron`, () => {
      expect(textsOverNeurons(example.network)).toEqual([]);
    });
  }
});

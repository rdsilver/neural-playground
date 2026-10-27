import { NetworkBuilder } from '../engine';

/**
 * Control unit of the Neural Snake: four direction keys, a two-bit
 * direction register (AXIS and SIGN flip-flops), a synchronous read-out
 * and a 2-to-4 decoder that fires exactly one direction strobe per frame.
 * See buildControl() for the public API and the frame schedule.
 */

export interface Cell {
  x: number;
  y: number;
}

/** Placement of a block: local (x, y) -> absolute cell, optionally mirrored. */
export interface Place {
  x0: number;
  y0: number;
  sx: 1 | -1;
}
const at = (f: Place, x: number, y: number): Cell => ({ x: f.x0 + f.sx * x, y: f.y0 + y });

/** Neuron ids of one bit (flip-flop + register). */
export interface BitIds {
  /** Fire to SET the bit (store 1). Keys connect here. */
  setSource: string;
  /** Fire to RESET the bit (store 0). Keys connect here. */
  resetSource: string;
  setGate: string;
  resetGate: string;
  /** The -1 half of RST's pair: power-on pokes it once to dig the first hole. */
  resetMinus: string;
  /** Register: threshold 2, its charge IS the bit (0 or 1) between reads. */
  register: string;
  /** Read pair source: fire it so its +1/-1 pair lands on the register at the read tick. */
  readSource: string;
  /** Relay from the read source to the register (+1 half of the pair). */
  readPlus: string;
  /** Inhibitor driven by the register: sends -1 wherever the bit means "not this rail". */
  registerMinus: string;
}

/**
 * One bit. The flip-flop is the hole-gate design of basics.ts: two gates
 * share one "hole" of -1 charge, so repeated presses are ignored and only
 * real changes get through. Each change lands on the register G
 * (threshold 2): SET adds +1 (straight from the SET gate), RST adds -1
 * (through an Inhibitor). So G's charge is the bit itself.
 *
 * Reading G without destroying it: a tight +1/-1 pair lands on G. If G
 * holds 1, the +1 makes 2 and G fires; the -1 leaves -1 and two restore
 * relays add +2, back to 1. If G holds 0, the pair just adds up to 0.
 *
 * Local layout (x right, y down; the SIGN bit is mirrored left-right):
 *
 *        x: 0     1     2     3
 *   y=-2              Sc              read pair: Sc -> Pc, Mc -> G
 *   y=-1        Mc    Gm    Pc        Gm: G's Inhibitor (the "bit is 1" -1 rail)
 *   y= 0  Sr    Pr    G     R1
 *   y= 1  Mr    RST   Ir    R2        Ir: RST's -1 onto G; R1, R2 restore G
 *   y= 2  Ms    SET
 *   y= 3  Ss    Ps
 */
export function buildBit(b: NetworkBuilder, f: Place, name: string): BitIds {
  const id = (s: string) => `${name}-${s}`;
  const n = (s: string, x: number, y: number, threshold = 1, label?: string) => {
    const c = at(f, x, y);
    return b.normal(c.x, c.y, threshold, { id: id(s), ...(label ? { label } : {}) });
  };
  const inh = (s: string, x: number, y: number, label = '−1') => {
    const c = at(f, x, y);
    return b.inhibitor(c.x, c.y, 1, { id: id(s), label });
  };
  // Flip-flop: two hole gates, each fed by a tight pair square (basics.ts).
  const resetSource = n('reset', 0, 0, 1, 'RST');
  const resetPlus = n('reset-plus', 1, 0, 1, '+1');
  const resetMinus = inh('reset-minus', 0, 1);
  const resetGate = n('reset-gate', 1, 1);
  const setMinus = inh('set-minus', 0, 2);
  const setGate = n('set-gate', 1, 2);
  const setSource = n('set', 0, 3, 1, 'SET');
  const setPlus = n('set-plus', 1, 3, 1, '+1');
  b.connect(resetSource, [resetPlus, resetMinus]).connect(resetPlus, resetGate).connect(resetMinus, resetGate);
  b.connect(setSource, [setPlus, setMinus]).connect(setPlus, setGate).connect(setMinus, setGate);
  b.both(setGate, resetGate);

  // Register. SET's +1 takes 34 ticks, RST's -1 takes 30 (15 + 15): a RST
  // always lands before a following SET (at least 15 + 34 ticks later), so
  // G only ever sees +1, -1, +1, ... and its charge stays 0 or 1.
  const g = n('register', 2, 0, 2, 'G');
  const ir = inh('reset-register', 2, 1);
  b.connect(setGate, g).connect(resetGate, ir).connect(ir, g);

  // Read pair (a diagonal square: 22 ticks per side) and restore relays.
  // On a tie at the read tick, SET's +1 (sent 34 ticks earlier) lands
  // before the pair and counts now; RST's -1 (sent 15 ticks earlier) lands
  // after it and counts at the next read. Either way G stays consistent.
  const readSource = n('read', 2, -2);
  const readPlus = n('read-plus', 3, -1);
  const readMinus = inh('read-minus', 1, -1);
  b.connect(readSource, [readPlus, readMinus]).connect(readPlus, g).connect(readMinus, g);
  const r1 = n('restore-1', 3, 0);
  const r2 = n('restore-2', 3, 1);
  b.connect(g, [r1, r2]).connect(r1, g).connect(r2, g);

  const gm = inh('register-minus', 2, -1);
  b.connect(g, gm);
  return { setSource, resetSource, setGate, resetGate, resetMinus, register: g, readSource, readPlus, registerMinus: gm };
}

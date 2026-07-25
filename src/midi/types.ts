/**
 * Minimal structural types for the Web MIDI API.
 *
 * These are declared locally rather than pulled from lib.dom so the project
 * type-checks the same way on every TypeScript version — Web MIDI moved in and
 * out of the DOM lib across releases, and a global re-declaration would clash
 * wherever it already exists.
 */
export interface MidiMessageLike {
  data: Uint8Array | null;
  timeStamp: number;
}

export interface MidiPortLike {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: 'connected' | 'disconnected';
  type: 'input' | 'output';
}

export interface MidiInputLike extends MidiPortLike {
  onmidimessage: ((e: MidiMessageLike) => void) | null;
}

export interface MidiAccessLike {
  inputs: ReadonlyMap<string, MidiInputLike>;
  onstatechange: ((e: { port: MidiPortLike | null }) => void) | null;
}

export type MidiSupport = 'unknown' | 'unsupported' | 'denied' | 'ready';

/** How raw MIDI numbers are turned into pad/knob indices 0..7. */
export interface MidiMapping {
  /** Note number of pad 1. LPD8 mk2 program 1 sends 36..43. */
  padBaseNote: number;
  /** CC number of knob 1. LPD8 mk2 program 1 sends 70..77. */
  knobBaseCc: number;
  /**
   * When a note or CC arrives outside the configured range, adopt it anyway by
   * handing it the next free slot. Keeps the site usable on a controller whose
   * programs have been remapped without making anyone open a settings panel.
   */
  adopt: boolean;
}

export const DEFAULT_MAPPING: MidiMapping = {
  padBaseNote: 36,
  knobBaseCc: 70,
  adopt: true,
};

export const PAD_COUNT = 8;
export const KNOB_COUNT = 8;

export interface PadState {
  /** True while the pad is held down. */
  down: boolean;
  /** Velocity of the most recent hit, 0..1. */
  velocity: number;
  /**
   * Decaying excitement, 0..1. Jumps to the hit velocity and falls off over
   * roughly a second, which is what most sketches actually want to draw.
   */
  energy: number;
  /** Total hits since the page loaded. */
  hits: number;
  /** performance.now() of the most recent hit. */
  lastHitAt: number;
}

export interface PadHit {
  pad: number;
  velocity: number;
  /** performance.now() of the hit. */
  at: number;
}

/** What a sketch sees each frame. */
export interface MidiFrame {
  pads: readonly PadState[];
  /** Knob positions, 0..1. */
  knobs: readonly number[];
  /** Hits that landed since the previous frame, oldest first. */
  hits: readonly PadHit[];
  /** True when a real controller is connected (as opposed to on-screen input). */
  live: boolean;
}

export interface MidiLogEntry {
  id: number;
  at: number;
  kind: 'note-on' | 'note-off' | 'cc' | 'other';
  channel: number;
  a: number;
  b: number;
  /** Slot this message was routed to, or -1 when it was ignored. */
  slot: number;
  source: string;
}

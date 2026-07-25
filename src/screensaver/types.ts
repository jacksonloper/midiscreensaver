import type { MidiFrame } from '../midi/types';

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels — the context is already scaled for devicePixelRatio. */
  width: number;
  height: number;
  /** Seconds since the sketch started. */
  time: number;
  /** Seconds since the previous frame, clamped to avoid post-tab-switch jumps. */
  dt: number;
  midi: MidiFrame;
}

export interface Sketch {
  /** Called once, and again whenever the canvas is resized. */
  setup?: (c: Omit<DrawContext, 'time' | 'dt' | 'midi'>) => void;
  draw: (c: DrawContext) => void;
}

export type SketchFactory = () => Sketch;

export interface KnobSpec {
  label: string;
  /** Where the knob sits before anyone touches it, 0..1. */
  default: number;
}

export interface PadSpec {
  /** One line describing what hitting this pad does. */
  label: string;
}

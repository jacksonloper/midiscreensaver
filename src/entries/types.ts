import type { ReactNode } from 'react';
import type { KnobSpec, PadSpec, SketchFactory } from '../screensaver/types';

export interface Entry {
  slug: string;
  title: string;
  /** ISO date, used for ordering and the byline. */
  date: string;
  /** One-sentence summary for the index page. */
  dek: string;
  tags: string[];
  /** Exactly eight, left to right, matching the LPD8's knob row. */
  knobs: KnobSpec[];
  /** Exactly eight, in LPD8 pad order (top row is pads 5-8 on the hardware). */
  pads: PadSpec[];
  factory: SketchFactory;
  /** The prose half of the post. */
  body: ReactNode;
}

export const knobDefaults = (entry: Entry): number[] => entry.knobs.map((k) => k.default);

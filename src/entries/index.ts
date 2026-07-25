import { chromaRain } from './chroma-rain';
import { orbitalChoir } from './orbital-choir';
import { pulseLattice } from './pulse-lattice';
import { strandWeave } from './strand-weave';
import type { Entry } from './types';

/** Newest first — this is the order the index page shows. */
export const entries: Entry[] = [chromaRain, strandWeave, orbitalChoir, pulseLattice].sort(
  (a, b) => b.date.localeCompare(a.date),
);

export const entryBySlug = (slug: string | undefined): Entry | undefined =>
  entries.find((e) => e.slug === slug);

export type { Entry };

import type { Entry } from '../types';
import { createPulseLattice } from './sketch';

export const pulseLattice: Entry = {
  slug: 'pulse-lattice',
  title: 'Pulse Lattice',
  date: '2026-03-02',
  dek: 'A grid of dots that only knows one thing: how far it is from the edge of a wave.',
  tags: ['grid', 'waves', 'first post'],
  knobs: [
    { label: 'Cell size', default: 0.45 },
    { label: 'Wave speed', default: 0.28 },
    { label: 'Band width', default: 0.42 },
    { label: 'Trail length', default: 0.55 },
    { label: 'Hue', default: 0.0 },
    { label: 'Dot size', default: 0.4 },
    { label: 'Warp', default: 0.35 },
    { label: 'Idle drift', default: 0.3 },
  ],
  pads: Array.from({ length: 8 }, (_, i) => ({
    label: `Ring from anchor ${i + 1}`,
  })),
  factory: createPulseLattice,
  body: (
    <>
      <p>
        The first one had to be the simplest thing that still felt like something. Every dot in the
        lattice asks one question each frame — <em>how far am I from the edge of a passing wave?</em>{' '}
        — and answers it with brightness, size, and a small shove outward. There is no simulation
        underneath. Nothing is conserved. The rings are just numbers growing at a constant rate, and
        the picture is a distance function wearing a costume.
      </p>
      <p>
        Each of the eight pads owns an anchor point, laid out in the same four-by-two arrangement as
        the pads themselves, so hitting the bottom-left pad drops a ring into the bottom-left of the
        screen. Velocity matters: a hard hit makes a ring with more push behind it, and the dots lean
        further out of line as the front goes by.
      </p>
      <p>
        The knob I keep coming back to is <strong>Warp</strong>. At zero the lattice stays perfectly
        rectilinear and the waves read as light passing over a grid. Past halfway the dots start
        genuinely fleeing the wavefront, and the grid stops looking like a grid and starts looking
        like fabric. Turn <strong>Band width</strong> up at the same time and single hits become slow
        pressure waves rather than sharp rings.
      </p>
      <p>
        Sustained chords are worth trying even though nothing here is tonal. Four pads at once puts
        four expanding circles into the field, and where two wavefronts cross, the brightness adds.
        Those intersections trace out hyperbolas as the rings grow, which is the sort of thing you
        get for free when you build something out of distances.
      </p>
    </>
  ),
};

import type { Entry } from '../types';
import { createPulseLattice } from './sketch';

export const pulseLattice: Entry = {
  slug: 'pulse-lattice',
  title: 'Waves through a grid of dots',
  date: '2026-03-02',
  dek: 'Each pad drops an expanding ring into a grid of dots. Every dot asks how far it is from the nearest wavefront.',
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
        Each pad drops an expanding ring into the grid from its own anchor point. The anchors are
        arranged like the pads themselves, so the bottom-left pad drops its ring into the bottom-left
        of the screen, and a harder hit gives the ring more push.
      </p>
      <p>
        Every dot does one calculation per frame: how far it is from the edge of a passing wave. That
        distance sets its brightness, its size, and how far it is shoved outward. Nothing is being
        simulated — the rings are radii growing at a constant rate.
      </p>
      <p>
        <strong>Warp</strong> changes the character most. At zero the grid stays square and the waves
        read as light passing over it. Past halfway the dots move out of the way of the wavefront and
        the grid reads as fabric. Turn <strong>Band width</strong> up as well and a hit becomes a slow
        pressure wave rather than a sharp ring.
      </p>
      <p>
        Try several pads at once. Where two wavefronts cross, the brightness adds, and the crossing
        points trace out hyperbolas as the rings grow.
      </p>
    </>
  ),
};

import type { Entry } from '../types';
import { createOrbitalChoir } from './sketch';

export const orbitalChoir: Entry = {
  slug: 'orbital-choir',
  title: 'Orbital Choir',
  date: '2026-04-18',
  dek: 'Eight bodies on eight harmonics, kicked outward by the pads and reeled back in by a spring.',
  tags: ['orbits', 'springs', 'harmonics'],
  knobs: [
    { label: 'Spin rate', default: 0.35 },
    { label: 'Spring', default: 0.4 },
    { label: 'Damping', default: 0.3 },
    { label: 'Trail length', default: 0.6 },
    { label: 'Link range', default: 0.45 },
    { label: 'Body size', default: 0.3 },
    { label: 'Orbit scale', default: 0.5 },
    { label: 'Hue', default: 0.0 },
  ],
  pads: Array.from({ length: 8 }, (_, i) => ({
    label: `Kick body ${i + 1} outward (harmonic ${[1, '1.5', 2, '2.5', 3, 4, '4.5', 6][i]}×)`,
  })),
  factory: createOrbitalChoir,
  body: (
    <>
      <p>
        Eight bodies orbit the centre. Each one runs at a different harmonic of a single base rate —
        1, 1½, 2, 2½, 3, 4, 4½, 6 — which means the whole set is periodic, but with a period long
        enough that you will not sit through it. What you see instead is the approach to alignment:
        the slow ones drift, the fast ones lap them, and every so often five of them are briefly in a
        line and it looks deliberate.
      </p>
      <p>
        A pad hit adds radial velocity to its body. From there it is an ordinary damped spring
        pulling back toward the rest orbit, so a kick becomes a wobble that dies out over a few
        seconds. <strong>Spring</strong> sets how urgently it snaps back and <strong>Damping</strong>{' '}
        sets how much it argues about it. Low damping with a strong spring gives you something that
        rings for ten or fifteen seconds after a single tap, which is the setting I leave it on.
      </p>
      <p>
        <strong>Link range</strong> is the one that changes the character of the piece rather than
        its parameters. At zero you have eight independent trails. Wound up, lines appear between any
        two bodies that happen to be near each other, and the thing stops reading as eight orbits and
        starts reading as one shape with eight corners that keeps turning inside out.
      </p>
      <p>
        The vertical squash is deliberate. Perfect circles look like a diagram; an ellipse at 0.82
        looks like a system seen slightly off-axis, and your eye supplies a third dimension that is
        not there.
      </p>
    </>
  ),
};

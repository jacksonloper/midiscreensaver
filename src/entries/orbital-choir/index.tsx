import type { Entry } from '../types';
import { createOrbitalChoir } from './sketch';

export const orbitalChoir: Entry = {
  slug: 'orbital-choir',
  title: 'Eight orbits on a spring',
  date: '2026-04-18',
  dek: 'Eight bodies run at different harmonics of one rate. A pad kicks its body outward and a spring pulls it back.',
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
        Eight bodies circle the centre, each at a harmonic of one base rate: 1, 1½, 2, 2½, 3, 4, 4½
        and 6. The set does repeat, but over a period long enough that what you actually watch is the
        approach to alignment — the slow ones drifting, the fast ones lapping them, and the occasional
        moment where five of them are briefly in a line.
      </p>
      <p>
        A pad hit pushes its body outward. A damped spring pulls it back toward its resting orbit, so
        a hit becomes a wobble that dies away over a few seconds. <strong>Spring</strong> sets how
        hard it pulls back, <strong>Damping</strong> how quickly the wobble fades. A strong spring
        with light damping rings for ten or fifteen seconds after one tap.
      </p>
      <p>
        <strong>Link range</strong> draws a line between any two bodies that come close to each other.
        At zero you have eight separate trails; wound up, the picture reads as one shape with eight
        corners.
      </p>
      <p>
        The orbits are drawn as slight ellipses rather than circles, which makes the system look
        tilted rather than flat.
      </p>
    </>
  ),
};

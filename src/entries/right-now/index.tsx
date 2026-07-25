import type { Entry } from '../types';
import { SEEDS } from './bodies';
import { createRightNow } from './sketch';

export const rightNow: Entry = {
  slug: 'right-now',
  title: 'Right Now, To Scale',
  date: '2026-07-25',
  dek: 'The solar system solved for this exact moment, with the clock on a knob and a planet on every pad.',
  tags: ['orrery', 'kepler', 'canvas'],
  knobs: [
    { label: 'Clock', default: 0.7 },
    { label: 'Zoom', default: 0.44 },
    { label: 'Orbit lines', default: 0.6 },
    { label: 'Body scale', default: 0.5 },
    { label: 'Trails', default: 0.35 },
    { label: 'Starfield', default: 0.6 },
    { label: 'Readouts', default: 0.85 },
    { label: 'Sun glow', default: 0.45 },
  ],
  pads: SEEDS.slice(1).map((seed) => ({
    label: `Fly to ${seed.name} — hit twice to pull back out`,
  })),
  factory: createRightNow,
  body: (
    <>
      <p>
        This one is not invented. Every position on screen is solved from JPL's approximate Keplerian
        elements — the twelve numbers per planet that describe an orbit and how it drifts, good from
        1800 to 2050 — evaluated for whatever instant the clock is currently showing. When you load
        the page, that instant is now. The arrangement you are looking at is today's, not a diagram
        of one.
      </p>
      <p>
        The work per planet is small: take the elements at time <em>T</em>, get the mean anomaly,
        solve Kepler's equation <em>M = E − e sin E</em> for the eccentric anomaly by
        Newton–Raphson, and rotate the result into the ecliptic plane. Four iterations is plenty.
        Doing that sixty times a second for eight planets costs nothing, which is what makes the{' '}
        <strong>Clock</strong> knob possible: centred it holds still, and either side of centre runs
        time forwards or backwards at up to four hundred days a second. Nothing is being animated.
        The elements are simply being asked about a different moment each frame.
      </p>
      <p>
        Wind the clock up and the inner planets become a blur while Neptune barely stirs — its year
        is 165 of ours. Turn <strong>Trails</strong> up at the same time and the orbits draw
        themselves in, each planet laying down the arc it has just covered.
      </p>

      <h2>The distances are the problem</h2>
      <p>
        A solar system drawn to scale is mostly nothing. Fit Neptune's orbit on screen and Earth is
        about a two-hundredth of a pixel across; every planet is invisible and you are looking at
        eight rings and a dot. Every orrery ever built lies about this. So does this one — but only
        by as much as you tell it to. <strong>Body scale</strong> runs from true size up to twenty
        thousand times, and whenever it is above one the readout says so and gives you the
        multiplier. Turn it all the way down and the planets vanish into honest little ×
        marks sitting on their orbit lines.
      </p>

      <h2>Getting there</h2>
      <p>
        Each pad flies the camera to a planet — Mercury on pad 1, out to Neptune on pad 8 — and how
        hard you hit decides how close you end up. Hit the same pad twice and it pulls back out to
        the whole system.
      </p>
      <p>
        The flight itself is the part I am most pleased with. Going straight from Neptune to Mercury
        would mean crossing thirty astronomical units, and if you pan at a constant rate while
        zoomed in, the world tears past at an absurd speed. So the camera pulls back until both the
        old frame and the destination fit, holds there, then pushes in — and the panning is
        distributed in proportion to how wide the frame is at each instant, so the ground appears to
        move at a near-constant speed the whole way. It is a Van Wijk-style zoom-and-pan, and it is
        about fifteen lines: integrate the frame width across the trip, normalise, and look up the
        position along that curve instead of along time.
      </p>
      <p>
        The planets keep moving while you fly, so the camera targets a planet rather than a point
        and re-reads where it is on every frame. With the clock wound up you can watch a world drift
        out from under the crosshair on approach.
      </p>

      <h2>What you are looking at</h2>
      <p>
        The view is straight down on the ecliptic from the north, so the planets go anticlockwise.
        The dashed line to the right is longitude zero, the direction of the vernal equinox, which
        is where all those longitude readouts are measured from. The scale bar bottom-left is
        honest at every zoom level, from astronomical units down to kilometres across a single
        disc.
      </p>
      <p>
        Surface detail is invented but deterministic — belts and blotches seeded per planet, so
        Jupiter looks like Jupiter every time you load it. The lighting is not invented: seen from
        directly above the plane, every planet is exactly half lit, and the terminator always runs
        square across the sunward direction. Zoom into any of them and the shadow will be pointing
        the right way.
      </p>
    </>
  ),
};

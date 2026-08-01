import type { Entry } from '../types';
import { SEEDS } from './bodies';
import { createRightNow } from './sketch';

export const rightNow: Entry = {
  slug: 'right-now',
  title: 'The planets, right now',
  date: '2026-07-25',
  dek: "The solar system worked out for this moment from JPL's orbital elements. A knob runs the clock; each pad flies to a planet.",
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
      <h2>What you are looking at</h2>
      <p>
        Every position is worked out from JPL's approximate Keplerian elements — the numbers that
        describe each planet's orbit and how it drifts, good from 1800 to 2050 — for whatever moment
        the clock is showing. When the page loads, that moment is now, so the arrangement is today's.
      </p>
      <p>
        The view looks down on the ecliptic from the north, so the planets travel anticlockwise. The
        dashed line to the right is longitude zero, which is where the longitude readouts are
        measured from. The scale bar is accurate at every zoom level.
      </p>

      <h2>The clock</h2>
      <p>
        Centred, the <strong>Clock</strong> knob holds time still. Either side of centre runs time
        forwards or backwards at up to four hundred days a second. Nothing is animated: each frame
        asks the same equations about a different moment. Wound up, the inner planets blur while
        Neptune barely moves — its year is 165 of ours. Turn <strong>Trails</strong> up to see the
        arc each planet has just covered.
      </p>

      <h2>Sizes</h2>
      <p>
        A solar system drawn to true scale is mostly empty. Fit Neptune's orbit on screen and Earth
        is about a two-hundredth of a pixel across. <strong>Body scale</strong> runs from true size up
        to twenty thousand times; above one, the readout gives the multiplier, and at the bottom of
        the range the planets become small × marks sitting on their orbit lines.
      </p>

      <h2>Flying to a planet</h2>
      <p>
        Pad 1 is Mercury and pad 8 is Neptune. How hard you hit decides how close you end up, and
        hitting the same pad again pulls back out to the whole system.
      </p>
      <p>
        A trip from Neptune to Mercury crosses thirty astronomical units. Panning at a constant rate
        while zoomed in would move the view far too fast to follow, so the camera pulls back until
        both ends fit, then pushes in, covering more ground while the frame is wide. The planets keep
        moving during the flight, so the camera follows the planet rather than a fixed point.
      </p>
      <p>
        Surface markings are invented, but seeded per planet, so Jupiter looks like Jupiter on every
        load. The lighting is not invented: seen from straight above the plane, every planet is
        exactly half lit, and the shadow runs square across the direction of the sun.
      </p>
    </>
  ),
};

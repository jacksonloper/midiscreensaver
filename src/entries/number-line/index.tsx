import type { Entry } from '../types';
import { DELTAS, createNumberLine } from './sketch';

const label = (d: number): string => (d < 0 ? `−${Math.abs(d)}` : `+${d}`);

export const numberLine: Entry = {
  slug: 'number-line',
  title: 'Adding on a number line',
  date: '2026-07-26',
  dek: 'Eight pads add or subtract 1, 2, 5 and 10. A ball hops to the new total and the axis rescales to fit.',
  tags: ['arithmetic', 'bouncing', 'canvas'],
  knobs: [
    { label: 'Hue', default: 0.1 },
    { label: 'Bounce', default: 0.5 },
    { label: 'Tempo', default: 0.42 },
    { label: 'Hop reach', default: 0.55 },
    { label: 'Squash', default: 0.6 },
    { label: 'Trail', default: 0.4 },
    { label: 'Number size', default: 0.55 },
    { label: 'Sparks', default: 0.5 },
  ],
  pads: DELTAS.map((d) => ({ label: `Add ${label(d)}` })),
  factory: createNumberLine,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Each pad changes one running total. The bottom row takes away 1, 2, 5 and 10; the top row
        adds the same four amounts, so 10 sits directly above −10.
      </p>
      <p>
        The ball stands where the total is. The axis runs from zero to the ball, and the number the
        ball is standing on is the answer.
      </p>

      <h2>The hops</h2>
      <p>
        The ball does not travel straight to the new total. It jumps a fixed fraction of the distance
        left, lands, then jumps the same fraction of what remains, so one press of +10 becomes a run
        of shrinking arcs. <strong>Hop reach</strong> is that fraction: high crosses the gap in two
        strides, low takes a dozen. The last part of a unit is walked rather than hopped.
      </p>
      <p>
        How hard you hit matters. A hard hit pushes the fraction past 1, so the ball overshoots and
        has to come back for the number from the other side. The total is the same either way.
      </p>
      <p>
        Arc height comes from the distance on screen rather than the number of units, so +10 out of a
        total of 12 is a leap and +10 out of 400 is a nudge.
      </p>

      <h2>The scale</h2>
      <p>
        There is no zoom control. The axis always runs from zero to the ball plus a margin, and the
        tick spacing steps through 1, 2, 5, 10, 20, 50 to suit. A total of 20 and a total of 200
        therefore look much the same until you read the numbers.
      </p>
      <p>
        Zooming out is quick and zooming back in is slow, so a long jump never outruns the frame.
      </p>

      <h2>The knobs</h2>
      <p>
        The knobs only change how it looks; none of them changes the total.{' '}
        <strong>Number size</strong> does the most work: it sets the type size, and the tick spacing
        follows from how much room the labels need, so the axis thins out as the numbers grow instead
        of letting them collide.
      </p>
    </>
  ),
};

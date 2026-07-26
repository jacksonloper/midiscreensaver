import type { Entry } from '../types';
import { DELTAS, createNumberLine } from './sketch';

const label = (d: number): string => (d < 0 ? `−${Math.abs(d)}` : `+${d}`);

export const numberLine: Entry = {
  slug: 'number-line',
  title: "Zeno's Adding Machine",
  date: '2026-07-26',
  dek: 'Eight pads add ±1, ±5, ±10 and ±25; a ball hops to the answer, and the axis redraws itself to fit.',
  tags: ['arithmetic', 'bouncing', 'canvas'],
  knobs: [
    { label: 'Hue', default: 0.1 },
    { label: 'Bounce', default: 0.5 },
    { label: 'Tempo', default: 0.42 },
    { label: 'Hop reach', default: 0.55 },
    { label: 'Squash', default: 0.6 },
    { label: 'Trail', default: 0.4 },
    { label: 'Ruler detail', default: 0.55 },
    { label: 'Sparks', default: 0.5 },
  ],
  pads: DELTAS.map((d) => ({ label: `Add ${label(d)}` })),
  factory: createNumberLine,
  body: (
    <>
      <p>
        There is one number in this post. The pads change it by ±1, ±5, ±10 and ±25, and everything
        on screen is a consequence of what that number currently is. The ball is where the number is.
        The axis runs from zero to the ball. The tick spacing is whatever fits. Nothing else is being
        kept track of.
      </p>
      <p>
        The pads are laid out the way the hardware already is: sign by row, magnitude by column.
        Bottom row takes away, top row adds, and the two rows line up so 25 sits above −25. Once your
        hands know that, you stop reading the labels and start playing the number, which is more or
        less the whole point of putting arithmetic on a drum controller.
      </p>

      <h2>Why it takes so many hops</h2>
      <p>
        The ball does not travel to the new total. It jumps a fixed <em>fraction</em> of the distance
        still to go, lands, and jumps the same fraction of what is left — so at the default setting a
        single hit of +25 becomes an arc of about eighteen, then five, then one and a bit, each one
        shorter and lower than the last, converging on the number in a run of decreasing bounces that
        never quite gets there. The last sliver of a unit is walked in rather than hopped, because an
        infinite series of bounces makes a lovely idea and a terrible readout.
      </p>
      <p>
        <strong>Hop reach</strong> is that fraction. Turn it up and the ball crosses in two big
        strides; turn it down and it patters across the gap in a dozen small ones, taking noticeably
        longer to arrive. It is the closest thing here to a difficulty setting.
      </p>
      <p>
        Arc height is chosen from how far the hop looks <em>on screen</em>, not how many units it
        covers. This matters more than it sounds: +25 out of a total of 30 is a leap across the whole
        frame, and +25 out of 400 is a nudge. The same pad has to be able to mean both, so the ball
        reads the pixels rather than the arithmetic and jumps accordingly.
      </p>
      <p>
        Velocity buys reach and height, and can push the fraction past 1. Hit a pad hard enough and
        the ball sails clean past the number it was aiming at, then has to come back for it in
        smaller hops from the other side. The total is exact either way — a hard +5 is still five —
        but the flight is a lot less dignified.
      </p>

      <h2>The window is not a setting</h2>
      <p>
        There is no zoom control, because there is nothing to decide: the axis runs from zero to
        wherever the ball is, plus a margin. Every scale you see is the arithmetic asking for it. Hit
        +25 four times and the frame quietly opens out to a hundred; work your way back down and it
        closes in again.
      </p>
      <p>
        Zooming out is fast and zooming back in is slow, which is not symmetry I would have chosen on
        purpose — it is what stops a long jump outrunning the frame. The ball would otherwise leave
        the right-hand edge on the way to a number the window has not heard about yet. As a fallback,
        the window is nudged at the end of every frame to keep the ball inside it, so the rule can
        never quite fail.
      </p>
      <p>
        The side effect is my favourite thing about this one. Because the ball always sits at
        roughly the same place on screen, and the ticks re-space themselves to 1, 2, 5, 10, 20, 50 as
        needed, a total of 25 and a total of 250 look identical until you read the numbers underneath.
        The picture stops being about position and starts being about scale.
      </p>

      <h2>The knobs are all frosting</h2>
      <p>
        Every knob here is styling. <strong>Bounce</strong>, <strong>Tempo</strong> and{' '}
        <strong>Squash</strong> set how the ball carries itself; <strong>Trail</strong> leaves a
        fading ghost of the arc it just flew; <strong>Ruler detail</strong> decides how crowded the
        axis gets; <strong>Sparks</strong> controls the mess it makes on landing; <strong>Hue</strong>{' '}
        rotates a palette that otherwise takes its colour from the last pad you hit. None of them
        touch the number. Turn all eight to zero and the total still comes out the same — it just
        arrives looking bored.
      </p>
    </>
  ),
};

import type { Entry } from '../types';
import { createLinkage } from './sketch';

export const linkage: Entry = {
  slug: 'linkage',
  title: 'Rods with one way to move',
  date: '2026-08-01',
  dek: 'Random lines, pinned together until exactly one degree of freedom is left, and then that one motion followed all the way round.',
  tags: ['linkages', 'geometry', 'canvas'],
  knobs: [
    { label: 'Speed: seconds per lap', default: 0.55 },
    { label: 'Rods: 3, 5, 7', default: 0.5 },
    { label: 'Pins to ground (next build)', default: 0.5 },
    { label: 'Zoom', default: 0.5 },
    { label: 'Trail length', default: 0.6 },
    { label: 'Ghosts', default: 0.3 },
    { label: 'How far the rods are drawn', default: 0.35 },
    { label: 'Hue', default: 0.55 },
  ],
  pads: [
    { label: 'New arrangement' },
    { label: 'Reverse' },
    { label: 'Re-pin where it stands' },
    { label: 'Trails' },
    { label: 'Ghosts' },
    { label: 'Markers: pins and ground, pins, none' },
    { label: 'Camera: whole motion, chase, frozen' },
    { label: 'Readout: full, short, off' },
  ],
  factory: createLinkage,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Pad 1 throws away everything and builds a new machine out of fresh random lines. That is the
        main control: most of these last a few seconds before you want the next one. Knob 2 sets how
        many rods it uses — three, five or seven — and changing it builds a new one straight away.
      </p>
      <p>
        Knob 1 sets how long the machine takes to go once round its motion, from about three seconds
        to about fifty; turning it all the way down stops the motion without stopping the drawing.
        It is a lap time rather than a speed because the machines differ so much: some swing right
        across the screen and some only shiver, and asking for a lap gives them all the same amount
        of your attention. Pad 2 sends it back the way it came.
      </p>

      <h2>What is on screen</h2>
      <p>
        Each rod is an infinite rigid line. It has no length, no thickness and no ends; the bright
        part is only the stretch between its outermost pins, and knob 7 draws more or less of the
        rest of it. Rods pass straight through each other. Nothing collides, nothing has weight, and
        the only rule is the pins.
      </p>
      <p>
        A round pin joins two rods: some point of one rod is the same point of the other, forever.
        The square pins with hatching underneath are joined to the background instead — that point
        of that rod cannot move at all.
      </p>
      <p>
        The trails are where the joints have been. They are not circles: a joint is being dragged by
        two rods at once, and what comes out is the sort of lopsided closed curve that mechanical
        linkages are prized for. The ghosts are earlier positions of the whole machine, evenly
        spaced around the motion, so a still frame shows the shape of the whole thing.
      </p>

      <h2>Counting the freedom</h2>
      <p>
        A rod in the plane takes three numbers: where a chosen point of it sits, and which way it
        points. So <em>n</em> rods have 3<em>n</em> numbers between them, and the whole machine is a
        single point in a space of 3<em>n</em> dimensions — nine, fifteen or twenty-one here.
      </p>
      <p>
        Each pin is two equations, one for each coordinate of the meeting point. Pile up all the
        pins and you get a system F(q) = 0, and the machine can move exactly as far as that system
        lets it. The count is the rank of the derivative J = DF: the number of independent equations,
        not the number written down. Degrees of freedom is 3<em>n</em> − rank J.
      </p>
      <p>
        For one degree of freedom the rank has to be 3<em>n</em> − 1, and since each usable pin
        supplies two rows, the number of pins is (3<em>n</em> − 1)/2 — which is only a whole number
        when <em>n</em> is odd. That is why the rod counts on knob 2 skip the even numbers. Three
        rods take four pins, five rods take seven, seven rods take ten. The readout counts them for
        you.
      </p>

      <h2>How one gets built</h2>
      <p>
        Start with the lines, thrown down at random and rejected if two are nearly parallel or three
        nearly meet at a point. Then propose pins, one at a time. A proposal is either a joint at
        the crossing of two rods, or a pin from some point of one rod to the spot of background it
        is currently sitting on. Knob 3 sets how often each kind is proposed.
      </p>
      <p>
        The trick is that every proposal is read off the arrangement as it stands, so it is
        satisfied the moment it is made. Nothing has to be solved to get started: the random
        arrangement is already a working configuration of whatever machine you end up with.
      </p>
      <p>
        A proposal is kept only if both its rows are independent of every row already accepted —
        rank up by two, freedom down by two. A pin that would repeat something the others already
        say is thrown out, however sensible it looks. Building stops the moment the rank hits
        3<em>n</em> − 1, and the readout shows how close it came and how good the numbers are, as
        the smallest and largest singular values of J.
      </p>
      <p>
        Two things then get the whole arrangement thrown away rather than any single pin. A rod
        left holding one pin only turns about it while everything else stands still — that is the
        entire motion, and it is not worth watching, so every rod has to end up with at least two.
        And some machines are legal but nearly rigid: the count says one degree of freedom and the
        joints barely stir. Each candidate is walked a short way and measured before it is shown,
        and the stiff ones are dropped.
      </p>
      <p>
        This is also why knob 3 stops having an effect near the top of its travel. Every rod needs
        two pins and there are only (3<em>n</em> − 1)/2 pins to hand out; a pin to the background
        holds one rod where a joint holds two, so no more than <em>n</em> − 1 of them can go to the
        background before the rest of the rods cannot be paid for.
      </p>
      <p>
        Pad 3 keeps the rods exactly where they are and pins them again from scratch. Same lines,
        same instant, different machine — a good way to see how much of the motion is the
        arrangement and how much is the choice of joints.
      </p>

      <h2>Following the motion</h2>
      <p>
        Nothing here is integrated forwards in time, and there is no physics. The set of legal
        configurations is a curve in 3<em>n</em>-dimensional space, and the screensaver simply walks
        along it.
      </p>
      <p>
        At the current configuration, the directions that break no constraint are the nullspace of
        J, and having stopped at rank 3<em>n</em> − 1 that nullspace is a single line. Take a small
        step along it. That step is a straight line in a curved space, so it lands slightly off the
        constraints, and a couple of Newton corrections push it back on — each one taking the
        smallest move that reduces the error. Then find the nullspace again at the new position,
        keeping the sign that agrees with the direction of travel, and repeat.
      </p>
      <p>
        Step length is chosen so the fastest-moving pin covers the same distance every time, rather
        than by any fixed amount of the coordinates. That is what keeps the motion even through the
        parts where the machine is heavily geared and a small change of angle throws a joint a long
        way. Measuring the pins and not the coordinates matters: where a rod's three numbers say it
        is can swing wildly while the part of it you can see hardly moves, because a rod turning
        about a distant pin drags its own origin along at a distance.
      </p>
      <p>
        The motion nearly always closes into a loop. The readout says how long a lap turned out to
        be and how far round the current one is; angles are never wrapped, so a rod that has turned
        all the way round is recognised as being back where it started rather than somewhere new.
        Once a lap has been measured it also sets the pace, which is why a machine can change speed
        slightly the first time it comes back round to where it began.
      </p>

      <h2>When it gives up</h2>
      <p>
        Every so often the singular values of J are recomputed properly. If the nullspace has grown
        to more than one dimension the machine has reached a singular configuration — a moment where
        it could carry on in more than one way, and where the curve being traced crosses another
        one. Deciding which branch to take is real work, so this does not: it says so and builds a
        new machine. The same happens if the corrections stop converging even after the step has
        been cut. The readout counts the restarts.
      </p>
    </>
  ),
};

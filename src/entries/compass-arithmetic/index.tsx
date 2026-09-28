import type { Entry } from '../types';
import { createCompassArithmetic, knobFor } from './sketch';

export const compassArithmetic: Entry = {
  slug: 'compass-arithmetic',
  title: 'Multiplying with a ruler and compass',
  date: '2026-09-27',
  dek: 'Two lengths go in, and a straightedge and a compass turn them into their product, their quotient and the square root of their product.',
  tags: ['arithmetic', 'geometry', 'canvas'],
  knobs: [
    { label: 'x', default: knobFor(2.4) },
    { label: 'y', default: knobFor(1.5) },
    { label: 'Angle between the lines', default: 0.35 },
    { label: 'Pace', default: 0.45 },
    { label: 'Turn the figure', default: 0.5 },
    { label: 'Arc length', default: 0.2 },
    { label: 'Label size', default: 0.5 },
    { label: 'Line weight', default: 0.35 },
  ],
  pads: [
    { label: 'Construct x · y' },
    { label: 'Construct x ÷ y' },
    { label: 'Construct √(xy)' },
    { label: 'Take turns: pad 6 moves on to the next one' },
    { label: 'Next step, by hand' },
    { label: 'Play: start again, or the next one when taking turns' },
    { label: 'Labels' },
    { label: 'Palette: night, chalkboard, blueprint, ember' },
  ],
  factory: createCompassArithmetic,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Knob 1 sets a length x and knob 2 sets a length y, anywhere from 0.5 to 4 in steps of a
        tenth. The screen then builds an answer out of them the way Euclid would have: every line
        is ruled with a straightedge that has no markings, and every length is carried from one
        place to another with a compass. Nothing is measured until the end.
      </p>
      <p>
        Pads 1 to 3 pick the answer: x times y, x divided by y, or the square root of x times y.
        A finished figure stays on screen until you hit pad 6, which starts the next one; out of
        the box that takes the three in turn. The list on the right says what each step is, and
        the three bars above it are the only lengths the compass is allowed to start from: 1, x and
        y.
      </p>
      <p>
        When the figure is finished, the number printed beside the gold segment is its length,
        measured off the figure. The line underneath is the same sum done in arithmetic, so you can
        check one against the other.
      </p>

      <h2>Why you need a 1</h2>
      <p>
        Multiply two lengths and you ought to get an area, not a length. The construction gets a
        length anyway because it is told what 1 is. It really computes x × y ÷ 1, and the 1 is
        the short segment OU that the compass marks first. Change what counts as 1 and the answer
        changes with it. That is why the unit is one of the givens.
      </p>
      <p>
        The square root is the exception: √(xy) comes out as a length with no unit needed. Set y
        to 1 and it is √x, which is the one square root a ruler and compass can take for any x.
      </p>

      <h2>Product and quotient</h2>
      <p>
        Both use the same picture: two lines out of a point O, and a pair of parallel lines across
        them. The triangles the parallels cut off are the same shape at two sizes, so their sides
        are in proportion. For the product, OU is to OY as OX is to OP. OU is 1, so OP is x times
        y.
      </p>
      <p>
        For the quotient, y and 1 swap places. Now OY is to OX as OU is to OQ, which makes OQ
        equal to x divided by y. The two shaded triangles at the end are the pair that matters.
      </p>
      <p>
        Drawing a parallel with a compass takes two steps. Swing one arc the length of UY from X
        and another the length of UX from Y. Where they cross is the fourth corner of a
        parallelogram, and the line from X through that corner is parallel to UY.
      </p>

      <h2>The square root</h2>
      <p>
        Lay x and y end to end along a line, meeting at O. Halve the whole length to find the
        middle, M, and draw the circle with that middle as its centre. It passes through both
        ends. Then stand a line straight up from O. Where it meets the circle is H, and OH is
        √(xy).
      </p>
      <p>
        Any triangle drawn on a diameter of a circle with its third corner on the circle has a
        right angle at that corner. So AHB is right-angled at H, and the two triangles either
        side of OH are the same shape. That gives x ÷ OH = OH ÷ y, which is OH × OH = x × y.
      </p>
      <p>
        Halving AB and standing up the perpendicular are constructions of their own, which is why
        this one has the most steps. Both are shown in full.
      </p>

      <h2>The knobs and pads</h2>
      <p>
        Pad 5 stops the automatic drawing and moves one step each time you hit it, which is the
        best way to follow along. Pad 6 goes back to playing on its own, from the top. Knob 3 opens or closes
        the angle between the two lines; the answer does not move, and that is the point of the
        proof. Knob 6 lengthens every compass arc until they are whole circles.
      </p>
      <p>
        The figure zooms to fit, so a big answer makes everything else small. Watch the unit
        segment OU shrink when x and y are both near 4.
      </p>
    </>
  ),
};

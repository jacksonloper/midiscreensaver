import type { Entry } from '../types';
import { createLinkageGallery } from './sketch';

export const linkageGallery: Entry = {
  slug: 'linkage-gallery',
  title: 'Rods, pins, and degrees of freedom',
  date: '2026-08-02',
  dek: 'Eight linkages, each one animated from the smallest set of numbers that decides where every pin is.',
  tags: ['mechanisms', 'kinematics', 'geometry', 'canvas'],
  knobs: [
    { label: 'q₁', default: 0.12 },
    { label: 'q₂', default: 0.06 },
    { label: 'Autoplay', default: 0.42 },
    { label: 'Proportions', default: 0.5 },
    { label: 'Zoom', default: 0.45 },
    { label: 'Trace', default: 0.42 },
    { label: 'Labels', default: 0.5 },
    { label: 'Palette', default: 0.58 },
  ],
  pads: [
    { label: 'Crank — 1 DOF' },
    { label: 'Two-link open chain — 2 DOF' },
    { label: 'Parallelogram vector copier — 1 DOF' },
    { label: 'Pantograph — 2 DOF' },
    { label: 'Translator — 2 DOF' },
    { label: 'Kempe angle doubler — 1 DOF' },
    { label: 'Peaucellier inversor — 2 DOF' },
    { label: 'Peaucellier straight-line — 1 DOF' },
  ],
  factory: createLinkageGallery,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Each pad is a mechanism, simplest first. Hit the pad you are already on and the linkage
        re-assembles into its other mode, where it has one — the same rods, pinned up a different
        way.
      </p>
      <p>
        Knobs 1 and 2 are the mechanism's coordinates. Knob 3 is autoplay: turn it all the way down
        and the coordinates stop moving, so the linkage is yours to fold by hand. Knob 4 stretches
        the rods, which changes the shape of everything the mechanism can do.
      </p>

      <h2>One rule for the whole gallery</h2>
      <p>
        A mechanism's state here is two things: <code>q</code>, a list of independent numbers, and{' '}
        <code>branch</code>, which says how the thing is assembled. Every pin on screen is computed
        from those. Nothing is animated on its own clock — no rod gets its own angle and hopes the
        others keep up.
      </p>
      <p>
        The readout at the bottom right is the proof. <em>Rod length error</em> is the worst rod on
        screen measured against the length it is supposed to be, and it sits at about 10⁻¹⁶, which is
        the size of a rounding error in double-precision arithmetic. Give each rod its own angle and
        let the angles drift instead, and that is the number that starts to grow.
      </p>

      <h2>Degrees of freedom, and what they are not</h2>
      <p>
        Pad 2 is an arm with an elbow. Both joints turn freely, so it takes two numbers to say where
        it is: the configuration space is a torus, S¹ × S¹. The endpoint sweeps an annulus, and the
        annulus is a tempting thing to point at, but it is the <em>workspace</em> — where the output
        can get to — and it is not the configuration space. Two different poses of the arm reach the
        same point.
      </p>
      <p>
        The panel at the bottom left draws the configuration space itself: a circle for one turning
        joint, a bounded interval where the mechanism has poses it cannot pass through, the torus cut
        open into a square for two free angles, and an annulus for the inversor's free input pin.
      </p>
      <p>
        A linkage built to compute something has as many degrees of freedom as its input. The output
        pin is dependent — it does what the input tells it — and does not count for anything.
      </p>

      <h2>Two coordinates, one curve</h2>
      <p>
        Four of the eight take two coordinates. Autoplay can only walk one path through a
        two-dimensional space, so for those it follows a chosen curve: α = t with β = 0.65 t for the
        pantograph, β = −0.8 t for the translator, each offset by wherever knobs 1 and 2 are sitting.
        The faint dots in the configuration-space panel are that curve, winding around the torus and
        never closing.
      </p>
      <p>
        It is a demonstration trajectory, not the configuration space, which is why the panel spells
        out <em>mechanism DOF 2, displayed trajectory dimension 1</em>. Knob 3 to zero and both
        coordinates are on knobs 1 and 2, and then the trace fills in a patch of two-dimensional
        space rather than drawing a line through it.
      </p>

      <h2>Circles, roots, and assembly modes</h2>
      <p>
        When a pin is held at a fixed distance from two others, it sits where two circles cross —
        and two circles cross in two places. Both are legal. Which one you get is the assembly mode,
        and it is a discrete choice, not a continuous coordinate: it cannot change without the
        linkage being taken apart, or passing through a pose where the two solutions meet.
      </p>
      <p>
        So each frame takes the solution nearest to where the pin was on the last frame, and only
        switches when you ask by hitting the pad again. Pad 3 is where that choice bites. The
        parallelogram copier is four rods that copy a vector — B − A = C − D — but only on the
        ordinary branch. Cross the assembly and the residual readout stops being zero: the same four
        rods now do something else entirely. This is the flip that real parallelogram linkages are
        designed to avoid, and you can watch the crossed branch whip through it as θ passes zero.
      </p>

      <h2>The eight</h2>
      <ul>
        <li>
          <strong>Crank</strong>, 1 DOF. One angle, one pin, a circle. Everything else in the gallery
          is this with more rods.
        </li>
        <li>
          <strong>Two-link open chain</strong>, 2 DOF. Two independent angles. The annulus below it
          is the workspace.
        </li>
        <li>
          <strong>Parallelogram copier</strong>, 1 DOF. Fix the rod AD and one angle places the other
          three rods.
        </li>
        <li>
          <strong>Pantograph</strong>, 2 DOF. Six rods on one fixed pivot. Whatever D does, G does λ
          times as far from A: G − A = λ(D − A). Both the input and the output have two degrees of
          freedom, because it is the same two.
        </li>
        <li>
          <strong>Translator</strong>, 2 DOF. Two parallelograms in series hold F at a constant offset
          from E — constant as a vector, so the offset never turns.
        </li>
        <li>
          <strong>Kempe angle doubler</strong>, 1 DOF. Two contraparallelogram cells sharing the rod
          OB, the second a scaled copy of the first. Each cell subtends the same angle, and the two
          stack: arg(E − O) = 2α. Kempe braces the copy to keep it in step; here the copy is
          computed, which draws the same picture. α stops short of 0 and π, the flattened poses where
          the assembly modes meet.
        </li>
        <li>
          <strong>Peaucellier inversor</strong>, 2 DOF. The input pin B is not on an arm — it is free
          inside an annulus, which is two degrees of freedom, and ρ and θ about F are the natural way
          to say where it is. D is the inverse of B in a circle: push B out and D comes in, with
          ‖D − F‖ · ‖B − F‖ never changing. The long rods FA and FC come out at √(t² + r²) whatever
          you do, which is the identity the cell is built on.
        </li>
        <li>
          <strong>Peaucellier straight-line</strong>, 1 DOF. Add one rod, GD, with ‖GD‖ = ‖GF‖. That
          pins D to a circle through F, and inverting a circle through the centre gives a line, so B
          runs dead straight — to 10⁻¹⁶, not approximately. One rod took a degree of freedom away and
          turned a two-dimensional mechanism into a one-dimensional trace.
        </li>
      </ul>

      <h2>The bottom of the screen</h2>
      <p>
        Each mechanism prints the relation it enforces and the residual of that relation. On the
        Peaucellier straight-line the residual is how far the output pin is from the ideal line, and
        it stays at the last bit of a double for the whole stroke. That mechanism was published in
        1864 and settled a question people had wondered about for a century: whether pinned rods
        alone could draw a straight line, with nothing already straight to trace against.
      </p>
    </>
  ),
};

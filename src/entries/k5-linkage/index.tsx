import type { Entry } from '../types';
import { createK5Linkage } from './sketch';

export const k5Linkage: Entry = {
  slug: 'k5-linkage',
  title: 'Two cranks and the graph they can reach',
  date: '2026-08-02',
  dek: 'One arm turns three times as fast as the other, or half as fast. Every position the pair can hold is an edge of K₅, and the pads pick which edge to walk next.',
  tags: ['linkage', 'graph', 'kinematics', 'canvas'],
  knobs: [
    { label: 'Speed', default: 0.45 },
    { label: 'θ slider', default: 0.5 },
    { label: 'φ slider', default: 0.5 },
    { label: 'Trail', default: 0.4 },
    { label: 'Derived rays', default: 0.75 },
    { label: 'Graph layout', default: 0 },
    { label: 'Crossing gap', default: 0.5 },
    { label: 'Split', default: 0.5 },
  ],
  pads: [
    { label: 'At the next corner: carry on' },
    { label: 'At the next corner: turn back' },
    { label: 'At the next corner: change branch' },
    { label: 'At the next corner: change branch and turn back' },
    { label: 'Hold, so the sliders can be used' },
    { label: 'Automatic traversal: walk all ten edges' },
    { label: 'Snap to the nearest corner' },
    { label: 'Readout: full, residuals, none' },
  ],
  factory: createK5Linkage,
  body: (
    <>
      <h2>The machine</h2>
      <p>
        On the left is a rod bolted to the ground with one pivot on it, and two arms of length one
        turning about that pivot. The tip of the first is W, at angle θ from the rod; the tip of the
        second is Z, at angle φ. As complex numbers on the unit circle, W = e<sup>iθ</sup> and Z =
        e<sup>iφ</sup>.
      </p>
      <p>
        Left alone that is two independent angles and two degrees of freedom. This machine is not
        left alone. It admits a position when one of two things is true:
      </p>
      <p>
        <strong>Branch A:</strong> φ = 3θ — the cube of W lands exactly on Z.
        <br />
        <strong>Branch B:</strong> θ = 2φ — the square of Z lands exactly on W.
      </p>
      <p>
        The dashed ghost arms are those powers: W², W³ and Z². On branch A the W³ ghost rides on top
        of Z, and on branch B the Z² ghost rides on top of W. The ring shows which coincidence is
        currently holding the machine together.
      </p>

      <h2>The graph</h2>
      <p>
        On the right is every position the machine can hold. Each branch is a circle with one number
        on it: A is (θ, φ) = (t, 3t) and B is (2t, t). The two circles are not disjoint — they agree
        at five positions, the ones where
      </p>
      <p>
        θ<sub>k</sub> = 2πk/5 and φ<sub>k</sub> = 6πk/5, for k = 0, 1, 2, 3, 4.
      </p>
      <p>
        Those five are the corners of the drawing, and the arcs between them are the edges. Branch A
        meets them in the order 0, 1, 2, 3, 4 and branch B in the order 0, 2, 4, 1, 3, so A
        contributes 01, 12, 23, 34, 40 and B contributes 02, 24, 41, 13, 30. That is ten edges on
        five corners with none missing: the complete graph K₅.
      </p>
      <p>
        K₅ cannot be drawn flat without edges crossing, so five pairs of edges cross in the picture.
        The edge underneath is broken with a gap at every crossing, because a crossing is not a
        position the machine can be in and nothing can turn there. <strong>Graph layout</strong>{' '}
        swaps which branch is the outside pentagon and which is the star; it is the same ten edges
        drawn a second way, and there are still five crossings.
      </p>

      <h2>Driving it</h2>
      <p>
        The marker moves at a fixed rate along whichever edge it is on and stops for nothing until it
        reaches a corner. At a corner there are exactly four ways out, and the four bottom pads are
        those four ways: keep going, turn round, change branch, or change branch and turn round. Hit
        one at any time and it is spent at the next corner — the graph shows the edge you have queued
        as a dashed line before you get there. Hit nothing and the machine carries on, which on
        branch A means going round the pentagon forever.
      </p>
      <p>
        Pad 6 drives instead of you, always taking the least-walked way out of each corner. Walked
        edges stay lit, so you can watch it close in on all ten; when it has them all it starts a new
        lap.
      </p>
      <p>
        Pad 5 holds the walk, which is what the two sliders are for. There is only ever one number to
        set, so moving either slider projects your request onto the branch you are standing on: on
        branch A the θ slider goes straight to t and the φ slider to the nearest t with 3t = φ; on
        branch B it is the other way round. Sliders leave you between corners, which is a perfectly
        good position but not one where you can change branch. Pad 7 snaps you to the nearest corner
        exactly.
      </p>

      <h2>Reading the residuals</h2>
      <p>
        The two numbers at the bottom are how badly each constraint is broken:
      </p>
      <p>
        r<sub>A</sub> = |e<sup>iφ</sup> − e<sup>3iθ</sup>| and r<sub>B</sub> = |e
        <sup>iθ</sup> − e<sup>2iφ</sup>|.
      </p>
      <p>
        One of them is zero the whole time — the one for the branch you are on. Both are zero only at
        the five corners, which is exactly what makes a corner a corner. Watch r<sub>A</sub> drop to
        zero the instant a branch change lands.
      </p>

      <h2>One degree of freedom</h2>
      <p>
        It is tempting to look at a corner, where four edges meet, and think the machine has picked
        up a second freedom there. It has not. Each branch is described by a single number, so each
        is one-dimensional, and five isolated intersections between two curves do not add up to a
        two-dimensional patch of anything.
      </p>
      <p>
        The tangent directions at a corner are (1, 3) for A and (2, 1) for B in the (θ, φ) plane.
        They are distinct, so four one-dimensional half-edges meet at the point and no neighbourhood
        of it is a disc. The machine has <strong>one degree of freedom</strong> at every ordinary
        position and, at the five corners, one degree of freedom with a choice of two ways to use
        it.
      </p>
      <p>
        So the configuration space is a one-dimensional graph rather than a smooth one-dimensional
        manifold: at those five points it is not smooth, and that is the whole interest of it. Build
        the thing for real out of rods and each (θ, φ) here would come with finitely many internal
        arrangements of the extra bars — a finite-to-one cover, which does not change the dimension.
        The real linkage has one degree of freedom too.
      </p>
    </>
  ),
};

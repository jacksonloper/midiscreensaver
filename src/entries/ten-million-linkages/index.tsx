import type { Entry } from '../types';
import { createTenMillionLinkages } from './sketch';

export const tenMillionLinkages: Entry = {
  slug: 'ten-million-linkages',
  title: 'One linkage from ten million',
  date: '2026-08-04',
  dek: 'A random mechanism, pulled a row at a time out of a ten-million-row dataset and turned by its crank.',
  tags: ['mechanisms', 'kinematics', 'datasets', 'canvas'],
  knobs: [
    { label: 'Crank speed', default: 0.33 },
    { label: 'Zoom', default: 0.35 },
    { label: 'Trail length', default: 0.5 },
    { label: 'Joint size', default: 0.45 },
    { label: 'Rod weight', default: 0.4 },
    { label: 'Glow', default: 0.4 },
    { label: 'Palette', default: 0.5 },
    { label: 'Readout', default: 0.85 },
  ],
  pads: [
    { label: 'Deal another mechanism' },
    { label: 'Reverse the crank' },
    { label: 'Hold the crank, and step it 6°' },
    { label: 'Trace the next joint' },
    { label: 'The stored target curve' },
    { label: 'Ghost of the starting pose' },
    { label: 'Joint numbers' },
    { label: "Flip the next joint's assembly branch" },
  ],
  factory: createTenMillionLinkages,
  body: (
    <>
      <h2>What you are looking at</h2>
      <p>
        Every dot is a pin joint. Every line is a rigid rod, and it never changes length. The
        triangles on hatched ground are the joints bolted down; the amber rod between joint 0 and
        joint 1 is the crank, and it is the only thing being driven. Turn the crank and everything
        else has no choice about where to go.
      </p>
      <p>
        The ringed joint at the end of the chain is the output. The dashed loop is the path the
        dataset says it walks, and the bright trail is the path it is walking right now. They should
        sit on top of each other.
      </p>

      <h2>Where it comes from</h2>
      <p>
        <a href="https://huggingface.co/datasets/ahn1376/LINKS-10M">LINKS-10M</a> is ten million
        planar linkages — twenty-four gigabytes of them. None of that is downloaded here. Hugging
        Face's dataset viewer will hand over a single row over HTTP, so the post asks for one row at
        a random offset out of the ten million, reads the row count back out of the same reply, and
        draws what arrives.
      </p>
      <p>
        A row is five fields: the starting position of every joint, the list of rods, which joints
        are grounded, a target curve, and a sequence that says in what order the joints can be
        worked out. Nothing about lengths, angles or timing — those are all recovered from the
        starting pose.
      </p>
      <p>
        Pad 1 deals another. Left alone the post deals one every couple of minutes, which is a
        request every two minutes rather than a download of anything.
      </p>

      <h2>How it moves</h2>
      <p>
        There is no physics engine here, and no solver worth the name. Joint 1 goes round joint 0 at
        whatever speed knob 1 says. After that, each remaining joint is found in the stored order,
        and each one is the same small piece of geometry: it is a fixed distance from one joint
        already placed and a fixed distance from another, so it is where two circles cross.
      </p>
      <p>
        Two circles cross in two places. Which of the two is the entire difficulty. The viewer looks
        at the starting pose, notes which side of the line the joint began on, and keeps it on that
        side for the rest of the turn. Pad 8 flips that choice for one joint at a time, and you can
        watch a perfectly good machine turn into a different perfectly good machine — same rods,
        same lengths, assembled inside out.
      </p>
      <p>
        Pad 3 holds the crank and steps it six degrees at a time, which is the way to watch a
        near-tangent joint: two circles that barely meet, where the joint slows almost to a stop and
        then flicks across. Move knob 1 to let it run again.
      </p>

      <h2>When it does not work</h2>
      <p>
        Sometimes the circles miss entirely. There is no position that satisfies both rods, the
        mechanism cannot be assembled at that angle, and the honest answer is to stop: the pose on
        screen freezes at the last angle that worked, the readout says where it gave up, and another
        row is dealt a few seconds later. Rows you have been flipping branches on are left alone,
        because breaking them was the point.
      </p>
      <p>
        Rows can also arrive malformed, or not arrive at all. Anything that fails to parse is
        skipped for another offset, and if the network is not there at all, four rows bundled with
        the page stand in and the readout says so.
      </p>

      <h2>What this is not</h2>
      <p>
        This is ideal rigid-link kinematics and nothing else. Nothing here knows about torque,
        inertia, friction or momentum; the crank turns at the speed you set because you set it.
        Rods pass straight through each other, they have no thickness, joints have no limits, and no
        part of this says whether the thing could be built out of metal.
      </p>
    </>
  ),
};

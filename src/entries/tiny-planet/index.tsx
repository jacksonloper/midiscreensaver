import type { Entry } from '../types';
import { createTinyPlanet } from './sketch';

export const tinyPlanet: Entry = {
  slug: 'tiny-planet',
  title: 'A tiny planet with people on it',
  date: '2026-09-07',
  dek: 'A world small enough to see at once: two poles, a day a few seconds long, and people standing on the outside.',
  tags: ['spheres', 'day and night', 'canvas'],
  knobs: [
    { label: 'Spin', default: 0.36 },
    { label: 'Tilt', default: 0.57 },
    { label: 'Sun', default: 0.08 },
    { label: 'Sea level', default: 0.5 },
    { label: 'View', default: 0.48 },
    { label: 'Size', default: 0.6 },
    { label: 'Towns', default: 0.5 },
    { label: 'Skyline', default: 0.42 },
  ],
  pads: [
    { label: 'World: temperate, desert, jungle, frozen' },
    { label: 'Latitude and longitude grid' },
    { label: 'Labels: poles, equator, dawn and dusk' },
    { label: 'Ice caps' },
    { label: 'Buildings: village, town, city, wilderness' },
    { label: 'Night lights' },
    { label: 'Stars' },
    { label: 'Follow somebody else' },
  ],
  factory: createTinyPlanet,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Knob 1 spins the planet. Turn it all the way down and the world stops, with half of it
        stuck in daylight and half stuck in the dark; turn it up and a day goes by every couple of
        seconds. The readout on the left says how long one turn takes.
      </p>
      <p>
        Knob 5 lifts the camera from the equator up towards the north pole, which is the quickest
        way to convince yourself the thing is a sphere and not a disc. Knob 6 makes it bigger. Knob 7
        adds towns, knob 8 makes their buildings taller.
      </p>

      <h2>The people are the point</h2>
      <p>
        Everyone stands at right angles to the ground, so on a planet this small they all point
        different ways — outward, like pins in a cushion. Nothing about that is drawn as a special
        case. Each person is a line from the surface to their head, and the picture is a flat
        shadow of the sphere, so somebody at the edge of the disc is seen side-on at full height
        and somebody in the middle is seen from directly overhead, which makes them a dot with a
        head on it.
      </p>
      <p>
        Their houses work the same way. A building at the edge is a tower sticking out sideways;
        the same building in the middle of the disc is a small bright roof. Watch one town cross
        the face of the planet and you see it stand up, lie down and stand up again.
      </p>

      <h2>Day and night</h2>
      <p>
        The sun is not a light that follows the camera. It is a fixed direction in space, and the
        planet turns underneath it, so night is simply the half of the world facing away. The
        boundary between the two is a circle drawn around the planet at right angles to the sun,
        which is why it is a straight line when the sun is off to one side and a wide curve when
        the sun is behind you.
      </p>
      <p>
        Nobody is told whether it is night where they are; it falls out of which way they are
        facing. Turn on the night lights and the windows come on in the buildings on the dark side, one
        town at a time, as the planet carries them out of the sun.
      </p>
      <p>
        Pad 8 picks somebody to follow. A ring appears over their head and the readout gives their
        latitude and the time on their own clock — noon when they are directly under the sun,
        midnight when they are furthest from it. Keep following them once they go round the back
        and the clock keeps running.
      </p>

      <h2>Poles and seasons</h2>
      <p>
        The axis is the dashed line through the middle. Where it comes out of the surface is a
        pole: <strong>N</strong> at the top of it, <strong>S</strong> at the bottom, each with an
        ice cap around it, and a spike on whichever of the two is facing you. The half of the axis behind the planet is
        hidden by the planet, which is a small thing that makes the picture read as solid.
      </p>
      <p>
        Knob 2 leans the axis over. Knob 3 walks the sun around the planet's orbit — a year, not a
        day. The two together are the seasons: lean the axis and then move the sun round, and the
        sun stops standing over the equator. The readout says which latitude it is standing over
        instead. Push the tilt up and take the sun round far enough and one pole never leaves the
        daylight while the other never sees it.
      </p>

      <h2>The pads</h2>
      <p>
        The pads are all about how the world is drawn. Pad 2 lays the latitude and longitude grid
        over it, every thirty degrees, with the equator picked out in a warmer colour. Pad 3 turns
        on the labels, including <em>dawn</em> and <em>dusk</em> on the two ends of the day-night
        line — and they are worked out, not guessed: dawn is the side of the line whose ground is
        moving into the sun.
      </p>
      <p>
        Pad 5 cycles the buildings from a village of low huts to a city of towers, and then to
        wilderness, which takes the buildings away and leaves the people standing on their own
        planet with the trees.
      </p>
    </>
  ),
};

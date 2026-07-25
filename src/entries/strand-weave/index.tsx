import type { Entry } from '../types';
import { createStrandWeave } from './sketch';

export const strandWeave: Entry = {
  slug: 'strand-weave',
  title: 'Strand Weave',
  date: '2026-05-30',
  dek: 'Fourteen hundred particles in a noise field, and eight taps that inject dye into it.',
  tags: ['flow field', 'noise', 'particles'],
  knobs: [
    { label: 'Field scale', default: 0.3 },
    { label: 'Curl', default: 0.4 },
    { label: 'Flow speed', default: 0.4 },
    { label: 'Trail length', default: 0.65 },
    { label: 'Stroke width', default: 0.25 },
    { label: 'Field drift', default: 0.3 },
    { label: 'Jet force', default: 0.5 },
    { label: 'Hue', default: 0.0 },
  ],
  pads: Array.from({ length: 8 }, (_, i) => ({
    label: `Inject dye at site ${i + 1} (${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i]})`,
  })),
  factory: createStrandWeave,
  body: (
    <>
      <p>
        A flow field is the cheapest way to make a computer look like it is drawing with intent. You
        sample a smooth noise function at every particle's position, treat the value as an angle,
        and push the particle that way. Do it fourteen hundred times a frame with a low-alpha stroke
        and the accumulated paths turn into something that looks combed.
      </p>
      <p>
        The pads inject dye. Eight sites sit on a circle, one per pad, and a hit sprays several dozen
        fresh particles from that point with their own colour and their own outward momentum. The
        interesting part is what happens next: injected particles do not immediately obey the field.
        They blend toward it over about a third of a second, so a hard hit throws a coloured spike
        straight across the weave before the field bends it back into line. That transition is the
        whole reason <strong>Jet force</strong> is on a knob.
      </p>
      <p>
        <strong>Field scale</strong> and <strong>Curl</strong> fight each other productively. A large
        scale with high curl gives you tight vortices packed together; a small scale with low curl
        gives long parallel rivers that take twenty seconds to cross the screen. Somewhere between
        them is a setting where the field has both, and the dye pools in the slow parts.
      </p>
      <p>
        Particles are recycled, never created — the pool is fixed at fourteen hundred and a burst
        overwrites the oldest ones. It keeps the frame budget flat no matter how hard you play, which
        matters when the whole point is that you can play it hard.
      </p>
    </>
  ),
};

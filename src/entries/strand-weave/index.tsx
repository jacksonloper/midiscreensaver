import type { Entry } from '../types';
import { createStrandWeave } from './sketch';

export const strandWeave: Entry = {
  slug: 'strand-weave',
  title: 'Dye in a flow field',
  date: '2026-05-30',
  dek: 'Fourteen hundred particles follow a noise field. Each pad injects coloured dye at one of eight sites.',
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
        Fourteen hundred particles move through a noise field. Each frame, every particle samples a
        smooth noise function at its own position, reads the value as an angle, and moves that way,
        drawing a faint line as it goes. The combed look is those lines accumulating.
      </p>
      <p>
        Each pad injects dye at one of eight sites around a circle: several dozen fresh particles with
        their own colour and their own outward speed. They do not follow the field straight away —
        they blend into it over about a third of a second, so a hard hit throws a coloured spike
        across the weave before the field bends it into line. <strong>Jet force</strong> sets how far
        that spike gets.
      </p>
      <p>
        <strong>Field scale</strong> and <strong>Curl</strong> pull against each other. A large scale
        with high curl gives tight vortices packed together; a small scale with low curl gives long
        parallel rivers that take twenty seconds to cross the screen. Between them is a setting where
        the dye pools in the slow parts.
      </p>
      <p>
        The particle count is fixed. A burst overwrites the oldest particles rather than adding new
        ones, so the frame rate holds up however hard you play.
      </p>
    </>
  ),
};

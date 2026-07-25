import type { Entry } from '../types';
import { createChromaRain } from './sketch';

const ALPHABET_NAMES = [
  'katakana',
  'binary',
  'greek',
  'box drawing',
  'cyrillic',
  'hexadecimal',
  'operators',
  'latin',
];

export const chromaRain: Entry = {
  slug: 'chroma-rain',
  title: 'Chroma Rain',
  date: '2026-07-11',
  dek: 'Falling glyphs where each pad owns both a column band and an alphabet.',
  tags: ['type', 'rain', 'canvas tricks'],
  knobs: [
    { label: 'Glyph size', default: 0.32 },
    { label: 'Fall speed', default: 0.35 },
    { label: 'Density', default: 0.5 },
    { label: 'Trail length', default: 0.7 },
    { label: 'Hue', default: 0.0 },
    { label: 'Hue spread', default: 0.25 },
    { label: 'Head glow', default: 0.4 },
    { label: 'Jitter', default: 0.0 },
  ],
  pads: ALPHABET_NAMES.map((name, i) => ({
    label: `Re-seed band ${i + 1} in ${name}`,
  })),
  factory: createChromaRain,
  body: (
    <>
      <p>
        Yes, it is that effect. I wanted it anyway, because the standard implementation is a small
        lesson in doing less work. The obvious approach redraws each column's tail every frame:
        twenty glyphs per column, a hundred columns, sixty times a second. The trick is to notice
        that the tail never changes — it only dims. So you draw one glyph per column per step and let
        a translucent black rectangle over the whole canvas do the dimming for you. The tail is not
        drawn. It is the residue of what you already drew.
      </p>
      <p>
        That single decision is why <strong>Trail length</strong> is a knob and not a constant. It is
        the alpha of that rectangle, and it costs nothing to change. Near the bottom of its range the
        glyphs persist so long the screen fills up and starts to glow; near the top you get sparse
        heads with almost no memory behind them.
      </p>
      <p>
        Each pad does two things at once. It re-seeds its eighth of the columns from the top, and it
        switches the alphabet — katakana, binary, greek, box drawing, cyrillic, hex, operators, latin.
        Playing across all eight pads leaves eight vertical bands in eight different scripts falling
        at eight different rates, which is a good deal more legible than it sounds, because each band
        keeps the colour of the pad that started it.
      </p>
      <p>
        <strong>Jitter</strong> starts at zero and should probably stay there most of the time. Past
        about a third it stops looking like rain and starts looking like a signal problem, which is
        occasionally what you want.
      </p>
    </>
  ),
};

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
  title: 'Falling glyphs',
  date: '2026-07-11',
  dek: 'Columns of falling glyphs. Each pad re-seeds an eighth of the screen and sets the alphabet it falls in.',
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
        Each pad does two things: it re-seeds its eighth of the columns from the top, and it sets the
        alphabet for that band — katakana, binary, greek, box drawing, cyrillic, hex, operators,
        latin. Play all eight and you get eight bands in eight scripts, each keeping the colour of the
        pad that started it.
      </p>
      <p>
        The tails are not redrawn. Each column draws one glyph per step, and a translucent black
        rectangle over the whole canvas dims everything already there. The tail is what is left of
        earlier frames.
      </p>
      <p>
        That is why <strong>Trail length</strong> can be a knob rather than a constant: it is the
        alpha of that rectangle, and changing it costs nothing. Low, and glyphs persist until the
        screen fills up and glows; high, and the heads fall with almost nothing behind them.
      </p>
      <p>
        <strong>Jitter</strong> starts at zero. Past about a third it stops looking like rain and
        starts looking like a broken signal, which is occasionally what you want.
      </p>
    </>
  ),
};

import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { clamp, fade, hsl, mulberry32, padHue, range } from '../../screensaver/util';

/** One alphabet per pad. Hitting a pad changes what the rain is made of. */
const ALPHABETS = [
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ',
  '01',
  'αβγδεζηθικλμνξοπρστυφχψω',
  '│┃┆┊┋╎╏║╽╿┇┅┄─━',
  'БГДЖЗИЙЛПФЦЧШЩЪЭЮЯ',
  '0123456789ABCDEF',
  '+−×÷=≠≈∞∫∂∇√∑∏±≤≥⊕⊗',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
];

interface Column {
  /** Fractional row index of the falling head. */
  row: number;
  /** Last row that actually got a glyph painted. */
  drawn: number;
  rowsPerSecond: number;
  hue: number;
  alphabet: number;
  /** Extra brightness from a recent pad hit, decays to zero. */
  heat: number;
  active: boolean;
}

/**
 * Falling glyphs, one alphabet per pad. The trail is the canvas fade rather
 * than a redrawn tail, so a thousand columns cost about as much as one.
 */
export const createChromaRain: SketchFactory = (): Sketch => {
  const rand = mulberry32(0xc0ffee);
  let columns: Column[] = [];
  let cellWidth = 18;
  let cellHeight = 22;
  let alphabet = 0;

  const rebuild = (width: number, size: number) => {
    cellWidth = size * 0.78;
    cellHeight = size * 1.08;
    const count = Math.max(1, Math.ceil(width / cellWidth));
    if (columns.length === count) return;
    const next: Column[] = [];
    for (let i = 0; i < count; i++) {
      next.push(
        columns[i] ?? {
          row: -rand() * 60,
          drawn: -1e6,
          rowsPerSecond: 6 + rand() * 22,
          hue: 150,
          alphabet: 0,
          heat: 0,
          active: rand() < 0.5,
        },
      );
    }
    columns = next;
  };

  return {
    setup({ width }) {
      columns = [];
      rebuild(width, 22);
    },

    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kSize, kSpeed, kDensity, kTrail, kHue, kSpread, kGlow, kChaos] = midi.knobs;

      const size = range(kSize, 10, 44);
      const speedScale = range(kSpeed, 0.35, 3.4);
      const density = range(kDensity, 0.06, 1);
      const trailAlpha = range(kTrail, 0.34, 0.02);
      const hueShift = kHue * 360;
      const spread = range(kSpread, 0, 90);
      const glow = kGlow;
      const chaos = kChaos;

      rebuild(width, size);

      for (const hit of midi.hits) {
        alphabet = hit.pad;
        const hue = padHue(hit.pad, hueShift);
        // Each pad owns a vertical band; a hit re-seeds that band from the top.
        const band = columns.length / 8;
        const start = Math.floor(hit.pad * band);
        const end = Math.floor((hit.pad + 1) * band);
        for (let i = start; i < end; i++) {
          const col = columns[i];
          if (!col) continue;
          col.active = true;
          col.row = -rand() * 6;
          col.drawn = -1e6;
          col.hue = hue;
          col.alphabet = hit.pad;
          col.heat = 0.5 + hit.velocity;
          col.rowsPerSecond = (6 + rand() * 22) * (0.6 + hit.velocity);
        }
      }

      fade(ctx, width, height, trailAlpha);
      ctx.textBaseline = 'top';
      ctx.font = `${Math.round(size)}px ui-monospace, "SFMono-Regular", "Menlo", monospace`;
      ctx.globalCompositeOperation = 'lighter';

      const chars = ALPHABETS[alphabet] ?? ALPHABETS[0];

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        col.heat *= Math.pow(0.5, dt / 0.7);

        if (!col.active) {
          if (rand() < density * dt * 2.2) {
            col.active = true;
            col.row = -rand() * 12;
            col.drawn = -1e6;
            col.hue = padHue(col.alphabet, hueShift) + (rand() - 0.5) * spread;
            col.rowsPerSecond = 6 + rand() * 22;
          }
          continue;
        }

        col.row += col.rowsPerSecond * speedScale * dt;
        const head = Math.floor(col.row);
        if (head === col.drawn) continue;

        // Paint every row the head crossed this frame so fast columns stay solid.
        const from = Math.max(col.drawn + 1, head - 4);
        const x = i * cellWidth;
        const set = ALPHABETS[col.alphabet] ?? chars;

        for (let r = from; r <= head; r++) {
          if (r < 0) continue;
          const y = r * cellHeight;
          const glyph = set[Math.floor(rand() * set.length)] ?? '0';
          const isHead = r === head;
          const jitter = chaos > 0.02 ? (rand() - 0.5) * chaos * cellWidth * 0.8 : 0;

          if (isHead) {
            ctx.fillStyle = hsl(col.hue, 60, clamp(78 + col.heat * 18, 0, 96), 0.95);
            if (glow > 0.02) {
              ctx.shadowColor = hsl(col.hue, 95, 60, 1);
              ctx.shadowBlur = glow * 26 * (0.5 + col.heat);
            }
          } else {
            ctx.fillStyle = hsl(col.hue, 85, clamp(38 + col.heat * 24, 0, 70), 0.75);
            ctx.shadowBlur = 0;
          }
          ctx.fillText(glyph, x + jitter, y);
          ctx.shadowBlur = 0;
        }

        col.drawn = head;
        if (col.row * cellHeight > height + cellHeight * 8) {
          col.active = rand() < density;
          col.row = -rand() * 30;
          col.drawn = -1e6;
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    },
  };
};

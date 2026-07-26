import type { Entry } from '../types';
import { createAreaModel } from './sketch';

export const areaModel: Entry = {
  slug: 'area-model',
  title: 'Sixteen Little Rectangles',
  date: '2026-07-26',
  dek: 'Four knobs are the terms of one factor and four are the terms of the other; the screen is the rectangle they multiply out to, cut into every partial product.',
  tags: ['arithmetic', 'multiplication', 'canvas'],
  knobs: [
    { label: 'x₁', default: 2 / 3 },
    { label: 'x₂', default: 1 },
    { label: 'x₃', default: 1 / 3 },
    { label: 'x₄', default: 2 / 3 },
    { label: 'y₁', default: 1 },
    { label: 'y₂', default: 1 / 3 },
    { label: 'y₃', default: 2 / 3 },
    { label: 'y₄', default: 1 / 3 },
  ],
  pads: [
    { label: 'Cycle the palette' },
    { label: 'Unit grid on or off' },
    { label: 'Partial-product labels on or off' },
    { label: 'Blocks flush, split or exploded' },
    { label: 'Fill: solid, dots, hatch, outline' },
    { label: 'Glow on or off' },
    { label: 'Sweep the sixteen products, one at a time' },
    { label: 'Readout: full, product, bare' },
  ],
  factory: createAreaModel,
  body: (
    <>
      <p>
        Eight knobs, eight numbers, each one of 0, 1, 2 or 3. The first four add up to the width of a
        rectangle and the last four add up to its height, and the rectangle is the product. That is
        the entire post. There is no simulation running underneath and nothing decays over time —
        turn a knob and the shape is immediately the answer to a different multiplication.
      </p>
      <p>
        The knobs snap. There is no 2.4 to be had: the position rounds to a whole number and the
        block grows or shrinks to match, so sweeping <strong>x₂</strong> from end to end feels like
        four detents rather than a slide. Multiplication of whole numbers is a discrete business and
        it seemed dishonest to let the picture pretend otherwise.
      </p>
      <p>
        Because each side is a sum of four terms, the rectangle is cut into sixteen blocks — every
        x term against every y term. Each block is a partial product, and each is labelled with the
        multiplication it stands for and the number of unit squares it contains. The blocks are the
        distributive law. Add up all sixteen and you get the same number as multiplying the two totals,
        not as a fact to be memorised but as an observation about a rectangle you cut into pieces and
        did not otherwise disturb.
      </p>

      <h2>Why the board never changes size</h2>
      <p>
        The dotted square behind everything is twelve by twelve, and it is always twelve by twelve.
        Four terms at three apiece is the largest either side can be, so 144 is as big as the product
        gets and every rectangle you can make is some corner of that same board. Nothing rescales:
        one unit square is one unit square whatever the knobs say.
      </p>
      <p>
        This is the decision the whole thing rests on. It would have been easy to zoom the rectangle
        to fill the frame — it would look better, most of the time — but then 6 × 6 and 12 × 12 would
        be the same picture, and the point is that one of them is four times the other. Keeping the
        scale fixed means the growth is the readout. Take <strong>x₃</strong> from 1 to 2 and a
        column's worth of area appears across the full height of the rectangle, which is a much more
        useful thing to watch than a number in the corner changing.
      </p>
      <p>
        Terms sitting at zero do not disappear quietly. Their labels stay in the gutter, dimmed, with
        no block behind them, so you can see which of the four you have switched off. Multiplying by
        zero deletes a whole column of partial products in one turn, and it is worth being able to
        watch that happen rather than being told about it.
      </p>

      <h2>The pads do not do arithmetic</h2>
      <p>
        Every pad is styling. The number is in the knobs and only in the knobs — hit all eight pads in
        any order and the product is the number it was before. What they change is how much of the
        structure the picture is showing at once, which turns out to matter more than it sounds.
      </p>
      <p>
        <strong>Unit grid</strong> rules every block into single squares, at which point the rectangle
        stops being an area and becomes something you could count if you had the afternoon.{' '}
        <strong>Fill</strong> goes further: on <em>dots</em>, each block draws one dot per unit square,
        so a 3 × 2 block is unmistakably six of something. <em>Hatch</em> and <em>outline</em> pull the
        colour back out when the sixteen labels are what you want to read.
      </p>
      <p>
        <strong>Blocks</strong> is the one to reach for first. Flush, the sixteen pieces make one solid
        rectangle. Split, thin lanes open between them. Exploded, they separate properly and you can
        see there is nothing between the pieces — the rectangle really is those sixteen products and
        nothing else. The board grows the gaps out of its own margin, so the picture never outruns the
        frame however far apart the blocks are pushed.
      </p>
      <p>
        <strong>Sweep</strong> walks the highlight across all sixteen in reading order, naming each
        product and keeping a running total in the panel, then starts again from the top-left. It is
        the slow version of the argument the picture makes all at once: sixteen small multiplications,
        added up, are one big one. Left running it is also the most screensaver-ish this blog gets.
      </p>
      <p>
        <strong>Palette</strong> cycles four ways of colouring the same sixteen blocks, and they are
        not interchangeable. <em>Columns</em> gives each x term a hue and each y term a lightness, so
        the grid reads as a multiplication table. <em>Diagonals</em> colours by x + y, which makes the
        symmetry between x₂y₃ and x₃y₂ obvious. <em>Magnitude</em> ignores position entirely and
        colours by the size of the partial product, turning the rectangle into a heat map where the
        3 × 3 corners glow and the small pieces go cold. Same sixteen numbers, three different things
        to notice about them.
      </p>
    </>
  ),
};

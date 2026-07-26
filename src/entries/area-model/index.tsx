import type { Entry } from '../types';
import { createAreaModel } from './sketch';

export const areaModel: Entry = {
  slug: 'area-model',
  title: 'Multiplication as a rectangle',
  date: '2026-07-26',
  dek: 'Eight knobs set eight small numbers. The screen shows the rectangle they multiply out to, cut into its sixteen parts.',
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
    { label: 'Palette' },
    { label: 'Unit grid' },
    { label: 'Block labels' },
    { label: 'Spacing: flush, split, exploded' },
    { label: 'Fill: solid, dots, hatch, outline' },
    { label: 'Glow' },
    { label: 'Sweep the blocks and add them up' },
    { label: 'Readout: full, product, none' },
  ],
  factory: createAreaModel,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Knobs 1 to 4 set four numbers, x₁ to x₄. Knobs 5 to 8 set y₁ to y₄. Each knob gives 0, 1, 2
        or 3, and snaps to whole numbers, so there is nothing in between.
      </p>
      <p>
        The rectangle is x₁ + x₂ + x₃ + x₄ wide and y₁ + y₂ + y₃ + y₄ tall. Its area is the product
        of those two sums, and that is the big number on the right.
      </p>

      <h2>The sixteen blocks</h2>
      <p>
        The rectangle is divided into one block for each pair of terms: the block in column 2, row 3
        is x₂ × y₃. There are four terms a side, so there are sixteen blocks, and each is labelled
        with its own multiplication and answer.
      </p>
      <p>
        Add up the sixteen and you get the same number as multiplying the two sums. Pad 7 does this
        for you, one block at a time, keeping a running total.
      </p>
      <p>
        Setting a term to 0 removes its column or row. Its label stays in the margin, so you can see
        which one you turned off.
      </p>

      <h2>The grid behind it</h2>
      <p>
        The dotted grid is 12 by 12 and never changes size. Four terms of 3 is the largest either
        side can be, so 144 squares is the largest rectangle available.
      </p>
      <p>
        Nothing zooms to fit: one unit square is the same size whatever the knobs say. Double both
        sums and the rectangle gets four times bigger on screen.
      </p>

      <h2>The pads</h2>
      <p>
        The pads change how the picture is drawn and nothing else; the product comes from the knobs
        alone. All eight are listed with the controls, but two are worth trying first. Pad 5 set to{' '}
        <em>dots</em> draws one dot per unit square, so each block is something you can count. Pad 7
        walks through the blocks in order and adds them up as it goes.
      </p>
      <p>
        Pad 1 cycles four colourings. <em>Columns</em> gives each x term its own colour,{' '}
        <em>diagonals</em> colours by x + y, and <em>magnitude</em> colours by the size of the block
        rather than by where it sits.
      </p>
    </>
  ),
};

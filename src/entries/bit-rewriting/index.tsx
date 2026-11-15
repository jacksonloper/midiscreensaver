import type { Entry } from '../types';
import { createBitRewriting, knobForRewrites } from './sketch';

export const bitRewriting: Entry = {
  slug: 'bit-rewriting',
  title: 'Growing a bit and cutting it back',
  date: '2026-11-15',
  dek: 'A single 0 or 1 is rewritten into a long expression that is still worth exactly the same, and then simplified back down to that bit, one rule at a time.',
  tags: ['algebra', 'rewriting', 'canvas'],
  knobs: [
    { label: 'Rewrites while growing', default: knobForRewrites(24) },
    { label: 'Pace', default: 0.55 },
    { label: 'Which run', default: 0.1 },
    { label: 'Type size', default: 0.5 },
    { label: 'Rules allowed while growing', default: 1 },
    { label: 'Highlight glow', default: 0.5 },
    { label: 'Pause at the ends', default: 0.35 },
    { label: 'Size graph height', default: 0.35 },
  ],
  pads: [
    { label: 'Start from 0' },
    { label: 'Start from 1' },
    { label: 'Next step, by hand' },
    { label: 'Play' },
    { label: 'Skip to simplifying' },
    { label: 'Strategy: biggest cut first, outermost first, innermost first' },
    { label: 'Rule list' },
    { label: 'Palette: night, chalkboard, violet, ember' },
  ],
  factory: createBitRewriting,
  body: (
    <>
      <h2>What to do</h2>
      <p>
        Each run starts from a single bit, a 0 or a 1. The screen then rewrites it again and
        again, and every rewrite makes it longer without changing what it is worth. After a couple
        of dozen rewrites the bit is a page of brackets, ones, zeros, pluses and minuses. Then the
        run turns around and simplifies the long expression, one rule at a time, until only the
        bit is left.
      </p>
      <p>
        Before each rewrite, the subterm that is about to go lights up. After it, the subterm that
        replaced it lights up. Orange means growing and green means simplifying. The rule being
        used is written above the expression, and the list on the right keeps the whole history.
        The number in the top corner is the value of whatever is on screen. It never changes
        during a run.
      </p>
      <p>
        Pads 1 and 2 start again from 0 or from 1. Out of the box, runs alternate between the two.
        Pad 3 stops the playback and moves one step each time you hit it, and pad 4 lets it play
        again. Pad 5 cuts the growing short and starts simplifying straight away.
      </p>

      <h2>The rules that grow it</h2>
      <p>
        Every growing rule is an identity read backwards. Here they are, tamest first. Knob 5
        decides how far down this list the growth may go. Turn it all the way down and you get
        only the first two.
      </p>
      <ul>
        <li>x → x + 0, and x → 1 · x</li>
        <li>0 → 1 − 1</li>
        <li>x → x − 0</li>
        <li>1 → (1 + 1) − 1</li>
        <li>x → x · x, but only when x is worth 0 or 1</li>
        <li>x → 1 − (1 − x)</li>
        <li>a + b → b + a</li>
        <li>a · (b + c) → a · b + a · c</li>
        <li>0 → 0 · t, where t is a copy of some other piece of the expression</li>
        <li>x → (x + 1) − 1</li>
      </ul>
      <p>
        Here x stands for any subterm at all, so x → x + 0 can wrap a single 1 or half the
        expression. Each rewrite picks a rule at random, then picks one of the places it can be
        used. Knob 3 picks one of 64 runs. Knob 1 sets how many rewrites there are. Turning it up
        extends the same expression rather than starting a new one, because each rewrite draws its
        random numbers in the same order.
      </p>

      <h2>The one rule that needs a bit</h2>
      <p>
        All but one of those rules are true for any number. x · x = x is not: it holds for 0 and
        for 1 and for nothing else. It is the one rule that knows the expression started life as a
        bit, and it only fires on a subterm that is still worth 0 or 1. That holds at the start
        and in a lot of places later, but not everywhere: 1 + 1 inside a (1 + 1) − 1 is worth 2,
        so that rule leaves it alone.
      </p>

      <h2>The rules that cut it back</h2>
      <p>
        Simplifying uses the same identities read forwards, x + 0 → x, 1 · x → x, x − x → 0 and
        so on, plus 0 · x → 0, which throws away any amount of expression in one go. When none of
        those fits, two plain numbers next to each other are worked out: 1 + 1 → 2, 2 − 1 → 1.
        Every simplifying rule makes the expression strictly shorter, so the simplifying always
        stops. And it can only stop at a number, because there is always some innermost pair of
        numbers to work out. Since no rule changes the value, that number is the bit.
      </p>
      <p>
        The simplifier does not undo the growth step by step. It has no record of what was done,
        only the expression in front of it. The graph at the bottom of the screen plots the size
        of each expression in turn, and it is rarely symmetrical: the way down is usually a
        different shape from the way up.
      </p>

      <h2>Where to cut first</h2>
      <p>
        Often several rules fit at once, in different places. Pad 6 picks which one goes first.
        Biggest cut first takes whichever rewrite removes the most of the expression, so a 0 · t
        is gone in a single step. Outermost first takes the one nearest the top of the tree.
        Innermost first works from the deepest numbers outwards, which is how you would do it with
        a pencil. Every strategy gets to the same bit, but not in the same number of steps.
        With the settings the post opens with, 24 rewrites out, biggest cut first and outermost
        first both get back in about 19 or 20 steps on average. Innermost first takes about 40,
        never fewer than the growth took. Working from the inside, it adds up numbers that
        are about to be multiplied by 0 anyway, and it works out 1 − (1 − x) the long way instead
        of using a − (a − x) → x. Switch strategy
        while it is simplifying and the rest of the run is worked out again from where it is.
      </p>
      <p>
        The brackets on screen follow the shape of the tree exactly. 1 + (1 + 0) keeps its
        brackets even though the sum is the same without them, because the rewrite that made it
        built it that way, and the next rule has to match that shape.
      </p>
    </>
  ),
};

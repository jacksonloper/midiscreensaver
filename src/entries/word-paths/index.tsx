import type { Entry } from '../types';
import { createWordPaths, knobForLambda, knobForLength, knobForRules } from './sketch';

export const wordPaths: Entry = {
  slug: 'word-paths',
  title: 'Two words, one path',
  date: '2026-11-15',
  dek: 'Somebody swaps letters according to a short list of rules and shows you only the first word and the last. Finding a way from one to the other is the whole problem.',
  tags: ['rewriting', 'search', 'cryptography', 'canvas'],
  knobs: [
    { label: 'Swaps the generator makes', default: knobForLambda(24) },
    { label: 'Pace', default: 0.55 },
    { label: 'Which words', default: 0.1 },
    { label: 'Tile size', default: 0.5 },
    { label: 'Rule set, 0 to 2', default: knobForRules(2) },
    { label: 'Length of the first word', default: knobForLength(12) },
    { label: 'Pause after each walk', default: 0.35 },
    { label: 'Graph height', default: 0.5 },
  ],
  pads: [
    { label: "The generator's own chain of swaps" },
    { label: 'Attacker 1: get closer each time' },
    { label: 'Attacker 2: simplify both words' },
    { label: 'Attacker 3: try everything' },
    { label: 'Next swap, by hand' },
    { label: 'Play' },
    { label: 'New words' },
    { label: 'Palette: night, chalkboard, violet, ember' },
  ],
  factory: createWordPaths,
  body: (
    <>
      <h2>The game</h2>
      <p>
        A word here is a row of coloured tiles. A rule is a pair of short words, and it says
        that either one may be swapped for the other wherever it appears. The rules do not mean
        anything. There are no numbers behind the letters and nothing to work out.
      </p>
      <p>
        A generator takes a word, makes some swaps, and shows you the word it started with, the
        word it ended with, and the list of rules. It keeps its swaps to itself. The claim is
        "this word can be turned into that one". The task is to find some chain of swaps that
        does it. It need not be the generator's chain.
      </p>
      <p>
        Checking a chain is trivial: look at each swap and see that it is one of the rules.
        Making a puzzle is trivial too: just swap. The question is how hard it is to find a
        chain when all you have is the two ends.
      </p>

      <h2>What to do</h2>
      <p>
        The screen plays four walks in turn, and pads 1 to 4 jump to any of them. First the
        generator's own chain, then three attackers who were given only the two words. The big
        row is the word as it stands. The small rows above and below are the first word and the
        target. Before each swap the letters about to go are outlined, and the rule in use is
        written above and outlined in the list on the right.
      </p>
      <p>
        The graph at the bottom counts how many letters differ from the target along each walk.
        A dot on the floor means the walk arrived, a cross means it got stuck, and an upright
        bar means it gave up.
      </p>
      <p>
        Knob 1 sets how many swaps the generator makes. Knob 5 picks the rules and knob 6 the
        length of the first word. Pad 7 or knob 3 gives new words. Pad 5 steps by hand and pad 6
        plays again.
      </p>

      <h2>Three attackers</h2>
      <p>
        Attacker 1 always makes the swap that leaves the word looking most like the target, and
        stops when no swap makes it look more like the target. That is the first thing anyone
        tries. Watch the generator's own line on the graph to see why it fails: the generator's
        chain wanders, and it is often further from the target in the middle than at the start.
        Looking more like the target is not the same as being closer to it.
      </p>
      <p>
        Attacker 2 tries to simplify. It reads every rule in one direction only, the one that
        makes the word shorter or, at the same length, earlier in the alphabet. It simplifies
        both words as far as they will go. If they end at the same word, it has a chain: down
        from one and back up to the other. If they end at different words, it has learned
        nothing, because two different dead ends may still be connected some other way.
      </p>
      <p>
        Attacker 3 tries everything. Every word one swap from either end, then every word two
        swaps away, and so on, until the two sides meet. If a chain exists it will find the
        shortest one. Its cost is the number of words it has to look at, and it gives up at
        60,000.
      </p>

      <h2>Three sets of rules</h2>
      <p>
        <strong>Any two neighbours may swap.</strong> With these rules two words are connected
        exactly when they have the same letters. Attacker 2 wins every time, because there is a
        standard form: sort the letters. Attacker 3, which knows nothing about sorting, has to
        look at about 400 words to undo 8 swaps and about 31,000 to undo 60, and it gave up on 28% of
        the 60-swap puzzles. Rules with structure in them are easy if you know the structure
        and expensive if you do not.
      </p>
      <p>
        <strong>Tseitin's seven rules.</strong> These are famous. In 1958 Tseitin showed that
        for these seven rules on five letters there is no method at all, however slow, that
        decides for every pair of words whether they are connected. It is one of the smallest
        known examples. On the words this generator makes, though, they are easy: few of the
        rules apply to a typical word, so there are not many places to go, and attacker 3 found
        a chain in 93% of 60-swap puzzles after looking at about 3,600 words. A problem can
        be impossible in general and easy on the examples in front of you.
      </p>
      <p>
        <strong>Six random rules.</strong> A fresh list each time: three that keep the length
        and three that change it. Here nobody has a standard form to offer. Attacker 2 succeeded
        on 24% of 8-swap puzzles and 6% of 60-swap ones. Attacker 3 succeeded on every
        8-swap puzzle after looking at about 140 words, and on 70% of 60-swap ones.
      </p>

      <h2>What the numbers say</h2>
      <p>
        The count of words that attacker 3 looks at is the thing to watch. With random rules it
        was about 28 for 4 swaps, 140 for 8, 560 for 16 and 2,400 for 32. The panel on
        the right lists how many new words turn up at each distance from the first word, and
        each number is roughly a multiple of the one before. The generator's work grows by one swap at a
        time. The search's work multiplies.
      </p>
      <p>
        Attacker 3 also often finds a shorter chain than the generator's. After 32 random-rule
        swaps the shortest chain was typically only 12 swaps long. A generator that swaps
        at random mostly goes in circles, so this one tries to move away from its starting word
        at each swap, and it still ends up nearer than it thinks. A good puzzle needs the two
        words to be far apart by the shortest route, not just by the route the generator took.
      </p>
      <p>
        At this size the puzzles are small enough for attacker 3 to win most of the time. The
        point is the trend. Each extra swap of real distance multiplies the words to look at,
        and the words here are at most 24 letters long. With longer words and more rules there
        are more swaps available at every step, the multiplying is faster, and the generator's
        work is still one swap at a time.
      </p>

      <h2>Why there are no numbers</h2>
      <p>
        Two earlier posts tried this with ordinary algebra:{' '}
        <a href="/posts/bit-rewriting">hiding a zero</a> and{' '}
        <a href="/posts/solve-rewriting">solving for x, y and z</a>. Both kept running into the
        same thing. When the symbols stand for numbers, an attacker can compute with them: plug
        values in, multiply out to a standard form, factor. The puzzle was never whether two
        expressions were equal, which could always be checked, but only how to get from one to
        the other.
      </p>
      <p>
        Taking the meaning away leaves just that. With no values to plug in and, for most rule
        sets, no standard form to head for, the attacker has only the rules and the two words.
        Whatever cleverness is left has to come from the shape of the rules themselves.
      </p>

      <h2>Checking it</h2>
      <p>
        The game is in one file with no dependencies, and <code>node tests/words-check.mjs</code>{' '}
        runs it on 840 puzzles and prints the table. It checks that every step of every walk is
        one rule used once, that every successful walk really joins the two words, and that
        attacker 3 never returns a chain longer than the generator's. The numbers above are from
        that script with <code>SEEDS=200</code>.
      </p>
    </>
  ),
};

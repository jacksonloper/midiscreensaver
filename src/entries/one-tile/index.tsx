import type { Entry } from '../types';
import { createOneTile, knobForLambda, knobForRules, knobForSize } from './sketch';

export const oneTile: Entry = {
  slug: 'one-tile',
  title: 'Back to one tile',
  date: '2026-11-15',
  dek: 'A single tile is turned into a board full of tiles by swaps from a short public list. The claim is that the mess can be turned back into the one tile. Finding how is the whole problem.',
  tags: ['rewriting', 'search', 'cryptography', 'canvas'],
  knobs: [
    { label: 'Swaps the generator makes', default: knobForLambda(24) },
    { label: 'Pace', default: 0.55 },
    { label: 'Which board', default: 0.1 },
    { label: 'Palette', default: 0.1 },
    { label: 'Rule set, 0 or 1', default: knobForRules(1) },
    { label: 'Board size', default: knobForSize(2) },
    { label: 'Pause after each walk', default: 0.35 },
    { label: 'Graph height', default: 0.5 },
  ],
  pads: [
    { label: 'Watch one tile become a mess' },
    { label: 'Attacker 1: remove a tile whenever possible' },
    { label: 'Attacker 2: simplify both boards' },
    { label: 'Attacker 3: try everything' },
    { label: "The generator's way back, with the key" },
    { label: 'Next swap, by hand' },
    { label: 'Play' },
    { label: 'New board' },
  ],
  factory: createOneTile,
  body: (
    <>
      <h2>The game</h2>
      <p>
        The board is a grid. Each cell is empty or holds a lettered tile. Above the board is the
        complete list of allowed swaps. Each one is a pair of small patterns of the same shape,
        and wherever one of the pair appears on the board, it may be replaced by the other.
        Either way round, anywhere, as often as you like. The swaps do not mean anything. There
        are no numbers behind the letters and nothing to work out.
      </p>
      <p>
        A generator starts with one tile on an empty board and makes a number of swaps. It then
        shows you the mess it ended with, the single tile it started from, and the list. It
        keeps its swaps to itself. The claim is: this whole mess can be turned back into that
        one tile. The task is to find some chain of swaps that does it. It need not be the
        generator's chain.
      </p>
      <p>
        Checking a chain is trivial: look at each swap and see that it is on the list. Making a
        puzzle is trivial too: start with a tile and swap. The question is how hard it is to
        find a chain when all you have is the two ends.
      </p>

      <h2>What to do</h2>
      <p>
        The screen plays five walks in turn, and pads 1 to 5 jump to any of them. First the one
        tile growing into the mess. Then three attackers who were given only the mess and the
        tile. Last, the generator's own way back. Before each swap, the cells about to change
        are outlined on the board and the swap being used is outlined in the list. The two
        small boards on the left are the claim: the mess, and the one tile.
      </p>
      <p>
        The graph at the bottom counts the tiles on the board along each way back. A dot on the
        floor means the walk reached the one tile, a cross means it got stuck, and an upright
        bar means it gave up.
      </p>
      <p>
        Knob 1 sets how many swaps the generator makes. Knob 5 picks the list of swaps and knob
        6 the size of the board. Pad 8 or knob 3 gives a new board. Pad 6 steps by hand and pad
        7 plays again.
      </p>

      <h2>Three attackers</h2>
      <p>
        Attacker 1 makes any swap that removes a tile, and stops when no swap does. Getting from
        many tiles to one surely means removing tiles, so this is the first thing anyone tries.
        It almost never works. Watch the generator's way back on the graph: the count of tiles
        goes up as well as down. Some tiles have to be changed or moved before they can be
        removed, and sometimes a tile has to be added first.
      </p>
      <p>
        Attacker 2 tries to simplify. It reads every swap in one direction only, the one that
        leaves fewer tiles or, with the same number, an earlier board in dictionary order. It
        simplifies the mess as far as it will go, and the one tile too. If they end at the same
        board, it has a chain: down from one and back up to the other. If they end at different
        boards, it has learned nothing, because two different dead ends may still be connected
        some other way.
      </p>
      <p>
        Attacker 3 tries everything. Every board one swap from either end, then every board two
        swaps away, and so on, until the two sides meet. If a chain exists it will find the
        shortest one. Its cost is the number of boards it has to look at, and it gives up at
        60,000.
      </p>

      <h2>Two lists of swaps</h2>
      <p>
        <strong>Copy, slide and recolour.</strong> A tile may copy itself into the empty cell to
        its right or below, may slide into an empty neighbour, and a b may turn into an a. This
        list is tame. Read backwards, copying removes a tile, and everything can be reduced to
        a single a in the bottom right corner. So attacker 2 solved every board, at every size.
        Attacker 3, which does not know that, solved 90% of the boards made with 10 swaps on
        the 8 by 6 board, 8% of those made with 20, and 2% of those made with 30. A list
        with structure in it is easy if you see the structure and expensive if you do not.
      </p>
      <p>
        <strong>Seven random swaps.</strong> A fresh list each time. For each of the three
        letters, one swap that turns a tile and an empty neighbour into two tiles. Three swaps
        that change one pair of tiles into another pair. One that moves a tile and changes its
        letter. Here there is no standard form on offer: attacker 2 solved between 2% and 9% of
        boards made with 10 or more swaps. Attacker 1 solved 1% or fewer. Attacker 3 solved every board made with 10 swaps, after looking
        at about 280 boards. At 20 swaps it solved 72% after looking at about 11,000. At
        30 swaps it solved 45%, and at 40, 28%.
      </p>

      <h2>Why a grid</h2>
      <p>
        An earlier version of this post used a row of tiles. It made the same point less well,
        because a row gives a swap few places to happen. After 32 swaps of a 12-letter row, the
        search typically had about 2,400 words to look at and found a chain four times in
        five. On a grid every tile has neighbours in two directions, so there are more swaps
        available at every step, and the number of boards within a given distance grows much
        faster. The panel on the right lists how many new boards turn up at each distance from
        the mess. Each number is several times the one before.
      </p>
      <p>
        That is the whole lesson in one line of numbers. The generator's work grows by one swap
        at a time. The work of trying everything multiplies with every swap of distance. The
        generator can make the puzzle harder for the price of a few more swaps, and the search
        has to pay many times over to keep up.
      </p>

      <h2>What it does not show</h2>
      <ul>
        <li>
          Trying everything is only one attack. Nothing here shows that a cleverer attacker
          could not read something useful off a particular list of swaps, the way attacker 2
          does for the tame list. For general lists of swaps there is a theorem that no method
          settles every case, but that is about the worst case, not about the boards a
          particular generator makes.
        </li>
        <li>
          The generator's chain is not the shortest. Attacker 3 regularly finds a shorter one.
          A puzzle is only as hard as its shortest solution, and the generator does not know
          how long that is.
        </li>
        <li>
          The board is small so that it fits on a screen, and the budget of 60,000 boards is
          small so that the page stays quick. Both are choices, and a patient computer gets
          further than this one.
        </li>
      </ul>

      <h2>Why there are no numbers</h2>
      <p>
        Two earlier posts tried this with ordinary algebra:{' '}
        <a href="/posts/bit-rewriting">hiding a zero</a> and{' '}
        <a href="/posts/solve-rewriting">solving for x, y and z</a>. Both kept running into the
        same thing. When the symbols stand for numbers, an attacker can compute with them: plug
        values in, multiply out to a standard form, factor. Whether two expressions were equal
        could always be checked. The only hard part was how to get from one to the other.
      </p>
      <p>
        Taking the meaning away leaves just that part. With no values to plug in and, for most
        lists, no standard form to head for, the attacker has only the list and the two ends.
      </p>

      <h2>Checking it</h2>
      <p>
        The game is in one file with no dependencies, and <code>node tests/grid-check.mjs</code>{' '}
        runs it on 960 boards and prints the table. It checks that every step of every walk is
        one swap from the list used once, that the generator started from a single tile, that
        every successful walk really runs from the mess to that tile, and that attacker 3 never
        returns a chain longer than the generator's. The numbers above are from that script with{' '}
        <code>SEEDS=100</code>, on the 8 by 6 board.
      </p>
    </>
  ),
};

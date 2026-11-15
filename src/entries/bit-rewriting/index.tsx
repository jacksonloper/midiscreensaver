import type { Entry } from '../types';
import { createBitRewriting, knobForLambda, knobForLevel } from './sketch';

export const bitRewriting: Entry = {
  slug: 'bit-rewriting',
  title: 'Hiding a bit in algebra',
  date: '2026-11-15',
  dek: 'A generator hides a 0 or a 1 inside a long expression and keeps the way back. Three attackers who are given only the expression try to find a way back of their own.',
  tags: ['algebra', 'rewriting', 'cryptography', 'canvas'],
  knobs: [
    { label: 'Security parameter λ', default: knobForLambda(16) },
    { label: 'Pace', default: 0.55 },
    { label: 'Which instance', default: 0.1 },
    { label: 'Type size', default: 0.5 },
    { label: 'Generator, 0 to 4', default: knobForLevel(3) },
    { label: 'Palette', default: 0.1 },
    { label: 'Pause after each walk', default: 0.35 },
    { label: 'Graph height', default: 0.5 },
  ],
  pads: [
    { label: 'Watch the generator hide the bit' },
    { label: 'Attacker 1: downhill only' },
    { label: 'Attacker 2: sort, then downhill' },
    { label: 'Attacker 3: multiply everything out' },
    { label: 'The planted path, with the key' },
    { label: 'Next step, by hand' },
    { label: 'Play' },
    { label: 'New instance' },
  ],
  factory: createBitRewriting,
  body: (
    <>
      <h2>The problem</h2>
      <p>
        This post is a toy model of an open problem. Fix a list of ordinary algebraic identities.
        Call two expressions neighbours if one use of one identity, on one subterm, turns the
        first into the second. That makes a graph whose points are expressions, and every step
        along an edge leaves the function the expression computes unchanged.
      </p>
      <p>
        The problem asks for a generator. It should produce a long expression E together with a
        short walk through that graph from E down to a short expression T. Anyone can check the
        walk one step at a time. The hard part is the security requirement: somebody who is given
        E and not the walk should be unable to find any walk of reasonable length from E to any
        comparably short expression. They do not have to find the same walk, or even the same T.
      </p>
      <p>
        Nobody knows whether such a generator exists. This toy does not settle it, and every
        generator in it is broken by something. What it does is let you watch four different
        reasons a generator fails, and the one place where an attack starts to cost real work.
      </p>

      <h2>What to do</h2>
      <p>
        Here T is a single bit, 0 or 1. The screen plays five walks in turn on the same instance,
        and pads 1 to 5 jump to any of them. First the generator walks uphill from the bit to E.
        Then three attackers, who see only E, each try to walk back down. Last, the generator's
        own walk is played backwards: that is the planted path. Before each step the subterm
        about to be rewritten lights up, and the identity being used is written above the
        expression. Long walks are played fast.
      </p>
      <p>
        The graph at the bottom plots the size of the expression along each way down from E, with
        the number of steps on a logarithmic scale. A dot on the floor means the walk reached the
        bit, a cross means it got stuck, and an upright bar means it ran out of budget. The panel
        on the right says the same in words.
      </p>
      <p>
        Knob 5 picks one of five generators, each allowed to do more than the last. Knob 1 is the
        security parameter λ: how many times the generator hides something. Pad 8 or knob 3 gives
        a different instance. Pad 6 steps by hand and pad 7 plays again.
      </p>

      <h2>The identities</h2>
      <p>
        There are seventeen, and each may be used in either direction. A, B and C stand for any
        subterm.
      </p>
      <ul>
        <li>A + 0 = A, 0 + A = A, A · 1 = A, 1 · A = A, A · 0 = 0, 0 · A = 0</li>
        <li>A − A = 0, and A − B = A + (−1) · B</li>
        <li>A + B = B + A, and A · B = B · A</li>
        <li>(A + B) + C = A + (B + C), and (A · B) · C = A · (B · C)</li>
        <li>A · (B + C) = A · B + A · C, and (A + B) · C = A · C + B · C</li>
        <li>sin(A) · sin(A) + cos(A) · cos(A) = 1, and cos(A) · cos(A) = 1 − sin(A) · sin(A)</li>
        <li>arithmetic on two written-out whole numbers, such as 1 + 1 = 2</li>
      </ul>
      <p>
        Brackets on screen follow the tree exactly. (x + y) + z and x + (y + z) are two different
        points of the graph, one associativity step apart.
      </p>

      <h2>Knowing the answer is not the problem</h2>
      <p>
        Give every variable a random value and work E out. It comes to 0 or to 1, and that is T.
        This works on every generator here and takes no thought at all. The panel shows it as
        "plug in numbers".
      </p>
      <p>
        It does not break anything, because the problem asks for a walk, and a number is not a
        walk. It does show that the difficulty has to live in finding a proof, not in
        finding the answer. It also shows why a single bit is too easy a target for the real
        thing: the attacker here always knows where the walk must end.
      </p>

      <h2>Generators 0 and 1: downhill works</h2>
      <p>
        Generator 0 uses numbers only. It pads the bit with + 0 and · 1, and hides zeros as
        something minus itself or zero times something. Generator 1 does the same with variables,
        so the answer can no longer be reached by arithmetic alone.
      </p>
      <p>
        Attacker 1 beats both. It only ever takes an edge that makes the expression shorter, the
        biggest cut first, and stops when no edge does. Each thing the generator hid is still
        sitting there in the shape it was hidden in, so there is nearly always something to cut.
      </p>
      <p>
        Nearly, because on generator 1 it failed in about 1 instance in 100, and the reason is
        worth seeing. Factoring is a downhill step too: w · (1 + 0) + w · 1 is longer than
        w · (1 + 0 + 1). Attacker 1 took that step, and then the other copy, still written w + w, no
        longer matched it. So even a step that shortens the expression can be the wrong one.
        There are several ways down, and they do not all arrive.
      </p>

      <h2>Generator 2: a place with no way down</h2>
      <p>
        Generator 2 adds shuffling. After hiding something it uses commutativity and
        associativity a few times nearby. Those steps change neither the value nor the size. But
        after them, a hidden x · y − y · x no longer matches A − A, and no single identity
        shortens it.
      </p>
      <p>
        Now attacker 1 stops partway down, at an expression where every edge leads to something
        the same size or longer. The panel counts those edges for whatever is on screen. The
        planted path gets through because it knows which sideways steps to take first. In 200
        instances at each setting, attacker 1 reached the bit 48% of the time at λ = 8 and 6% of
        the time at λ = 40.
      </p>
      <p>
        Attacker 2 repairs this cheaply. It puts every sum and every product into one fixed
        bracketing and one fixed order, which takes only sideways steps, and then goes downhill
        again. Two terms that differ only by shuffling become letter for letter the same. It
        reached the bit in 98% to 100% of those instances. Shuffling hides nothing, because
        order and bracketing can be normalised without understanding anything else.
      </p>

      <h2>Generator 3: the way down goes up first</h2>
      <p>
        Generator 3 hides zeros as P − P where P is a product of several two-term sums, and its
        scrambling may also multiply brackets out. So one copy of P stays as a product while the
        other is partly expanded. Sorting cannot match them any more. At the opening setting,
        λ = 16, attacker 1 reached the bit in 2% of instances and attacker 2 in 25%.
      </p>
      <p>
        Attacker 3 always has an answer in principle. It multiplies everything out into a sum of
        plain terms in a fixed order and collects like terms. Any two polynomial expressions that
        are equal as functions come out identical, so a hidden zero comes out as 0. Every step is
        one of the seventeen identities, so the result is a valid walk.
      </p>
      <p>
        The trouble is its length. A product of k two-term sums is about 4k symbols long as
        written and has up to 2<sup>k</sup> terms multiplied out. On the graph, attacker 3 climbs a
        mountain before it comes down. At λ = 16 it finished in 90% of instances. Its typical walk
        was about 6,200 steps long and passed through expressions of about 700 nodes. The planted
        path was 96 steps and never holds anything longer than E, which was typically 235 nodes. At λ = 24 it finished inside its
        budget of 12,000 steps in 12% of instances, and at λ = 32 in none.
      </p>
      <p>
        This is the shape the open problem is after: a short walk that exists, and attackers
        whose walks get long quickly as λ grows. It is nowhere near a proof of anything, for
        the reasons below.
      </p>

      <h2>Generator 4: an identity that is not polynomial</h2>
      <p>
        Generator 4 also hides ones as sin² + cos² of some term, and scrambles those too.
        Multiplying out is not enough on its own now, because sin and cos are not polynomials.
        Attacker 3 copes by treating each sine and cosine as an extra variable and replacing
        every cos² with 1 − sin², which is the last identity on the list.
      </p>
      <p>
        That trick works for this one identity. It does not carry on working. For polynomials
        there is always a standard form to expand to. Once expressions may contain sin, the
        exponential function and absolute values together, a theorem of Richardson from 1968
        says there is no procedure at all that decides whether an expression is zero
        everywhere. That is a statement about the worst case. The open problem needs typical
        instances to be hard, which is a much stronger thing to ask.
      </p>

      <h2>Where this toy is weak</h2>
      <ul>
        <li>
          Each hidden piece is a self-contained subterm. An attacker can deal with them one at a
          time, and attacker 3 already does. A real construction would need the hiding to be
          tangled across the whole expression, so that no small part can be simplified alone.
        </li>
        <li>
          The products stop at eight factors so that E fits on a screen. The 12,000-step budget
          is what makes attacker 3 give up, not a law of nature. A patient attacker finishes.
        </li>
        <li>
          There is no factoring attacker. One copy of each P is still a product, and factoring
          the multiplied-out copy to match it is exactly what the planted path does. Nothing here
          shows that this is hard to rediscover.
        </li>
        <li>
          The three attackers are the first three anyone would try. Security means every
          efficient attacker fails, including ones nobody has thought of.
        </li>
        <li>
          Expressions here are trees. The problem allows circuits, where a subterm can be shared
          and written once. That changes the sizes a great deal: P − P with P shared is small
          however large P is when written out.
        </li>
      </ul>

      <h2>Checking it</h2>
      <p>
        The algebra is in one file with no dependencies, and <code>node tests/rewrite-check.mjs</code>{' '}
        runs it on 1,000 instances and prints a table of who reached the bit. For each one it checks every step of every walk from the two
        expressions either side of it: nothing outside the rewritten subterm may differ, and the
        subterm before and after must be the two sides of one identity. It also checks that no
        step changes the value at a random point. The numbers quoted above are from that script
        run with <code>SEEDS=200</code>, which is 200 instances per setting.
      </p>
    </>
  ),
};

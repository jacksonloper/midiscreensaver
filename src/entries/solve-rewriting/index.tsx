import type { Entry } from '../types';
import { createSolveRewriting, knobForLambda, knobForLevel } from './sketch';

export const solveRewriting: Entry = {
  slug: 'solve-rewriting',
  title: 'Solving for x, y and z, one rewrite at a time',
  date: '2026-11-15',
  dek: 'A generator scrambles a solved system of equations and keeps how. Three attackers who see only the scrambled system try to get the unknowns alone on the left again.',
  tags: ['algebra', 'rewriting', 'cryptography', 'canvas'],
  knobs: [
    { label: 'How much scrambling, λ', default: knobForLambda(8) },
    { label: 'Pace', default: 0.55 },
    { label: 'Which system', default: 0.1 },
    { label: 'Type size', default: 0.5 },
    { label: 'Generator, 0 to 3', default: knobForLevel(3) },
    { label: 'Palette', default: 0.1 },
    { label: 'Pause after each walk', default: 0.35 },
    { label: 'Graph height', default: 0.5 },
  ],
  pads: [
    { label: 'Watch the generator scramble a solved system' },
    { label: 'Attacker 1: downhill only' },
    { label: 'Attacker 2: isolate and substitute' },
    { label: 'Attacker 3: the same, multiplying out' },
    { label: "The generator's way back, with the key" },
    { label: 'Next step, by hand' },
    { label: 'Play' },
    { label: 'New system' },
  ],
  factory: createSolveRewriting,
  body: (
    <>
      <h2>The game</h2>
      <p>
        There are three equations and three unknowns, x, y and z, drawn in colour. The other
        letters, a to f, are givens. The task is to solve the system: get each unknown alone on
        the left of one equation, with nothing but givens on the right.
      </p>
      <p>
        A generator makes the puzzle. It starts from a solved system, scrambles it one step at a
        time, and remembers every step. Played backwards, its steps solve the scrambled system.
        Then three attackers get the scrambled system and nothing else. The generator's method
        is public. Only its random choices are secret.
      </p>
      <p>
        This is a companion to <a href="/posts/bit-rewriting">Hiding a zero in algebra</a>, and
        it is after the same thing: a puzzle that is cheap to make with the answer in hand and
        expensive to solve without it. The difference is the target. There, the attacker knew
        the answer was 0 and only had to prove it. Here the answer is three formulas the attacker
        has never seen.
      </p>

      <h2>What to do</h2>
      <p>
        The screen plays five walks in turn on the same system, and pads 1 to 5 jump to any of
        them: the generator scrambling, the three attackers, and the generator's own way back.
        Before each step, the part about to change lights up, and the step is named above the
        equations. When a step borrows from another equation, that equation's number lights up
        too.
      </p>
      <p>
        The count in the top corner is how many unknowns are out of place: every appearance of
        x, y or z except one standing alone as a whole left side. The graph at the bottom plots
        that count along each walk. A dot on the floor means solved, a cross means stuck, and an
        upright bar means out of budget.
      </p>
      <p>
        Knob 5 picks one of four generators. Knob 1 is how many times the generator does
        something. Pad 8 or knob 3 gives a different system. Pad 6 steps by hand and pad 7 plays
        again.
      </p>

      <h2>Bits</h2>
      <p>
        Every letter is a bit, 0 or 1. Here + means "one or the other but not both", so
        1 + 1 = 0, and · means "both". Two things follow that make this tidier than ordinary
        algebra. Anything added to itself is 0, so there is no minus sign: a term changes sides
        by being added to both sides. And anything times itself is itself, so there are no
        squares.
      </p>
      <p>
        Bits also remove the cheap trick that haunted the other post. With real numbers you can
        plug in random values and learn a great deal. With bits a wrong formula can agree with
        the right one almost everywhere, so sampling tells you little. What you can do is try
        every case, and for a system this small that is only 512 cases. It gives the answer as a
        table. It does not give a derivation, and it stops being possible as soon as there are
        a few dozen letters.
      </p>

      <h2>The steps</h2>
      <p>
        Inside either side of any equation, fourteen identities may be used in either direction
        on any subterm:
      </p>
      <ul>
        <li>A + 0 = A, 0 + A = A, A · 1 = A, 1 · A = A, A · 0 = 0, 0 · A = 0</li>
        <li>A + A = 0, and A · A = A</li>
        <li>A + B = B + A, and A · B = B · A</li>
        <li>(A + B) + C = A + (B + C), and (A · B) · C = A · (B · C)</li>
        <li>A · (B + C) = A · B + A · C, and (A + B) · C = A · C + B · C</li>
      </ul>
      <p>On whole equations there are four moves:</p>
      <ul>
        <li>add the same term to both sides, or take the same last term off both sides</li>
        <li>swap the two sides</li>
        <li>
          where one side of another equation appears, write that equation's other side instead
        </li>
      </ul>
      <p>
        Every one of these can be undone by another, so no step ever gains or loses a solution.
        Multiplying both sides by something is deliberately not a step: it cannot be undone, and
        it would let wrong answers in.
      </p>

      <h2>The generators</h2>
      <ul>
        <li>Generator 0 moves terms from one side to the other and swaps sides.</li>
        <li>Generator 1 also adds one equation to another.</li>
        <li>
          Generator 2 also adds a multiple of one equation to another, with a given as the
          multiplier, and multiplies some of the result out.
        </li>
        <li>
          Generator 3 does mostly that, and its multipliers may contain the unknowns themselves.
        </li>
      </ul>
      <p>
        Adding a multiple works like this. If equation 2 says L = R, then g · L + g · R is 0
        whatever g is, so it can be added to any side of any other equation without changing
        what is true. Once it is multiplied out and shuffled, the system has unknowns multiplied
        by givens and by each other, on both sides.
      </p>

      <h2>The attackers</h2>
      <p>
        Attacker 1 takes any single step that leaves fewer unknowns out of place, or failing
        that a shorter system, and stops when no step does. It almost never solves anything.
        Moving a term across takes two steps, and the first one makes things worse: the term is
        briefly on both sides. So the most natural measure of progress points the wrong way at
        the very first move.
      </p>
      <p>
        Attacker 2 does what everyone is taught. Bring each equation to the form "something =
        0". Find an equation where some unknown appears exactly once, as a term on its own. Move
        everything else across, which leaves that unknown alone. Write its right side in place
        of it everywhere else. Repeat. In between it tidies, but it never multiplies a bracket
        out.
      </p>
      <p>
        Attacker 3 is the same, except that it multiplies everything out every time. That puts
        each side in a standard form in which equal things look equal, so cancellations that
        attacker 2 cannot see happen by themselves. It is also much slower, and the graph shows
        its count of misplaced unknowns going up before it comes down.
      </p>

      <h2>The score so far</h2>
      <p>These are from 200 systems per setting.</p>
      <ul>
        <li>
          Generator 0: attackers 2 and 3 solved every system. Attacker 1 solved 3% at λ = 4 and
          1% after that.
        </li>
        <li>
          Generator 1: attacker 3 solved every system. Attacker 2 solved 95% at λ = 8 and
          83% at λ = 16.
        </li>
        <li>
          Generator 2: at λ = 8, attacker 2 solved 69% and attacker 3 91%.
        </li>
        <li>
          Generator 3: at λ = 8, attacker 2 solved 28% and attacker 3 59%. The generator's
          own way back was typically 33 steps. Attacker 3, when it succeeded, took about 2,200.
        </li>
      </ul>
      <p>
        So the attackers are ahead. The best generator here still loses to attacker 3 more than
        half the time. Where attacker 3 fails, it is nearly always for one reason (75 of its 83
        failures at that setting; the other 8 ran out of budget): after multiplying out, no
        equation has an unknown standing on its own. Every unknown is tangled with another one, as in
        x + a · x · y. The method has no next move, and the generator's way back does, because
        it knows which multiple of which equation to take away.
      </p>

      <h2>What comes next in the game</h2>
      <p>
        Both sides have obvious next moves. The generator should make that tangle happen every
        time instead of half the time, which probably means choosing its multiples so that
        every equation is tangled at once. At the moment it runs out of room first: the system
        reaches its size limit after about eight steps, so turning knob 1 further changes
        little.
      </p>
      <p>
        The attacker should look for the multiple itself. Take every equation times every small
        product of letters, treat each distinct product as a new unknown, and solve the result
        as a linear system. That is a real method for systems like this, and it works whenever
        the multipliers are small. Its cost grows quickly with the size of the multipliers it
        has to try, and that growth is the thing the generator would be trying to force.
      </p>
      <p>
        Nothing here is hard in any provable sense, and it will not become so. The question the
        game can answer is narrower: whether there is a way of scrambling that stays ahead of
        each attacker as it is added, and what that way turns out to look like.
      </p>

      <h2>Checking it</h2>
      <p>
        The algebra is in one file with no dependencies, and <code>node tests/solve-check.mjs</code>{' '}
        runs it on 800 systems and prints the table. For every walk it checks each step from the
        two systems either side of it. It also checks that the generator's answer satisfies
        every system on every walk, for a spread of values of the givens. Since every step can
        be undone, a system that the answer satisfies has exactly that answer.
      </p>
    </>
  ),
};

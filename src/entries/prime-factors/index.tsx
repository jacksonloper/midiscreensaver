import type { Entry } from '../types';
import { createPrimeFactors } from './sketch';

export const primeFactors: Entry = {
  slug: 'prime-factors',
  title: 'Every number, factored',
  date: '2026-11-23',
  dek: 'Factors across, numbers up. A big dot wherever a prime goes into a number, a small one for any other divisor, and the whole table scrolls upward forever.',
  tags: ['number theory', 'primes', 'canvas'],
  knobs: [
    { label: 'Factors up to', default: 0.588 },
    { label: 'Rows on screen', default: 0.32 },
    { label: 'Speed', default: 0.275 },
    { label: 'Factors from', default: 0 },
    { label: 'Prime dot size', default: 0.55 },
    { label: 'Divisor dot size', default: 0.5 },
    { label: 'Hue', default: 0 },
    { label: 'Text size', default: 0.5 },
  ],
  pads: [
    { label: 'Reverse direction' },
    { label: 'Pause' },
    { label: 'Back to 1' },
    { label: 'Jump ×10' },
    { label: 'Prime columns only' },
    { label: 'Factorisations on the right' },
    { label: 'Mark rows with no dot' },
    { label: 'Rings for repeated factors' },
  ],
  factory: createPrimeFactors,
  body: (
    <>
      <h2>How to read it</h2>
      <p>
        The horizontal axis lists possible factors: 1, 2, 3, and so on up to whatever knob 1 says.
        The vertical axis lists the numbers being factored, smallest at the bottom. Where column x
        meets row y there is a dot if x goes into y exactly.
      </p>
      <p>
        If x is prime, the dot is big and has that prime&rsquo;s colour. If x is not prime, such as
        4, 6 or 9, the dot is small and grey. So the big dots on a row are the primes that make up
        that number, and the small dots are its other divisors.
      </p>
      <p>
        The table scrolls upward on its own, so the numbers keep growing. The list on the right
        writes each row out in full, such as 60 = 2²·3·5, with each prime in the same colour as its
        column.
      </p>

      <h2>What to look for</h2>
      <p>
        Every column repeats. Column 2 has a dot on every second row and column 7 on every seventh,
        so each column is a dotted line whose gaps are the same width as its number. The small grey
        dots in column 6 fall exactly where columns 2 and 3 both have a big dot, because a number is
        divisible by 6 only when it is divisible by both.
      </p>
      <p>
        Column 1 divides everything, so it is a solid line of small dots. Turn knob 4 up a little to
        drop it.
      </p>
      <p>
        At the start, while the rows are still smaller than the last column, every prime row has
        exactly one dot, sitting on itself. Those dots form a broken diagonal. Once the rows climb
        past the last column, primes have no dots at all, and their rows are empty.
      </p>

      <h2>Rows with no dot</h2>
      <p>
        Pad 7 shades every row that no prime on the axis divides. This is the sieve of Eratosthenes:
        each prime column crosses off its multiples, and what remains has no factors that small.
      </p>
      <p>
        If the axis runs to 30, every number below 30² = 900 that survives must be prime, because a
        composite number that size has a factor of 30 or less. Above 900 the shading begins to catch
        numbers such as 31 × 37 = 1,147, which are not prime but have only factors larger than the
        axis. Pad 4 jumps the table ten times higher, which makes the difference easy to see.
      </p>

      <h2>Repeated factors</h2>
      <p>
        A dot only says that a prime goes in, not how many times. Pad 8 adds a ring around the dot
        for every extra time: 8 = 2·2·2 gets two rings in column 2, and 12 = 2·2·3 gets one. The
        rings need room, so they show up best with fewer rows on screen.
      </p>

      <h2>The knobs</h2>
      <p>
        Knobs 1 and 4 set the right and left ends of the factor axis. Knob 2 sets how many rows are
        on screen at once, from 8 to 480. Knob 3 sets the speed, from stopped at the bottom of its
        travel to 300 rows per second at the top. Pad 1 reverses direction and pad 3 goes back to 1.
      </p>
      <p>
        The table stops at ten billion. The dots would carry on happily, but the list on the right
        factors each row by trying every divisor up to its square root, and past that point a prime
        row starts to cost noticeable time. Scrolling at top speed takes over a year to get there;
        pressing pad 4 ten times gets there at once. When it does, the screen says so and waits for
        you to reverse or go back to 1.
      </p>
      <p>
        Pad 5 removes every column that is not prime. The small dots disappear and the remaining
        columns get wider, which leaves only the factorisations.
      </p>
    </>
  ),
};

/**
 * The word problem on a grid, as a game. The board is a grid of cells, each
 * empty or holding a lettered tile. A rule is a pair of small patterns of the
 * same shape, and it lets either pattern be swapped for the other wherever it
 * appears on the board. The rules mean nothing: there are no numbers behind
 * the letters.
 *
 * The generator starts from a board with a single tile on it, makes a number
 * of swaps, and publishes the board it ends on, the single tile it started
 * from, and the rules. It keeps the swaps. The claim is that the mess can be
 * turned back into that one tile. Three attackers try to do it.
 *
 * No imports and only erasable TypeScript, so `node tests/grid-check.mjs`
 * can load this file directly.
 */

export const LETTERS = ['a', 'b', 'c'];
export const EMPTY = '.';

/** A board is a string of cells, row by row. */
export interface Size {
  w: number;
  h: number;
}

export const SIZES: Size[] = [
  { w: 5, h: 4 },
  { w: 6, h: 5 },
  { w: 7, h: 5 },
  { w: 8, h: 6 },
];

/** Two patterns of the same shape, row by row. Either may be swapped for the other. */
export interface Rule {
  w: number;
  h: number;
  l: string;
  r: string;
}

/** Swap the rule's left pattern for its right (dir 1) or the reverse (dir −1), with its top-left corner at cell `at`. */
export interface Step {
  at: number;
  rule: number;
  dir: 1 | -1;
}

export interface Walk {
  frames: string[];
  /** steps[i] turns frames[i] into frames[i + 1]. */
  steps: Step[];
}

/** How many tiles are on a board or in a pattern. */
export const tiles = (board: string): number => {
  let n = 0;
  for (const c of board) if (c !== EMPTY) n++;
  return n;
};

const sides = (rule: Rule, dir: 1 | -1): [string, string] => (dir === 1 ? [rule.l, rule.r] : [rule.r, rule.l]);

/** Does `pattern` sit on the board with its top-left corner at cell `at`? */
const fits = (board: string, size: Size, rule: Rule, pattern: string, at: number): boolean => {
  const row = Math.floor(at / size.w);
  const col = at % size.w;
  if (col + rule.w > size.w || row + rule.h > size.h) return false;
  for (let y = 0; y < rule.h; y++) {
    for (let x = 0; x < rule.w; x++) {
      if (board[(row + y) * size.w + col + x] !== pattern[y * rule.w + x]) return false;
    }
  }
  return true;
};

const stamp = (board: string, size: Size, rule: Rule, pattern: string, at: number): string => {
  const cells = board.split('');
  const row = Math.floor(at / size.w);
  const col = at % size.w;
  for (let y = 0; y < rule.h; y++) {
    for (let x = 0; x < rule.w; x++) cells[(row + y) * size.w + col + x] = pattern[y * rule.w + x];
  }
  return cells.join('');
};

export const applyStep = (board: string, size: Size, rules: Rule[], step: Step): string | null => {
  const rule = rules[step.rule];
  if (!rule || step.at < 0 || step.at >= board.length) return null;
  const [was, now] = sides(rule, step.dir);
  return fits(board, size, rule, was, step.at) ? stamp(board, size, rule, now, step.at) : null;
};

/** Is `after` exactly `before` with one rule used once? */
export const verifyStep = (before: string, after: string, size: Size, rules: Rule[], step: Step): boolean =>
  applyStep(before, size, rules, step) === after;

/** Every swap that can be made on a board. */
export const moves = (board: string, size: Size, rules: Rule[]): { step: Step; next: string }[] => {
  const out: { step: Step; next: string }[] = [];
  rules.forEach((rule, r) => {
    for (const dir of [1, -1] as const) {
      const [was, now] = sides(rule, dir);
      for (let at = 0; at < board.length; at++) {
        if (fits(board, size, rule, was, at)) out.push({ step: { at, rule: r, dir }, next: stamp(board, size, rule, now, at) });
      }
    }
  });
  return out;
};

/* ----------------------------------------------------------- rule sets */

const prng = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

export const RULE_SETS = ['copy, slide and recolour', 'seven random rules'];

const across = (l: string, r: string): Rule => ({ w: 2, h: 1, l, r });
const down = (l: string, r: string): Rule => ({ w: 1, h: 2, l, r });

/**
 * A tame set. A tile may copy itself into the empty cell to its right or
 * below, may slide into an empty neighbour, and b may turn into a. Everything
 * can be simplified to a single a in the bottom right corner, so there is a
 * standard form.
 */
const TAME: Rule[] = [
  across('aa', 'a.'),
  down('aa', 'a.'),
  across('a.', '.a'),
  down('a.', '.a'),
  across('bb', 'b.'),
  down('bb', 'b.'),
  across('b.', '.b'),
  down('b.', '.b'),
  { w: 1, h: 1, l: 'b', r: 'a' },
];

/**
 * A fresh list: for each letter one rule that turns a single tile and an
 * empty neighbour into two tiles, three rules that change one pair of tiles
 * into another, and one that moves a tile and changes its letter.
 */
const randomRules = (rand: () => number): Rule[] => {
  const letter = (): string => LETTERS[Math.floor(rand() * LETTERS.length)];
  const shape = (l: string, r: string): Rule => (rand() < 0.5 ? across(l, r) : down(l, r));
  const out: Rule[] = [];
  for (const x of LETTERS) out.push(shape(letter() + letter(), rand() < 0.5 ? x + EMPTY : EMPTY + x));
  while (out.length < 6) {
    const l = letter() + letter();
    const r = letter() + letter();
    if (l !== r && !out.some((o) => (o.l === l && o.r === r) || (o.l === r && o.r === l))) out.push(shape(l, r));
  }
  out.push(shape(letter() + EMPTY, EMPTY + letter()));
  return out;
};

/* ----------------------------------------------------------- generator */

export interface Spec {
  /** Index into RULE_SETS. */
  rules: number;
  /** How many swaps the generator makes. */
  lambda: number;
  /** Index into SIZES. */
  size: number;
  seed: number;
}

const generate = (spec: Spec): { rules: Rule[]; size: Size; walk: Walk } => {
  const size = SIZES[spec.size];
  let best: { rules: Rule[]; size: Size; walk: Walk } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rand = prng(spec.seed * 7919 + spec.rules * 104729 + spec.size * 977 + attempt * 31 + 5);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const rules = spec.rules === 0 ? TAME : randomRules(rand);
    // One tile, somewhere away from the edges.
    const cells = Array.from({ length: size.w * size.h }, () => EMPTY);
    const row = 1 + Math.floor(rand() * (size.h - 2));
    const col = 1 + Math.floor(rand() * (size.w - 2));
    cells[row * size.w + col] = spec.rules === 0 ? pick(['a', 'b']) : pick(LETTERS);
    let board = cells.join('');
    const frames = [board];
    const steps: Step[] = [];
    const been = new Set([board]);
    for (let n = 0; n < spec.lambda; n++) {
      // Never return to a board already visited, and mostly add a tile when a swap can.
      const open = moves(board, size, rules).filter((m) => !been.has(m.next));
      if (open.length === 0) break;
      const more = open.filter((m) => tiles(m.next) > tiles(board));
      const m = pick(more.length > 0 && rand() < 0.7 ? more : open);
      board = m.next;
      been.add(board);
      frames.push(board);
      steps.push(m.step);
    }
    if (!best || steps.length > best.walk.steps.length) best = { rules, size, walk: { frames, steps } };
    if (steps.length === spec.lambda) break;
  }
  return best!;
};

/* ----------------------------------------------------------- attackers */

export type Outcome = 'found' | 'stuck' | 'gave up';

export interface Attack extends Walk {
  outcome: Outcome;
}

const flip = (s: Step): Step => ({ ...s, dir: s.dir === 1 ? -1 : 1 });

/** Attacker 1: make any swap that removes a tile, the first one found, until none does. */
const greedy = (from: string, to: string, size: Size, rules: Rule[]): Attack => {
  const frames = [from];
  const steps: Step[] = [];
  let board = from;
  for (let n = 0; n < 400 && board !== to; n++) {
    const here = tiles(board);
    const m = moves(board, size, rules).find((o) => tiles(o.next) < here);
    if (!m) break;
    board = m.next;
    frames.push(board);
    steps.push(m.step);
  }
  return { frames, steps, outcome: board === to ? 'found' : 'stuck' };
};

/** "Smaller" for patterns and boards: fewer tiles first, then alphabetical. */
const smaller = (a: string, b: string): boolean => tiles(a) < tiles(b) || (tiles(a) === tiles(b) && a < b);

/** Use every rule only in the direction that makes the board smaller, until none applies. */
const simplify = (board: string, size: Size, rules: Rule[]): Walk => {
  const frames = [board];
  const steps: Step[] = [];
  for (let n = 0; n < 4000; n++) {
    let made: { step: Step; next: string } | null = null;
    for (let r = 0; r < rules.length && !made; r++) {
      const dir: 1 | -1 = smaller(rules[r].r, rules[r].l) ? 1 : -1;
      const [was, now] = sides(rules[r], dir);
      for (let at = 0; at < board.length && !made; at++) {
        if (fits(board, size, rules[r], was, at)) made = { step: { at, rule: r, dir }, next: stamp(board, size, rules[r], now, at) };
      }
    }
    if (!made) break;
    board = made.next;
    frames.push(board);
    steps.push(made.step);
  }
  return { frames, steps };
};

export interface Standard extends Attack {
  /** Where the mess and the single tile each ended up. */
  ends: [string, string];
}

/**
 * Attacker 2: simplify the mess as far as it goes, and the single tile too.
 * If they arrive at the same board, that is a path: down from one, back up
 * to the other. If they arrive at different boards, nothing has been learned.
 */
const standardForm = (from: string, to: string, size: Size, rules: Rule[]): Standard => {
  const a = simplify(from, size, rules);
  const b = simplify(to, size, rules);
  const ends: [string, string] = [a.frames[a.frames.length - 1], b.frames[b.frames.length - 1]];
  if (ends[0] !== ends[1]) return { ...a, outcome: 'stuck', ends };
  return {
    frames: [...a.frames, ...b.frames.slice(0, -1).reverse()],
    steps: [...a.steps, ...b.steps.slice().reverse().map(flip)],
    outcome: 'found',
    ends,
  };
};

/** The most boards the search may look at before it gives up. */
export const SEARCH_BUDGET = 60000;

export interface Search extends Attack {
  /** How many different boards it looked at. */
  seen: number;
  /** New boards found at each distance from the mess, and from the single tile. */
  rings: [number[], number[]];
}

/**
 * Attacker 3: try everything. Every board one swap from either end, then two
 * swaps, and so on, growing whichever side is smaller, until the two sides
 * meet. The path it finds is as short as any path can be.
 */
const search = (from: string, to: string, size: Size, rules: Rule[]): Search => {
  type Mark = { prev: string | null; step: Step | null };
  const seen: [Map<string, Mark>, Map<string, Mark>] = [new Map([[from, { prev: null, step: null }]]), new Map([[to, { prev: null, step: null }]])];
  const edge: [string[], string[]] = [[from], [to]];
  const rings: [number[], number[]] = [[1], [1]];
  let meet: string | null = from === to ? from : null;
  let count = 2;

  while (!meet && count < SEARCH_BUDGET && edge[0].length > 0 && edge[1].length > 0) {
    const side = edge[0].length <= edge[1].length ? 0 : 1;
    const next: string[] = [];
    for (const board of edge[side]) {
      for (const m of moves(board, size, rules)) {
        if (seen[side].has(m.next)) continue;
        seen[side].set(m.next, { prev: board, step: m.step });
        next.push(m.next);
        count++;
        if (seen[1 - side].has(m.next)) {
          meet = m.next;
          break;
        }
      }
      if (meet || count >= SEARCH_BUDGET) break;
    }
    rings[side].push(next.length);
    edge[side] = next;
  }

  if (!meet) return { frames: [from], steps: [], outcome: 'gave up', seen: count, rings };

  // Walk back from the meeting board to each end.
  const half = (side: 0 | 1): { boards: string[]; steps: Step[] } => {
    const boards: string[] = [];
    const steps: Step[] = [];
    for (let b: string = meet!; ; ) {
      const mark = seen[side].get(b)!;
      if (!mark.prev) break;
      boards.push(mark.prev);
      steps.push(mark.step!);
      b = mark.prev;
    }
    return { boards, steps };
  };
  const a = half(0);
  const b = half(1);
  return {
    frames: [...a.boards.reverse(), meet, ...b.boards],
    steps: [...a.steps.reverse(), ...b.steps.map(flip)],
    outcome: 'found',
    seen: count,
    rings,
  };
};

/* ------------------------------------------------------------ instance */

export interface Instance {
  spec: Spec;
  size: Size;
  rules: Rule[];
  /** The mess the attackers are given. */
  mess: string;
  /** The single tile it is claimed to be the same as. */
  one: string;
  /** The generator's walk, from the single tile out to the mess. */
  grown: Walk;
  /** The same walk backwards: the generator's way from the mess to the single tile. */
  planted: Attack;
  greedy: Attack;
  standard: Standard;
  search: Search;
}

export const makeInstance = (spec: Spec): Instance => {
  const { rules, size, walk } = generate(spec);
  const one = walk.frames[0];
  const mess = walk.frames[walk.frames.length - 1];
  return {
    spec,
    size,
    rules,
    mess,
    one,
    grown: walk,
    planted: { frames: walk.frames.slice().reverse(), steps: walk.steps.slice().reverse().map(flip), outcome: 'found' },
    greedy: greedy(mess, one, size, rules),
    standard: standardForm(mess, one, size, rules),
    search: search(mess, one, size, rules),
  };
};

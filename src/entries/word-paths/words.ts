/**
 * The word problem as a game. A word is a row of letters. A rule is a pair of
 * short words, and it lets either one be swapped for the other wherever it
 * appears. The rules mean nothing: there are no numbers behind the letters.
 *
 * The generator takes a word, makes a number of swaps, and publishes the
 * first word, the last word and the rules. It keeps the swaps. Three
 * attackers then try to find some chain of swaps from the first word to the
 * last.
 *
 * No imports and only erasable TypeScript, so `node tests/words-check.mjs`
 * can load this file directly.
 */

export const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/** Either side may be swapped for the other. */
export interface Rule {
  l: string;
  r: string;
}

/** Replace the rule's left side by its right (dir 1) or the reverse (dir −1), at letter `at`. */
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

/** No word on any walk may be longer than this. It is part of the public rules of the game. */
export const MAX_LENGTH = 24;

const sides = (rule: Rule, dir: 1 | -1): [string, string] => (dir === 1 ? [rule.l, rule.r] : [rule.r, rule.l]);

export const applyStep = (word: string, rules: Rule[], step: Step): string | null => {
  const rule = rules[step.rule];
  if (!rule) return null;
  const [was, now] = sides(rule, step.dir);
  if (!word.startsWith(was, step.at)) return null;
  return word.slice(0, step.at) + now + word.slice(step.at + was.length);
};

/** Is `after` exactly `before` with one rule used once? */
export const verifyStep = (before: string, after: string, rules: Rule[], step: Step): boolean =>
  applyStep(before, rules, step) === after && after.length <= MAX_LENGTH;

/** Every swap that can be made in a word. */
export const moves = (word: string, rules: Rule[]): { step: Step; next: string }[] => {
  const out: { step: Step; next: string }[] = [];
  rules.forEach((rule, r) => {
    for (const dir of [1, -1] as const) {
      const [was, now] = sides(rule, dir);
      if (word.length - was.length + now.length > MAX_LENGTH) continue;
      for (let at = word.indexOf(was); at >= 0; at = word.indexOf(was, at + 1)) {
        out.push({ step: { at, rule: r, dir }, next: word.slice(0, at) + now + word.slice(at + was.length) });
      }
    }
  });
  return out;
};

/** How many single-letter insertions, deletions and changes turn one word into the other. */
export const distance = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length];
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

export const RULE_SETS = ['any two neighbours may swap', "Tseitin's seven rules", 'six random rules'];

/** Every pair of different letters may change places. Tame: sorting the letters is a standard form. */
const COMMUTE: Rule[] = [];
for (let i = 0; i < LETTERS.length; i++) {
  for (let j = i + 1; j < LETTERS.length; j++) COMMUTE.push({ l: LETTERS[j] + LETTERS[i], r: LETTERS[i] + LETTERS[j] });
}

/**
 * Seven rules on five letters, due to Tseitin (1958), for which no algorithm
 * at all can decide whether two words are connected.
 */
const TSEITIN: Rule[] = [
  { l: 'ac', r: 'ca' },
  { l: 'ad', r: 'da' },
  { l: 'bc', r: 'cb' },
  { l: 'bd', r: 'db' },
  { l: 'eca', r: 'ce' },
  { l: 'edb', r: 'de' },
  { l: 'cca', r: 'ccae' },
];

const randomRules = (rand: () => number): Rule[] => {
  const word = (len: number): string => Array.from({ length: len }, () => LETTERS[Math.floor(rand() * LETTERS.length)]).join('');
  const out: Rule[] = [];
  while (out.length < 6) {
    // The first three keep the length; the others grow or shrink the word.
    const l = word(2 + Math.floor(rand() * 2));
    const r = word(out.length < 3 ? l.length : 1 + Math.floor(rand() * 3));
    if (l === r || out.some((o) => (o.l === l && o.r === r) || (o.l === r && o.r === l))) continue;
    out.push({ l, r });
  }
  return out;
};

/* ----------------------------------------------------------- generator */

export interface Spec {
  /** Index into RULE_SETS. */
  rules: number;
  /** How many swaps the generator makes. */
  lambda: number;
  /** How long the first word is. */
  length: number;
  seed: number;
}

const generate = (spec: Spec): { rules: Rule[]; walk: Walk } => {
  // A few tries, in case a starting word turns out to have nowhere to go.
  let best: { rules: Rule[]; walk: Walk } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rand = prng(spec.seed * 7919 + spec.rules * 104729 + attempt * 31 + 5);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const rules = spec.rules === 0 ? COMMUTE : spec.rules === 1 ? TSEITIN : randomRules(rand);
    let word = Array.from({ length: spec.length }, () => pick(LETTERS)).join('');
    const frames = [word];
    const steps: Step[] = [];
    const been = new Set([word]);
    for (let n = 0; n < spec.lambda; n++) {
      // Never return to a word already visited, so the walk keeps going somewhere new.
      const open = moves(word, rules).filter((m) => !been.has(m.next));
      if (open.length === 0) break;
      // Mostly head away from where it started: a walk that wanders at random ends up close to home.
      let m = pick(open);
      if (rand() < 0.8) {
        let far = -1;
        for (const o of open) {
          const d = distance(o.next, frames[0]) + rand() * 0.9;
          if (d > far) {
            far = d;
            m = o;
          }
        }
      }
      word = m.next;
      been.add(word);
      frames.push(word);
      steps.push(m.step);
    }
    if (!best || steps.length > best.walk.steps.length) best = { rules, walk: { frames, steps } };
    if (steps.length === spec.lambda) break;
  }
  return best!;
};

/* ----------------------------------------------------------- attackers */

export type Outcome = 'found' | 'stuck' | 'gave up';

export interface Attack extends Walk {
  outcome: Outcome;
}

/** Attacker 1: always make the swap that leaves the word most like the target, while any swap helps. */
const greedy = (from: string, to: string, rules: Rule[]): Attack => {
  const frames = [from];
  const steps: Step[] = [];
  let word = from;
  for (let n = 0; n < 400 && word !== to; n++) {
    const here = distance(word, to);
    let best: { step: Step; next: string } | null = null;
    let bestD = here;
    for (const m of moves(word, rules)) {
      const d = distance(m.next, to);
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    if (!best) break;
    word = best.next;
    frames.push(word);
    steps.push(best.step);
  }
  return { frames, steps, outcome: word === to ? 'found' : 'stuck' };
};

/** "Smaller" for words: shorter first, then alphabetical. */
const smaller = (a: string, b: string): boolean => a.length < b.length || (a.length === b.length && a < b);

/** Use every rule only in the direction that makes the word smaller, until none applies. */
const simplify = (word: string, rules: Rule[]): Walk => {
  const frames = [word];
  const steps: Step[] = [];
  for (let n = 0; n < 4000; n++) {
    let made: { step: Step; next: string } | null = null;
    for (let r = 0; r < rules.length && !made; r++) {
      const dir: 1 | -1 = smaller(rules[r].r, rules[r].l) ? 1 : -1;
      const [was, now] = sides(rules[r], dir);
      const at = word.indexOf(was);
      if (at >= 0) made = { step: { at, rule: r, dir }, next: word.slice(0, at) + now + word.slice(at + was.length) };
    }
    if (!made) break;
    word = made.next;
    frames.push(word);
    steps.push(made.step);
  }
  return { frames, steps };
};

export interface Standard extends Attack {
  /** Where each of the two words ended up. */
  ends: [string, string];
}

/**
 * Attacker 2: simplify both words as far as they go. If they arrive at the
 * same word, that is a path: down from one, and back up to the other. If
 * they arrive at different words, nothing has been learned.
 */
const standardForm = (from: string, to: string, rules: Rule[]): Standard => {
  const down = simplify(from, rules);
  const up = simplify(to, rules);
  const ends: [string, string] = [down.frames[down.frames.length - 1], up.frames[up.frames.length - 1]];
  if (ends[0] !== ends[1]) return { ...down, outcome: 'stuck', ends };
  return {
    frames: [...down.frames, ...up.frames.slice(0, -1).reverse()],
    steps: [...down.steps, ...up.steps.slice().reverse().map((s): Step => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))],
    outcome: 'found',
    ends,
  };
};

/** The most words the search may look at before it gives up. */
export const SEARCH_BUDGET = 60000;

export interface Search extends Attack {
  /** How many different words it looked at. */
  seen: number;
  /** New words found at each distance from the first word, and from the last. */
  rings: [number[], number[]];
}

/**
 * Attacker 3: try everything. Every word one swap from either end, then two
 * swaps, and so on, growing whichever side is smaller, until the two sides
 * meet. The path it finds is as short as any path can be.
 */
const search = (from: string, to: string, rules: Rule[]): Search => {
  type Mark = { prev: string | null; step: Step | null };
  const seen: [Map<string, Mark>, Map<string, Mark>] = [new Map([[from, { prev: null, step: null }]]), new Map([[to, { prev: null, step: null }]])];
  let edge: [string[], string[]] = [[from], [to]];
  const rings: [number[], number[]] = [[1], [1]];
  let meet: string | null = from === to ? from : null;
  let count = 2;

  while (!meet && count < SEARCH_BUDGET && edge[0].length > 0 && edge[1].length > 0) {
    const side = edge[0].length <= edge[1].length ? 0 : 1;
    const next: string[] = [];
    for (const word of edge[side]) {
      for (const m of moves(word, rules)) {
        if (seen[side].has(m.next)) continue;
        seen[side].set(m.next, { prev: word, step: m.step });
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

  // Walk back from the meeting word to each end.
  const half = (side: 0 | 1): { words: string[]; steps: Step[] } => {
    const words: string[] = [];
    const steps: Step[] = [];
    for (let w: string = meet!; ; ) {
      const mark = seen[side].get(w)!;
      if (!mark.prev) break;
      words.push(mark.prev);
      steps.push(mark.step!);
      w = mark.prev;
    }
    return { words, steps };
  };
  const a = half(0);
  const b = half(1);
  return {
    frames: [...a.words.reverse(), meet, ...b.words],
    steps: [...a.steps.reverse(), ...b.steps.map((s): Step => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))],
    outcome: 'found',
    seen: count,
    rings,
  };
};

/* ------------------------------------------------------------ instance */

export interface Instance {
  spec: Spec;
  rules: Rule[];
  from: string;
  to: string;
  /** The generator's own chain of swaps. */
  planted: Attack;
  greedy: Attack;
  standard: Standard;
  search: Search;
}

export const makeInstance = (spec: Spec): Instance => {
  const { rules, walk } = generate(spec);
  const from = walk.frames[0];
  const to = walk.frames[walk.frames.length - 1];
  return {
    spec,
    rules,
    from,
    to,
    planted: { ...walk, outcome: 'found' },
    greedy: greedy(from, to, rules),
    standard: standardForm(from, to, rules),
    search: search(from, to, rules),
  };
};

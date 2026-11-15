/**
 * The algebra behind the post: closed expressions over the integers built
 * from +, − and ·, a set of rules that make them longer without changing what
 * they are worth, and a set that make them shorter, one rewrite at a time.
 *
 * Nothing here touches the canvas, so the whole run can be generated (and
 * checked) up front: grow a bit into a long expression, then simplify it back.
 */
import { mulberry32 } from '../../screensaver/util';

export type Op = '+' | '−' | '·';

export type Expr = { k: 'num'; v: number } | { k: 'op'; op: Op; a: Expr; b: Expr };

/** Which child to take at each level, 0 for the left and 1 for the right. */
export type Path = number[];

export const num = (v: number): Expr => ({ k: 'num', v });
const bin = (op: Op, a: Expr, b: Expr): Expr => ({ k: 'op', op, a, b });
const plus = (a: Expr, b: Expr): Expr => bin('+', a, b);
const minus = (a: Expr, b: Expr): Expr => bin('−', a, b);
const times = (a: Expr, b: Expr): Expr => bin('·', a, b);

const ZERO = num(0);
const ONE = num(1);

export const size = (e: Expr): number => (e.k === 'num' ? 1 : 1 + size(e.a) + size(e.b));

export const value = (e: Expr): number => {
  if (e.k === 'num') return e.v;
  const a = value(e.a);
  const b = value(e.b);
  return e.op === '+' ? a + b : e.op === '−' ? a - b : a * b;
};

export const same = (x: Expr, y: Expr): boolean =>
  x.k === 'num'
    ? y.k === 'num' && x.v === y.v
    : y.k === 'op' && x.op === y.op && same(x.a, y.a) && same(x.b, y.b);

const isNum = (e: Expr, v: number): boolean => e.k === 'num' && e.v === v;
const isBit = (e: Expr): boolean => {
  const v = value(e);
  return v === 0 || v === 1;
};

export const at = (e: Expr, path: Path): Expr => {
  let n = e;
  for (const i of path) {
    if (n.k !== 'op') break;
    n = i === 0 ? n.a : n.b;
  }
  return n;
};

export const replaceAt = (e: Expr, path: Path, by: Expr, i = 0): Expr => {
  if (i >= path.length || e.k !== 'op') return by;
  return path[i] === 0
    ? bin(e.op, replaceAt(e.a, path, by, i + 1), e.b)
    : bin(e.op, e.a, replaceAt(e.b, path, by, i + 1));
};

/** Every node with its path, in pre-order (parents before children, left first). */
const nodes = (e: Expr, path: Path = [], out: { e: Expr; path: Path }[] = []) => {
  out.push({ e, path });
  if (e.k === 'op') {
    nodes(e.a, [...path, 0], out);
    nodes(e.b, [...path, 1], out);
  }
  return out;
};

/* ------------------------------------------------------------ printing */

export interface Token {
  text: string;
  kind: 'num' | 'op' | 'paren';
  /** Inside the subterm being rewritten. */
  hot: boolean;
}

const prec = (e: Expr): number => (e.k === 'num' ? 3 : e.op === '·' ? 2 : 1);

/**
 * Tokens for `e`, with as few brackets as the tree allows. The tree is shown
 * faithfully: a + (b + c) keeps its brackets, because the rewrite that made it
 * did not make (a + b) + c.
 */
export const tokens = (e: Expr, hot: Path | null = null): Token[] => {
  const out: Token[] = [];
  const walk = (n: Expr, path: Path, parent: number, right: boolean, inHot: boolean) => {
    const h = inHot || (hot !== null && hot.length === path.length && hot.every((v, i) => v === path[i]));
    const wrap =
      parent > 0 &&
      (n.k === 'num' ? n.v < 0 : prec(n) < parent || (right && prec(n) === parent));
    if (wrap) out.push({ text: '(', kind: 'paren', hot: h });
    if (n.k === 'num') out.push({ text: String(n.v).replace('-', '−'), kind: 'num', hot: h });
    else {
      walk(n.a, [...path, 0], prec(n), false, h);
      out.push({ text: n.op, kind: 'op', hot: h });
      walk(n.b, [...path, 1], prec(n), true, h);
    }
    if (wrap) out.push({ text: ')', kind: 'paren', hot: h });
  };
  walk(e, [], 0, false, false);
  return out;
};

export const show = (e: Expr): string =>
  tokens(e)
    .map((t) => (t.kind === 'op' ? ` ${t.text} ` : t.text))
    .join('');

/* ------------------------------------------------------------- growing */

interface GrowRule {
  name: string;
  /** Can it rewrite this node? */
  fits: (e: Expr) => boolean;
  make: (e: Expr, rand: () => number, whole: Expr) => Expr;
}

/** A small piece of the expression to multiply by zero: any subterm will do. */
const anything = (rand: () => number, whole: Expr): Expr => {
  const pool = nodes(whole).filter((n) => size(n.e) >= 3 && size(n.e) <= 9);
  if (pool.length === 0 || rand() < 0.3) return plus(ONE, ONE);
  return pool[Math.floor(rand() * pool.length)].e;
};

/**
 * Ordered from tamest to wildest; knob 5 decides how far down the list the
 * growth is allowed to reach. Every one leaves the value alone.
 */
export const GROW_RULES: GrowRule[] = [
  { name: 'x → x + 0', fits: () => true, make: (e) => plus(e, ZERO) },
  { name: 'x → 1 · x', fits: () => true, make: (e) => times(ONE, e) },
  { name: '0 → 1 − 1', fits: (e) => isNum(e, 0), make: () => minus(ONE, ONE) },
  { name: 'x → x − 0', fits: () => true, make: (e) => minus(e, ZERO) },
  { name: '1 → (1 + 1) − 1', fits: (e) => isNum(e, 1), make: () => minus(plus(ONE, ONE), ONE) },
  { name: 'x → x · x   when x is a bit', fits: isBit, make: (e) => times(e, e) },
  { name: 'x → 1 − (1 − x)', fits: () => true, make: (e) => minus(ONE, minus(ONE, e)) },
  {
    name: 'a + b → b + a',
    fits: (e) => e.k === 'op' && e.op === '+' && !same(e.a, e.b),
    make: (e) => (e.k === 'op' ? plus(e.b, e.a) : e),
  },
  {
    name: 'a · (b + c) → a · b + a · c',
    fits: (e) => e.k === 'op' && e.op === '·' && e.b.k === 'op' && e.b.op === '+',
    make: (e) =>
      e.k === 'op' && e.b.k === 'op' ? plus(times(e.a, e.b.a), times(e.a, e.b.b)) : e,
  },
  { name: '0 → 0 · t', fits: (e) => isNum(e, 0), make: (_e, rand, whole) => times(ZERO, anything(rand, whole)) },
  { name: 'x → (x + 1) − 1', fits: () => true, make: (e) => minus(plus(e, ONE), ONE) },
];

/** Never let one expression get longer than this many nodes. */
export const MAX_NODES = 141;

/* ---------------------------------------------------------- simplifying */

interface Redex {
  path: Path;
  rule: string;
  by: Expr;
  /** How many nodes the rewrite removes. */
  cut: number;
}

/** The first shortening rule that fits this node, if any. Order matters. */
const shorten = (e: Expr): { rule: string; by: Expr } | null => {
  if (e.k === 'num') return null;
  const { op, a, b } = e;
  if (op === '+') {
    if (isNum(b, 0)) return { rule: 'x + 0 → x', by: a };
    if (isNum(a, 0)) return { rule: '0 + x → x', by: b };
  }
  if (op === '−') {
    if (isNum(b, 0)) return { rule: 'x − 0 → x', by: a };
    if (same(a, b)) return { rule: 'x − x → 0', by: ZERO };
    if (b.k === 'op' && b.op === '−' && same(a, b.a)) return { rule: 'a − (a − x) → x', by: b.b };
    if (a.k === 'op' && a.op === '+' && same(a.b, b)) return { rule: '(x + a) − a → x', by: a.a };
  }
  if (op === '·') {
    if (isNum(a, 0) || isNum(b, 0)) return { rule: isNum(a, 0) ? '0 · x → 0' : 'x · 0 → 0', by: ZERO };
    if (isNum(b, 1)) return { rule: 'x · 1 → x', by: a };
    if (isNum(a, 1)) return { rule: '1 · x → x', by: b };
    if (same(a, b) && isBit(a)) return { rule: 'x · x → x   when x is a bit', by: a };
  }
  if (a.k === 'num' && b.k === 'num') {
    const r = num(value(e));
    return { rule: `${show(e)} → ${show(r)}`, by: r };
  }
  return null;
};

export const STRATEGIES = ['biggest cut first', 'outermost first', 'innermost first'];

const redexes = (e: Expr, order: 'pre' | 'post'): Redex[] => {
  const out: Redex[] = [];
  const walk = (n: Expr, path: Path) => {
    const here = (): void => {
      const r = shorten(n);
      if (r) out.push({ path, rule: r.rule, by: r.by, cut: size(n) - size(r.by) });
    };
    if (order === 'pre') here();
    if (n.k === 'op') {
      walk(n.a, [...path, 0]);
      walk(n.b, [...path, 1]);
    }
    if (order === 'post') here();
  };
  walk(e, []);
  return out;
};

/** The next shortening step under a strategy, or null once `e` is a number. */
export const nextShorten = (e: Expr, strategy: number): Redex | null => {
  if (strategy === 1) return redexes(e, 'pre')[0] ?? null;
  if (strategy === 2) return redexes(e, 'post')[0] ?? null;
  const all = redexes(e, 'pre');
  let best: Redex | null = null;
  for (const r of all) if (!best || r.cut > best.cut) best = r;
  return best;
};

/* ----------------------------------------------------------------- run */

export interface Step {
  /** Which subterm is rewritten. The replacement sits at the same path. */
  path: Path;
  rule: string;
  phase: 'grow' | 'shrink';
}

export interface Run {
  /** frames[0] is the bit; frames[grown] is the longest; the last is the bit again. */
  frames: Expr[];
  /** steps[k] turns frames[k] into frames[k + 1]. */
  steps: Step[];
  grown: number;
}

export interface RunSpec {
  bit: 0 | 1;
  seed: number;
  rewrites: number;
  /** How many of GROW_RULES are allowed, from the top of the list. */
  wildness: number;
  strategy: number;
}

/**
 * The whole run, start to finish. The growth only depends on the bit, the
 * seed and the rules allowed, and every rewrite draws from the generator the
 * same way, so asking for more rewrites extends the same expression rather
 * than starting a different one.
 */
export const makeRun = ({ bit, seed, rewrites, wildness, strategy }: RunSpec): Run => {
  const rand = mulberry32(seed * 7919 + bit * 104729 + wildness * 31 + 1);
  const rules = GROW_RULES.slice(0, Math.max(2, Math.min(GROW_RULES.length, wildness)));
  let e = num(bit);
  const frames: Expr[] = [e];
  const steps: Step[] = [];

  for (let n = 0; n < rewrites; n++) {
    let done = false;
    for (let attempt = 0; attempt < 24 && !done; attempt++) {
      const rule = rules[Math.floor(rand() * rules.length)];
      const sites = nodes(e).filter((s) => rule.fits(s.e));
      const pick = rand();
      if (sites.length === 0) continue;
      const site = sites[Math.floor(pick * sites.length)];
      const by = rule.make(site.e, rand, e);
      const next = replaceAt(e, site.path, by);
      if (size(next) > MAX_NODES) continue;
      steps.push({ path: site.path, rule: rule.name, phase: 'grow' });
      frames.push(next);
      e = next;
      done = true;
    }
  }
  const grown = frames.length - 1;
  simplify(e, strategy, frames, steps);
  return { frames, steps, grown };
};

/** Simplify `e` to a number under one strategy, returning every step. */
const simplify = (e: Expr, strategy: number, frames: Expr[], steps: Step[]): void => {
  for (let guard = 0; guard < 2000; guard++) {
    const r = nextShorten(e, strategy);
    if (!r) break;
    e = replaceAt(e, r.path, r.by);
    steps.push({ path: r.path, rule: r.rule, phase: 'shrink' });
    frames.push(e);
  }
};

/**
 * The same run up to frame `k`, then simplified from there under another
 * strategy — for switching strategy halfway down.
 */
export const resimplify = (run: Run, at: number, strategy: number): Run => {
  const k = Math.max(0, Math.min(at, run.frames.length - 1));
  const frames = run.frames.slice(0, k + 1);
  const steps = run.steps.slice(0, k);
  simplify(frames[k], strategy, frames, steps);
  return { frames, steps, grown: run.grown };
};

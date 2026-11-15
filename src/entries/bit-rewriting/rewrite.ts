/**
 * A toy model of the open problem this post is about: can ordinary algebraic
 * identities hide a short expression so that it is easy to plant and hard to
 * find again?
 *
 * Everything is a walk in one graph. Vertices are expressions; an edge is a
 * single use of one identity from IDENTITIES, in either direction, on one
 * subterm. `makeInstance` plays the generator: it walks uphill from a bit to a
 * long expression E and keeps the walk, which read backwards is the planted
 * path. Then three attackers, given only E, each try to walk back down.
 *
 * Every step anyone takes goes through `applyIdentity`, and `verifyStep` can
 * check any step afterwards from the two expressions alone.
 *
 * No imports and only erasable TypeScript, so `node tests/rewrite-check.mjs`
 * can load this file directly.
 */

export type Op = '+' | '−' | '·';
export type Fn = 'sin' | 'cos';

/** `n` is the number of nodes, kept on the node so size is free to ask for. */
export type Expr =
  | { k: 'num'; v: number; n: number }
  | { k: 'var'; name: string; n: number }
  /** A placeholder in an identity. Never appears in a real expression. */
  | { k: 'meta'; name: string; n: number }
  | { k: 'fn'; fn: Fn; a: Expr; n: number }
  | { k: 'op'; op: Op; a: Expr; b: Expr; n: number };

/** Which child to take at each level: 0 for the left (or only), 1 for the right. */
export type Path = number[];

export const num = (v: number): Expr => ({ k: 'num', v, n: 1 });
export const va = (name: string): Expr => ({ k: 'var', name, n: 1 });
const meta = (name: string): Expr => ({ k: 'meta', name, n: 1 });
const fn = (f: Fn, a: Expr): Expr => ({ k: 'fn', fn: f, a, n: a.n + 1 });
const bin = (op: Op, a: Expr, b: Expr): Expr => ({ k: 'op', op, a, b, n: a.n + b.n + 1 });
const plus = (a: Expr, b: Expr): Expr => bin('+', a, b);
const minus = (a: Expr, b: Expr): Expr => bin('−', a, b);
const times = (a: Expr, b: Expr): Expr => bin('·', a, b);

const ZERO = num(0);
const ONE = num(1);

export const same = (x: Expr, y: Expr): boolean => {
  if (x === y) return true;
  if (x.n !== y.n || x.k !== y.k) return false;
  switch (x.k) {
    case 'num':
      return x.v === (y as typeof x).v;
    case 'var':
    case 'meta':
      return x.name === (y as typeof x).name;
    case 'fn':
      return x.fn === (y as typeof x).fn && same(x.a, (y as typeof x).a);
    default:
      return x.op === (y as typeof x).op && same(x.a, (y as typeof x).a) && same(x.b, (y as typeof x).b);
  }
};

const isNum = (e: Expr, v: number): boolean => e.k === 'num' && e.v === v;
const isOp = (e: Expr, op: Op): e is Extract<Expr, { k: 'op' }> => e.k === 'op' && e.op === op;

export const evaluate = (e: Expr, env: Record<string, number>): number => {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'var':
    case 'meta':
      return env[e.name] ?? 0;
    case 'fn':
      return e.fn === 'sin' ? Math.sin(evaluate(e.a, env)) : Math.cos(evaluate(e.a, env));
    default: {
      const a = evaluate(e.a, env);
      const b = evaluate(e.b, env);
      return e.op === '+' ? a + b : e.op === '−' ? a - b : a * b;
    }
  }
};

export const at = (e: Expr, path: Path): Expr => {
  let n = e;
  for (const i of path) {
    if (n.k === 'op') n = i === 0 ? n.a : n.b;
    else if (n.k === 'fn') n = n.a;
    else break;
  }
  return n;
};

/** A copy of `e` with the subterm at `path` swapped; everything off the path is shared. */
export const replaceAt = (e: Expr, path: Path, by: Expr, i = 0): Expr => {
  if (i >= path.length) return by;
  if (e.k === 'fn') return fn(e.fn, replaceAt(e.a, path, by, i + 1));
  if (e.k !== 'op') return by;
  return path[i] === 0
    ? bin(e.op, replaceAt(e.a, path, by, i + 1), e.b)
    : bin(e.op, e.a, replaceAt(e.b, path, by, i + 1));
};

/** Visit every node with its path, parents before children. The path is reused: copy it to keep it. */
const visit = (e: Expr, f: (n: Expr, path: Path) => void): void => {
  const path: Path = [];
  const walk = (n: Expr): void => {
    f(n, path);
    if (n.k === 'fn') {
      path.push(0);
      walk(n.a);
      path.pop();
    } else if (n.k === 'op') {
      path.push(0);
      walk(n.a);
      path.pop();
      path.push(1);
      walk(n.b);
      path.pop();
    }
  };
  walk(e);
};

const sites = (e: Expr, ok: (n: Expr) => boolean): Path[] => {
  const out: Path[] = [];
  visit(e, (n, p) => {
    if (ok(n)) out.push(p.slice());
  });
  return out;
};

/* ------------------------------------------------------------ printing */

export interface Token {
  text: string;
  kind: 'num' | 'var' | 'fn' | 'op' | 'paren';
  /** Inside the subterm being rewritten. */
  hot: boolean;
}

const prec = (e: Expr): number => (e.k === 'op' ? (e.op === '·' ? 2 : 1) : 3);

/**
 * Tokens for `e` with as few brackets as the tree allows. The tree is shown
 * faithfully: a + (b + c) keeps its brackets, because (a + b) + c is a
 * different vertex of the graph, one associativity step away.
 */
export const tokens = (e: Expr, hot: Path | null = null): Token[] => {
  const out: Token[] = [];
  const walk = (n: Expr, parent: number, right: boolean, depth: number, on: boolean, inHot: boolean): void => {
    const h = inHot || (on && hot !== null && depth === hot.length);
    const down = (i: number): boolean => on && hot !== null && depth < hot.length && hot[depth] === i;
    const wrap =
      parent > 0 && (n.k === 'num' ? n.v < 0 : prec(n) < parent || (right && prec(n) === parent));
    if (wrap) out.push({ text: '(', kind: 'paren', hot: h });
    if (n.k === 'num') out.push({ text: String(n.v).replace('-', '−'), kind: 'num', hot: h });
    else if (n.k === 'var' || n.k === 'meta') out.push({ text: n.name, kind: 'var', hot: h });
    else if (n.k === 'fn') {
      out.push({ text: n.fn, kind: 'fn', hot: h });
      out.push({ text: '(', kind: 'paren', hot: h });
      walk(n.a, 0, false, depth + 1, down(0), h);
      out.push({ text: ')', kind: 'paren', hot: h });
    } else {
      walk(n.a, prec(n), false, depth + 1, down(0), h);
      out.push({ text: n.op, kind: 'op', hot: h });
      walk(n.b, prec(n), true, depth + 1, down(1), h);
    }
    if (wrap) out.push({ text: ')', kind: 'paren', hot: h });
  };
  walk(e, 0, false, 0, true, false);
  return out;
};

const shown = new WeakMap<Expr, string>();
export const show = (e: Expr): string => {
  let s = shown.get(e);
  if (s === undefined) {
    s = tokens(e)
      .map((t) => (t.kind === 'op' ? ` ${t.text} ` : t.text))
      .join('');
    shown.set(e, s);
  }
  return s;
};

/* ---------------------------------------------------------- identities */

export interface Identity {
  l: Expr;
  r: Expr;
}

const A = meta('A');
const B = meta('B');
const C = meta('C');
const sq = (f: Fn, a: Expr): Expr => times(fn(f, a), fn(f, a));

/**
 * The fixed system R. Each one is true for all real values of A, B and C, and
 * may be used left to right or right to left on any subterm. `arith` stands
 * for the sums, differences and products of two written-out integers.
 */
export const IDENTITIES = {
  add0R: { l: plus(A, ZERO), r: A },
  add0L: { l: plus(ZERO, A), r: A },
  mul1R: { l: times(A, ONE), r: A },
  mul1L: { l: times(ONE, A), r: A },
  mul0R: { l: times(A, ZERO), r: ZERO },
  mul0L: { l: times(ZERO, A), r: ZERO },
  sub: { l: minus(A, A), r: ZERO },
  commA: { l: plus(A, B), r: plus(B, A) },
  commM: { l: times(A, B), r: times(B, A) },
  assocA: { l: plus(plus(A, B), C), r: plus(A, plus(B, C)) },
  assocM: { l: times(times(A, B), C), r: times(A, times(B, C)) },
  distL: { l: times(A, plus(B, C)), r: plus(times(A, B), times(A, C)) },
  distR: { l: times(plus(A, B), C), r: plus(times(A, C), times(B, C)) },
  neg: { l: minus(A, B), r: plus(A, times(num(-1), B)) },
  pyth: { l: plus(sq('sin', A), sq('cos', A)), r: ONE },
  pyth2: { l: sq('cos', A), r: minus(ONE, sq('sin', A)) },
  arith: { l: meta('m ∘ n'), r: meta('k') },
} satisfies Record<string, Identity>;

export type IdName = keyof typeof IDENTITIES;
export type Dir = 1 | -1;
type Binding = Record<string, Expr>;

const match = (pat: Expr, e: Expr, s: Binding): boolean => {
  switch (pat.k) {
    case 'meta': {
      const had = s[pat.name];
      if (had) return same(had, e);
      s[pat.name] = e;
      return true;
    }
    case 'num':
      return e.k === 'num' && e.v === pat.v;
    case 'var':
      return e.k === 'var' && e.name === pat.name;
    case 'fn':
      return e.k === 'fn' && e.fn === pat.fn && match(pat.a, e.a, s);
    default:
      return e.k === 'op' && e.op === pat.op && match(pat.a, e.a, s) && match(pat.b, e.b, s);
  }
};

const fill = (pat: Expr, s: Binding): Expr | null => {
  switch (pat.k) {
    case 'meta':
      return s[pat.name] ?? null;
    case 'num':
    case 'var':
      return pat;
    case 'fn': {
      const a = fill(pat.a, s);
      return a && fn(pat.fn, a);
    }
    default: {
      const a = fill(pat.a, s);
      const b = fill(pat.b, s);
      return a && b && bin(pat.op, a, b);
    }
  }
};

/**
 * Use one identity on `sub` in one direction. Directions that invent a term,
 * like 0 → A − A, take it from `free`. Null when the identity does not fit.
 */
export const applyIdentity = (id: IdName, dir: Dir, sub: Expr, free?: Binding): Expr | null => {
  if (id === 'arith') {
    if (dir !== 1 || sub.k !== 'op' || sub.a.k !== 'num' || sub.b.k !== 'num') return null;
    return num(evaluate(sub, {}));
  }
  const { l, r } = IDENTITIES[id];
  const s: Binding = {};
  if (!match(dir === 1 ? l : r, sub, s)) return null;
  return fill(dir === 1 ? r : l, free ? { ...free, ...s } : s);
};

export interface Step {
  /** The subterm rewritten. Its replacement sits at the same path. */
  path: Path;
  id: IdName;
  dir: Dir;
}

/**
 * Is `after` exactly `before` with one identity used once at `step.path`?
 * Looks only at the two expressions: nothing outside the path may differ, and
 * the two subterms must be the two sides of the identity under one binding.
 */
export const verifyStep = (before: Expr, after: Expr, step: Step): boolean => {
  let b = before;
  let a = after;
  for (const i of step.path) {
    if (b.k === 'fn' && a.k === 'fn' && b.fn === a.fn) {
      b = b.a;
      a = a.a;
    } else if (b.k === 'op' && a.k === 'op' && b.op === a.op) {
      if (i === 0) {
        if (!same(b.b, a.b)) return false;
        b = b.a;
        a = a.a;
      } else {
        if (!same(b.a, a.a)) return false;
        b = b.b;
        a = a.b;
      }
    } else return false;
  }
  if (step.id === 'arith') {
    const [from, to] = step.dir === 1 ? [b, a] : [a, b];
    const got = applyIdentity('arith', 1, from);
    return got !== null && same(got, to);
  }
  const { l, r } = IDENTITIES[step.id];
  const s: Binding = {};
  return match(step.dir === 1 ? l : r, b, s) && match(step.dir === 1 ? r : l, a, s);
};

/** The rule as it is used in a step, e.g. "A + 0 → A" or "1 + 1 → 2". */
export const ruleText = (step: Step, before: Expr, after: Expr): string => {
  if (step.id === 'arith') return `${show(at(before, step.path))} → ${show(at(after, step.path))}`;
  const { l, r } = IDENTITIES[step.id];
  return step.dir === 1 ? `${show(l)} → ${show(r)}` : `${show(r)} → ${show(l)}`;
};

/* --------------------------------------------------------------- edges */

const metasOf = (e: Expr, out = new Set<string>()): Set<string> => {
  if (e.k === 'meta') out.add(e.name);
  else if (e.k === 'fn') metasOf(e.a, out);
  else if (e.k === 'op') {
    metasOf(e.a, out);
    metasOf(e.b, out);
  }
  return out;
};

/** Directions whose result is fixed by the subterm; the rest invent a term and have no end of instances. */
const FIXED: { id: IdName; dir: Dir }[] = [];
for (const id of Object.keys(IDENTITIES) as IdName[]) {
  if (id === 'arith') {
    FIXED.push({ id, dir: 1 });
    continue;
  }
  const { l, r } = IDENTITIES[id];
  const ml = metasOf(l);
  const mr = metasOf(r);
  if ([...mr].every((m) => ml.has(m))) FIXED.push({ id, dir: 1 });
  if ([...ml].every((m) => mr.has(m))) FIXED.push({ id, dir: -1 });
}

export interface Edge extends Step {
  by: Expr;
  /** Change in size: negative is downhill. */
  delta: number;
}

/** Every edge out of `e` whose far end is fixed by `e`, optionally only some identities. */
export const edges = (e: Expr, only?: (id: IdName, dir: Dir) => boolean): Edge[] => {
  const out: Edge[] = [];
  visit(e, (n, p) => {
    for (const { id, dir } of FIXED) {
      if (only && !only(id, dir)) continue;
      const by = applyIdentity(id, dir, n);
      if (by && !same(by, n)) out.push({ path: p.slice(), id, dir, by, delta: by.n - n.n });
    }
  });
  return out;
};

/** How many edges lead to a shorter, an equally long and a longer expression. */
export const edgeCounts = (e: Expr): { down: number; level: number; up: number } => {
  let down = 0;
  let level = 0;
  let up = 0;
  for (const g of edges(e)) {
    if (g.delta < 0) down++;
    else if (g.delta === 0) level++;
    else up++;
  }
  return { down, level, up };
};

/* --------------------------------------------------------------- walks */

export interface Walk {
  frames: Expr[];
  /** steps[i] turns frames[i] into frames[i + 1]. */
  steps: Step[];
}

const GAVE_UP = { gaveUp: true };

/** Longest walk an attacker may take, and the largest expression it may hold. */
export const STEP_BUDGET = 12000;
export const NODE_BUDGET = 4000;

interface Tracer extends Walk {
  cur: () => Expr;
  /** Take a step; throws if the identity does not fit, or GAVE_UP past the budget. */
  rw: (path: Path, id: IdName, dir: Dir, free?: Binding) => void;
}

const tracer = (start: Expr, budget = STEP_BUDGET): Tracer => {
  let cur = start;
  const frames: Expr[] = [start];
  const steps: Step[] = [];
  return {
    frames,
    steps,
    cur: () => cur,
    rw: (path, id, dir, free) => {
      const by = applyIdentity(id, dir, at(cur, path), free);
      if (!by) throw new Error(`${id} does not fit ${show(at(cur, path))}`);
      if (steps.length >= budget) throw GAVE_UP;
      cur = replaceAt(cur, path, by);
      frames.push(cur);
      steps.push({ path: path.slice(), id, dir });
      if (cur.n > NODE_BUDGET) throw GAVE_UP;
    },
  };
};

/* ----------------------------------------------------- lists under + or · */

const ASSOC: Record<'+' | '·', IdName> = { '+': 'assocA', '·': 'assocM' };
const COMM: Record<'+' | '·', IdName> = { '+': 'commA', '·': 'commM' };

/** Re-bracket a chain of one operator to a + (b + (c + …)). */
const rightNest = (t: Tracer, path: Path, op: '+' | '·'): void => {
  const p = path.slice();
  for (;;) {
    let n = at(t.cur(), p);
    if (!isOp(n, op)) return;
    while (isOp(n.a, op)) {
      t.rw(p, ASSOC[op], 1);
      n = at(t.cur(), p) as typeof n;
    }
    p.push(1);
  }
};

/** The items of a right-nested chain. */
const items = (e: Expr, op: '+' | '·'): Expr[] => {
  const out: Expr[] = [];
  let n = e;
  while (isOp(n, op)) {
    out.push(n.a);
    n = n.b;
  }
  out.push(n);
  return out;
};

/** The path of the node whose left child is item i (or, for the last item, the item itself). */
const spine = (path: Path, i: number): Path => {
  const p = path.slice();
  for (let k = 0; k < i; k++) p.push(1);
  return p;
};

/** Swap items i and i + 1 of a right-nested chain of `len` items. */
const swap = (t: Tracer, path: Path, op: '+' | '·', i: number, len: number): void => {
  const p = spine(path, i);
  if (i === len - 2) t.rw(p, COMM[op], 1);
  else {
    t.rw(p, ASSOC[op], -1);
    t.rw([...p, 0], COMM[op], 1);
    t.rw(p, ASSOC[op], 1);
  }
};

/** Bubble-sort a right-nested chain by key, one neighbouring swap at a time. */
const sortChain = (t: Tracer, path: Path, op: '+' | '·', key: (e: Expr) => string): void => {
  const keys = items(at(t.cur(), path), op).map(key);
  const len = keys.length;
  for (let end = len - 1; end > 0; end--) {
    let moved = false;
    for (let i = 0; i < end; i++) {
      if (keys[i] > keys[i + 1]) {
        swap(t, path, op, i, len);
        [keys[i], keys[i + 1]] = [keys[i + 1], keys[i]];
        moved = true;
      }
    }
    if (!moved) break;
  }
};

/* ------------------------------------------------- attacker 1: downhill */

/** Take the edge that shortens the expression most, until none shortens it. Returns steps taken. */
const descend = (t: Tracer): number => {
  let taken = 0;
  for (;;) {
    let best: Edge | null = null;
    for (const g of edges(t.cur())) if (g.delta < 0 && (!best || g.delta < best.delta)) best = g;
    if (!best) return taken;
    t.rw(best.path, best.id, best.dir);
    taken++;
  }
};

/* ------------------------------------------ attacker 2: sort, then downhill */

const acKeys = new WeakMap<Expr, string>();
/** A name for a term that ignores the order and bracketing of its sums and products. */
const acKey = (e: Expr): string => {
  let s = acKeys.get(e);
  if (s !== undefined) return s;
  if (e.k === 'num') s = String(e.v);
  else if (e.k === 'var' || e.k === 'meta') s = e.name;
  else if (e.k === 'fn') s = `${e.fn}(${acKey(e.a)})`;
  else if (e.op === '−') s = `(${acKey(e.a)}−${acKey(e.b)})`;
  else {
    const op = e.op;
    const parts: string[] = [];
    const flat = (n: Expr): void => {
      if (isOp(n, op)) {
        flat(n.a);
        flat(n.b);
      } else parts.push(acKey(n));
    };
    flat(e);
    s = `(${parts.sort().join(op)})`;
  }
  acKeys.set(e, s);
  return s;
};

/** Put every sum and product into one fixed bracketing and order, using only + and · shuffles. */
const sortAll = (t: Tracer, path: Path): void => {
  const n = at(t.cur(), path);
  if (n.k === 'fn') sortAll(t, [...path, 0]);
  else if (n.k === 'op' && n.op === '−') {
    sortAll(t, [...path, 0]);
    sortAll(t, [...path, 1]);
  } else if (n.k === 'op') {
    const op = n.op as '+' | '·';
    rightNest(t, path, op);
    const len = items(at(t.cur(), path), op).length;
    for (let i = 0; i < len; i++) sortAll(t, i < len - 1 ? [...spine(path, i), 0] : spine(path, i));
    sortChain(t, path, op, acKey);
  }
};

/* ------------------------------------------- attacker 3: canonical form */

const hasCoef = (m: Expr): boolean => isOp(m, '·') && m.a.k === 'num';
/** What a monomial is a multiple of: "" for a plain number. */
const monoKey = (m: Expr): string => (m.k === 'num' ? '' : hasCoef(m) ? show((m as { b: Expr }).b) : show(m));
const factorKey = (f: Expr): string => (f.k === 'num' ? '' : show(f));

/**
 * Expand everything. Afterwards the subterm at `path` is a sum of monomials
 * in a fixed order, each a number times a sorted product of variables and
 * sines, with no cos² left anywhere. Two expressions that are equal as
 * functions end up letter for letter the same, so a hidden bit ends up as the
 * bit. The catch is how long the walk is.
 */
const canon = (t: Tracer, path: Path): void => {
  const n = at(t.cur(), path);
  if (n.k === 'fn') canon(t, [...path, 0]);
  else if (n.k === 'op') {
    if (n.op === '−') {
      t.rw(path, 'neg', 1);
      canon(t, path);
      return;
    }
    canon(t, [...path, 0]);
    canon(t, [...path, 1]);
    if (n.op === '+') mergeSum(t, path);
    else mergeProduct(t, path);
  }
};

/** A product of two canonical sums: multiply out, one distribution at a time. */
const mergeProduct = (t: Tracer, path: Path): void => {
  const n = at(t.cur(), path);
  if (!isOp(n, '·')) return;
  if (isOp(n.a, '+') || isOp(n.b, '+')) {
    t.rw(path, isOp(n.a, '+') ? 'distR' : 'distL', 1);
    mergeProduct(t, [...path, 0]);
    mergeProduct(t, [...path, 1]);
    mergeSum(t, path);
  } else mergeMonomial(t, path);
};

/** A product of two monomials: sort the factors, multiply the numbers, remove cos². */
const mergeMonomial = (t: Tracer, path: Path): void => {
  rightNest(t, path, '·');
  sortChain(t, path, '·', factorKey);
  for (;;) {
    const n = at(t.cur(), path);
    if (!isOp(n, '·') || n.a.k !== 'num') break;
    if (n.b.k === 'num') t.rw(path, 'arith', 1);
    else if (isOp(n.b, '·') && n.b.a.k === 'num') {
      t.rw(path, 'assocM', -1);
      t.rw([...path, 0], 'arith', 1);
    } else if (n.a.v === 0) t.rw(path, 'mul0L', 1);
    else if (n.a.v === 1) t.rw(path, 'mul1L', 1);
    else break;
  }
  const fs = items(at(t.cur(), path), '·');
  for (let i = 0; i + 1 < fs.length; i++) {
    const f = fs[i];
    if (f.k !== 'fn' || f.fn !== 'cos' || !same(f, fs[i + 1])) continue;
    const p = spine(path, i);
    if (i === fs.length - 2) t.rw(p, 'pyth2', 1);
    else {
      t.rw(p, 'assocM', -1);
      t.rw([...p, 0], 'pyth2', 1);
    }
    canon(t, path);
    return;
  }
};

/** A sum of two canonical sums: one sorted list, like terms collected, zeros dropped. */
const mergeSum = (t: Tracer, path: Path): void => {
  if (!isOp(at(t.cur(), path), '+')) return;
  rightNest(t, path, '+');
  sortChain(t, path, '+', monoKey);
  for (;;) {
    const ms = items(at(t.cur(), path), '+');
    const len = ms.length;
    if (len < 2) return;
    const zero = ms.findIndex((m) => isNum(m, 0));
    if (zero >= 0) {
      if (zero < len - 1) t.rw(spine(path, zero), 'add0L', 1);
      else t.rw(spine(path, len - 2), 'add0R', 1);
      continue;
    }
    let i = 0;
    while (i + 1 < len && monoKey(ms[i]) !== monoKey(ms[i + 1])) i++;
    if (i + 1 >= len) return;
    // Bring the two like terms under one node, then add their coefficients.
    let p = spine(path, i);
    if (i < len - 2) {
      t.rw(p, 'assocA', -1);
      p = [...p, 0];
    }
    if (ms[i].k === 'num') {
      t.rw(p, 'arith', 1);
      continue;
    }
    if (!hasCoef(ms[i])) t.rw([...p, 0], 'mul1L', -1);
    if (!hasCoef(ms[i + 1])) t.rw([...p, 1], 'mul1L', -1);
    t.rw(p, 'distR', -1);
    t.rw([...p, 0], 'arith', 1);
    const c = (at(t.cur(), [...p, 0]) as { v: number }).v;
    if (c === 0) t.rw(p, 'mul0L', 1);
    else if (c === 1) t.rw(p, 'mul1L', 1);
  }
};

/* ----------------------------------------------------------- generator */

/** Deterministic 32-bit PRNG (mulberry32), so an instance is the same on every reload. */
const prng = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

export const LEVELS = [
  'numbers only',
  'variables',
  'variables, shuffled',
  'shuffled and multiplied out',
  'with sin² + cos²',
];

const VARS = ['x', 'y', 'z', 'w', 'v', 'u', 'p', 'q', 'r', 'k', 'm', 'h'];

/** The longest E the generator will make. */
export const MAX_NODES = 300;

export interface Spec {
  /** Index into LEVELS: how much the generator is allowed to do. */
  level: number;
  /** The security parameter: how many times the generator hides something. */
  lambda: number;
  seed: number;
}

/** Walk uphill from a bit. The walk read backwards is the planted path. */
const generate = ({ level, lambda, seed }: Spec): { bit: number; walk: Walk } => {
  const rand = prng(seed * 7919 + level * 104729 + 13);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const bit = rand() < 0.5 ? 0 : 1;
  const t = tracer(num(bit), Infinity);
  const pool = VARS.slice(0, level <= 2 ? 4 : VARS.length);

  /** A small random term with a few leaves. */
  const small = (leaves: number): Expr => {
    const leaf = (): Expr => (level === 0 || rand() < 0.15 ? ONE : va(pick(pool)));
    let e = leaf();
    for (let i = 1; i < leaves; i++) {
      const other = leaf();
      const op = rand() < 0.5 ? plus : times;
      e = rand() < 0.5 ? op(e, other) : op(other, e);
    }
    return e;
  };
  /** A product of k two-term sums: short as written, 2^k terms multiplied out. */
  const product = (k: number): Expr => {
    const start = Math.floor(rand() * pool.length);
    let e: Expr | null = null;
    for (let i = 0; i < k; i++) {
      const v = va(pool[(start + i) % pool.length]);
      const f = plus(v, rand() < 0.4 ? ONE : va(pool[(start + i + 1 + Math.floor(rand() * 5)) % pool.length]));
      e = e ? times(e, f) : f;
    }
    return e!;
  };
  const kMax = Math.max(2, Math.min(8, 2 + Math.floor(lambda / 5)));
  const hidden = (room: number): Expr => {
    if (level >= 3) {
      const k = Math.max(2, kMax - Math.floor(rand() * 3));
      if (8 * k < room) return product(k);
    }
    return small(1 + Math.floor(rand() * 3));
  };

  const shuffles: IdName[] = ['commA', 'commM', 'assocA', 'assocM'];
  const scramble = (id: IdName, dir: Dir): boolean =>
    shuffles.includes(id) || (level >= 3 && dir === 1 && (id === 'distL' || id === 'distR' || id === 'neg'));

  for (let n = 0; n < lambda; n++) {
    const e = t.cur();
    const room = MAX_NODES - e.n;
    if (room < 6) break;
    const zeros = sites(e, (s) => isNum(s, 0));
    const ones = sites(e, (s) => isNum(s, 1));
    const r = rand();
    let where: Path;
    if (zeros.length > 0 && r < 0.5) {
      // Hide a zero as something minus itself, or as zero times something.
      where = pick(zeros);
      const term = hidden(room);
      if (rand() < 0.75) t.rw(where, 'sub', -1, { A: term });
      else t.rw(where, 'mul0L', -1, { A: term });
    } else if (level >= 4 && ones.length > 0 && r < 0.78) {
      where = pick(ones);
      t.rw(where, 'pyth', -1, { A: small(1 + Math.floor(rand() * 2)) });
    } else {
      // Make a zero or a one to hide later.
      where = pick(sites(e, () => true));
      t.rw(where, rand() < 0.55 ? 'add0R' : 'mul1R', -1);
    }

    if (level < 2) continue;
    // Scramble, mostly around what was just hidden.
    const inside = (p: Path): boolean => where.every((v, i) => p[i] === v);
    for (let s = 0; s < (level >= 3 ? 5 : 3); s++) {
      const cur = t.cur();
      const all = edges(cur, scramble).filter((g) => cur.n + g.delta <= MAX_NODES);
      const near = all.filter((g) => inside(g.path));
      const from = near.length > 0 && rand() < 0.75 ? near : all;
      if (from.length === 0) break;
      const g = pick(from);
      t.rw(g.path, g.id, g.dir);
    }
  }
  return { bit, walk: { frames: t.frames, steps: t.steps } };
};

/* ------------------------------------------------------------ instance */

export type Outcome = 'reached' | 'stuck' | 'gave up';

export interface Attack extends Walk {
  outcome: Outcome;
  /** The largest expression on the walk. */
  peak: number;
}

export interface Instance {
  spec: Spec;
  /** T: the bit the whole thing is worth. */
  bit: number;
  /** The long expression handed to the attackers. */
  E: Expr;
  /** The generator's walk, from the bit up to E. */
  grown: Walk;
  /** The same walk backwards, from E down to the bit: what the generator keeps. */
  planted: Attack;
  greedy: Attack;
  sorted: Attack;
  canonical: Attack;
  /** E worked out at one random point: the answer, with no path attached. */
  sample: number;
  env: Record<string, number>;
}

const attack = (E: Expr, run: (t: Tracer) => void): Attack => {
  const t = tracer(E);
  let gaveUp = false;
  try {
    run(t);
  } catch (err) {
    if (err !== GAVE_UP) throw err;
    gaveUp = true;
  }
  let peak = 0;
  for (const f of t.frames) peak = Math.max(peak, f.n);
  const outcome: Outcome = gaveUp ? 'gave up' : t.cur().k === 'num' ? 'reached' : 'stuck';
  return { frames: t.frames, steps: t.steps, outcome, peak };
};

export const makeInstance = (spec: Spec): Instance => {
  const { bit, walk } = generate(spec);
  const E = walk.frames[walk.frames.length - 1];

  const planted: Attack = {
    frames: walk.frames.slice().reverse(),
    steps: walk.steps
      .slice()
      .reverse()
      .map((s) => ({ path: s.path, id: s.id, dir: (s.dir === 1 ? -1 : 1) as Dir })),
    outcome: 'reached',
    peak: Math.max(...walk.frames.map((f) => f.n)),
  };

  const greedy = attack(E, (t) => {
    descend(t);
  });
  const sorted = attack(E, (t) => {
    descend(t);
    for (let round = 0; round < 40 && t.cur().k !== 'num'; round++) {
      sortAll(t, []);
      if (descend(t) === 0) break;
    }
  });
  const canonical = attack(E, (t) => canon(t, []));

  const rand = prng(spec.seed + 99);
  const env: Record<string, number> = {};
  for (const v of VARS) env[v] = Math.round((rand() * 4 - 2) * 1000) / 1000;

  return { spec, bit, E, grown: walk, planted, greedy, sorted, canonical, sample: evaluate(E, env), env };
};

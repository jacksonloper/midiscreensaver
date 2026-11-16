/**
 * A toy model of the open problem this post is about: can ordinary algebraic
 * identities hide a short expression so that it is easy to plant and hard to
 * find again?
 *
 * Everything is a walk in one graph. Vertices are expressions; an edge is a
 * single use of one identity from IDENTITIES, in either direction, on one
 * subterm. `makeInstance` plays the generator: it walks uphill from 0 to a
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
  /** A use of a named gate. It stands for that gate's whole definition. */
  | { k: 'ref'; name: string; n: number }
  | { k: 'fn'; fn: Fn; a: Expr; n: number }
  | { k: 'op'; op: Op; a: Expr; b: Expr; n: number };

/** Which child to take at each level: 0 for the left (or only), 1 for the right. */
export type Path = number[];

export const num = (v: number): Expr => ({ k: 'num', v, n: 1 });
export const va = (name: string): Expr => ({ k: 'var', name, n: 1 });
export const ref = (name: string): Expr => ({ k: 'ref', name, n: 1 });
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
    case 'ref':
      return x.name === (y as typeof x).name;
    case 'fn':
      return x.fn === (y as typeof x).fn && same(x.a, (y as typeof x).a);
    default:
      return x.op === (y as typeof x).op && same(x.a, (y as typeof x).a) && same(x.b, (y as typeof x).b);
  }
};

const isNum = (e: Expr, v: number): boolean => e.k === 'num' && e.v === v;
const isOp = (e: Expr, op: Op): e is Extract<Expr, { k: 'op' }> => e.k === 'op' && e.op === op;

/**
 * Values are worked out modulo this prime. A circuit of a few dozen gates can
 * have a degree in the billions, and ordinary arithmetic would overflow long
 * before that; modulo a prime every gate still has an exact value.
 */
export const PRIME = 67108859;
const mod = (v: number): number => ((v % PRIME) + PRIME) % PRIME;
/** Both below 2^26, so the product is below 2^52 and exact. */
const mulmod = (a: number, b: number): number => (a * b) % PRIME;
const powmod = (a: number, e: number): number => {
  let r = 1;
  let base = a;
  for (let k = e; k > 0; k = Math.floor(k / 2)) {
    if (k % 2 === 1) r = mulmod(r, base);
    base = mulmod(base, base);
  }
  return r;
};
/**
 * There is no sine modulo a prime. All the identities know about sin and cos
 * is that their squares add to 1, so each argument value is given some point
 * (s, c) with s² + c² = 1, always the same point for the same value.
 */
const circle = (v: number): [number, number] => {
  let t = mod(v * 48271 + 12345);
  while (mod(1 + mulmod(t, t)) === 0) t = mod(t + 1);
  const inv = powmod(mod(1 + mulmod(t, t)), PRIME - 2);
  return [mulmod(mod(2 * t), inv), mulmod(mod(1 - mulmod(t, t)), inv)];
};

export const evaluate = (e: Expr, env: Record<string, number>, gate?: (name: string) => number): number => {
  switch (e.k) {
    case 'num':
      return mod(e.v);
    case 'var':
    case 'meta':
      return mod(env[e.name] ?? 0);
    case 'ref':
      return gate ? gate(e.name) : 0;
    case 'fn': {
      const [s, c] = circle(evaluate(e.a, env, gate));
      return e.fn === 'sin' ? s : c;
    }
    default: {
      const a = evaluate(e.a, env, gate);
      const b = evaluate(e.b, env, gate);
      return e.op === '+' ? mod(a + b) : e.op === '−' ? mod(a - b) : mulmod(a, b);
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
  kind: 'num' | 'var' | 'ref' | 'fn' | 'op' | 'paren';
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
    else if (n.k === 'ref') out.push({ text: n.name, kind: 'ref', hot: h });
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
    case 'ref':
      return e.k === 'ref' && e.name === pat.name;
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
    case 'ref':
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
    const a = sub.a.v;
    const b = sub.b.v;
    const v = sub.op === '+' ? a + b : sub.op === '−' ? a - b : a * b;
    // Past 2^53 the arithmetic would stop being exact, and so would the walk.
    return Number.isSafeInteger(v) ? num(v) : null;
  }
  const { l, r } = IDENTITIES[id];
  const s: Binding = {};
  if (!match(dir === 1 ? l : r, sub, s)) return null;
  return fill(dir === 1 ? r : l, free ? { ...free, ...s } : s);
};

/* ------------------------------------------------------------ circuits */

/** A named gate: `name` may be used anywhere in place of `body`. */
export interface Def {
  name: string;
  body: Expr;
}

/**
 * An expression with shared parts: a root, and gates it and each other may
 * refer to by name. Its size is everything that has to be written down, each
 * gate once however often it is used.
 */
export interface Circuit {
  root: Expr;
  defs: Def[];
  n: number;
}

export const circuit = (root: Expr, defs: Def[] = []): Circuit => ({
  root,
  defs,
  n: defs.reduce((sum, d) => sum + d.body.n, root.n),
});

/** The root when `def` is null, otherwise that gate's definition. */
export const bodyOf = (c: Circuit, def: string | null): Expr => {
  if (def === null) return c.root;
  const d = c.defs.find((x) => x.name === def);
  if (!d) throw new Error(`no gate ${def}`);
  return d.body;
};

const withBody = (c: Circuit, def: string | null, body: Expr): Circuit =>
  def === null ? circuit(body, c.defs) : circuit(c.root, c.defs.map((d) => (d.name === def ? { name: def, body } : d)));

const countRefs = (e: Expr, name: string): number =>
  e.k === 'ref' ? (e.name === name ? 1 : 0) : e.k === 'fn' ? countRefs(e.a, name) : e.k === 'op' ? countRefs(e.a, name) + countRefs(e.b, name) : 0;

/** How many times a gate is used, anywhere. */
const uses = (c: Circuit, name: string): number =>
  c.defs.reduce((sum, d) => sum + countRefs(d.body, name), countRefs(c.root, name));

const refNames = (e: Expr, out = new Set<string>()): Set<string> => {
  if (e.k === 'ref') out.add(e.name);
  else if (e.k === 'fn') refNames(e.a, out);
  else if (e.k === 'op') {
    refNames(e.a, out);
    refNames(e.b, out);
  }
  return out;
};

/** How many layers of gates sit under each gate: 1 for a gate that uses no other. */
export const heights = (c: Circuit): Map<string, number> => {
  const h = new Map<string, number>();
  const of = (name: string): number => {
    const had = h.get(name);
    if (had !== undefined) return had;
    let v = 1;
    for (const r of refNames(bodyOf(c, name))) v = Math.max(v, of(r) + 1);
    h.set(name, v);
    return v;
  };
  for (const d of c.defs) of(d.name);
  return h;
};

export const evalCircuit = (c: Circuit, env: Record<string, number>): number => {
  const known = new Map<string, number>();
  const gate = (name: string): number => {
    let v = known.get(name);
    if (v === undefined) {
      v = evaluate(bodyOf(c, name), env, gate);
      known.set(name, v);
    }
    return v;
  };
  return evaluate(c.root, env, gate);
};

/** How long the root would be with every gate written out in full wherever it is used. */
export const fullSize = (c: Circuit): number => {
  const known = new Map<string, number>();
  const of = (e: Expr): number => {
    if (e.k === 'ref') {
      let v = known.get(e.name);
      if (v === undefined) {
        v = of(bodyOf(c, e.name));
        known.set(e.name, v);
      }
      return v;
    }
    return e.k === 'fn' ? 1 + of(e.a) : e.k === 'op' ? 1 + of(e.a) + of(e.b) : 1;
  };
  return of(c.root);
};

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'κ', 'μ', 'ν', 'ξ', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω'];
const freshName = (c: Circuit): string => {
  for (let round = 0; ; round++) {
    for (const g of GREEK) {
      const name = g + '′'.repeat(round);
      if (!c.defs.some((d) => d.name === name)) return name;
    }
  }
};

/* --------------------------------------------------------------- steps */

/**
 * One edge of the graph. Either one identity used once inside the root or one
 * gate, or one of four moves that change what is shared without changing what
 * anything is worth:
 *
 *   unfold  write a gate's definition in place of one use of its name
 *   fold    the reverse: write a gate's name in place of a copy of its definition
 *   add     define a new gate that nothing uses yet
 *   drop    the reverse: delete a gate that nothing uses
 */
export type Step =
  | { kind: 'id'; def: string | null; path: Path; id: IdName; dir: Dir }
  | { kind: 'unfold'; def: string | null; path: Path; name: string }
  | { kind: 'fold'; def: string | null; path: Path; name: string }
  | { kind: 'add'; name: string; body: Expr }
  | { kind: 'drop'; name: string; body: Expr };

/** Take one step from `c`. Null when the step does not fit. */
export const applyStep = (c: Circuit, step: Step, free?: Binding): Circuit | null => {
  if (step.kind === 'add') {
    if (c.defs.some((d) => d.name === step.name)) return null;
    for (const r of refNames(step.body)) if (!c.defs.some((d) => d.name === r)) return null;
    return circuit(c.root, [...c.defs, { name: step.name, body: step.body }]);
  }
  if (step.kind === 'drop') {
    const d = c.defs.find((x) => x.name === step.name);
    if (!d || !same(d.body, step.body) || uses(c, step.name) > 0) return null;
    return circuit(c.root, c.defs.filter((x) => x !== d));
  }
  if (step.def !== null && !c.defs.some((d) => d.name === step.def)) return null;
  const body = bodyOf(c, step.def);
  const sub = at(body, step.path);
  let by: Expr | null = null;
  if (step.kind === 'id') by = applyIdentity(step.id, step.dir, sub, free);
  else {
    const d = c.defs.find((x) => x.name === step.name);
    if (!d) return null;
    if (step.kind === 'unfold') by = sub.k === 'ref' && sub.name === step.name ? d.body : null;
    else by = step.def !== step.name && same(sub, d.body) ? ref(step.name) : null;
  }
  return by && withBody(c, step.def, replaceAt(body, step.path, by));
};

export const reverseStep = (s: Step): Step =>
  s.kind === 'id'
    ? { ...s, dir: s.dir === 1 ? -1 : 1 }
    : s.kind === 'unfold'
      ? { ...s, kind: 'fold' }
      : s.kind === 'fold'
        ? { ...s, kind: 'unfold' }
        : s.kind === 'add'
          ? { ...s, kind: 'drop' }
          : { ...s, kind: 'add' };

/** Is `after` exactly `before` with one identity used once at `path`? */
const verifyTree = (before: Expr, after: Expr, path: Path, id: IdName, dir: Dir): boolean => {
  let b = before;
  let a = after;
  for (const i of path) {
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
  if (id === 'arith') {
    const [from, to] = dir === 1 ? [b, a] : [a, b];
    const got = applyIdentity('arith', 1, from);
    return got !== null && same(got, to);
  }
  const { l, r } = IDENTITIES[id];
  const s: Binding = {};
  return match(dir === 1 ? l : r, b, s) && match(dir === 1 ? r : l, a, s);
};

const sameCircuit = (x: Circuit, y: Circuit): boolean =>
  same(x.root, y.root) &&
  x.defs.length === y.defs.length &&
  x.defs.every((d) => {
    const e = y.defs.find((o) => o.name === d.name);
    return e !== undefined && same(d.body, e.body);
  });

/**
 * Is `after` one step from `before`? Looks only at the two circuits. For an
 * identity, nothing outside the rewritten subterm may differ and the subterm
 * before and after must be the two sides of the identity under one binding.
 * The four sharing moves have only one possible result each, so they are
 * checked by doing them again.
 */
export const verifyStep = (before: Circuit, after: Circuit, step: Step): boolean => {
  if (step.kind !== 'id') {
    const got = applyStep(before, step);
    return got !== null && sameCircuit(got, after);
  }
  if (before.defs.length !== after.defs.length) return false;
  for (const d of before.defs) {
    const e = after.defs.find((o) => o.name === d.name);
    if (!e || (d.name !== step.def && !same(d.body, e.body))) return false;
  }
  if (step.def !== null && !same(before.root, after.root)) return false;
  if (step.def !== null && !before.defs.some((d) => d.name === step.def)) return false;
  return verifyTree(bodyOf(before, step.def), bodyOf(after, step.def), step.path, step.id, step.dir);
};

/** The step in words, e.g. "A + 0 → A", "1 + 1 → 2" or "unfold β". */
export const ruleText = (step: Step, before: Circuit, after: Circuit): string => {
  if (step.kind === 'unfold') return `unfold ${step.name}: write out what it stands for`;
  if (step.kind === 'fold') return `fold: this is ${step.name}, so write ${step.name}`;
  if (step.kind === 'add') return `add a gate ${step.name} that nothing uses yet`;
  if (step.kind === 'drop') return `drop ${step.name}: nothing uses it`;
  if (step.id === 'arith') {
    return `${show(at(bodyOf(before, step.def), step.path))} → ${show(at(bodyOf(after, step.def), step.path))}`;
  }
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

interface TreeEdge {
  path: Path;
  id: IdName;
  dir: Dir;
  by: Expr;
  delta: number;
}

/** Every identity edge out of one tree whose far end is fixed by the tree. */
const treeEdges = (e: Expr, only?: (id: IdName, dir: Dir) => boolean): TreeEdge[] => {
  const out: TreeEdge[] = [];
  visit(e, (n, p) => {
    for (const { id, dir } of FIXED) {
      if (only && !only(id, dir)) continue;
      const by = applyIdentity(id, dir, n);
      if (by && !same(by, n)) out.push({ path: p.slice(), id, dir, by, delta: by.n - n.n });
    }
  });
  return out;
};

export interface Edge {
  step: Step;
  /** Change in size: negative is downhill. */
  delta: number;
}

/**
 * Every edge out of a circuit whose far end is fixed by the circuit: the
 * identities, unfolding any use of a gate, folding any copy of a gate's
 * definition, and dropping any unused gate. Adding a gate is left out, like
 * the identities that invent a term: there is no end of gates to add.
 */
export const edges = (c: Circuit): Edge[] => {
  const out: Edge[] = [];
  const bodies: [string | null, Expr][] = [[null, c.root], ...c.defs.map((d): [string, Expr] => [d.name, d.body])];
  for (const [def, body] of bodies) {
    for (const g of treeEdges(body)) out.push({ step: { kind: 'id', def, path: g.path, id: g.id, dir: g.dir }, delta: g.delta });
    if (c.defs.length === 0) continue;
    visit(body, (n, p) => {
      if (n.k === 'ref') {
        out.push({ step: { kind: 'unfold', def, path: p.slice(), name: n.name }, delta: bodyOf(c, n.name).n - 1 });
      } else if (n.n > 1) {
        for (const d of c.defs) {
          if (d.name !== def && d.body.n === n.n && same(d.body, n)) {
            out.push({ step: { kind: 'fold', def, path: p.slice(), name: d.name }, delta: 1 - n.n });
            break;
          }
        }
      }
    });
  }
  for (const d of c.defs) {
    if (uses(c, d.name) === 0) out.push({ step: { kind: 'drop', name: d.name, body: d.body }, delta: -d.body.n });
  }
  return out;
};

/** How many edges lead to a shorter, an equally long and a longer circuit. */
export const edgeCounts = (c: Circuit): { down: number; level: number; up: number } => {
  let down = 0;
  let level = 0;
  let up = 0;
  for (const g of edges(c)) {
    if (g.delta < 0) down++;
    else if (g.delta === 0) level++;
    else up++;
  }
  return { down, level, up };
};

/* --------------------------------------------------------------- walks */

export interface Walk {
  frames: Circuit[];
  /** steps[i] turns frames[i] into frames[i + 1]. */
  steps: Step[];
}

const GAVE_UP = { gaveUp: true };

/** Longest walk an attacker may take, and the largest circuit it may hold. */
export const STEP_BUDGET = 12000;
export const NODE_BUDGET = 4000;

/** A grip on one tree, the root or one gate, for code that only knows about trees. */
interface Hand {
  cur: () => Expr;
  /** Use an identity; throws if it does not fit, or GAVE_UP past the budget. */
  rw: (path: Path, id: IdName, dir: Dir, free?: Binding) => void;
}

interface Tracer extends Walk {
  cur: () => Circuit;
  take: (step: Step, free?: Binding) => void;
  hand: (def: string | null) => Hand;
}

const tracer = (start: Circuit, budget = STEP_BUDGET): Tracer => {
  let cur = start;
  const frames: Circuit[] = [start];
  const steps: Step[] = [];
  const take = (step: Step, free?: Binding): void => {
    const next = applyStep(cur, step, free);
    if (!next) {
      // Arithmetic that would overflow is a reason to stop, not a bug.
      if (step.kind === 'id' && step.id === 'arith') throw GAVE_UP;
      throw new Error(`step does not fit: ${JSON.stringify(step).slice(0, 120)}`);
    }
    if (steps.length >= budget) throw GAVE_UP;
    cur = next;
    frames.push(cur);
    steps.push(step);
    if (cur.n > NODE_BUDGET) throw GAVE_UP;
  };
  return {
    frames,
    steps,
    cur: () => cur,
    take,
    hand: (def) => ({
      cur: () => bodyOf(cur, def),
      rw: (path, id, dir, free) => take({ kind: 'id', def, path: path.slice(), id, dir }, free),
    }),
  };
};

/* ----------------------------------------------------- lists under + or · */

const ASSOC: Record<'+' | '·', IdName> = { '+': 'assocA', '·': 'assocM' };
const COMM: Record<'+' | '·', IdName> = { '+': 'commA', '·': 'commM' };

/** Re-bracket a chain of one operator to a + (b + (c + …)). */
const rightNest = (t: Hand, path: Path, op: '+' | '·'): void => {
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
const swap = (t: Hand, path: Path, op: '+' | '·', i: number, len: number): void => {
  const p = spine(path, i);
  if (i === len - 2) t.rw(p, COMM[op], 1);
  else {
    t.rw(p, ASSOC[op], -1);
    t.rw([...p, 0], COMM[op], 1);
    t.rw(p, ASSOC[op], 1);
  }
};

/** Bubble-sort a right-nested chain by key, one neighbouring swap at a time. */
const sortChain = (t: Hand, path: Path, op: '+' | '·', key: (e: Expr) => string): void => {
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

/** Take the edge that shortens the circuit most, until none shortens it. Returns steps taken. */
const descend = (t: Tracer): number => {
  let taken = 0;
  for (;;) {
    let best: Edge | null = null;
    for (const g of edges(t.cur())) if (g.delta < 0 && (!best || g.delta < best.delta)) best = g;
    if (!best) return taken;
    t.take(best.step);
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
  else if (e.k === 'var' || e.k === 'meta' || e.k === 'ref') s = e.name;
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
const sortAll = (t: Hand, path: Path): void => {
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
 * functions end up letter for letter the same, so a hidden zero ends up as
 * 0. The catch is how long the walk is.
 */
const canon = (t: Hand, path: Path): void => {
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
const mergeProduct = (t: Hand, path: Path): void => {
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
const mergeMonomial = (t: Hand, path: Path): void => {
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
const mergeSum = (t: Hand, path: Path): void => {
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

/* -------------------------------------------- the attackers, on circuits */

/** Somewhere a gate is used, if anywhere. */
const findUse = (c: Circuit, name: string, only?: string | null): { def: string | null; path: Path } | null => {
  const bodies: [string | null, Expr][] = [[null, c.root], ...c.defs.map((d): [string, Expr] => [d.name, d.body])];
  for (const [def, body] of bodies) {
    if (only !== undefined && def !== only) continue;
    const found = sites(body, (n) => n.k === 'ref' && n.name === name)[0];
    if (found) return { def, path: found };
  }
  return null;
};

/** Two gates with the same definition are one gate: point every use of `twin` at `keep`. */
const mergeGate = (t: Tracer, twin: string, keep: string): void => {
  for (let use = findUse(t.cur(), twin); use; use = findUse(t.cur(), twin)) {
    t.take({ kind: 'unfold', def: use.def, path: use.path, name: twin });
    t.take({ kind: 'fold', def: use.def, path: use.path, name: keep });
  }
  t.take({ kind: 'drop', name: twin, body: bodyOf(t.cur(), twin) });
};

const mergeTwins = (t: Tracer): boolean => {
  const defs = t.cur().defs;
  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      if (same(defs[i].body, defs[j].body)) {
        mergeGate(t, defs[j].name, defs[i].name);
        return true;
      }
    }
  }
  return false;
};

/** Delete every gate nothing uses, and then any that only those used. */
const sweep = (t: Tracer): void => {
  for (;;) {
    const c = t.cur();
    const dead = c.defs.find((d) => uses(c, d.name) === 0);
    if (!dead) return;
    t.take({ kind: 'drop', name: dead.name, body: dead.body });
  }
};

/** Attacker 2: one fixed order everywhere, gates that came out the same merged, then downhill. */
const sortThenDescend = (t: Tracer): void => {
  descend(t);
  for (let round = 0; round < 40 && t.cur().root.k !== 'num'; round++) {
    let merged = false;
    do {
      for (const def of [null, ...t.cur().defs.map((d) => d.name)]) sortAll(t.hand(def), []);
    } while (mergeTwins(t) && (merged = true));
    if (descend(t) === 0 && !merged) break;
  }
  sweep(t);
};

/**
 * Attacker 3: expand. Each gate is put in canonical form with the gates
 * under it treated as extra variables, lowest first, merging any two that
 * come out the same. If the root is still not a number, the tallest gate it
 * mentions is written out in full and the root expanded again, and so on down
 * until no gates are left. It always gets there. The catch is how long the
 * root is by then.
 */
const expandAll = (t: Tracer): void => {
  const h = heights(t.cur());
  const order = t.cur().defs.map((d) => d.name).sort((a, b) => h.get(a)! - h.get(b)!);
  const done: string[] = [];
  for (const name of order) {
    canon(t.hand(name), []);
    const twin = done.find((d) => same(bodyOf(t.cur(), d), bodyOf(t.cur(), name)));
    if (twin) mergeGate(t, name, twin);
    else done.push(name);
  }
  canon(t.hand(null), []);
  while (t.cur().root.k !== 'num') {
    const hs = heights(t.cur());
    let top: string | null = null;
    for (const r of refNames(t.cur().root)) if (top === null || hs.get(r)! > hs.get(top)!) top = r;
    if (top === null) break;
    for (let use = findUse(t.cur(), top, null); use; use = findUse(t.cur(), top, null)) {
      t.take({ kind: 'unfold', def: null, path: use.path, name: top });
    }
    canon(t.hand(null), []);
  }
  sweep(t);
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
  'shared gates',
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

/** Walk uphill from 0. The walk read backwards is the planted path. */
const generate = ({ level, lambda, seed }: Spec): { bit: number; walk: Walk } => {
  const ct = tracer(circuit(ZERO), Infinity);
  const rand = prng(seed * 7919 + level * 104729 + 13);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  // T is always 0, so the question is the classic one: is E zero everywhere?
  const bit = 0;
  const t = ct.hand(null);
  const pool = VARS.slice(0, level <= 2 ? 4 : VARS.length);

  const shuffles: IdName[] = ['commA', 'commM', 'assocA', 'assocM'];
  const scramble = (id: IdName, dir: Dir): boolean =>
    shuffles.includes(id) || (level >= 3 && dir === 1 && (id === 'distL' || id === 'distR' || id === 'neg'));

  if (level >= 5) {
    // A tower of gates, each using the one below it twice, so the degree
    // doubles at every floor while the circuit grows by a few nodes.
    const floors = Math.max(2, Math.min(9, 2 + Math.floor(lambda / 5)));
    const v = (): Expr => va(pick(pool));
    const tower: string[] = [];
    const add = (body: Expr): void => {
      const name = freshName(ct.cur());
      ct.take({ kind: 'add', name, body });
      tower.push(name);
    };
    add(rand() < 0.5 ? plus(v(), v()) : plus(times(v(), v()), ONE));
    for (let i = 1; i <= floors; i++) {
      const a = ref(tower[i - 1]);
      const form = Math.floor(rand() * 5);
      add(
        form === 0
          ? times(plus(a, v()), a)
          : form === 1
            ? plus(times(a, a), v())
            : form === 2
              ? times(plus(a, ONE), plus(a, v()))
              : form === 3
                ? plus(times(a, plus(a, v())), ONE)
                : times(plus(a, v()), plus(a, v())),
      );
    }
    // Zero, as the top of the tower minus itself.
    t.rw([], 'sub', -1, { A: ref(tower[floors]) });

    // Now make the right-hand copy a different circuit for the same thing.
    // Going down the tower, write out one use of each floor and scramble
    // around it, so the right side ends up built from pieces of every floor
    // that no longer line up with the gates on the left.
    const right = (p: Path): boolean => p[0] === 1;
    for (let j = floors; j >= 1; j--) {
      const here = sites(ct.cur().root, (n) => n.k === 'ref' && n.name === tower[j]).filter(right);
      if (here.length === 0) continue;
      const where = pick(here);
      ct.take({ kind: 'unfold', def: null, path: where, name: tower[j] });
      const inside = (p: Path): boolean => where.every((x, i) => p[i] === x);
      for (let s = 0; s < 3; s++) {
        const cur = ct.cur();
        const all = treeEdges(cur.root, scramble).filter((g) => right(g.path) && cur.n + g.delta <= MAX_NODES);
        const near = all.filter((g) => inside(g.path));
        // The first scramble on each floor multiplies something out if it can: that is what sorting cannot undo.
        const spread = near.filter((g) => g.id === 'distL' || g.id === 'distR');
        const from = s === 0 && spread.length > 0 ? spread : near.length > 0 && rand() < 0.75 ? near : all;
        if (from.length === 0) break;
        const g = pick(from);
        t.rw(g.path, g.id, g.dir);
      }
    }
    // Give a couple of pieces of the right side names of their own: gates the left side has no match for.
    for (let g = 0; g < 2; g++) {
      const root = ct.cur().root;
      const cands = sites(root, (n) => n.k === 'op' && n.n >= 3 && n.n <= 9).filter(right);
      if (cands.length === 0) break;
      const body = at(root, pick(cands));
      const name = freshName(ct.cur());
      ct.take({ kind: 'add', name, body });
      for (const p of sites(ct.cur().root, (n) => same(n, body))) ct.take({ kind: 'fold', def: null, path: p, name });
    }
    return { bit, walk: { frames: ct.frames, steps: ct.steps } };
  }

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
      const all = treeEdges(cur, scramble).filter((g) => cur.n + g.delta <= MAX_NODES);
      const near = all.filter((g) => inside(g.path));
      const from = near.length > 0 && rand() < 0.75 ? near : all;
      if (from.length === 0) break;
      const g = pick(from);
      t.rw(g.path, g.id, g.dir);
    }
  }
  return { bit, walk: { frames: ct.frames, steps: ct.steps } };
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
  /** T: what the whole thing is worth. Always 0. */
  bit: number;
  /** The long expression handed to the attackers. */
  E: Circuit;
  /** The generator's walk, from 0 up to E. */
  grown: Walk;
  /** The same walk backwards, from E down to 0: what the generator keeps. */
  planted: Attack;
  greedy: Attack;
  sorted: Attack;
  canonical: Attack;
  /** E worked out at one random point: the answer, with no path attached. */
  sample: number;
  env: Record<string, number>;
}

const attack = (E: Circuit, run: (t: Tracer) => void): Attack => {
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
  const outcome: Outcome = gaveUp ? 'gave up' : t.cur().root.k === 'num' ? 'reached' : 'stuck';
  return { frames: t.frames, steps: t.steps, outcome, peak };
};

export const makeInstance = (spec: Spec): Instance => {
  const { bit, walk } = generate(spec);
  const E = walk.frames[walk.frames.length - 1];

  const planted: Attack = {
    frames: walk.frames.slice().reverse(),
    steps: walk.steps.slice().reverse().map(reverseStep),
    outcome: 'reached',
    peak: Math.max(...walk.frames.map((f) => f.n)),
  };

  const greedy = attack(E, (t) => {
    descend(t);
  });
  const sorted = attack(E, sortThenDescend);
  const canonical = attack(E, expandAll);

  const rand = prng(spec.seed + 99);
  const env: Record<string, number> = {};
  for (const v of VARS) env[v] = Math.floor(rand() * PRIME);

  return { spec, bit, E, grown: walk, planted, greedy, sorted, canonical, sample: evalCircuit(E, env), env };
};

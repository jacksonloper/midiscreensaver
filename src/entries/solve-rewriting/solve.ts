/**
 * Solving for unknowns by rewriting, as a game between a generator and some
 * attackers.
 *
 * Everything is a bit: + is "exclusive or" (1 + 1 = 0) and · is "and". A
 * system is a few equations in the unknowns x, y, z and some given letters.
 * It is solved when each unknown stands alone on the left of one equation
 * and no unknown appears on any right.
 *
 * A vertex of the graph is a system; an edge is one step: one identity used
 * once on one subterm, or one of four moves on whole equations. Every step
 * can be undone by another step, so no step gains or loses solutions.
 *
 * `makeInstance` plays the generator: it starts from the solved system, walks
 * to a scrambled one and keeps the walk. Read backwards, that walk solves the
 * scrambled system. Then three attackers, given only the scrambled system,
 * try to solve it themselves.
 *
 * No imports and only erasable TypeScript, so `node tests/solve-check.mjs`
 * can load this file directly.
 */

export type Op = '+' | '·';

/** `n` is the number of nodes, kept on the node so size is free to ask for. */
export type Expr =
  | { k: 'num'; v: number; n: number }
  | { k: 'var'; name: string; n: number }
  /** A placeholder in an identity. Never appears in a real expression. */
  | { k: 'meta'; name: string; n: number }
  | { k: 'op'; op: Op; a: Expr; b: Expr; n: number };

/** Which child to take at each level: 0 for the left, 1 for the right. */
export type Path = number[];

const num = (v: number): Expr => ({ k: 'num', v, n: 1 });
const va = (name: string): Expr => ({ k: 'var', name, n: 1 });
const meta = (name: string): Expr => ({ k: 'meta', name, n: 1 });
const bin = (op: Op, a: Expr, b: Expr): Expr => ({ k: 'op', op, a, b, n: a.n + b.n + 1 });
const plus = (a: Expr, b: Expr): Expr => bin('+', a, b);
const times = (a: Expr, b: Expr): Expr => bin('·', a, b);

const ZERO = num(0);
const ONE = num(1);

export const UNKNOWNS = ['x', 'y', 'z'];
const GIVENS = ['a', 'b', 'c', 'd', 'e', 'f'];
export const isUnknown = (name: string): boolean => UNKNOWNS.includes(name);

export const same = (x: Expr, y: Expr): boolean => {
  if (x === y) return true;
  if (x.n !== y.n || x.k !== y.k) return false;
  if (x.k === 'num') return x.v === (y as typeof x).v;
  if (x.k === 'var' || x.k === 'meta') return x.name === (y as typeof x).name;
  return x.op === (y as typeof x).op && same(x.a, (y as typeof x).a) && same(x.b, (y as typeof x).b);
};

const isNum = (e: Expr, v: number): boolean => e.k === 'num' && e.v === v;
const isOp = (e: Expr, op: Op): e is Extract<Expr, { k: 'op' }> => e.k === 'op' && e.op === op;

/** The value of an expression, 0 or 1, given a value for every letter. */
export const evaluate = (e: Expr, env: Record<string, number>): number => {
  if (e.k === 'num') return e.v & 1;
  if (e.k === 'var' || e.k === 'meta') return env[e.name] ?? 0;
  const a = evaluate(e.a, env);
  const b = evaluate(e.b, env);
  return e.op === '+' ? a ^ b : a & b;
};

export const at = (e: Expr, path: Path): Expr => {
  let n = e;
  for (const i of path) {
    if (n.k !== 'op') break;
    n = i === 0 ? n.a : n.b;
  }
  return n;
};

const replaceAt = (e: Expr, path: Path, by: Expr, i = 0): Expr => {
  if (i >= path.length || e.k !== 'op') return by;
  return path[i] === 0
    ? bin(e.op, replaceAt(e.a, path, by, i + 1), e.b)
    : bin(e.op, e.a, replaceAt(e.b, path, by, i + 1));
};

/** Visit every node with its path, parents first. The path is reused: copy it to keep it. */
const visit = (e: Expr, f: (n: Expr, path: Path) => void): void => {
  const path: Path = [];
  const walk = (n: Expr): void => {
    f(n, path);
    if (n.k === 'op') {
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

const countUnknowns = (e: Expr): number =>
  e.k === 'var' ? (isUnknown(e.name) ? 1 : 0) : e.k === 'op' ? countUnknowns(e.a) + countUnknowns(e.b) : 0;

const mentions = (e: Expr, name: string): boolean =>
  e.k === 'var' ? e.name === name : e.k === 'op' ? mentions(e.a, name) || mentions(e.b, name) : false;

/* ------------------------------------------------------------ printing */

export interface Token {
  text: string;
  kind: 'num' | 'var' | 'unknown' | 'op' | 'paren' | 'eq';
  /** Inside the subterm being rewritten. */
  hot: boolean;
}

const prec = (e: Expr): number => (e.k === 'op' ? (e.op === '·' ? 2 : 1) : 3);

/** Tokens for `e` with as few brackets as the tree allows; the tree is shown faithfully. */
export const tokens = (e: Expr, hot: Path | null = null): Token[] => {
  const out: Token[] = [];
  const walk = (n: Expr, parent: number, right: boolean, depth: number, on: boolean, inHot: boolean): void => {
    const h = inHot || (on && hot !== null && depth === hot.length);
    const down = (i: number): boolean => on && hot !== null && depth < hot.length && hot[depth] === i;
    const wrap = parent > 0 && (prec(n) < parent || (right && prec(n) === parent));
    if (wrap) out.push({ text: '(', kind: 'paren', hot: h });
    if (n.k === 'num') out.push({ text: String(n.v), kind: 'num', hot: h });
    else if (n.k === 'var' || n.k === 'meta') {
      out.push({ text: n.name, kind: n.k === 'var' && isUnknown(n.name) ? 'unknown' : 'var', hot: h });
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

const A = meta('A');
const B = meta('B');
const C = meta('C');

/**
 * The identities, each true for all bits A, B and C and usable in either
 * direction on any subterm. Two of them are special to bits: A + A = 0 and
 * A · A = A.
 */
export const IDENTITIES = {
  add0R: { l: plus(A, ZERO), r: A },
  add0L: { l: plus(ZERO, A), r: A },
  mul1R: { l: times(A, ONE), r: A },
  mul1L: { l: times(ONE, A), r: A },
  mul0R: { l: times(A, ZERO), r: ZERO },
  mul0L: { l: times(ZERO, A), r: ZERO },
  self: { l: plus(A, A), r: ZERO },
  idem: { l: times(A, A), r: A },
  commA: { l: plus(A, B), r: plus(B, A) },
  commM: { l: times(A, B), r: times(B, A) },
  assocA: { l: plus(plus(A, B), C), r: plus(A, plus(B, C)) },
  assocM: { l: times(times(A, B), C), r: times(A, times(B, C)) },
  distL: { l: times(A, plus(B, C)), r: plus(times(A, B), times(A, C)) },
  distR: { l: times(plus(A, B), C), r: plus(times(A, C), times(B, C)) },
} satisfies Record<string, { l: Expr; r: Expr }>;

export type IdName = keyof typeof IDENTITIES;
export type Dir = 1 | -1;
type Binding = Record<string, Expr>;

const match = (pat: Expr, e: Expr, s: Binding): boolean => {
  if (pat.k === 'meta') {
    const had = s[pat.name];
    if (had) return same(had, e);
    s[pat.name] = e;
    return true;
  }
  if (pat.k === 'num') return e.k === 'num' && e.v === pat.v;
  if (pat.k === 'var') return e.k === 'var' && e.name === pat.name;
  return e.k === 'op' && e.op === pat.op && match(pat.a, e.a, s) && match(pat.b, e.b, s);
};

const fill = (pat: Expr, s: Binding): Expr | null => {
  if (pat.k === 'meta') return s[pat.name] ?? null;
  if (pat.k !== 'op') return pat;
  const a = fill(pat.a, s);
  const b = fill(pat.b, s);
  return a && b && bin(pat.op, a, b);
};

/** Use one identity on `sub` in one direction. Directions that invent a term take it from `free`. */
const applyIdentity = (id: IdName, dir: Dir, sub: Expr, free?: Binding): Expr | null => {
  const { l, r } = IDENTITIES[id];
  const s: Binding = {};
  if (!match(dir === 1 ? l : r, sub, s)) return null;
  return fill(dir === 1 ? r : l, free ? { ...free, ...s } : s);
};

const metasOf = (e: Expr, out = new Set<string>()): Set<string> => {
  if (e.k === 'meta') out.add(e.name);
  else if (e.k === 'op') {
    metasOf(e.a, out);
    metasOf(e.b, out);
  }
  return out;
};

/** Directions whose result is fixed by the subterm; the others invent a term. */
const FIXED: { id: IdName; dir: Dir }[] = [];
for (const id of Object.keys(IDENTITIES) as IdName[]) {
  const ml = metasOf(IDENTITIES[id].l);
  const mr = metasOf(IDENTITIES[id].r);
  if ([...mr].every((m) => ml.has(m))) FIXED.push({ id, dir: 1 });
  if ([...ml].every((m) => mr.has(m))) FIXED.push({ id, dir: -1 });
}

interface TreeEdge {
  path: Path;
  id: IdName;
  dir: Dir;
  by: Expr;
}

const treeEdges = (e: Expr, only?: (id: IdName, dir: Dir) => boolean): TreeEdge[] => {
  const out: TreeEdge[] = [];
  visit(e, (n, p) => {
    for (const { id, dir } of FIXED) {
      if (only && !only(id, dir)) continue;
      const by = applyIdentity(id, dir, n);
      if (by && !same(by, n)) out.push({ path: p.slice(), id, dir, by });
    }
  });
  return out;
};

/* ------------------------------------------------------------- systems */

export interface Eq {
  l: Expr;
  r: Expr;
}

export interface System {
  eqs: Eq[];
  /** Everything written down: both sides of every equation. */
  n: number;
}

const system = (eqs: Eq[]): System => ({ eqs, n: eqs.reduce((s, e) => s + e.l.n + e.r.n, 0) });
export const sideOf = (q: Eq, side: 0 | 1): Expr => (side === 0 ? q.l : q.r);
const withSide = (s: System, eq: number, side: 0 | 1, body: Expr): System =>
  system(s.eqs.map((q, i) => (i !== eq ? q : side === 0 ? { l: body, r: q.r } : { l: q.l, r: body })));

const lone = (e: Expr): string | null => (e.k === 'var' && isUnknown(e.name) ? e.name : null);

/**
 * How many unknowns are out of place: every appearance of an unknown, except
 * one standing alone as the whole left side of an equation. Zero is necessary
 * for a solved system, and it is the obvious thing to try to drive down.
 */
export const stray = (s: System): number =>
  s.eqs.reduce((sum, q) => sum + countUnknowns(q.l) + countUnknowns(q.r) - (lone(q.l) ? 1 : 0), 0);

/** Solved: each equation is a different unknown, alone, equal to something with no unknowns in it. */
export const solved = (s: System): boolean => {
  const names = s.eqs.map((q) => lone(q.l));
  return stray(s) === 0 && names.every((x) => x !== null) && new Set(names).size === names.length;
};

/* --------------------------------------------------------------- steps */

/**
 * One edge of the graph.
 *
 *   id      one identity, used once, inside one side of one equation
 *   both    add the same term to both sides
 *   cancel  the reverse: take the same last term off both sides
 *   swap    exchange the two sides
 *   subst   one side of another equation appears here: write its other side instead
 *
 * Over bits there is no subtraction to worry about: adding a term to both
 * sides is how a term changes sides, because t + t = 0. Multiplying both
 * sides by something is not a step, because it cannot be undone.
 */
export type Step =
  | { kind: 'id'; eq: number; side: 0 | 1; path: Path; id: IdName; dir: Dir }
  | { kind: 'both'; eq: number; t: Expr }
  | { kind: 'cancel'; eq: number; t: Expr }
  | { kind: 'swap'; eq: number }
  | { kind: 'subst'; eq: number; side: 0 | 1; path: Path; from: number; way: Dir };

export const applyStep = (s: System, step: Step, free?: Binding): System | null => {
  const q = s.eqs[step.eq];
  if (!q) return null;
  const put = (l: Expr, r: Expr): System => system(s.eqs.map((o, i) => (i === step.eq ? { l, r } : o)));
  switch (step.kind) {
    case 'both':
      return put(plus(q.l, step.t), plus(q.r, step.t));
    case 'cancel':
      if (!isOp(q.l, '+') || !isOp(q.r, '+') || !same(q.l.b, step.t) || !same(q.r.b, step.t)) return null;
      return put(q.l.a, q.r.a);
    case 'swap':
      return put(q.r, q.l);
    case 'id': {
      const body = sideOf(q, step.side);
      const by = applyIdentity(step.id, step.dir, at(body, step.path), free);
      return by && withSide(s, step.eq, step.side, replaceAt(body, step.path, by));
    }
    default: {
      const src = s.eqs[step.from];
      if (!src || step.from === step.eq) return null;
      const body = sideOf(q, step.side);
      const [was, now] = step.way === 1 ? [src.l, src.r] : [src.r, src.l];
      if (!same(at(body, step.path), was)) return null;
      return withSide(s, step.eq, step.side, replaceAt(body, step.path, now));
    }
  }
};

export const reverseStep = (s: Step): Step =>
  s.kind === 'id'
    ? { ...s, dir: s.dir === 1 ? -1 : 1 }
    : s.kind === 'both'
      ? { ...s, kind: 'cancel' }
      : s.kind === 'cancel'
        ? { ...s, kind: 'both' }
        : s.kind === 'subst'
          ? { ...s, way: s.way === 1 ? -1 : 1 }
          : s;

const sameSystem = (x: System, y: System): boolean =>
  x.eqs.length === y.eqs.length && x.eqs.every((q, i) => same(q.l, y.eqs[i].l) && same(q.r, y.eqs[i].r));

/**
 * Is `after` one step from `before`? Looks only at the two systems. For an
 * identity, nothing outside the rewritten subterm may differ and the subterm
 * before and after must be the two sides of the identity under one binding.
 * The equation moves have one possible result each, so they are done again.
 */
export const verifyStep = (before: System, after: System, step: Step): boolean => {
  if (step.kind !== 'id') {
    const got = applyStep(before, step);
    return got !== null && sameSystem(got, after);
  }
  if (before.eqs.length !== after.eqs.length) return false;
  for (let i = 0; i < before.eqs.length; i++) {
    for (const side of [0, 1] as const) {
      if (i === step.eq && side === step.side) continue;
      if (!same(sideOf(before.eqs[i], side), sideOf(after.eqs[i], side))) return false;
    }
  }
  let b = sideOf(before.eqs[step.eq], step.side);
  let a = sideOf(after.eqs[step.eq], step.side);
  for (const i of step.path) {
    if (b.k !== 'op' || a.k !== 'op' || b.op !== a.op) return false;
    if (!same(i === 0 ? b.b : b.a, i === 0 ? a.b : a.a)) return false;
    b = i === 0 ? b.a : b.b;
    a = i === 0 ? a.a : a.b;
  }
  const { l, r } = IDENTITIES[step.id];
  const bound: Binding = {};
  return match(step.dir === 1 ? l : r, b, bound) && match(step.dir === 1 ? r : l, a, bound);
};

const clip = (text: string, max = 26): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The step in words. */
export const ruleText = (step: Step, before: System): string => {
  if (step.kind === 'both') return `add ${clip(show(step.t))} to both sides`;
  if (step.kind === 'cancel') return `take ${clip(show(step.t))} off both sides`;
  if (step.kind === 'swap') return 'swap the two sides';
  if (step.kind === 'subst') {
    const src = before.eqs[step.from];
    const [was, now] = step.way === 1 ? [src.l, src.r] : [src.r, src.l];
    return `by equation ${step.from + 1}: ${clip(show(was), 18)} → ${clip(show(now), 18)}`;
  }
  const { l, r } = IDENTITIES[step.id];
  return step.dir === 1 ? `${show(l)} → ${show(r)}` : `${show(r)} → ${show(l)}`;
};

/* --------------------------------------------------------------- walks */

export interface Walk {
  frames: System[];
  /** steps[i] turns frames[i] into frames[i + 1]. */
  steps: Step[];
}

const GAVE_UP = { gaveUp: true };
export const STEP_BUDGET = 6000;
export const NODE_BUDGET = 3000;

/** A grip on one side of one equation, for code that only knows about trees. */
interface Hand {
  cur: () => Expr;
  rw: (path: Path, id: IdName, dir: Dir, free?: Binding) => void;
}

interface Tracer extends Walk {
  cur: () => System;
  take: (step: Step, free?: Binding) => void;
  hand: (eq: number, side: 0 | 1) => Hand;
}

const tracer = (start: System, budget = STEP_BUDGET): Tracer => {
  let cur = start;
  const frames: System[] = [start];
  const steps: Step[] = [];
  const take = (step: Step, free?: Binding): void => {
    const next = applyStep(cur, step, free);
    if (!next) throw new Error(`step does not fit: ${JSON.stringify(step).slice(0, 140)}`);
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
    hand: (eq, side) => ({
      cur: () => sideOf(cur.eqs[eq], side),
      rw: (path, id, dir, free) => take({ kind: 'id', eq, side, path: path.slice(), id, dir }, free),
    }),
  };
};

/* ----------------------------------------------------- lists under + or · */

const ASSOC: Record<Op, IdName> = { '+': 'assocA', '·': 'assocM' };
const COMM: Record<Op, IdName> = { '+': 'commA', '·': 'commM' };

/** Re-bracket a chain of one operator to a + (b + (c + …)). */
const rightNest = (t: Hand, path: Path, op: Op): void => {
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
const items = (e: Expr, op: Op): Expr[] => {
  const out: Expr[] = [];
  let n = e;
  while (isOp(n, op)) {
    out.push(n.a);
    n = n.b;
  }
  out.push(n);
  return out;
};

/** Every term of a sum, however it is bracketed. */
const addends = (e: Expr, out: Expr[] = []): Expr[] => {
  if (isOp(e, '+')) {
    addends(e.a, out);
    addends(e.b, out);
  } else out.push(e);
  return out;
};

const spine = (path: Path, i: number): Path => {
  const p = path.slice();
  for (let k = 0; k < i; k++) p.push(1);
  return p;
};

const sortChain = (t: Hand, path: Path, op: Op, key: (e: Expr) => string): void => {
  const keys = items(at(t.cur(), path), op).map(key);
  const len = keys.length;
  for (let end = len - 1; end > 0; end--) {
    let moved = false;
    for (let i = 0; i < end; i++) {
      if (keys[i] <= keys[i + 1]) continue;
      const p = spine(path, i);
      if (i === len - 2) t.rw(p, COMM[op], 1);
      else {
        t.rw(p, ASSOC[op], -1);
        t.rw([...p, 0], COMM[op], 1);
        t.rw(p, ASSOC[op], 1);
      }
      [keys[i], keys[i + 1]] = [keys[i + 1], keys[i]];
      moved = true;
    }
    if (!moved) break;
  }
};

/** In a sorted right-nested chain, two equal neighbours: a + a is 0, a · a is a. Returns true if one was found. */
const pairOff = (t: Hand, path: Path, op: Op): boolean => {
  const xs = items(at(t.cur(), path), op);
  for (let i = 0; i + 1 < xs.length; i++) {
    if (!same(xs[i], xs[i + 1])) continue;
    const p = spine(path, i);
    const id: IdName = op === '+' ? 'self' : 'idem';
    if (i === xs.length - 2) t.rw(p, id, 1);
    else {
      t.rw(p, ASSOC[op], -1);
      t.rw([...p, 0], id, 1);
    }
    return true;
  }
  return false;
};

/** Remove a 0 from a sum or a 1 from a product, or collapse a product with a 0 in it. Returns true if it did. */
const unit = (t: Hand, path: Path, op: Op): boolean => {
  const xs = items(at(t.cur(), path), op);
  if (xs.length < 2) return false;
  const gone = op === '+' ? 0 : 1;
  for (let i = 0; i < xs.length; i++) {
    const last = i === xs.length - 1;
    if (op === '·' && isNum(xs[i], 0)) {
      t.rw(last ? spine(path, i - 1) : spine(path, i), last ? 'mul0R' : 'mul0L', 1);
      return true;
    }
    if (isNum(xs[i], gone)) {
      const idL: IdName = op === '+' ? 'add0L' : 'mul1L';
      const idR: IdName = op === '+' ? 'add0R' : 'mul1R';
      t.rw(last ? spine(path, i - 1) : spine(path, i), last ? idR : idL, 1);
      return true;
    }
  }
  return false;
};

/* ------------------------------------------------------ two ways to tidy */

const acKeys = new WeakMap<Expr, string>();
/** A name for a term that ignores the order and bracketing of its sums and products. */
const acKey = (e: Expr): string => {
  let s = acKeys.get(e);
  if (s !== undefined) return s;
  if (e.k !== 'op') s = show(e);
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

/**
 * Tidy without multiplying anything out: one fixed order and bracketing
 * everywhere, equal neighbours paired off, zeros and ones dropped. Brackets
 * stay as they are, so x inside a · (x + b) stays inside.
 */
const tidy = (t: Hand, path: Path = []): void => {
  const first = at(t.cur(), path);
  if (first.k !== 'op') return;
  const op = first.op;
  for (;;) {
    if (!isOp(at(t.cur(), path), op)) {
      // It collapsed into something else; tidy whatever that is.
      tidy(t, path);
      return;
    }
    rightNest(t, path, op);
    const len = items(at(t.cur(), path), op).length;
    for (let i = 0; i < len; i++) tidy(t, i < len - 1 ? [...spine(path, i), 0] : spine(path, i));
    // Tidying an item can turn it into a chain of this same operator: go round again.
    if (items(at(t.cur(), path), op).some((x) => isOp(x, op))) continue;
    sortChain(t, path, op, acKey);
    if (!pairOff(t, path, op) && !unit(t, path, op)) return;
  }
};

/**
 * Multiply everything out. Afterwards the side is a sum of products of
 * letters in one fixed order, with nothing repeated: the standard form of a
 * function of bits. Two sides that are equal as functions come out letter
 * for letter the same.
 */
const expand = (t: Hand, path: Path = []): void => {
  const n = at(t.cur(), path);
  if (n.k !== 'op') return;
  expand(t, [...path, 0]);
  expand(t, [...path, 1]);
  if (n.op === '+') mergeSum(t, path);
  else mergeProduct(t, path);
};

const mergeProduct = (t: Hand, path: Path): void => {
  const n = at(t.cur(), path);
  if (!isOp(n, '·')) return;
  if (isOp(n.a, '+') || isOp(n.b, '+')) {
    t.rw(path, isOp(n.a, '+') ? 'distR' : 'distL', 1);
    mergeProduct(t, [...path, 0]);
    mergeProduct(t, [...path, 1]);
    mergeSum(t, path);
    return;
  }
  rightNest(t, path, '·');
  sortChain(t, path, '·', show);
  while (isOp(at(t.cur(), path), '·') && (unit(t, path, '·') || pairOff(t, path, '·')));
};

const mergeSum = (t: Hand, path: Path): void => {
  if (!isOp(at(t.cur(), path), '+')) return;
  rightNest(t, path, '+');
  sortChain(t, path, '+', show);
  while (isOp(at(t.cur(), path), '+') && (unit(t, path, '+') || pairOff(t, path, '+')));
};

/* ------------------------------------------------- attacker 1: downhill */

/** What downhill means here: fewer unknowns out of place first, then a shorter system. */
const badness = (s: System): number => stray(s) * 1000 + s.n;

/** Every step out of a system whose result is fixed by the system. */
export const edges = (s: System): Step[] => {
  const out: Step[] = [];
  s.eqs.forEach((q, eq) => {
    out.push({ kind: 'swap', eq });
    if (isOp(q.l, '+') && isOp(q.r, '+') && same(q.l.b, q.r.b)) out.push({ kind: 'cancel', eq, t: q.l.b });
    const moved = new Set<string>();
    for (const t of [q.l, q.r, ...addends(q.l), ...addends(q.r)]) {
      if (moved.has(show(t)) || isNum(t, 0)) continue;
      moved.add(show(t));
      out.push({ kind: 'both', eq, t });
    }
    for (const side of [0, 1] as const) {
      const body = sideOf(q, side);
      for (const g of treeEdges(body)) out.push({ kind: 'id', eq, side, path: g.path, id: g.id, dir: g.dir });
      visit(body, (n, p) => {
        s.eqs.forEach((src, from) => {
          if (from === eq || same(src.l, src.r)) return;
          if (same(n, src.l)) out.push({ kind: 'subst', eq, side, path: p.slice(), from, way: 1 });
          else if (same(n, src.r)) out.push({ kind: 'subst', eq, side, path: p.slice(), from, way: -1 });
        });
      });
    }
  });
  return out;
};

/** How many steps out of a system make it better, leave it level, or make it worse. */
export const edgeCounts = (s: System): { down: number; level: number; up: number } => {
  const here = badness(s);
  let down = 0;
  let level = 0;
  let up = 0;
  for (const step of edges(s)) {
    const next = applyStep(s, step);
    if (!next) continue;
    const b = badness(next);
    if (b < here) down++;
    else if (b === here) level++;
    else up++;
  }
  return { down, level, up };
};

const descend = (t: Tracer): void => {
  for (;;) {
    const here = badness(t.cur());
    let best: Step | null = null;
    let bestB = here;
    for (const step of edges(t.cur())) {
      const next = applyStep(t.cur(), step);
      if (next && badness(next) < bestB) {
        best = step;
        bestB = badness(next);
      }
    }
    if (!best) return;
    t.take(best);
  }
};

/* --------------------------- attackers 2 and 3: isolate, then substitute */

/**
 * What everyone is taught. Bring each equation to "something = 0". Find an
 * equation where some unknown appears exactly once, as a term on its own.
 * Move everything else across, which leaves that unknown alone on the left.
 * Write its right side in place of that unknown everywhere else. Repeat.
 *
 * `clean` is how sides are simplified in between: tidying only, or
 * multiplying everything out. It stops, stuck, when no equation has an
 * unknown standing on its own.
 */
const isolateAndSubstitute = (t: Tracer, clean: (h: Hand) => void): void => {
  const owner = new Map<number, string>();
  const count = t.cur().eqs.length;
  for (;;) {
    for (let k = 0; k < count; k++) {
      if (owner.has(k)) clean(t.hand(k, 1));
      else {
        if (!isNum(t.cur().eqs[k].r, 0)) t.take({ kind: 'both', eq: k, t: t.cur().eqs[k].r });
        clean(t.hand(k, 0));
        clean(t.hand(k, 1));
      }
    }
    if (owner.size === count) return;
    let found: { k: number; x: string } | null = null;
    for (let k = 0; k < count && !found; k++) {
      if (owner.has(k) || !isNum(t.cur().eqs[k].r, 0)) continue;
      const terms = addends(t.cur().eqs[k].l);
      for (const x of UNKNOWNS) {
        if ([...owner.values()].includes(x)) continue;
        const holding = terms.filter((term) => mentions(term, x));
        if (holding.length === 1 && holding[0].k === 'var') {
          found = { k, x };
          break;
        }
      }
    }
    if (!found) return;
    const { k, x } = found;
    // Move every other term across, one at a time.
    for (;;) {
      const other = addends(t.cur().eqs[k].l).find((term) => !(term.k === 'var' && term.name === x));
      if (!other) break;
      t.take({ kind: 'both', eq: k, t: other });
      clean(t.hand(k, 0));
      clean(t.hand(k, 1));
    }
    owner.set(k, x);
    for (let j = 0; j < count; j++) {
      if (j === k) continue;
      for (const side of [0, 1] as const) {
        for (;;) {
          const where = sites(sideOf(t.cur().eqs[j], side), (n) => n.k === 'var' && n.name === x)[0];
          if (!where) break;
          t.take({ kind: 'subst', eq: j, side, path: where, from: k, way: 1 });
        }
      }
    }
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
  'terms moved across',
  'equations added together',
  'multiples of equations added',
  'multiples with unknowns in them',
];

/** The longest system the generator will make. */
export const MAX_NODES = 170;

export interface Spec {
  /** Index into LEVELS: how much the generator is allowed to do. */
  level: number;
  /** How many times the generator does something to the system. */
  lambda: number;
  seed: number;
}

/** Walk from the solved system to a scrambled one. Read backwards, the walk solves it. */
const generate = ({ level, lambda, seed }: Spec): Walk => {
  const rand = prng(seed * 7919 + level * 104729 + 31);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const given = (): Expr => va(pick(GIVENS));

  // The answer: each unknown equal to some small function of the givens.
  const answer = (): Expr => {
    let e: Expr | null = null;
    const terms = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < terms; i++) {
      const m = rand() < 0.5 ? given() : times(given(), given());
      e = e ? plus(e, m) : m;
    }
    return rand() < 0.3 ? plus(e!, ONE) : e!;
  };
  const t = tracer(system(UNKNOWNS.map((x) => ({ l: va(x), r: answer() }))), Infinity);
  const count = UNKNOWNS.length;
  const other = (k: number): number => (k + 1 + Math.floor(rand() * (count - 1))) % count;

  const shuffle = (id: IdName, dir: Dir): boolean =>
    id === 'commA' || id === 'commM' || id === 'assocA' || id === 'assocM' || (level >= 2 && dir === 1 && (id === 'distL' || id === 'distR'));

  for (let n = 0; n < lambda; n++) {
    if (t.cur().n > MAX_NODES - 24) break;
    const k = Math.floor(rand() * count);
    const r = rand();
    if (level >= 2 && r < (level >= 3 ? 0.75 : 0.45)) {
      // Add a multiple of another equation: g · (its left) + g · (its right) is 0, so it can go anywhere.
      const j = other(k);
      const side: 0 | 1 = rand() < 0.5 ? 0 : 1;
      const letter = (): Expr => (level >= 3 && rand() < 0.5 ? va(pick(UNKNOWNS)) : given());
      const g = level >= 3 && rand() < 0.3 ? times(letter(), letter()) : letter();
      const h = t.hand(k, side);
      h.rw([], 'add0R', -1);
      h.rw([1], 'self', -1, { A: times(g, t.cur().eqs[j].l) });
      t.take({ kind: 'subst', eq: k, side, path: [1, 1, 1], from: j, way: 1 });
    } else if (level >= 1 && level < 3 && r < 0.65) {
      // Add another equation to this one.
      const j = other(k);
      t.take({ kind: 'both', eq: k, t: t.cur().eqs[j].l });
      t.take({ kind: 'subst', eq: k, side: 1, path: [1], from: j, way: 1 });
    } else if (r < 0.9) {
      // Move one term to the other side.
      const side: 0 | 1 = rand() < 0.5 ? 0 : 1;
      const term = pick(addends(sideOf(t.cur().eqs[k], side)));
      if (isNum(term, 0)) continue;
      t.take({ kind: 'both', eq: k, t: term });
      tidy(t.hand(k, side));
    } else t.take({ kind: 'swap', eq: k });

    if (level < 1) continue;
    // Shuffle the equation just touched, and from level 2 multiply some of it out.
    for (let s = 0; s < 3; s++) {
      const side: 0 | 1 = rand() < 0.5 ? 0 : 1;
      const all = treeEdges(sideOf(t.cur().eqs[k], side), shuffle).filter((g) => t.cur().n + g.by.n < MAX_NODES);
      const spread = all.filter((g) => g.id === 'distL' || g.id === 'distR');
      const from = s === 0 && spread.length > 0 ? spread : all;
      if (from.length === 0) continue;
      const g = pick(from);
      t.hand(k, side).rw(g.path, g.id, g.dir);
    }
  }
  return { frames: t.frames, steps: t.steps };
};

/* ------------------------------------------------------------ instance */

export type Outcome = 'solved' | 'stuck' | 'gave up';

export interface Attack extends Walk {
  outcome: Outcome;
}

export interface Instance {
  spec: Spec;
  /** The scrambled system handed to the attackers. */
  E: System;
  /** The generator's walk, from the solved system to E. */
  grown: Walk;
  /** The same walk backwards: the generator's way of solving E. */
  planted: Attack;
  greedy: Attack;
  school: Attack;
  expanded: Attack;
}

const attack = (E: System, run: (t: Tracer) => void): Attack => {
  const t = tracer(E);
  let gaveUp = false;
  try {
    run(t);
  } catch (err) {
    if (err !== GAVE_UP) throw err;
    gaveUp = true;
  }
  return { frames: t.frames, steps: t.steps, outcome: gaveUp ? 'gave up' : solved(t.cur()) ? 'solved' : 'stuck' };
};

export const makeInstance = (spec: Spec): Instance => {
  const grown = generate(spec);
  const E = grown.frames[grown.frames.length - 1];
  return {
    spec,
    E,
    grown,
    planted: {
      frames: grown.frames.slice().reverse(),
      steps: grown.steps.slice().reverse().map(reverseStep),
      outcome: 'solved',
    },
    greedy: attack(E, descend),
    school: attack(E, (t) => isolateAndSubstitute(t, (h) => tidy(h))),
    expanded: attack(E, (t) => isolateAndSubstitute(t, (h) => expand(h))),
  };
};

/** The values of the givens, and the values the solved system then gives the unknowns. */
export const solutionAt = (inst: Instance, bits: number): Record<string, number> => {
  const env: Record<string, number> = {};
  GIVENS.forEach((g, i) => (env[g] = (bits >> i) & 1));
  for (const q of inst.grown.frames[0].eqs) env[(q.l as { name: string }).name] = evaluate(q.r, env);
  return env;
};
export const GIVEN_COUNT = GIVENS.length;

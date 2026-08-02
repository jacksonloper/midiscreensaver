import { TAU, range } from '../../screensaver/util';

/**
 * Eight planar linkages, each solved from its own generalized coordinates.
 *
 * The rule the whole gallery obeys: a mechanism's state is `q`, a list of
 * independent numbers, plus `branch`, a discrete assembly mode. Every pin
 * position is computed from those. No dependent rod is animated on its own
 * clock, so the picture cannot drift out of a legal configuration — the bars
 * keep their lengths to the last bit, which the sketch checks and prints.
 */

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (angle: number): Vec => ({ x: Math.cos(angle), y: Math.sin(angle) });
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);

/** Signed angle difference, wrapped into (−π, π]. */
export const wrapPi = (a: number): number => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};

/**
 * Where two circles cross: two points, one when they are tangent, none when
 * they are too far apart or one swallows the other. The order is stable —
 * left of the centre line first — which is what makes branch tracking work.
 */
export function circleIntersections(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < 1e-12) return [];
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const ex = (c2.x - c1.x) / d;
  const ey = (c2.y - c1.y) / d;
  const px = c1.x + a * ex;
  const py = c1.y + a * ey;
  if (h2 <= 0) return [v(px, py)];
  const h = Math.sqrt(h2);
  return [v(px - h * ey, py + h * ex), v(px + h * ey, py - h * ex)];
}

/**
 * Pick one root of a circle intersection. Continuity is the default: take the
 * solution nearest where the pin was last frame, so the mechanism never
 * teleports between assembly modes on its own. `flip` is the one moment the
 * reader asks for the other mode, and it is honoured exactly once — after
 * that, continuity carries the new branch.
 */
export function chooseBranch(sols: Vec[], previous: Vec | null, flip: boolean): Vec | null {
  if (sols.length === 0) return null;
  if (sols.length === 1) return sols[0];
  if (!previous) return sols[flip ? 1 : 0];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < sols.length; i++) {
    const d = dist(sols[i], previous);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return flip ? sols[1 - best] : sols[best];
}

export type PinRole = 'fixed' | 'joint' | 'input' | 'output';

export interface Pin {
  name: string;
  at: Vec;
  role: PinRole;
}

/** `ground` rods join two fixed pins; `long` ones are drawn thinner. */
export type RodStyle = 'bar' | 'ground' | 'long';

export interface Rod {
  a: number;
  b: number;
  /** The length this rod is supposed to have, for the error readout. */
  nominal: number;
  style: RodStyle;
}

export type Domain =
  | { kind: 'annulus'; center: Vec; inner: number; outer: number; label: string }
  | { kind: 'arc'; center: Vec; radius: number; from: number; to: number; label: string }
  | { kind: 'line'; a: Vec; b: Vec; label: string };

export interface Frame {
  pins: Pin[];
  rods: Rod[];
  /** False when the bars cannot close — the sketch keeps the last good frame. */
  ok: boolean;
  /** Pin index the reader is driving, and the one that answers. */
  input: number;
  output: number;
  /** How far the mechanism's defining relation misses, in world units. */
  residual: number;
  /** Worst rod, measured against its nominal length. */
  barError: number;
  domains: Domain[];
}

interface Builder {
  pins: Pin[];
  rods: Rod[];
  at: (name: string) => Vec;
  pin: (name: string, at: Vec, role?: PinRole) => void;
  rod: (a: string, b: string, nominal: number, style?: RodStyle) => void;
  index: (name: string) => number;
}

const builder = (): Builder => {
  const pins: Pin[] = [];
  const rods: Rod[] = [];
  const slot = new Map<string, number>();
  const index = (name: string): number => slot.get(name) ?? 0;
  return {
    pins,
    rods,
    index,
    at: (name) => pins[index(name)].at,
    pin: (name, at, role = 'joint') => {
      slot.set(name, pins.length);
      pins.push({ name, at, role });
    },
    rod: (a, b, nominal, style = 'bar') => {
      rods.push({ a: index(a), b: index(b), nominal, style });
    },
  };
};

const finish = (
  b: Builder,
  opts: { input: string; output: string; residual: number; ok?: boolean; domains?: Domain[] },
): Frame => {
  let barError = 0;
  for (const r of b.rods) {
    barError = Math.max(barError, Math.abs(dist(b.pins[r.a].at, b.pins[r.b].at) - r.nominal));
  }
  return {
    pins: b.pins,
    rods: b.rods,
    ok: opts.ok !== false,
    input: b.index(opts.input),
    output: b.index(opts.output),
    residual: opts.residual,
    barError,
    domains: opts.domains ?? [],
  };
};

/** One generalized coordinate: either a full turn, or a bounded interval. */
export interface CoordSpec {
  label: string;
  kind: 'angle' | 'interval';
  /** Speed multiplier along the demonstration trajectory. */
  rate: number;
  /** Interval coordinates only. */
  lo: number;
  hi: number;
}

const turn = (label: string, rate: number): CoordSpec => ({
  label,
  kind: 'angle',
  rate,
  lo: 0,
  hi: TAU,
});

const span = (label: string, rate: number, lo: number, hi: number): CoordSpec => ({
  label,
  kind: 'interval',
  rate,
  lo,
  hi,
});

export interface Mechanism {
  key: string;
  title: string;
  /** The one-line "what it is for". */
  role: string;
  dof: 1 | 2;
  /** Rod count, spelled out — the frame counts as a link. */
  links: string;
  /** Number of assembly modes worth switching between. */
  branches: number;
  configSpace: string;
  /** The relation the output obeys, and the quantity the residual measures. */
  relation: string;
  residualLabel: string;
  /** What knob 4 stretches. */
  proportionLabel: string;
  /** Extra sentence for the readout, where there is a trap worth naming. */
  note?: string;
  coords: (m: number) => CoordSpec[];
  solve: (s: SolveInput) => Frame;
}

/** Everything a mechanism needs to place its pins: `q`, `branch`, and history. */
export interface SolveInput {
  /** Independent generalized coordinates. */
  q: number[];
  /** The proportions knob, 0..1. */
  m: number;
  /** Discrete assembly-mode identifier. */
  branch: number;
  /** True only on the frame where the reader asked for the other mode. */
  flip: boolean;
  /** Last frame, so circle intersections can be resolved by continuity. */
  previous: Frame | null;
}

/** Reflect `p` in the perpendicular bisector of `a`–`b`. */
const mirrorAcross = (p: Vec, a: Vec, b: Vec): Vec => {
  const axis = sub(b, a);
  const d = len(axis);
  if (d < 1e-12) return p;
  const n = scale(axis, 1 / d);
  const mid = scale(add(a, b), 0.5);
  return sub(p, scale(n, 2 * dot(sub(p, mid), n)));
};

const previousAt = (previous: Frame | null, name: string): Vec | null => {
  if (!previous) return null;
  const p = previous.pins.find((q) => q.name === name);
  return p ? p.at : null;
};

/** 1 — Crank. The whole gallery in miniature: one angle, one pin. */
const crank: Mechanism = {
  key: 'crank',
  title: 'Crank',
  role: 'One arm on one pivot — the smallest thing that moves.',
  dof: 1,
  links: '2 — frame and crank',
  branches: 1,
  configSpace: 'a circle, S¹',
  relation: 'A = O + r·u(θ)',
  residualLabel: '‖A−O‖ − r',
  proportionLabel: 'Crank length r',
  coords: () => [turn('θ', 1)],
  solve: ({ q, m }) => {
    const r = range(m, 0.35, 1);
    const b = builder();
    const O = v(0, 0);
    b.pin('O', O, 'fixed');
    b.pin('A', add(O, scale(unit(q[0]), r)), 'output');
    b.rod('O', 'A', r);
    return finish(b, {
      input: 'A',
      output: 'A',
      residual: Math.abs(dist(b.at('A'), O) - r),
      domains: [{ kind: 'arc', center: O, radius: r, from: 0, to: TAU, label: 'locus of A' }],
    });
  },
};

/** 2 — Two-link open chain. Two angles, and an annulus that is not the answer. */
const openChain: Mechanism = {
  key: 'open-chain',
  title: 'Two-link open chain',
  role: 'An arm with an elbow. Both joints are free.',
  dof: 2,
  links: '3 — frame and two arms',
  branches: 1,
  configSpace: 'a torus, S¹ × S¹',
  relation: 'B = O + a·u(θ₁) + b·u(θ₂)',
  residualLabel: 'rod lengths',
  proportionLabel: 'Forearm b',
  note: 'B sweeps an annulus. That annulus is the workspace, not the configuration space.',
  coords: () => [turn('θ₁', 1), turn('θ₂', 1.7)],
  solve: ({ q, m }) => {
    const a = 0.62;
    const bLen = range(m, 0.24, 0.58);
    const b = builder();
    const O = v(0, 0);
    const A = add(O, scale(unit(q[0]), a));
    const B = add(A, scale(unit(q[1]), bLen));
    b.pin('O', O, 'fixed');
    b.pin('A', A);
    b.pin('B', B, 'output');
    b.rod('O', 'A', a);
    b.rod('A', 'B', bLen);
    return finish(b, {
      input: 'A',
      output: 'B',
      residual: 0,
      domains: [
        {
          kind: 'annulus',
          center: O,
          inner: Math.abs(a - bLen),
          outer: a + bLen,
          label: 'workspace of B',
        },
      ],
    });
  },
};

/** 3 — Parallelogram vector copier. One angle, two branches, one honest trap. */
const copier: Mechanism = {
  key: 'copier',
  title: 'Parallelogram vector copier',
  role: 'Copies a vector from one pivot to another.',
  dof: 1,
  links: '4 — AD is the frame',
  branches: 2,
  configSpace: 'a circle, S¹, once per assembly mode',
  relation: 'B − A = C − D',
  residualLabel: '‖(B−A) − (C−D)‖',
  proportionLabel: 'Arm length p',
  note: 'The copy holds on the ordinary branch only. Cross the assembly and the same four rods do something else.',
  coords: () => [turn('θ', 1)],
  solve: ({ q, m, branch }) => {
    const g = 1;
    const p = range(m, 0.4, 0.85);
    const b = builder();
    const A = v(-g / 2, -0.25);
    const D = v(g / 2, -0.25);
    const B = add(A, scale(unit(q[0]), p));
    // Both assemblies are closed forms rather than tracked roots. The ordinary
    // branch is the parallel copy. The crossed one is the isosceles trapezoid,
    // whose mirror line is the perpendicular bisector of the diagonal BD — it
    // swaps A with C, which is exactly the closure the four rods allow.
    const parallel = add(D, scale(unit(q[0]), p));
    const C = branch === 0 ? parallel : mirrorAcross(A, B, D);
    b.pin('A', A, 'fixed');
    b.pin('D', D, 'fixed');
    b.pin('B', B, 'input');
    b.pin('C', C, 'output');
    b.rod('A', 'D', g, 'ground');
    b.rod('A', 'B', p);
    b.rod('D', 'C', p);
    b.rod('B', 'C', g);
    return finish(b, {
      input: 'B',
      output: 'C',
      residual: len(sub(sub(B, A), sub(C, D))),
    });
  },
};

/** 4 — Pantograph. Two coordinates in, a scaled copy out. */
const pantograph: Mechanism = {
  key: 'pantograph',
  title: 'Pantograph',
  role: 'Scales whatever the input pin draws by λ about A.',
  dof: 2,
  links: '6 bars on one fixed pivot',
  branches: 1,
  configSpace: 'a torus, S¹ × S¹',
  relation: 'G − A = λ·(D − A)',
  residualLabel: '‖(G−A) − λ(D−A)‖',
  proportionLabel: 'Ratio λ',
  note: 'D can go anywhere in its annulus, so the input itself has two degrees of freedom.',
  coords: () => [turn('α', 1), turn('β', 0.65)],
  solve: ({ q, m }) => {
    const s = 0.8;
    const t = 0.7;
    const lambda = range(m, 1.45, 3);
    const [alpha, beta] = q;
    const b = builder();
    const A = v(0, 0);
    const B = add(A, scale(unit(alpha), s));
    const C = add(A, scale(unit(alpha), s / lambda));
    const E = add(B, scale(unit(beta), t / lambda));
    const D = add(C, scale(unit(beta), t / lambda));
    const G = add(B, scale(unit(beta), t));
    b.pin('A', A, 'fixed');
    b.pin('C', C);
    b.pin('B', B);
    b.pin('E', E);
    b.pin('D', D, 'input');
    b.pin('G', G, 'output');
    b.rod('A', 'C', s / lambda);
    b.rod('C', 'B', s - s / lambda);
    b.rod('B', 'E', t / lambda);
    b.rod('E', 'G', t - t / lambda);
    b.rod('C', 'D', t / lambda);
    b.rod('D', 'E', s - s / lambda);
    return finish(b, {
      input: 'D',
      output: 'G',
      residual: len(sub(sub(G, A), scale(sub(D, A), lambda))),
      domains: [
        {
          kind: 'annulus',
          center: A,
          inner: Math.abs(s - t) / lambda,
          outer: (s + t) / lambda,
          label: 'domain of D',
        },
      ],
    });
  },
};

/** 5 — Translator. Two rigid parallelograms carrying a fixed vector around. */
const translator: Mechanism = {
  key: 'translator',
  title: 'Translator',
  role: 'Repeats the input pin a fixed distance away, never turning it.',
  dof: 2,
  links: '7 — AB and two parallelograms',
  branches: 1,
  configSpace: 'a torus, S¹ × S¹',
  relation: 'F = E + (B − A)',
  residualLabel: '‖F − E − (B−A)‖',
  proportionLabel: 'Second arm t',
  note: 'The offset never rotates: whatever E does, F does exactly the same, one step over.',
  coords: () => [turn('α', 1), turn('β', -0.8)],
  solve: ({ q, m }) => {
    const s = 0.62;
    const t = range(m, 0.3, 0.62);
    const gap = 0.62;
    const [alpha, beta] = q;
    const b = builder();
    const A = v(-gap / 2, 0);
    const B = v(gap / 2, 0);
    const C = add(A, scale(unit(alpha), s));
    const D = add(B, scale(unit(alpha), s));
    const E = add(C, scale(unit(beta), t));
    const F = add(D, scale(unit(beta), t));
    b.pin('A', A, 'fixed');
    b.pin('B', B, 'fixed');
    b.pin('C', C);
    b.pin('D', D);
    b.pin('E', E, 'input');
    b.pin('F', F, 'output');
    b.rod('A', 'B', gap, 'ground');
    b.rod('A', 'C', s);
    b.rod('B', 'D', s);
    b.rod('C', 'D', gap);
    b.rod('C', 'E', t);
    b.rod('D', 'F', t);
    b.rod('E', 'F', gap);
    return finish(b, {
      input: 'E',
      output: 'F',
      residual: len(sub(sub(F, E), sub(B, A))),
      domains: [
        {
          kind: 'annulus',
          center: A,
          inner: Math.abs(s - t),
          outer: s + t,
          label: 'domain of E',
        },
        {
          kind: 'annulus',
          center: B,
          inner: Math.abs(s - t),
          outer: s + t,
          label: 'domain of F',
        },
      ],
    });
  },
};

/**
 * 6 — Kempe angle doubler.
 *
 * Cell one is an honest four-bar: ground OA, input OB, and C found by crossing
 * two circles, which is where the two assembly modes live. On the crossed
 * (contraparallelogram) mode the bars from O sit at angles s and t about the
 * diagonal, with sin t / sin s fixed by the link ratio — so the angle the cell
 * subtends is a function of α alone.
 *
 * Cell two is the same cell scaled by qLen/p and turned by α, sharing the bar
 * OB. Kempe braces the copy so that it cannot fall out of step; here it is
 * computed, which comes to the same picture. Stacking the two equal angles is
 * what doubles α.
 */
const kempe: Mechanism = {
  key: 'kempe',
  title: 'Kempe angle doubler',
  role: 'Turns an angle into twice that angle.',
  dof: 1,
  links: '7 — two crossed cells',
  branches: 2,
  configSpace: 'an interval, one component per assembly mode',
  relation: 'arg(E − O) = 2α',
  residualLabel: '∠BOE − ∠AOB',
  proportionLabel: 'Link ratio qLen / p',
  note: 'α stops short of 0 and π. Those are the flattened poses where the two assembly modes meet.',
  coords: () => [span('α', 0.55, 0.34, 2.6)],
  solve: ({ q, m, branch, flip, previous }) => {
    const p = 0.78;
    const qLen = range(m, 0.44, 0.72);
    const alpha = q[0];
    const b = builder();
    const O = v(0, 0);
    const A = add(O, scale(unit(0), p));
    const B = add(O, scale(unit(alpha), qLen));
    const roots = circleIntersections(B, p, A, qLen);
    const parallel = add(A, sub(B, O));
    // Cold start: branch 0 is the crossed cell, the one Kempe's doubler is
    // built from, so name it by its distance from the parallel closure rather
    // than by whichever root the solver happened to list first.
    const pair = roots.length === 2;
    const crossed = pair
      ? dist(roots[0], parallel) > dist(roots[1], parallel)
        ? roots[0]
        : roots[1]
      : (roots[0] ?? null);
    const cold =
      branch === 0 || !pair ? crossed : crossed === roots[0] ? roots[1] : roots[0];
    const C = previous || flip ? chooseBranch(roots, previousAt(previous, 'C'), flip) : cold;
    const ok = C !== null;
    const Cc = C ?? parallel;
    // Cell two: cell one scaled by qLen/p and rotated by α about O.
    const k = qLen / p;
    const cs = Math.cos(alpha) * k;
    const sn = Math.sin(alpha) * k;
    const similar = (z: Vec): Vec => {
      const d = sub(z, O);
      return add(O, v(d.x * cs - d.y * sn, d.x * sn + d.y * cs));
    };
    const E = similar(B);
    const C2 = similar(Cc);
    b.pin('O', O, 'fixed');
    b.pin('A', A, 'fixed');
    b.pin('B', B, 'input');
    b.pin('C', Cc);
    b.pin('C₂', C2);
    b.pin('E', E, 'output');
    b.rod('O', 'A', p, 'ground');
    b.rod('O', 'B', qLen);
    b.rod('B', 'C', p);
    b.rod('C', 'A', qLen);
    b.rod('O', 'E', (qLen * qLen) / p, 'long');
    b.rod('E', 'C₂', qLen, 'long');
    b.rod('C₂', 'B', (qLen * qLen) / p, 'long');
    // Measured from the pins rather than assumed: the two stacked angles.
    const first = wrapPi(angleOf(sub(B, O)) - angleOf(sub(A, O)));
    const second = wrapPi(angleOf(sub(E, O)) - angleOf(sub(B, O)));
    return finish(b, {
      input: 'B',
      output: 'E',
      residual: Math.abs(wrapPi(second - first)),
      ok,
    });
  },
};

/** Rhombus side, inversion power and long-bar length, shared by 7 and 8. */
const cellGeometry = (m: number) => {
  const r = range(m, 0.32, 0.6);
  const power = 0.62 * 0.62;
  return { r, power, long: Math.hypot(0.62, r) };
};

/**
 * How far the crank may swing before the rhombus flattens at one end of its
 * travel or the other. Stopping short of both keeps the cell off its folds.
 */
const psiRange = (r: number, long: number, c: number): [number, number] => [
  Math.PI / 2 + 2 * Math.asin(Math.min(1, (long - r + 0.06) / (2 * c))),
  Math.PI / 2 + 2 * Math.asin(Math.min(1, (long + r - 0.06) / (2 * c))),
];

/** The four bars of the Peaucellier cell, given its two collinear pins. */
const peaucellierCell = (
  b: Builder,
  B: Vec,
  D: Vec,
  r: number,
  long: number,
  branch: number,
  previous: Frame | null,
  flip: boolean,
): boolean => {
  const roots = circleIntersections(B, r, D, r);
  const A =
    previous || flip
      ? chooseBranch(roots, previousAt(previous, 'A'), flip)
      : (roots[branch % Math.max(roots.length, 1)] ?? null);
  const ok = roots.length === 2 && A !== null;
  const Aa = A ?? add(B, scale(unit(Math.PI / 2), r));
  const C = roots.length === 2 ? (dist(roots[0], Aa) < dist(roots[1], Aa) ? roots[1] : roots[0]) : Aa;
  b.pin('A', Aa);
  b.pin('C', C);
  b.rod('F', 'A', long, 'long');
  b.rod('F', 'C', long, 'long');
  b.rod('A', 'B', r);
  b.rod('B', 'C', r);
  b.rod('C', 'D', r);
  b.rod('D', 'A', r);
  return ok;
};

/**
 * 7 — Modified Peaucellier inversor.
 *
 * The input pin is not on an arm: it is free inside an annulus, which is
 * exactly two degrees of freedom, and polar coordinates about F are the
 * natural way to say where it is. The long bars FA and FC come out at
 * √(t² + r²) whatever ρ and θ do — that is the identity the cell is built on,
 * and the bar-error readout is watching it.
 */
const inversor: Mechanism = {
  key: 'inversor',
  title: 'Peaucellier inversor',
  role: 'Reflects the input pin in a circle about F.',
  dof: 2,
  links: '6 bars on one fixed pivot',
  branches: 2,
  configSpace: 'an annulus — two coordinates, ρ and θ',
  relation: 'D − F = (t² / ‖B−F‖²)·(B − F)',
  residualLabel: '‖D−F‖·‖B−F‖ − t²',
  proportionLabel: 'Rhombus side r',
  note: 'Push B out and D comes in. The product of the two distances never changes.',
  coords: (m) => {
    const { r, long } = cellGeometry(m);
    return [span('ρ', 2, long - r + 0.05, long + r - 0.05), turn('θ', 1)];
  },
  solve: ({ q, m, branch, flip, previous }) => {
    const { r, power, long } = cellGeometry(m);
    const [rho, theta] = q;
    const b = builder();
    const F = v(0, 0);
    const B = add(F, scale(unit(theta), rho));
    const dv = sub(B, F);
    const D = add(F, scale(dv, power / dot(dv, dv)));
    b.pin('F', F, 'fixed');
    b.pin('B', B, 'input');
    b.pin('D', D, 'output');
    const ok = peaucellierCell(b, B, D, r, long, branch, previous, flip);
    return finish(b, {
      input: 'B',
      output: 'D',
      residual: Math.abs(dist(D, F) * dist(B, F) - power),
      ok,
      domains: [
        {
          kind: 'annulus',
          center: F,
          inner: long - r,
          outer: long + r,
          label: 'domain of B',
        },
      ],
    });
  },
};

/**
 * 8 — Peaucellier straight-line mechanism.
 *
 * One rod more than the inversor: the crank GD, with ‖GD‖ = ‖GF‖, which pins D
 * to a circle through F. Inverting a circle through the centre gives a line,
 * so B runs dead straight. ψ stops short of the pose that would put D on F.
 */
const straightLine: Mechanism = {
  key: 'straight-line',
  title: 'Peaucellier straight-line',
  role: 'Draws an exact straight line with nothing but pinned rods.',
  dof: 1,
  links: '8 — inversor cell plus crank GD',
  branches: 2,
  configSpace: 'an interval — the singular pose cuts the circle',
  relation: 'B lies on a line ⟂ FG, at t²/2c from F',
  residualLabel: 'distance of B from that line',
  proportionLabel: 'Rhombus side r',
  note: 'Adding one rod took a degree of freedom away: the two-dimensional inversor becomes a one-dimensional trace.',
  coords: (m) => {
    const { r, long } = cellGeometry(m);
    const [lo, hi] = psiRange(r, long, 0.8);
    return [span('ψ', 1, lo, hi)];
  },
  solve: ({ q, m, branch, flip, previous }) => {
    const { r, power, long } = cellGeometry(m);
    const c = 0.8;
    const [psiLo, psiHi] = psiRange(r, long, c);
    const b = builder();
    const F = v(0, 0);
    const G = v(0, -c);
    const D = add(G, scale(unit(q[0]), c));
    const dv = sub(D, F);
    const B = add(F, scale(dv, power / dot(dv, dv)));
    b.pin('F', F, 'fixed');
    b.pin('G', G, 'fixed');
    b.pin('D', D, 'input');
    b.pin('B', B, 'output');
    const ok = dot(dv, dv) > 1e-6 && peaucellierCell(b, B, D, r, long, branch, previous, flip);
    b.rod('G', 'D', c);
    b.rod('F', 'G', c, 'ground');
    // The line the inversion sends D's circle to: perpendicular to FG, on G's side.
    const lineY = -power / (2 * c);
    const reach = (rho: number): number => {
      const omega = 2 * Math.asin(Math.min(1, rho / (2 * c)));
      return lineY / Math.tan(omega / 2);
    };
    return finish(b, {
      input: 'D',
      output: 'B',
      residual: Math.abs(B.y - lineY),
      ok,
      domains: [
        {
          kind: 'arc',
          center: G,
          radius: c,
          from: psiLo,
          to: psiHi,
          label: 'locus of D',
        },
        {
          kind: 'line',
          a: v(reach(long - r + 0.06), lineY),
          b: v(reach(long + r - 0.06), lineY),
          label: 'locus of B',
        },
      ],
    });
  },
};

/** Pad order: pads 1-8 walk up the gallery, simplest first. */
export const MECHANISMS: Mechanism[] = [
  crank,
  openChain,
  copier,
  pantograph,
  translator,
  kempe,
  inversor,
  straightLine,
];

/**
 * One generalized coordinate, from its knob and the autoplay phase.
 *
 * Angles wrap. Bounded coordinates ride a raised cosine instead, so autoplay
 * runs them back and forth across the interval without ever stepping outside
 * it, and the knob alone still sweeps the whole range.
 */
export const coordValue = (spec: CoordSpec, knob: number, phase: number): number => {
  if (spec.kind === 'angle') return TAU * knob + spec.rate * phase;
  const x = 0.5 * knob + (spec.rate * phase) / TAU;
  return spec.lo + (spec.hi - spec.lo) * (1 - Math.cos(TAU * x)) * 0.5;
};

/** Where the coordinate sits in its own range, 0..1 — for the readouts. */
export const coordFraction = (spec: CoordSpec, value: number): number => {
  if (spec.kind === 'angle') return (((value / TAU) % 1) + 1) % 1;
  return (value - spec.lo) / (spec.hi - spec.lo);
};

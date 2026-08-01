/**
 * Planar rod-and-pin mechanisms with exactly one degree of freedom, and the
 * continuation that follows their motion.
 *
 * A rod is an infinite rigid line: three numbers, a point and an angle, with a
 * material coordinate running along it. A pin says "this material point on
 * this rod is that material point on that rod", or "this material point sits
 * on that fixed spot of the background". Each pin is two scalar equations, so
 * the whole system is F(q) = 0 for a configuration vector q of length 3n.
 *
 * Everything here turns on the rank of J = DF. The local number of degrees of
 * freedom is 3n − rank J, so a mechanism with one way to move is one whose
 * Jacobian has rank 3n − 1 and a one-dimensional nullspace. Mechanisms are
 * built by proposing pins that the sampled arrangement already satisfies and
 * keeping only the ones that raise the rank by two; they are animated by
 * stepping along the nullspace and projecting back onto F = 0.
 */

import { addRow, luFactor, luSolve, rankOf, rowSpace, svd } from './linalg';

/**
 * One pin. `j < 0` means the material point is pinned to the background at
 * (gx, gy); otherwise it is pinned to material coordinate `v` on rod `j`.
 */
export interface Pin {
  i: number;
  u: number;
  j: number;
  v: number;
  gx: number;
  gy: number;
}

export interface Mechanism {
  /** Rod count — always odd, so that (3n − 1)/2 pins is a whole number. */
  n: number;
  pins: Pin[];
  /** The arrangement the pins were read off, and a point on the motion. */
  q0: Float64Array;
  /** rank J at q0. The build only returns a mechanism when this is 3n − 1. */
  rank: number;
  /** Smallest and largest singular value at q0. */
  sigmaMin: number;
  sigmaMax: number;
  /** World radius the lines were sampled in — the natural length scale. */
  scale: number;
  /** Pin proposals made, accepted or not, before the rank filled up. */
  proposals: number;
}

/** Both material coordinates a pin needs, per rod, for drawing. */
export interface PinPoint {
  x: number;
  y: number;
  ground: boolean;
}

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ model */

/** World position of material coordinate u on rod `rod`. */
export function pointOn(q: Float64Array, rod: number, u: number, out: PinPoint): PinPoint {
  const b = rod * 3;
  const th = q[b + 2];
  out.x = q[b] + u * Math.cos(th);
  out.y = q[b + 1] + u * Math.sin(th);
  return out;
}

/** The constraint residuals, two per pin. */
export function evalF(mech: Mechanism, q: Float64Array, out: Float64Array): void {
  const { pins } = mech;
  for (let k = 0; k < pins.length; k++) {
    const pin = pins[k];
    const a = pin.i * 3;
    const ta = q[a + 2];
    const px = q[a] + pin.u * Math.cos(ta);
    const py = q[a + 1] + pin.u * Math.sin(ta);
    if (pin.j < 0) {
      out[2 * k] = px - pin.gx;
      out[2 * k + 1] = py - pin.gy;
    } else {
      const b = pin.j * 3;
      const tb = q[b + 2];
      out[2 * k] = px - (q[b] + pin.v * Math.cos(tb));
      out[2 * k + 1] = py - (q[b + 1] + pin.v * Math.sin(tb));
    }
  }
}

/**
 * The constraint Jacobian, row-major, (2·pins) × 3n. `out` must be zeroed by
 * the caller when it is reused — only the handful of nonzero entries per row
 * are written.
 */
export function evalJ(mech: Mechanism, q: Float64Array, out: Float64Array): void {
  const cols = mech.n * 3;
  const { pins } = mech;
  for (let k = 0; k < pins.length; k++) {
    const pin = pins[k];
    const r0 = 2 * k * cols;
    const r1 = r0 + cols;
    const a = pin.i * 3;
    const ta = q[a + 2];
    out[r0 + a] = 1;
    out[r0 + a + 2] = -pin.u * Math.sin(ta);
    out[r1 + a + 1] = 1;
    out[r1 + a + 2] = pin.u * Math.cos(ta);
    if (pin.j >= 0) {
      const b = pin.j * 3;
      const tb = q[b + 2];
      out[r0 + b] = -1;
      out[r0 + b + 2] = pin.v * Math.sin(tb);
      out[r1 + b + 1] = -1;
      out[r1 + b + 2] = -pin.v * Math.cos(tb);
    }
  }
}

/** The two rows a single pin contributes, for the rank filter. */
function pinRows(q: Float64Array, pin: Pin, rowA: Float64Array, rowB: Float64Array): void {
  rowA.fill(0);
  rowB.fill(0);
  const a = pin.i * 3;
  const ta = q[a + 2];
  rowA[a] = 1;
  rowA[a + 2] = -pin.u * Math.sin(ta);
  rowB[a + 1] = 1;
  rowB[a + 2] = pin.u * Math.cos(ta);
  if (pin.j >= 0) {
    const b = pin.j * 3;
    const tb = q[b + 2];
    rowA[b] = -1;
    rowA[b + 2] = pin.v * Math.sin(tb);
    rowB[b + 1] = -1;
    rowB[b + 2] = -pin.v * Math.cos(tb);
  }
}

/**
 * How fast the picture changes, per unit of travel along the motion: the speed
 * of the fastest pinned point.
 *
 * Pins are the right thing to measure. A rod's own coordinates are not — its
 * base point is wherever the sampler happened to put it, and a rod turning a
 * degree about a distant pin swings that base point a long way while the part
 * of it anyone can see barely stirs. Every rod carries at least two pins, so
 * this can only read zero if nothing moves at all.
 */
export function motionSpeed(mech: Mechanism, q: Float64Array, t: Float64Array): number {
  let fastest = 0;
  const speedAt = (rod: number, u: number): number => {
    const b = rod * 3;
    const th = q[b + 2];
    const vx = t[b] - u * Math.sin(th) * t[b + 2];
    const vy = t[b + 1] + u * Math.cos(th) * t[b + 2];
    return Math.hypot(vx, vy);
  };
  for (const pin of mech.pins) {
    fastest = Math.max(fastest, speedAt(pin.i, pin.u));
    if (pin.j >= 0) fastest = Math.max(fastest, speedAt(pin.j, pin.v));
  }
  return fastest;
}

/** Distance between two configurations, with angles compared the short way. */
export function configDistance(mech: Mechanism, a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < mech.n; i++) {
    const k = i * 3;
    const dx = a[k] - b[k];
    const dy = a[k + 1] - b[k + 1];
    let dth = (a[k + 2] - b[k + 2]) % TWO_PI;
    if (dth > Math.PI) dth -= TWO_PI;
    if (dth < -Math.PI) dth += TWO_PI;
    // An angle is worth its arc at the mechanism's own radius, so the two
    // kinds of coordinate are compared in the same units.
    const arc = dth * mech.scale;
    sum += dx * dx + dy * dy + arc * arc;
  }
  return Math.sqrt(sum);
}

/* --------------------------------------------------------------- sampling */

/** Lines closer to parallel than this are refused: their intersection runs away. */
const MIN_CROSS = 0.18;
/** Intersections further out than this many radii make an unusable picture. */
const MAX_REACH = 2.4;
/** Three lines whose three crossings sit inside this radius count as concurrent. */
const CONCURRENT = 0.09;
const ARRANGEMENT_TRIES = 80;
const MAX_PROPOSALS = 400;

interface Line {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

const lineOf = (q: Float64Array, i: number): Line => {
  const b = i * 3;
  return { px: q[b], py: q[b + 1], dx: Math.cos(q[b + 2]), dy: Math.sin(q[b + 2]) };
};

/** Material coordinates of the crossing of two lines, or null if near-parallel. */
function crossing(a: Line, b: Line): { u: number; v: number; x: number; y: number } | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < MIN_CROSS) return null;
  const rx = b.px - a.px;
  const ry = b.py - a.py;
  const u = (rx * b.dy - ry * b.dx) / det;
  const v = (rx * a.dy - ry * a.dx) / det;
  return { u, v, x: a.px + u * a.dx, y: a.py + u * a.dy };
}

/**
 * Sample n lines in general position: no near-parallel pair, no three nearly
 * concurrent, and every crossing inside the frame. Writes into `q` and reports
 * whether it managed it.
 */
function sampleArrangement(rand: () => number, n: number, scale: number, q: Float64Array): boolean {
  for (let attempt = 0; attempt < ARRANGEMENT_TRIES; attempt++) {
    for (let i = 0; i < n; i++) {
      const r = scale * Math.sqrt(rand());
      const a = rand() * TWO_PI;
      q[i * 3] = r * Math.cos(a);
      q[i * 3 + 1] = r * Math.sin(a);
      // Directions spread over a half turn, nudged off the regular pattern so
      // no two rods start out parallel by construction.
      q[i * 3 + 2] = ((i + rand() * 0.8) * Math.PI) / n;
    }

    const lines = Array.from({ length: n }, (_, i) => lineOf(q, i));
    const meets: (ReturnType<typeof crossing>)[][] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      meets.push([]);
      for (let j = 0; j < n; j++) {
        if (j <= i) {
          meets[i].push(null);
          continue;
        }
        const m = crossing(lines[i], lines[j]);
        if (!m || Math.hypot(m.x, m.y) > MAX_REACH * scale) {
          ok = false;
          break;
        }
        meets[i].push(m);
      }
    }
    if (!ok) continue;

    const at = (i: number, j: number) => (i < j ? meets[i][j] : meets[j][i]);
    for (let i = 0; i < n - 2 && ok; i++) {
      for (let j = i + 1; j < n - 1 && ok; j++) {
        for (let k = j + 1; k < n; k++) {
          const a = at(i, j);
          const b = at(i, k);
          const c = at(j, k);
          if (!a || !b || !c) continue;
          const spread = Math.max(
            Math.hypot(a.x - b.x, a.y - b.y),
            Math.hypot(a.x - c.x, a.y - c.y),
            Math.hypot(b.x - c.x, b.y - c.y),
          );
          if (spread < CONCURRENT * scale) {
            ok = false;
            break;
          }
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

const samePin = (a: Pin, b: Pin): boolean => {
  if (a.j < 0 && b.j < 0) return a.i === b.i;
  if (a.j < 0 || b.j < 0) return false;
  return (a.i === b.i && a.j === b.j) || (a.i === b.j && a.j === b.i);
};

/**
 * Pin an arrangement until it has exactly one degree of freedom.
 *
 * Every proposal is read off `q` itself, so it is satisfied there by
 * construction and the arrangement stays on the solution set. A proposal is
 * kept only when both of its rows are independent of everything accepted so
 * far — rank up by two, degrees of freedom down by two — and the loop stops
 * the moment the rank reaches 3n − 1.
 */
export function pinArrangement(
  rand: () => number,
  n: number,
  q: Float64Array,
  scale: number,
  groundBias: number,
): Mechanism | null {
  const cols = n * 3;
  const target = cols - 1;
  const space = rowSpace(cols);
  const rowA = new Float64Array(cols);
  const rowB = new Float64Array(cols);
  const pins: Pin[] = [];
  const lines = Array.from({ length: n }, (_, i) => lineOf(q, i));
  const held = new Int32Array(n);
  let proposals = 0;

  /**
   * Pick a rod, favouring the ones holding the fewest pins so far. A rod that
   * ends up with a single pin turns about it while the rest of the machine
   * stands still — that is the whole motion, and it is not worth watching, so
   * the proposals lean away from leaving one behind.
   */
  const pickRod = (avoid: number): number => {
    let total = 0;
    for (let i = 0; i < n; i++) if (i !== avoid) total += 1 / (1 + held[i] * held[i]);
    let ticket = rand() * total;
    for (let i = 0; i < n; i++) {
      if (i === avoid) continue;
      ticket -= 1 / (1 + held[i] * held[i]);
      if (ticket <= 0) return i;
    }
    return avoid === n - 1 ? Math.max(0, n - 2) : n - 1;
  };

  // Every rod needs two pins and there are only (3n − 1)/2 pins to go round, so
  // at most n − 1 of them can be spent on a single rod each. Past that the
  // proposals stop offering the background however far the bias is turned up.
  const groundBudget = n - 1;
  let grounded = 0;

  while (space.rows.length < target && proposals < MAX_PROPOSALS) {
    proposals++;
    let pin: Pin;

    if (n < 2 || (grounded < groundBudget && rand() < groundBias)) {
      const i = pickRod(-1);
      const u = (rand() * 2 - 1) * scale;
      const line = lines[i];
      pin = {
        i,
        u,
        j: -1,
        v: 0,
        gx: line.px + u * line.dx,
        gy: line.py + u * line.dy,
      };
    } else {
      const i = pickRod(-1);
      const j = pickRod(i);
      const m = crossing(lines[i], lines[j]);
      if (!m) continue;
      pin = { i, u: m.u, j, v: m.v, gx: 0, gy: 0 };
    }

    if (pins.some((other) => samePin(other, pin))) continue;

    pinRows(q, pin, rowA, rowB);
    const before = space.rows.length;
    if (!addRow(space, rowA)) continue;
    if (!addRow(space, rowB)) {
      space.rows.length = before;
      continue;
    }
    pins.push(pin);
    held[pin.i]++;
    if (pin.j >= 0) held[pin.j]++;
    else grounded++;
  }

  if (space.rows.length !== target) return null;
  // One pin is one degree of freedom handed to a single rod, and with only one
  // to go round that is the entire motion. Throw the arrangement back.
  for (let i = 0; i < n; i++) if (held[i] < 2) return null;

  const mech: Mechanism = {
    n,
    pins,
    q0: Float64Array.from(q),
    rank: 0,
    sigmaMin: 0,
    sigmaMax: 0,
    scale,
    proposals,
  };

  // The incremental test above is a rank test one row at a time; confirm the
  // whole thing the way the recipe asks for, with singular values.
  const j = new Float64Array(2 * pins.length * cols);
  evalJ(mech, q, j);
  const s = svd(j, 2 * pins.length, cols);
  mech.rank = rankOf(s);
  mech.sigmaMin = s.sigma[mech.rank - 1];
  mech.sigmaMax = s.sigma[0];
  return mech.rank === target ? mech : null;
}

/**
 * Slide every rod's base point to the middle of the stretch its pins occupy,
 * without moving a single line.
 *
 * Where a rod's coordinates sit along it is pure bookkeeping — the line is the
 * same — but the bookkeeping drifts as the mechanism moves, and the base point
 * can wander far from anything visible. Re-pinning a moving arrangement wants
 * it tidied up first, since new pins are proposed relative to it.
 */
export function rebase(mech: Mechanism, q: Float64Array): Float64Array {
  const out = Float64Array.from(q);
  const lo = new Float64Array(mech.n).fill(Infinity);
  const hi = new Float64Array(mech.n).fill(-Infinity);
  const note = (rod: number, u: number): void => {
    if (u < lo[rod]) lo[rod] = u;
    if (u > hi[rod]) hi[rod] = u;
  };
  for (const pin of mech.pins) {
    note(pin.i, pin.u);
    if (pin.j >= 0) note(pin.j, pin.v);
  }
  for (let i = 0; i < mech.n; i++) {
    if (!Number.isFinite(lo[i])) continue;
    const b = i * 3;
    const mid = (lo[i] + hi[i]) / 2;
    out[b] = q[b] + mid * Math.cos(q[b + 2]);
    out[b + 1] = q[b + 1] + mid * Math.sin(q[b + 2]);
  }
  return out;
}

/** A fresh arrangement, pinned down to one degree of freedom. */
export function sampleMechanism(
  rand: () => number,
  n: number,
  scale: number,
  groundBias: number,
): Mechanism | null {
  const q = new Float64Array(n * 3);
  if (!sampleArrangement(rand, n, scale, q)) return null;
  return pinArrangement(rand, n, q, scale, groundBias);
}

/* ---------------------------------------------------------------- tracing */

export type StepResult = 'ok' | 'stuck' | 'singular';

export interface Trace {
  mech: Mechanism;
  /** Current configuration, and the unit tangent to the motion there. */
  q: Float64Array;
  t: Float64Array;
  /** Steps taken and arc length covered, in configuration space. */
  steps: number;
  arc: number;
  /** From the last full singular value check. */
  dof: number;
  sigmaMin: number;
  sigmaMax: number;
  work: Work;
}

interface Work {
  rows: number;
  cols: number;
  j: Float64Array;
  square: Float64Array;
  piv: Int32Array;
  rhs: Float64Array;
  sol: Float64Array;
  f: Float64Array;
  qGuess: Float64Array;
  qTry: Float64Array;
  tNext: Float64Array;
}

/** Residual small enough to call the configuration on the constraint set. */
const PROJECT_TOL = 1e-11;
const PROJECT_ITERS = 10;
/** Below this pivot ratio the bordered system is telling us the tangent is gone. */
const TANGENT_FLOOR = 1e-11;

function makeWork(mech: Mechanism): Work {
  const cols = mech.n * 3;
  const rows = 2 * mech.pins.length;
  return {
    rows,
    cols,
    j: new Float64Array(rows * cols),
    square: new Float64Array(cols * cols),
    piv: new Int32Array(cols),
    rhs: new Float64Array(cols),
    sol: new Float64Array(cols),
    f: new Float64Array(rows),
    qGuess: new Float64Array(cols),
    qTry: new Float64Array(cols),
    tNext: new Float64Array(cols),
  };
}

/**
 * The tangent to the motion at q: the nullspace of J, picked out by solving the
 * bordered system [J; tᵀ] t' = [0; 1]. At a regular configuration that system
 * is square and nonsingular — the extra row is what makes it square, and it
 * also fixes the sign, since it asks for a tangent pointing the same way as the
 * one before. `hint` is the previous tangent, or any nonzero vector to start.
 */
function tangentAt(
  mech: Mechanism,
  q: Float64Array,
  hint: Float64Array,
  out: Float64Array,
  work: Work,
): number {
  const { cols, rows, square, piv, rhs, sol, j } = work;
  j.fill(0);
  evalJ(mech, q, j);
  square.fill(0);
  square.set(j.subarray(0, rows * cols));
  const last = rows * cols;
  for (let i = 0; i < cols; i++) square[last + i] = hint[i];
  rhs.fill(0);
  rhs[cols - 1] = 1;

  const health = luFactor(square, cols, piv);
  if (health < TANGENT_FLOOR) return 0;
  luSolve(square, cols, piv, rhs, sol);

  let norm = 0;
  for (let i = 0; i < cols; i++) norm += sol[i] * sol[i];
  norm = Math.sqrt(norm);
  if (!(norm > 0) || !Number.isFinite(norm)) return 0;
  for (let i = 0; i < cols; i++) out[i] = sol[i] / norm;

  let dot = 0;
  for (let i = 0; i < cols; i++) dot += out[i] * hint[i];
  if (dot < 0) for (let i = 0; i < cols; i++) out[i] = -out[i];
  return health;
}

export function startTrace(mech: Mechanism): Trace | null {
  const work = makeWork(mech);
  const q = Float64Array.from(mech.q0);
  const t = new Float64Array(work.cols);
  const hint = new Float64Array(work.cols);
  for (let i = 0; i < work.cols; i++) hint[i] = Math.sin(i * 1.7 + 0.3);
  if (tangentAt(mech, q, hint, t, work) === 0) return null;

  const trace: Trace = {
    mech,
    q,
    t,
    steps: 0,
    arc: 0,
    dof: work.cols - mech.rank,
    sigmaMin: mech.sigmaMin,
    sigmaMax: mech.sigmaMax,
    work,
  };
  return trace;
}

/** Reverse the direction of travel. */
export function reverseTrace(trace: Trace): void {
  for (let i = 0; i < trace.t.length; i++) trace.t[i] = -trace.t[i];
}

/**
 * Project a configuration back onto F = 0, by Gauss-Newton with the minimum
 * norm correction: solve (JJᵀ)λ = −F and take dq = Jᵀλ. The Jacobian is taken
 * once, at the guess, and reused for every iteration — the guess is a short
 * step away from a solution, so a fixed Jacobian still converges in two or
 * three passes and costs one factorisation instead of three.
 */
function project(mech: Mechanism, q: Float64Array, work: Work): boolean {
  const { rows, cols, j, square, piv, rhs, sol, f } = work;
  j.fill(0);
  evalJ(mech, q, j);

  // JJᵀ, the normal equations of the underdetermined system.
  for (let a = 0; a < rows; a++) {
    for (let b = a; b < rows; b++) {
      let sum = 0;
      for (let k = 0; k < cols; k++) sum += j[a * cols + k] * j[b * cols + k];
      square[a * rows + b] = sum;
      square[b * rows + a] = sum;
    }
  }
  if (luFactor(square, rows, piv) < 1e-13) return false;

  const tol = PROJECT_TOL * Math.max(1, mech.scale);
  let previous = Infinity;
  for (let iter = 0; iter < PROJECT_ITERS; iter++) {
    evalF(mech, q, f);
    let worst = 0;
    for (let i = 0; i < rows; i++) worst = Math.max(worst, Math.abs(f[i]));
    if (worst < tol) return true;
    // Not heading for a solution: better to shorten the step than to wander.
    if (iter >= 3 && worst > previous * 0.9) return false;
    previous = worst;

    for (let i = 0; i < rows; i++) rhs[i] = -f[i];
    luSolve(square, rows, piv, rhs, sol);
    for (let k = 0; k < cols; k++) {
      let sum = 0;
      for (let a = 0; a < rows; a++) sum += j[a * cols + k] * sol[a];
      q[k] += sum;
    }
  }
  evalF(mech, q, f);
  let worst = 0;
  for (let i = 0; i < rows; i++) worst = Math.max(worst, Math.abs(f[i]));
  return worst < tol;
}

/** One predictor-corrector step of length h along the motion. */
export function stepTrace(trace: Trace, h: number): StepResult {
  const { mech, work } = trace;
  const { cols, qTry, tNext } = work;
  for (let i = 0; i < cols; i++) qTry[i] = trace.q[i] + h * trace.t[i];
  if (!project(mech, qTry, work)) return 'stuck';
  if (tangentAt(mech, qTry, trace.t, tNext, work) === 0) return 'singular';

  trace.arc += h;
  trace.steps++;
  trace.q.set(qTry);
  trace.t.set(tNext);
  return 'ok';
}

/**
 * The expensive check the fast path skips: singular values of J, and with them
 * the true nullspace dimension. Run every so often rather than every step —
 * it is how a mechanism arriving at a singular configuration gets noticed.
 */
export function checkTrace(trace: Trace): number {
  const { work, mech } = trace;
  work.j.fill(0);
  evalJ(mech, trace.q, work.j);
  const s = svd(work.j, work.rows, work.cols);
  const rank = rankOf(s);
  trace.dof = work.cols - rank;
  trace.sigmaMin = rank > 0 ? s.sigma[rank - 1] : 0;
  trace.sigmaMax = s.sigma[0];
  return trace.dof;
}

/** Every pinned point in the world, for drawing and for framing the shot. */
export function pinPoints(mech: Mechanism, q: Float64Array, out: PinPoint[]): PinPoint[] {
  out.length = 0;
  for (const pin of mech.pins) {
    const b = pin.i * 3;
    const th = q[b + 2];
    out.push({
      x: q[b] + pin.u * Math.cos(th),
      y: q[b + 1] + pin.u * Math.sin(th),
      ground: pin.j < 0,
    });
  }
  return out;
}

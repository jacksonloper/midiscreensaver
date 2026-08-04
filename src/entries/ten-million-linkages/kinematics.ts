/**
 * The kinematics half of the LINKS-10M viewer.
 *
 * Nothing here is a physics engine. Every joint is placed by geometry alone:
 * the crank sweeps a circle around its ground pivot, and each remaining joint
 * sits where two rods of known length say it must — one of the two points
 * where two circles cross. Rod lengths come from the row's own starting pose,
 * so the mechanism is exactly the one the dataset stored, posed at a different
 * crank angle.
 */

/** A dataset row, already renamed out of the API's spaced-out field names. */
export interface DatasetRow {
  /** Row offset within the split. */
  index: number;
  /** Rows in the split, as the API reported them. */
  total: number;
  /** Where the mechanism came from — the live dataset, or a bundled sample. */
  source: 'dataset' | 'built-in';
  /** n × 2 starting pose. */
  positions: number[][];
  /** One pair of joint indices per rod. */
  edges: number[][];
  /** Indices of the joints bolted to the ground. */
  fixed: number[];
  /** The stored solution order, four tokens per joint. */
  sequence: number[];
  /** The path the output joint traces over one turn of the crank, or empty. */
  curve: number[][];
}

export type JointKind = 'ground' | 'crank' | 'moving' | 'output';

/** One joint, solved from two already-placed neighbours. */
export interface Step {
  joint: number;
  a: number;
  b: number;
  /** Rod length from `a`, measured off the starting pose. */
  la: number;
  /** Rod length from `b`. */
  lb: number;
  /** Which side of the a→b line this joint sits on: +1 or −1. */
  sign: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Mechanism {
  index: number;
  total: number;
  source: 'dataset' | 'built-in';
  /** Joint count. */
  n: number;
  /** Starting pose, flat x/y pairs. */
  start: Float64Array;
  /** Rods, flat joint-index pairs. */
  rods: Int32Array;
  kind: JointKind[];
  ground: number[];
  steps: Step[];
  /** How many solve steps deep each joint is; 0 for ground and the crank. */
  depth: Int32Array;
  maxDepth: number;
  /** The joint whose path the dataset stored — always the last one. */
  output: number;
  crankRadius: number;
  /** Crank angle in the starting pose, so θ = 0 reproduces that pose. */
  crankPhase: number;
  /** The stored target curve, flat x/y pairs, or null when the row had none. */
  curve: Float64Array | null;
  /** Box swept by every joint over a full turn, plus the stored curve. */
  bounds: Bounds;
  /** First crank angle (radians) with no valid assembly, or null if it turns. */
  stallAngle: number | null;
}

/*
 * Token vocabulary of the `sequence` field. Each joint gets four tokens —
 * a kind, a separator, and two references — and the whole thing is closed by a
 * stop token. A reference is the joint index offset by JOINT_BASE; the crank
 * and the ground joints pad their unused slots with NONE.
 */
const KIND_GROUND = 0;
const KIND_MOVING = 1;
const KIND_OUTPUT = 2;
const SEPARATOR = 3;
const NONE = 4;
const JOINT_BASE = 6;
const STOP = 26;

const TOKENS_PER_JOINT = 4;

interface PlanEntry {
  kind: JointKind;
  /** −1 where the slot was padded. */
  a: number;
  b: number;
}

/** Reads the stored solution order. Throws on anything it does not recognise. */
function decodePlan(sequence: number[], n: number): PlanEntry[] {
  const expected = n * TOKENS_PER_JOINT + 1;
  if (sequence.length !== expected) {
    throw new Error(`sequence has ${sequence.length} tokens, expected ${expected}`);
  }
  if (sequence[expected - 1] !== STOP) throw new Error('sequence does not end with the stop token');

  const ref = (token: number, joint: number): number => {
    if (token === NONE) return -1;
    const j = token - JOINT_BASE;
    // A joint may only lean on joints placed before it, which is what makes
    // the stored order a solution order rather than a puzzle.
    if (j < 0 || j >= joint) throw new Error(`joint ${joint} references joint ${j}`);
    return j;
  };

  const plan: PlanEntry[] = [];
  for (let j = 0; j < n; j++) {
    const at = j * TOKENS_PER_JOINT;
    const kindToken = sequence[at];
    if (sequence[at + 1] !== SEPARATOR) throw new Error(`joint ${j} is missing its separator`);

    if (kindToken === KIND_GROUND) {
      plan.push({ kind: 'ground', a: -1, b: -1 });
      continue;
    }
    if (kindToken !== KIND_MOVING && kindToken !== KIND_OUTPUT) {
      throw new Error(`joint ${j} has an unknown kind token ${kindToken}`);
    }

    const a = ref(sequence[at + 2], j);
    const b = ref(sequence[at + 3], j);
    if (j === 1) {
      // The crank: one ground pivot and an angle, not two rods.
      if (a !== 0) throw new Error('the crank does not turn about joint 0');
      plan.push({ kind: 'crank', a: 0, b: -1 });
      continue;
    }
    if (a < 0 || b < 0 || a === b) throw new Error(`joint ${j} does not name two parents`);
    plan.push({ kind: kindToken === KIND_OUTPUT ? 'output' : 'moving', a, b });
  }
  return plan;
}

const isPoint = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Turns a row into something posable: rod lengths and branch choices read off
 * the starting pose, then a sweep of a full turn to find the framing and to
 * catch a mechanism that cannot actually go round.
 */
export function preprocess(row: DatasetRow): Mechanism {
  const n = row.positions.length;
  if (n < 3) throw new Error(`a mechanism needs at least three joints, got ${n}`);
  if (!row.positions.every(isPoint)) throw new Error('a joint position is not a finite pair');

  const plan = decodePlan(row.sequence, n);
  if (plan[0].kind !== 'ground') throw new Error('joint 0 is not on the ground');
  if (plan[1].kind !== 'crank') throw new Error('joint 1 is not the crank');

  const start = new Float64Array(n * 2);
  for (let j = 0; j < n; j++) {
    start[j * 2] = row.positions[j][0];
    start[j * 2 + 1] = row.positions[j][1];
  }

  const rodPairs = row.edges.filter(
    (e) =>
      Array.isArray(e) &&
      e.length >= 2 &&
      Number.isInteger(e[0]) &&
      Number.isInteger(e[1]) &&
      e[0] >= 0 &&
      e[1] >= 0 &&
      e[0] < n &&
      e[1] < n &&
      e[0] !== e[1],
  );
  if (rodPairs.length === 0) throw new Error('the row lists no usable rods');
  const rods = new Int32Array(rodPairs.length * 2);
  rodPairs.forEach((e, i) => {
    rods[i * 2] = e[0];
    rods[i * 2 + 1] = e[1];
  });

  const kind = plan.map((p) => p.kind);
  const depth = new Int32Array(n);
  const steps: Step[] = [];
  let maxDepth = 0;

  for (let j = 2; j < n; j++) {
    const entry = plan[j];
    if (entry.kind === 'ground') continue;
    const { a, b } = entry;
    const ax = start[a * 2];
    const ay = start[a * 2 + 1];
    const bx = start[b * 2];
    const by = start[b * 2 + 1];
    const jx = start[j * 2];
    const jy = start[j * 2 + 1];
    // The cross product says which of the two circle crossings the dataset
    // assembled. Keeping that sign is the whole of the branch problem.
    const cross = (bx - ax) * (jy - ay) - (by - ay) * (jx - ax);
    steps.push({
      joint: j,
      a,
      b,
      la: Math.hypot(jx - ax, jy - ay),
      lb: Math.hypot(jx - bx, jy - by),
      sign: cross >= 0 ? 1 : -1,
    });
    depth[j] = 1 + Math.max(depth[a], depth[b]);
    if (depth[j] > maxDepth) maxDepth = depth[j];
  }

  const crankRadius = Math.hypot(start[2] - start[0], start[3] - start[1]);
  if (!(crankRadius > 0)) throw new Error('the crank has no length');

  const curve =
    row.curve.length > 0 && row.curve.every(isPoint)
      ? Float64Array.from(row.curve.flatMap((p) => [p[0], p[1]]))
      : null;

  const mechanism: Mechanism = {
    index: row.index,
    total: row.total,
    source: row.source,
    n,
    start,
    rods,
    kind,
    ground: kind.map((k, j) => (k === 'ground' ? j : -1)).filter((j) => j >= 0),
    steps,
    depth,
    maxDepth,
    output: n - 1,
    crankRadius,
    crankPhase: Math.atan2(start[3] - start[1], start[2] - start[0]),
    curve,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    stallAngle: null,
  };
  survey(mechanism);
  return mechanism;
}

const TAU = Math.PI * 2;

/**
 * Poses the mechanism at crank angle `theta`, writing 2n coordinates into
 * `out`. Returns false when a joint has no valid position, which leaves `out`
 * holding a half-built pose that nothing should draw.
 */
export function solve(m: Mechanism, theta: number, out: Float64Array): boolean {
  out.set(m.start);
  const x0 = m.start[0];
  const y0 = m.start[1];
  const angle = m.crankPhase + theta;
  out[2] = x0 + m.crankRadius * Math.cos(angle);
  out[3] = y0 + m.crankRadius * Math.sin(angle);

  for (const step of m.steps) {
    const ax = out[step.a * 2];
    const ay = out[step.a * 2 + 1];
    const bx = out[step.b * 2];
    const by = out[step.b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    const { la, lb } = step;

    // Tangent circles are the interesting case: the exact arithmetic almost
    // never lands on d === la + lb, so allow a hair of overlap and clamp
    // rather than declaring a mechanism dead one rounding error early.
    const tol = 1e-9 * (la + lb + d);
    if (d <= tol || d > la + lb + tol || d < Math.abs(la - lb) - tol) return false;

    const u = (la * la - lb * lb + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, la * la - u * u));
    const mx = ax + (u * dx) / d;
    const my = ay + (u * dy) / d;
    out[step.joint * 2] = mx - (step.sign * h * dy) / d;
    out[step.joint * 2 + 1] = my + (step.sign * h * dx) / d;
  }
  return true;
}

const SWEEP_SAMPLES = 240;

/**
 * Walks a full turn to find the box the mechanism moves through and the first
 * angle, if any, where it cannot be assembled. Called again after a branch is
 * flipped, because that is a different mechanism with a different reach.
 */
export function survey(m: Mechanism): void {
  const pose = new Float64Array(m.n * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let stall: number | null = null;

  for (let i = 0; i < SWEEP_SAMPLES; i++) {
    const theta = (i / SWEEP_SAMPLES) * TAU;
    if (!solve(m, theta, pose)) {
      if (stall === null) stall = theta;
      continue;
    }
    for (let j = 0; j < m.n; j++) {
      const x = pose[j * 2];
      const y = pose[j * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (m.curve) {
    for (let i = 0; i < m.curve.length; i += 2) {
      const x = m.curve[i];
      const y = m.curve[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX)) {
    // Nothing solved anywhere: fall back to the starting pose so the frame is
    // still somewhere sensible while the viewer reports the stall.
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    for (let j = 0; j < m.n; j++) {
      minX = Math.min(minX, m.start[j * 2]);
      maxX = Math.max(maxX, m.start[j * 2]);
      minY = Math.min(minY, m.start[j * 2 + 1]);
      maxY = Math.max(maxY, m.start[j * 2 + 1]);
    }
  }

  m.bounds = { minX, minY, maxX, maxY };
  m.stallAngle = stall;
}

/**
 * The closed path one joint walks over a full turn, or null if the mechanism
 * stalls on the way round. Dataset rows ship the output joint's path already;
 * this is how the bundled samples get theirs, and how any other joint gets one.
 */
export function tracePath(m: Mechanism, joint: number, samples = 200): Float64Array | null {
  const pose = new Float64Array(m.n * 2);
  const path = new Float64Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    if (!solve(m, (i / samples) * TAU, pose)) return null;
    path[i * 2] = pose[joint * 2];
    path[i * 2 + 1] = pose[joint * 2 + 1];
  }
  return path;
}

/** Flips which of the two circle crossings a joint assembles into. */
export function flipBranch(m: Mechanism, stepIndex: number): void {
  const step = m.steps[stepIndex];
  if (!step) return;
  step.sign = -step.sign;
  survey(m);
}

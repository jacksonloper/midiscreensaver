import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, lerp, range } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/** x and y run from 0.5 to 4 in tenths, so every answer can be checked by hand. */
export const MIN_VALUE = 0.5;
export const MAX_VALUE = 4;
const STEPS = Math.round((MAX_VALUE - MIN_VALUE) * 10);

/** A knob position, 0..1, as the tenth it stands for. */
export const quantise = (v: number): number => MIN_VALUE + Math.round(clamp(v) * STEPS) / 10;
/** The knob position that reads as `value` — for the post's defaults. */
export const knobFor = (value: number): number => (value - MIN_VALUE) / (MAX_VALUE - MIN_VALUE);

export const CONSTRUCTIONS = ['x · y', 'x ÷ y', '√(xy)'];
export const PALETTES = ['night', 'chalkboard', 'blueprint', 'ember'];

/* ------------------------------------------------------------ geometry */

interface Vec {
  x: number;
  y: number;
}

const v = (x: number, y: number): Vec => ({ x, y });
const add = (a: Vec, b: Vec): Vec => v(a.x + b.x, a.y + b.y);
const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
const mul = (a: Vec, k: number): Vec => v(a.x * k, a.y * k);
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const dir = (angle: number): Vec => v(Math.cos(angle), Math.sin(angle));
const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
const mid = (a: Vec, b: Vec): Vec => mul(add(a, b), 0.5);

/** Where the line through `p` along `d` meets the line through `q` along `e`. */
const meet = (p: Vec, d: Vec, q: Vec, e: Vec): Vec => {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return p;
  return add(p, mul(d, cross(sub(q, p), e) / den));
};

/**
 * Where two circles cross, on the left of the line from the first centre to
 * the second (`side` = 1) or on its right (`side` = -1).
 */
const crossing = (c1: Vec, r1: number, c2: Vec, r2: number, side: number): Vec => {
  const d = len(sub(c2, c1));
  if (d < 1e-12) return c1;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = mul(sub(c2, c1), 1 / d);
  return add(add(c1, mul(u, a)), mul(v(-u.y, u.x), h * side));
};

/** Where the ray from `p` along unit `d` first leaves the circle round `c`. */
const exitCircle = (p: Vec, d: Vec, c: Vec, r: number): Vec => {
  const f = sub(p, c);
  const b = f.x * d.x + f.y * d.y;
  const q = f.x * f.x + f.y * f.y - r * r;
  return add(p, mul(d, -b + Math.sqrt(Math.max(0, b * b - q))));
};

/* ------------------------------------------------------ the constructions */

type Given = 'one' | 'x' | 'y';

/** Something the straightedge or the compass draws. */
type Prim =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'arc'; c: Vec; r: number; from: number; to: number; fixed?: boolean }
  | { kind: 'result'; a: Vec; b: Vec };

interface Step {
  text: string;
  prims: Prim[];
  /** Which given length the compass is opened to, if any. */
  uses?: Given;
}

interface Mark {
  p: Vec;
  label: string;
  /** Which way the label sits off the point. */
  toward: Vec;
  /** The step that puts the point on the page. */
  step: number;
  result?: boolean;
}

interface Figure {
  steps: Step[];
  marks: Mark[];
  /** Pairs of similar triangles, shaded once the answer is drawn. */
  triangles: Vec[][];
  /** The answer as the construction measures it, in units. */
  measured: number;
  /** The answer as arithmetic gives it. */
  exact: number;
  /** "OP", "OQ", "OH" — the segment that is the answer. */
  segment: string;
  bounds: Vec[];
}

/** An arc just wide enough to pass through each target, seen from `c`. */
const arcThrough = (c: Vec, ...targets: Vec[]): Prim => {
  const r = len(sub(targets[0], c));
  const a1 = angleOf(sub(targets[0], c));
  if (targets.length === 1) return { kind: 'arc', c, r, from: a1, to: a1 };
  let d = angleOf(sub(targets[1], c)) - a1;
  while (d > Math.PI) d -= TAU;
  while (d <= -Math.PI) d += TAU;
  return d >= 0
    ? { kind: 'arc', c, r, from: a1, to: a1 + d }
    : { kind: 'arc', c, r, from: a1 + d, to: a1 };
};

const line = (a: Vec, b: Vec): Prim => ({ kind: 'line', a, b });

/** Two rays out of O and the reach they need to carry every point on them. */
const rays = (ea: Vec, eb: Vec, pts: Vec[]): [Vec, Vec] => {
  const reach = Math.max(...pts.map(len)) * 1.14;
  return [mul(ea, reach), mul(eb, reach)];
};

/**
 * Descartes' product. Mark 1 and x on one ray and y on the other; the line
 * through x parallel to the one joining 1 to y lands at x·y, because the two
 * triangles it makes with O are the same shape.
 */
const productFigure = (x: number, y: number, rot: number, spread: number): Figure => {
  const O = v(0, 0);
  const ea = dir(rot);
  const eb = dir(rot + spread);
  const U = ea;
  const X = mul(ea, x);
  const Y = mul(eb, y);
  // UXZY is a parallelogram, so XZ runs parallel to UY.
  const Z = add(X, sub(Y, U));
  const P = meet(X, sub(Y, U), O, eb);
  const [ra, rb] = rays(ea, eb, [U, X, Y, P, Z]);
  const far = len(sub(Z, X)) > len(sub(P, X)) ? Z : P;
  const beyond = add(far, mul(sub(far, X), 0.08 / Math.max(0.2, len(sub(far, X)))));

  return {
    steps: [
      { text: 'Rule a line out of O.', prims: [line(O, ra)] },
      { text: 'Rule a second line out of O.', prims: [line(O, rb)] },
      { text: 'Open the compass to 1. Mark U on the first line.', prims: [arcThrough(O, U)], uses: 'one' },
      { text: 'Open it to x. Mark X on the first line.', prims: [arcThrough(O, X)], uses: 'x' },
      { text: 'Open it to y. Mark Y on the second line.', prims: [arcThrough(O, Y)], uses: 'y' },
      { text: 'Rule U to Y.', prims: [line(U, Y)] },
      { text: 'From X, open the compass to UY.', prims: [arcThrough(X, Z)] },
      { text: 'From Y, open it to UX. The arcs cross at Z.', prims: [arcThrough(Y, Z)] },
      { text: 'Rule X through Z. It meets the second line at P.', prims: [line(X, beyond)] },
      { text: 'OP is x · y.', prims: [{ kind: 'result', a: O, b: P }] },
    ],
    marks: [
      { p: O, label: 'O', toward: mul(add(ea, eb), -1), step: 0 },
      { p: U, label: 'U', toward: dir(rot - Math.PI / 2), step: 2 },
      { p: X, label: 'X', toward: dir(rot - Math.PI / 2), step: 3 },
      { p: Y, label: 'Y', toward: dir(rot + spread + Math.PI / 2), step: 4 },
      { p: Z, label: 'Z', toward: sub(Z, mid(X, Y)), step: 7 },
      { p: P, label: 'P', toward: dir(rot + spread + Math.PI / 2), step: 8, result: true },
    ],
    triangles: [
      [O, U, Y],
      [O, X, P],
    ],
    measured: len(P),
    exact: x * y,
    segment: 'OP',
    bounds: [O, ra, rb, U, X, Y, Z, P, beyond],
  };
};

/**
 * The same picture run backwards. This time 1 and y share a ray and x has the
 * other; the parallel through 1 cuts x down by the same ratio that takes y
 * down to 1.
 */
const quotientFigure = (x: number, y: number, rot: number, spread: number): Figure => {
  const O = v(0, 0);
  const ea = dir(rot);
  const eb = dir(rot + spread);
  const U = ea;
  const Y = mul(ea, y);
  const X = mul(eb, x);
  const Z = add(U, sub(X, Y));
  const Q = meet(U, sub(X, Y), O, eb);
  const [ra, rb] = rays(ea, eb, [U, X, Y, Q, Z]);
  const far = len(sub(Z, U)) > len(sub(Q, U)) ? Z : Q;
  const beyond = add(far, mul(sub(far, U), 0.08 / Math.max(0.2, len(sub(far, U)))));

  return {
    steps: [
      { text: 'Rule a line out of O.', prims: [line(O, ra)] },
      { text: 'Rule a second line out of O.', prims: [line(O, rb)] },
      { text: 'Open the compass to 1. Mark U on the first line.', prims: [arcThrough(O, U)], uses: 'one' },
      { text: 'Open it to y. Mark Y on the first line.', prims: [arcThrough(O, Y)], uses: 'y' },
      { text: 'Open it to x. Mark X on the second line.', prims: [arcThrough(O, X)], uses: 'x' },
      { text: 'Rule Y to X.', prims: [line(Y, X)] },
      { text: 'From U, open the compass to YX.', prims: [arcThrough(U, Z)] },
      { text: 'From X, open it to YU. The arcs cross at Z.', prims: [arcThrough(X, Z)] },
      { text: 'Rule U through Z. It meets the second line at Q.', prims: [line(U, beyond)] },
      { text: 'OQ is x ÷ y.', prims: [{ kind: 'result', a: O, b: Q }] },
    ],
    marks: [
      { p: O, label: 'O', toward: mul(add(ea, eb), -1), step: 0 },
      { p: U, label: 'U', toward: dir(rot - Math.PI / 2), step: 2 },
      { p: Y, label: 'Y', toward: dir(rot - Math.PI / 2), step: 3 },
      { p: X, label: 'X', toward: dir(rot + spread + Math.PI / 2), step: 4 },
      { p: Z, label: 'Z', toward: sub(Z, mid(U, X)), step: 7 },
      { p: Q, label: 'Q', toward: dir(rot + spread + Math.PI / 2), step: 8, result: true },
    ],
    triangles: [
      [O, Y, X],
      [O, U, Q],
    ],
    measured: len(Q),
    exact: x / y,
    segment: 'OQ',
    bounds: [O, ra, rb, U, X, Y, Z, Q, beyond],
  };
};

/**
 * The geometric mean. Lay x and y end to end and draw the circle they are the
 * diameter of; the perpendicular at the join reaches the circle at a height
 * of √(xy), because the two right triangles either side of it are the same
 * shape.
 */
const rootFigure = (x: number, y: number, rot: number): Figure => {
  const O = v(0, 0);
  const e = dir(rot);
  const n = dir(rot + Math.PI / 2);
  const A = mul(e, -x);
  const B = mul(e, y);
  const ab = x + y;
  const reachAB = ab * 0.62;
  const C1 = crossing(A, reachAB, B, reachAB, 1);
  const C2 = crossing(A, reachAB, B, reachAB, -1);
  const M = meet(C1, sub(C2, C1), O, e);
  const R = ab / 2;
  const r0 = Math.min(x, y) * 0.45;
  const E = mul(e, -r0);
  const F = mul(e, r0);
  const G = crossing(E, r0 * 1.6, F, r0 * 1.6, 1);
  const H = exitCircle(O, n, M, R);
  const top = add(H, mul(n, Math.max(0.25, len(H) * 0.12)));
  const baseA = add(A, mul(e, -ab * 0.1));
  const baseB = add(B, mul(e, ab * 0.1));

  return {
    steps: [
      { text: 'Rule a line through O.', prims: [line(baseA, baseB)] },
      { text: 'Open the compass to x. Mark A to the left of O.', prims: [arcThrough(O, A)], uses: 'x' },
      { text: 'Open it to y. Mark B to the right.', prims: [arcThrough(O, B)], uses: 'y' },
      {
        text: 'Open it past half of AB. Swing it from A, then from B.',
        prims: [arcThrough(A, C2, C1), arcThrough(B, C1, C2)],
      },
      { text: 'Rule through the two crossings. It halves AB at M.', prims: [line(C2, C1)] },
      {
        text: 'From M, draw the circle through A and B.',
        prims: [{ kind: 'arc', c: M, r: R, from: rot, to: rot + Math.PI, fixed: true }],
      },
      { text: 'From O, mark E and F either side.', prims: [arcThrough(O, F, E)] },
      {
        text: 'Wider, from E and then F. They cross at G.',
        prims: [arcThrough(E, G), arcThrough(F, G)],
      },
      { text: 'Rule O through G. It meets the circle at H.', prims: [line(O, top)] },
      { text: 'OH is √(xy).', prims: [{ kind: 'result', a: O, b: H }] },
    ],
    marks: [
      { p: O, label: 'O', toward: mul(n, -1), step: 0 },
      { p: A, label: 'A', toward: mul(n, -1), step: 1 },
      { p: B, label: 'B', toward: mul(n, -1), step: 2 },
      { p: M, label: 'M', toward: mul(n, -1), step: 4 },
      { p: E, label: 'E', toward: add(mul(n, -1), mul(e, -0.4)), step: 6 },
      { p: F, label: 'F', toward: add(mul(n, -1), mul(e, 0.4)), step: 6 },
      { p: G, label: 'G', toward: e, step: 7 },
      { p: H, label: 'H', toward: add(n, mul(e, 0.6)), step: 8, result: true },
    ],
    triangles: [
      [A, O, H],
      [H, O, B],
    ],
    measured: len(H),
    exact: Math.sqrt(x * y),
    segment: 'OH',
    bounds: [baseA, baseB, C1, C2, add(M, mul(n, R)), top, E, F],
  };
};

/** The instrument in the reader's hand while a step is being drawn. */
type Tool = { kind: 'ruler'; a: Vec; b: Vec } | { kind: 'compass'; c: Vec; tip: Vec };

/* ------------------------------------------------------------- palettes */

interface Palette {
  bg: [string, string];
  ink: (a: number) => string;
  arc: (a: number) => string;
  point: string;
  label: string;
  accent: (a: number) => string;
  x: (a: number) => string;
  y: (a: number) => string;
  one: (a: number) => string;
  tool: (a: number) => string;
  dim: string;
  text: string;
}

const PALETTE_INKS: Palette[] = [
  {
    bg: [hsl(222, 32, 9), '#04050a'],
    ink: (a) => hsl(212, 30, 80, a),
    arc: (a) => hsl(198, 70, 64, a * 0.75),
    point: '#e6ecff',
    label: hsl(212, 40, 88, 0.9),
    accent: (a) => hsl(40, 96, 62, a),
    x: (a) => hsl(338, 80, 70, a),
    y: (a) => hsl(168, 70, 58, a),
    one: (a) => hsl(212, 20, 82, a),
    tool: (a) => hsl(212, 30, 85, a),
    dim: '#64748b',
    text: '#c8d2ea',
  },
  {
    bg: [hsl(152, 26, 15), hsl(160, 30, 9)],
    ink: (a) => hsl(60, 20, 93, a * 0.88),
    arc: (a) => hsl(52, 55, 82, a * 0.6),
    point: '#fbfbf2',
    label: hsl(60, 20, 94, 0.92),
    accent: (a) => hsl(46, 100, 70, a),
    x: (a) => hsl(350, 85, 80, a),
    y: (a) => hsl(195, 80, 78, a),
    one: (a) => hsl(60, 15, 90, a),
    tool: (a) => hsl(35, 45, 70, a),
    dim: hsl(140, 12, 55),
    text: hsl(60, 15, 90),
  },
  {
    bg: [hsl(214, 66, 26), hsl(218, 70, 15)],
    ink: (a) => hsl(200, 50, 94, a * 0.9),
    arc: (a) => hsl(192, 80, 80, a * 0.55),
    point: '#ffffff',
    label: hsl(200, 60, 95, 0.95),
    accent: (a) => hsl(50, 100, 64, a),
    x: (a) => hsl(18, 100, 72, a),
    y: (a) => hsl(160, 80, 70, a),
    one: (a) => hsl(200, 40, 92, a),
    tool: (a) => hsl(200, 60, 90, a),
    dim: hsl(205, 40, 68),
    text: hsl(200, 60, 94),
  },
  {
    bg: [hsl(18, 34, 11), hsl(8, 30, 5)],
    ink: (a) => hsl(32, 40, 82, a),
    arc: (a) => hsl(20, 80, 62, a * 0.7),
    point: '#fff1e0',
    label: hsl(32, 60, 88, 0.9),
    accent: (a) => hsl(52, 100, 66, a),
    x: (a) => hsl(4, 85, 66, a),
    y: (a) => hsl(190, 60, 66, a),
    one: (a) => hsl(32, 30, 84, a),
    tool: (a) => hsl(30, 50, 80, a),
    dim: hsl(24, 20, 50),
    text: hsl(32, 50, 86),
  },
];

/* ---------------------------------------------------------------- sketch */

/**
 * Three pieces of arithmetic done with nothing but a straightedge and a
 * compass. Knobs 1 and 2 set x and y; the pads pick which answer to build and
 * how to step through it. Every step is a real ruler line or compass swing,
 * and the answer printed at the end is the length the construction produced,
 * measured off the figure rather than worked out alongside it.
 */
export const createCompassArithmetic: SketchFactory = (): Sketch => {
  let xs = 2.4;
  let ys = 1.5;

  let which = 0;
  let taking = true;
  let manual = false;
  let target = 0;
  let labels = true;
  let palette = 0;

  /** How far through the construction we are, in steps. */
  let progress = 0;

  let scale = 0;
  let cx = 0;
  let cy = 0;

  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  const restart = (): void => {
    progress = 0;
  };

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      const [kx, ky, kSpread, kPace, kTurn, kArc, kType, kWeight] = midi.knobs;

      /* -------------------------------------------------------- controls */

      const xn = quantise(kx);
      const yn = quantise(ky);
      xs = approach(xs, xn, 0.08, dt);
      ys = approach(ys, yn, 0.08, dt);

      const say = (text: string): void => {
        toast = text;
        toastAge = 0;
      };

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
          case 1:
          case 2:
            which = hit.pad;
            taking = false;
            manual = false;
            restart();
            say(`construct · ${CONSTRUCTIONS[which]}`);
            break;
          case 3:
            taking = true;
            manual = false;
            say('taking turns · all three');
            break;
          case 4:
            if (!manual) {
              manual = true;
              target = Math.floor(progress) + 1;
            } else if (target >= 10) {
              progress = 0;
              target = 1;
            } else {
              target += 1;
            }
            say(`step ${Math.min(target, 10)} of 10`);
            break;
          case 5:
            // A finished figure stays up until this pad is hit. When taking
            // turns, that is also what moves on to the next construction.
            if (taking && progress >= 10) which = (which + 1) % CONSTRUCTIONS.length;
            manual = false;
            restart();
            say(taking ? `play · ${CONSTRUCTIONS[which]}` : 'play from the start');
            break;
          case 6:
            labels = !labels;
            say(`labels · ${labels ? 'on' : 'off'}`);
            break;
          default:
            palette = (palette + 1) % PALETTES.length;
            say(`palette · ${PALETTES[palette]}`);
            break;
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const secondsPerStep = range(kPace, 3.2, 0.45);
      const spread = range(kSpread, 20, 110) * (Math.PI / 180);
      const rot = range(kTurn, -60, 60) * (Math.PI / 180);

      const figure =
        which === 0
          ? productFigure(xs, ys, rot, spread)
          : which === 1
            ? quotientFigure(xs, ys, rot, spread)
            : rootFigure(xs, ys, rot);
      const total = figure.steps.length;

      if (manual) {
        progress = Math.min(target, progress + dt / secondsPerStep);
      } else {
        progress = Math.min(total, progress + dt / secondsPerStep);
      }

      /* ---------------------------------------------------------- layout */

      const pal = PALETTE_INKS[palette];
      const margin = Math.min(width, height) * 0.045 + 6;
      // The page floats its own control bar over the top of the stage and the
      // knobs and pads across the bottom, so the drawing keeps out of both.
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);
      const plotX = margin;
      const plotY = top;
      const plotW = Math.max(120, width - margin * 2);
      const plotH = Math.max(90, height - top - footer);

      const type = clamp(Math.min(width, height) * 0.026, 10, 18) * range(kType, 0.6, 1.4);
      const weight = range(kWeight, 0.7, 3.2);
      const panelW = Math.min(type * 26, plotW * 0.42);
      const wide = plotW - panelW > plotH * 0.9;
      const figW = wide ? plotW - panelW - type * 1.5 : plotW;
      const figH = wide ? plotH : plotH - type * 3.4;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of figure.bounds) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const pad = type * 2.2;
      const want = Math.min(
        (figW - pad * 2) / Math.max(0.1, maxX - minX),
        (figH - pad * 2) / Math.max(0.1, maxY - minY),
      );
      const wantX = plotX + figW / 2 - ((minX + maxX) / 2) * want;
      const wantY = plotY + figH / 2 + ((minY + maxY) / 2) * want;
      if (scale === 0) {
        scale = want;
        cx = wantX;
        cy = wantY;
      }
      scale = approach(scale, want, 0.25, dt);
      cx = approach(cx, wantX, 0.25, dt);
      cy = approach(cy, wantY, 0.25, dt);

      const sx = (p: Vec): number => cx + p.x * scale;
      const sy = (p: Vec): number => cy - p.y * scale;

      /* ------------------------------------------------------ background */

      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, pal.bg[0]);
      sky.addColorStop(1, pal.bg[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // A faint unit grid under the figure, so 1 is visible before it is used.
      if (scale > 14) {
        ctx.fillStyle = pal.ink(0.07);
        const x0 = Math.floor((plotX - cx) / scale);
        const x1 = Math.ceil((plotX + figW - cx) / scale);
        const y0 = Math.floor((cy - plotY - figH) / scale);
        const y1 = Math.ceil((cy - plotY) / scale);
        for (let i = x0; i <= x1; i++) {
          for (let j = y0; j <= y1; j++) {
            ctx.fillRect(cx + i * scale - 1, cy - j * scale - 1, 2, 2);
          }
        }
      }

      /* ---------------------------------------------------------- figure */

      const arcPad = kArc > 0.98 ? Math.PI : range(kArc, 5, 150) * (Math.PI / 180);
      const current = Math.min(Math.floor(progress), total - 1);
      const stepT = (k: number): number => clamp((progress - k) / 0.85);

      // Once the answer is in, shade the two triangles whose likeness makes it
      // true — they are the whole argument.
      const shade = clamp(progress - (total - 1));
      if (shade > 0) {
        figure.triangles.forEach((tri, i) => {
          ctx.beginPath();
          tri.forEach((p, k) => (k ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))));
          ctx.closePath();
          ctx.fillStyle = i === 0 ? pal.y(0.1 * shade) : pal.x(0.12 * shade);
          ctx.fill();
        });
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      /** Where the pencil is, and what is holding it, for the step in hand. */
      let tool: Tool | null = null;

      figure.steps.forEach((step, k) => {
        const t = stepT(k);
        if (t <= 0) return;
        const n = step.prims.length;
        step.prims.forEach((prim, i) => {
          const pt = clamp(t * n - i);
          if (pt <= 0) return;
          const live = k === current && pt < 1 && progress < total;

          if (prim.kind === 'line' || prim.kind === 'result') {
            const end = add(prim.a, mul(sub(prim.b, prim.a), pt));
            ctx.beginPath();
            ctx.moveTo(sx(prim.a), sy(prim.a));
            ctx.lineTo(sx(end), sy(end));
            if (prim.kind === 'result') {
              ctx.save();
              ctx.shadowColor = pal.accent(0.8);
              ctx.shadowBlur = 14;
              ctx.strokeStyle = pal.accent(1);
              ctx.lineWidth = weight * 2.6 + 1.5;
              ctx.stroke();
              ctx.restore();
            } else {
              ctx.strokeStyle = pal.ink(0.85);
              ctx.lineWidth = weight;
              ctx.stroke();
            }
            if (live && prim.kind === 'line') tool = { kind: 'ruler', a: prim.a, b: prim.b };
            return;
          }

          if (prim.r * scale < 0.5) return;
          const span = prim.to - prim.from;
          const extra = prim.fixed ? 0 : arcPad;
          let a0 = prim.from - extra;
          let a1 = prim.to + extra;
          if (a1 - a0 >= TAU) {
            a0 = prim.from + span / 2 - Math.PI;
            a1 = a0 + TAU;
          }
          const aEnd = lerp(a0, a1, pt);
          const segs = Math.max(6, Math.ceil(((aEnd - a0) * prim.r * scale) / 6));
          ctx.beginPath();
          for (let s = 0; s <= segs; s++) {
            const p = add(prim.c, mul(dir(lerp(a0, aEnd, s / segs)), prim.r));
            if (s) ctx.lineTo(sx(p), sy(p));
            else ctx.moveTo(sx(p), sy(p));
          }
          ctx.strokeStyle = prim.fixed ? pal.ink(0.8) : pal.arc(1);
          ctx.lineWidth = prim.fixed ? weight : Math.max(0.8, weight * 0.8);
          ctx.stroke();
          if (live) tool = { kind: 'compass', c: prim.c, tip: add(prim.c, mul(dir(aEnd), prim.r)) };
        });
      });

      // The instrument itself, drawn over the figure while it works.
      // (Assigned inside the loop above, which the compiler cannot see.)
      const held = tool as Tool | null;
      if (held && held.kind === 'ruler') {
        const ax = sx(held.a);
        const ay = sy(held.a);
        const bx = sx(held.b);
        const by = sy(held.b);
        const L = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / L;
        const uy = (by - ay) / L;
        const w = type * 1.3;
        const over = type * 1.5;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = pal.tool(0.1);
        ctx.fillRect(-over, 2, L + over * 2, w);
        ctx.strokeStyle = pal.tool(0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(-over, 2, L + over * 2, w);
        ctx.restore();
      } else if (held && held.kind === 'compass') {
        const ax = sx(held.c);
        const ay = sy(held.c);
        const bx = sx(held.tip);
        const by = sy(held.tip);
        const L = Math.hypot(bx - ax, by - ay);
        // The hinge stands up off the page on the far side from the origin,
        // and never taller than a hand would hold it.
        const lift = Math.min(L * 0.55, type * 6) + type;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const nx = L > 0 ? -(by - ay) / L : 0;
        const ny = L > 0 ? (bx - ax) / L : -1;
        const flip = ny > 0 ? -1 : 1;
        const hx = mx + nx * lift * flip;
        const hy = my + ny * lift * flip;
        ctx.strokeStyle = pal.tool(0.75);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(hx, hy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + nx * type * flip, hy + ny * type * flip);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = pal.tool(0.9);
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = pal.accent(0.95);
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, TAU);
        ctx.fill();
      }

      /* ------------------------------------------------------------ marks */

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const mark of figure.marks) {
        const a = clamp((progress - mark.step - 0.8) / 0.2);
        if (a <= 0) continue;
        const px = sx(mark.p);
        const py = sy(mark.p);
        ctx.fillStyle = mark.result ? pal.accent(a) : pal.point;
        ctx.globalAlpha = mark.result ? 1 : a;
        ctx.beginPath();
        ctx.arc(px, py, mark.result ? 4 + weight : 2.5 + weight * 0.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!labels) continue;
        const d = len(mark.toward) || 1;
        const off = type * 1.1;
        ctx.font = `600 ${type}px ${MONO}`;
        ctx.fillStyle = mark.result ? pal.accent(a) : pal.label;
        ctx.globalAlpha = mark.result ? 1 : a;
        ctx.fillText(
          mark.label,
          px + (mark.toward.x / d) * off,
          py - (mark.toward.y / d) * off,
        );
        ctx.globalAlpha = 1;
      }

      // The answer's own length, written along it once it is drawn.
      const resultStep = figure.steps[total - 1].prims[0];
      if (labels && shade > 0 && resultStep.kind === 'result') {
        const a = resultStep.a;
        const b = resultStep.b;
        const m = mid(a, b);
        const along = angleOf(sub(b, a));
        let ang = -along;
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        const side = dir(along + Math.PI / 2);
        ctx.save();
        ctx.translate(sx(m) + side.x * type * 1.3, sy(m) - side.y * type * 1.3);
        ctx.rotate(ang);
        ctx.font = `600 ${type * 1.05}px ${MONO}`;
        ctx.fillStyle = pal.accent(shade);
        ctx.fillText(`${CONSTRUCTIONS[which]} = ${figure.measured.toFixed(2)}`, 0, 0);
        ctx.restore();
      }

      /* ---------------------------------------------------------- readout */

      const exactText = (value: number): string => `${Math.round(value * 1000) / 1000}`;
      const sum =
        which === 0
          ? `${xn.toFixed(1)} × ${yn.toFixed(1)} = ${exactText(xn * yn)}`
          : which === 1
            ? `${xn.toFixed(1)} ÷ ${yn.toFixed(1)} = ${exactText(xn / yn)}`
            : `√(${xn.toFixed(1)} × ${yn.toFixed(1)}) = ${exactText(Math.sqrt(xn * yn))}`;

      if (wide) {
        const px = plotX + plotW - panelW;
        const using = progress < total ? figure.steps[current].uses : undefined;
        const answered = clamp(progress - (total - 1));
        const givens: [Given, string, number, (a: number) => string][] = [
          ['one', '1', 1, pal.one],
          ['x', 'x', xs, pal.x],
          ['y', 'y', ys, pal.y],
        ];

        /**
         * Lays the panel out at text size `t`, painting it only when asked, and
         * says how tall it came out — so it can be shrunk until it fits above
         * the controls.
         */
        const panel = (t: number, paint: boolean): number => {
          let py = plotY + t * 0.4;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';

          if (paint) {
            ctx.font = `500 ${t * 0.72}px ${MONO}`;
            setTracking(ctx, '0.3em');
            ctx.fillStyle = pal.dim;
            ctx.fillText(taking ? 'TAKING TURNS' : 'CONSTRUCTING', px, py);
            setTracking(ctx, '0em');
          }
          py += t * 1.5;

          if (paint) {
            ctx.font = `200 ${t * 2.4}px ${MONO}`;
            ctx.fillStyle = pal.text;
            ctx.fillText(CONSTRUCTIONS[which], px, py);
          }
          py += t * 3;

          // The givens, drawn to one shared scale: three lengths are all the
          // compass is ever allowed to start from.
          const unit = Math.min(scale, (panelW - t * 3) / Math.max(1, xs, ys));
          for (const [key, name, value, ink] of givens) {
            if (paint) {
              const on = using === key;
              const barY = py + t * 0.4;
              ctx.font = `600 ${t * 0.9}px ${MONO}`;
              ctx.fillStyle = ink(on ? 1 : 0.8);
              ctx.textBaseline = 'middle';
              ctx.fillText(name, px, barY);
              ctx.textBaseline = 'top';
              ctx.strokeStyle = ink(on ? 1 : 0.7);
              ctx.lineWidth = on ? 4 : 2.5;
              ctx.beginPath();
              ctx.moveTo(px + t * 2, barY);
              ctx.lineTo(px + t * 2 + value * unit, barY);
              ctx.stroke();
              ctx.lineWidth = 1.5;
              for (const end of [0, value * unit]) {
                ctx.beginPath();
                ctx.moveTo(px + t * 2 + end, py);
                ctx.lineTo(px + t * 2 + end, py + t * 0.8);
                ctx.stroke();
              }
            }
            py += t * 1.3;
          }
          py += t * 0.5;

          // The answer goes above the list, where it cannot be pushed off the
          // bottom; the space is kept even before there is anything in it.
          if (paint && answered > 0) {
            ctx.font = `500 ${t}px ${MONO}`;
            ctx.fillStyle = pal.accent(answered);
            ctx.fillText(`${figure.segment} measures ${figure.measured.toFixed(3)}`, px, py);
            ctx.fillStyle = pal.text;
            ctx.globalAlpha = answered;
            ctx.fillText(sum, px, py + t * 1.4);
            ctx.globalAlpha = 1;
          }
          py += t * 3.4;

          ctx.font = `400 ${t * 0.86}px ${MONO}`;
          figure.steps.forEach((step, k) => {
            const done = progress >= k + 1;
            const now = k === current && progress < total;
            // Word-wrapped to the panel, with the step number hanging out on
            // the left of the first row.
            const rows: string[] = [];
            let row = `${String(k + 1).padStart(2, ' ')} `;
            for (const word of step.text.split(' ')) {
              const trial = row.endsWith(' ') ? row + word : `${row} ${word}`;
              if (ctx.measureText(trial).width > panelW && !row.endsWith(' ')) {
                rows.push(row);
                row = `   ${word}`;
              } else row = trial;
            }
            rows.push(row);
            for (const r of rows) {
              if (paint) {
                ctx.fillStyle = now ? pal.accent(0.95) : done ? pal.text : pal.dim;
                ctx.globalAlpha = now ? 1 : done ? 0.85 : 0.55;
                ctx.fillText(r, px, py);
                ctx.globalAlpha = 1;
              }
              py += t * 1.3;
            }
            py += t * 0.12;
          });
          return py - plotY;
        };

        let t = type;
        while (t > 7 && panel(t, false) > plotH) t *= 0.94;
        panel(t, true);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const px = plotX + plotW / 2;
        const py = plotY + figH + type * 0.4;
        ctx.font = `500 ${type * 0.9}px ${MONO}`;
        ctx.fillStyle = pal.accent(1);
        const now =
          progress < total
            ? figure.steps[current].text
            : `${figure.segment} measures ${figure.measured.toFixed(3)}`;
        ctx.fillText(`${Math.min(current + 1, total)}/${total}  ${now}`, px, py);
        ctx.fillStyle = pal.text;
        ctx.font = `300 ${type * 1.1}px ${MONO}`;
        ctx.fillText(sum, px, py + type * 1.6);
      }

      /* ------------------------------------------------------------ toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        // Bottom right: the only corner the page does not put a control in.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = `500 ${type * 0.76}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = pal.accent(a);
        ctx.fillText(toast.toUpperCase(), plotX + plotW, plotY + plotH);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = pal.accent(padFlash * 0.06);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // A slow breath on O, so a finished figure still looks switched on.
      ctx.fillStyle = pal.accent(0.12 + Math.sin(time * 1.3) * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, 6 + weight * 2, 0, TAU);
      ctx.fill();
    },
  };
};

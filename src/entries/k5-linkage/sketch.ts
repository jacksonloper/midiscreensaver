import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, lerp, mulberry32, range } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/* ------------------------------------------------------------- the model */

/**
 * Two unit cranks turn about one pivot: W at angle θ, Z at angle φ. The
 * mechanism allows a configuration when either of two constraints holds:
 *
 *   branch A — φ = 3θ   (the third power of W lands on Z)
 *   branch B — θ = 2φ   (the square of Z lands on W)
 *
 * Each branch is a circle, parameterised by one number. They agree at five
 * configurations, and the two circles glued at those five points are the
 * complete graph on five vertices.
 */
export type Branch = 'A' | 'B';

export const N = 5;
/** Both branches meet a vertex every fifth of a turn of their own parameter. */
export const STEP = TAU / N;
/** Arrival tolerance, in radians of the parameter. */
export const EPS = 1e-4;

const mod = (x: number, m = TAU): number => ((x % m) + m) % m;
const mod5 = (k: number): number => ((k % N) + N) % N;

/** Shortest distance between two angles, 0..π. */
const angleGap = (a: number, b: number): number => {
  const d = mod(a - b);
  return Math.min(d, TAU - d);
};

/** The two crank angles a branch shows at parameter t. */
export const anglesOf = (branch: Branch, t: number): { theta: number; phi: number } =>
  branch === 'A' ? { theta: mod(t), phi: mod(3 * t) } : { theta: mod(2 * t), phi: mod(t) };

/** The parameter at which `branch` stands on vertex k. */
export const parameterAt = (branch: Branch, k: number): number =>
  mod(branch === 'A' ? STEP * k : 3 * STEP * k);

/**
 * Which vertex sits at parameter slot·STEP. On A the slots are the vertices in
 * order; on B they are the same five vertices, visited two apart.
 */
const vertexAtSlot = (branch: Branch, slot: number): number =>
  branch === 'A' ? mod5(slot) : mod5(2 * slot);

export interface Edge {
  branch: Branch;
  startVertex: number;
  endVertex: number;
  startParameter: number;
  endParameter: number;
}

/** A: 01 12 23 34 40. B: 02 24 41 13 30. Ten edges, which is all of K₅. */
export const EDGES: Edge[] = (['A', 'B'] as const).flatMap((branch) =>
  Array.from({ length: N }, (_, slot) => ({
    branch,
    startVertex: vertexAtSlot(branch, slot),
    endVertex: vertexAtSlot(branch, slot + 1),
    startParameter: slot * STEP,
    endParameter: (slot + 1) * STEP,
  })),
);

const edgeIndex = (branch: Branch, slot: number): number => (branch === 'A' ? 0 : N) + mod5(slot);

/** |e^{ia} − e^{ib}|: how badly a constraint is broken, 0..2. */
const residual = (a: number, b: number): number =>
  Math.hypot(Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b));

/** Solve factor·t ≡ target (mod 2π), taking the root nearest to `near`. */
const nearestRoot = (target: number, factor: number, near: number): number => {
  let best = 0;
  let bestGap = Infinity;
  for (let j = 0; j < factor; j++) {
    const cand = mod((target + TAU * j) / factor);
    const gap = angleGap(cand, near);
    if (gap < bestGap) {
      bestGap = gap;
      best = cand;
    }
  }
  return best;
};

/* --------------------------------------------------------------- drawing */

const HUE_A = 194;
const HUE_B = 34;
export const READOUTS = ['full', 'residuals', 'none'];

interface Choice {
  /** Leave for the other branch. */
  swap: boolean;
  /** Turn around: the same edge you arrived on. */
  back: boolean;
}

const CHOICE_NAMES = ['carry on', 'turn back', 'change branch', 'change branch, turn back'];

interface Sample {
  theta: number;
  phi: number;
  age: number;
}

/**
 * A two-crank linkage and its configuration space, side by side. The left half
 * is the machine; the right half is the graph of everything the machine can do,
 * with a marker showing where on that graph it currently is. The point of the
 * post is that the second picture is K₅ — ten edges, five corners, and a corner
 * is the one place where the machine has a choice about what to do next.
 */
export const createK5Linkage: SketchFactory = (): Sketch => {
  const rand = mulberry32(0x5eed5);

  let branch: Branch = 'A';
  let t = 0;
  let dir = 1;
  let held = false;
  let auto = false;
  let readout = 0;

  /** The choice waiting to be spent at the next vertex, if any. */
  let pending: Choice | null = null;
  let pendingName = '';
  /** How many times each of the ten edges has been walked this lap. */
  const walked = new Array<number>(2 * N).fill(0);
  /** Set when a lap completes; spent one corner later, so 10/10 is readable. */
  let lapDue = false;
  let laps = 0;

  let lastVertex = 0;
  let vertexFlash = 0;
  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  const trail: Sample[] = [];
  const knobWas = [-1, -1, -1, -1, -1, -1, -1, -1];

  const other = (b: Branch): Branch => (b === 'A' ? 'B' : 'A');

  /** The slot the current edge starts at — the vertex behind us, not ahead. */
  const currentSlot = (): number => {
    const m = mod(t) / STEP;
    const nearest = Math.round(m);
    const onVertex = Math.abs(m - nearest) * STEP < EPS;
    return mod5(onVertex ? (dir > 0 ? nearest : nearest - 1) : Math.floor(m));
  };

  /** Where along that edge's parameter interval we are, 0..1. */
  const progress = (): number => clamp(mod(t - currentSlot() * STEP) / STEP);

  /** The edge we would leave on if `choice` were taken at vertex k. */
  const edgeAfter = (k: number, choice: Choice): number => {
    const b = choice.swap ? other(branch) : branch;
    const d = choice.back ? -dir : dir;
    const slot = Math.round(parameterAt(b, k) / STEP);
    return edgeIndex(b, d > 0 ? slot : slot - 1);
  };

  /** Automatic traversal: take the least-walked way out, and rather not U-turn. */
  const autoChoice = (k: number): Choice => {
    let best: Choice = { swap: false, back: false };
    let bestScore = Infinity;
    for (const swap of [false, true]) {
      for (const back of [false, true]) {
        const choice = { swap, back };
        const score = walked[edgeAfter(k, choice)] * 10 + (back ? 1 : 0) + rand() * 0.4;
        if (score < bestScore) {
          bestScore = score;
          best = choice;
        }
      }
    }
    return best;
  };

  const say = (text: string): void => {
    toast = text;
    toastAge = 0;
  };

  const arrive = (slot: number): void => {
    if (lapDue) {
      walked.fill(0);
      lapDue = false;
    }
    // Credit the edge we just finished before anything about the state moves.
    walked[edgeIndex(branch, dir > 0 ? slot - 1 : slot)] += 1;
    if (auto && walked.every((w) => w > 0)) {
      laps += 1;
      lapDue = true;
      say(`all ten edges · lap ${laps}`);
    }

    const k = vertexAtSlot(branch, slot);
    lastVertex = k;
    vertexFlash = 1;

    const choice = pending ?? (auto ? autoChoice(k) : { swap: false, back: false });
    pending = null;
    pendingName = '';
    if (choice.back) dir = -dir;
    if (choice.swap) branch = other(branch);
    // Snap to the exact parameter of the vertex, on whichever branch we are now
    // on. Nothing accumulates: every vertex resets the state to an exact value.
    t = parameterAt(branch, k);
  };

  /** Walk `amount` radians of parameter, stopping dead on every vertex passed. */
  const advance = (amount: number): void => {
    let left = amount;
    for (let guard = 0; left > 1e-12 && guard < 64; guard++) {
      const past = mod(t, STEP);
      let toVertex = dir > 0 ? STEP - past : past;
      if (toVertex < EPS) toVertex = STEP;
      if (left < toVertex) {
        t = mod(t + dir * left);
        return;
      }
      left -= toVertex;
      arrive(mod5(Math.round(mod(t + dir * toVertex) / STEP)));
    }
  };

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      /* -------------------------------------------------------- controls */

      const speed = 0.1 * Math.pow(30, clamp(midi.knobs[0]));
      const trailSeconds = range(clamp(midi.knobs[3]), 0, 2.2);
      const rayInk = clamp(midi.knobs[4]);
      // Either end of the layout knob is a settled drawing; the swap happens
      // across the middle third, where the corners are on their way past each
      // other and nothing is worth reading.
      const morph = clamp((clamp(midi.knobs[5]) - 0.35) / 0.3);
      const layout = morph * morph * (3 - 2 * morph);
      const gapPx = range(clamp(midi.knobs[6]), 0, 15);
      const split = range(clamp(midi.knobs[7]), 0.32, 0.68);

      for (const hit of midi.hits) {
        const queue = (choice: Choice, name: string): void => {
          pending = choice;
          pendingName = name;
          auto = false;
          say(`at the next corner · ${name}`);
        };
        switch (hit.pad) {
          case 0:
            queue({ swap: false, back: false }, CHOICE_NAMES[0]);
            break;
          case 1:
            queue({ swap: false, back: true }, CHOICE_NAMES[1]);
            break;
          case 2:
            queue({ swap: true, back: false }, CHOICE_NAMES[2]);
            break;
          case 3:
            queue({ swap: true, back: true }, CHOICE_NAMES[3]);
            break;
          case 4:
            held = !held;
            say(held ? 'held' : 'running');
            break;
          case 5:
            auto = !auto;
            pending = null;
            pendingName = '';
            if (auto) walked.fill(0);
            lapDue = false;
            laps = 0;
            say(`automatic traversal · ${auto ? 'on' : 'off'}`);
            break;
          case 6:
            // Scrubbing leaves you mid-edge; this puts you back on a corner
            // exactly, which is the only place a branch change is allowed.
            t = mod5(Math.round(mod(t) / STEP)) * STEP;
            lastVertex = vertexAtSlot(branch, Math.round(mod(t) / STEP));
            vertexFlash = 1;
            say(`snapped to V${lastVertex}`);
            break;
          default:
            readout = (readout + 1) % READOUTS.length;
            say(`readout · ${READOUTS[readout]}`);
            break;
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }

      // The θ and φ knobs are absolute sliders. Whichever one you move, the
      // other angle follows: there is only ever one number to set, and moving
      // either knob projects your request onto the branch you are standing on.
      if (knobWas[1] < 0) for (let i = 0; i < knobWas.length; i++) knobWas[i] = midi.knobs[i];
      const scrubbed = Math.abs(midi.knobs[1] - knobWas[1]) > 0.003
        ? 1
        : Math.abs(midi.knobs[2] - knobWas[2]) > 0.003
          ? 2
          : 0;
      if (scrubbed === 1) {
        t = nearestRoot(clamp(midi.knobs[1]) * TAU, branch === 'A' ? 1 : 2, t);
      } else if (scrubbed === 2) {
        t = nearestRoot(clamp(midi.knobs[2]) * TAU, branch === 'A' ? 3 : 1, t);
      }
      if (scrubbed && !held) {
        held = true;
        say('held · scrubbing');
      }
      for (let i = 0; i < knobWas.length; i++) knobWas[i] = midi.knobs[i];

      /* ------------------------------------------------------------ step */

      if (!held && !scrubbed) advance(speed * dt);

      const { theta, phi } = anglesOf(branch, t);
      const rA = residual(phi, 3 * theta);
      const rB = residual(theta, 2 * phi);
      const slot = currentSlot();
      const active = edgeIndex(branch, slot);
      const u = progress();
      const edge = EDGES[active];

      vertexFlash = approach(vertexFlash, 0, 0.22, dt);
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      trail.unshift({ theta, phi, age: 0 });
      for (const s of trail) s.age += dt;
      while (trail.length > 0 && (trail[trail.length - 1].age > trailSeconds || trail.length > 360)) {
        trail.pop();
      }

      /* ---------------------------------------------------------- layout */

      const margin = Math.min(width, height) * 0.045 + 6;
      // The page floats a control bar over the top of the stage and the knobs
      // and pads across the bottom, so the drawing keeps out of both.
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);
      const plotX = margin;
      const plotY = top;
      const plotW = Math.max(160, width - margin * 2);
      const plotH = Math.max(120, height - top - footer);
      const type = clamp(Math.min(width, height) * 0.026, 9, 16);

      const sideBySide = plotW / plotH > 1.15;
      const mech = sideBySide
        ? { x: plotX, y: plotY, w: plotW * split, h: plotH }
        : { x: plotX, y: plotY, w: plotW, h: plotH * split };
      const graph = sideBySide
        ? { x: plotX + mech.w, y: plotY, w: plotW - mech.w, h: plotH }
        : { x: plotX, y: plotY + mech.h, w: plotW, h: plotH - mech.h };

      /* ------------------------------------------------------ background */

      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, hsl(HUE_A, 34, 8));
      sky.addColorStop(0.5, '#04050a');
      sky.addColorStop(1, hsl(HUE_B + 300, 26, 6));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(148, 163, 200, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (sideBySide) {
        ctx.moveTo(Math.round(graph.x) + 0.5, plotY + type);
        ctx.lineTo(Math.round(graph.x) + 0.5, plotY + plotH - type);
      } else {
        ctx.moveTo(plotX + type, Math.round(graph.y) + 0.5);
        ctx.lineTo(plotX + plotW - type, Math.round(graph.y) + 0.5);
      }
      ctx.stroke();

      const caption = (text: string, x: number, y: number, color: string): void => {
        ctx.font = `500 ${type * 0.68}px ${MONO}`;
        setTracking(ctx, '0.28em');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = color;
        ctx.fillText(text.toUpperCase(), x, y);
        setTracking(ctx, '0em');
      };

      /* ------------------------------------------------------- mechanism */

      // The readout takes the foot of the mechanism panel; the linkage gets
      // the rest of it, centred in what is left.
      // A short panel cannot hold the whole block and the linkage too, so it
      // keeps the two residuals and drops the rest.
      const fullReadout = readout === 0 && mech.h > type * 20;
      const readoutH = readout === 2 ? 0 : fullReadout ? type * 8.1 : type * 3.2;
      const roomH = Math.max(60, mech.h - readoutH - type * 1.8);
      const ox = mech.x + mech.w * 0.5;
      const oy = mech.y + type * 1.8 + roomH * 0.5;
      // Room outside the circle for the joint names, and for the ghost names
      // in the ring inside them.
      const labelPad = type * (rayInk > 0.02 ? 2.5 : 1.6);
      const R = Math.max(
        24,
        Math.min(mech.w * 0.5 - labelPad - type, roomH * 0.5 - labelPad),
      );
      const at = (angle: number, r: number): [number, number] => [
        ox + Math.cos(angle) * r,
        // Canvas y runs down; negate so angles read anticlockwise as written.
        oy - Math.sin(angle) * r,
      ];

      caption('mechanism', mech.x + type, mech.y, '#5b6784');

      // The unit circle both crank tips are stuck on.
      ctx.strokeStyle = 'rgba(148, 163, 200, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      // The fixed base rod: the horizontal the angles are measured from.
      ctx.strokeStyle = 'rgba(148, 163, 200, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ox - R * 1.3, oy);
      ctx.lineTo(ox + R * 1.3, oy);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(148, 163, 200, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -R * 1.3; x < R * 1.3; x += 9) {
        ctx.moveTo(ox + x, oy + 1);
        ctx.lineTo(ox + x - 6, oy + 8);
      }
      ctx.stroke();

      // Tip trails: where the two cranks have just been.
      if (trailSeconds > 0.01) {
        for (const s of trail) {
          const a = clamp(1 - s.age / trailSeconds) * 0.5;
          if (a <= 0.01) continue;
          for (const [angle, hue] of [
            [s.theta, HUE_A],
            [s.phi, HUE_B],
          ] as const) {
            const [tx, ty] = at(angle, R);
            ctx.fillStyle = hsl(hue, 80, 66, a * 0.5);
            ctx.fillRect(tx - 1, ty - 1, 2, 2);
          }
        }
      }

      // The derived rays. On A the third power of W is Z; on B the square of Z
      // is W. Whichever branch you are on, one ghost is sitting on a real crank.
      if (rayInk > 0.02) {
        const ghosts: Array<[string, number, number]> = [
          ['W²', 2 * theta, HUE_A],
          ['W³', 3 * theta, HUE_A],
          ['Z²', 2 * phi, HUE_B],
        ];
        for (const [name, angle, hue] of ghosts) {
          const [gx, gy] = at(angle, R);
          ctx.strokeStyle = hsl(hue, 60, 62, 0.35 * rayInk);
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(gx, gy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(gx, gy, 3.2, 0, TAU);
          ctx.strokeStyle = hsl(hue, 70, 74, 0.8 * rayInk);
          ctx.stroke();
          if (R > 54) {
            const [lx, ly] = at(angle, R + type * 0.95);
            ctx.font = `400 ${type * 0.72}px ${MONO}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = hsl(hue, 55, 72, 0.7 * rayInk);
            ctx.fillText(name, lx, ly);
          }
        }

        // Ring the coincidence the current branch is defined by: on A the ghost
        // W³ is sitting on Z, on B the ghost Z² is sitting on W.
        const [cx, cy] = at(branch === 'A' ? phi : theta, R);
        ctx.strokeStyle = hsl(branch === 'A' ? HUE_A : HUE_B, 85, 76, 0.9 * rayInk);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 11 + Math.sin(time * 3) * 1.4, 0, TAU);
        ctx.stroke();
      }

      // Angle arcs off the base rod.
      for (const [angle, hue, r] of [
        [theta, HUE_A, R * 0.3],
        [phi, HUE_B, R * 0.42],
      ] as const) {
        ctx.strokeStyle = hsl(hue, 70, 62, 0.45);
        ctx.lineWidth = 1.4;
        // Angles run anticlockwise from the rod; canvas y runs down, so the
        // sweep is drawn from −angle up to zero.
        ctx.beginPath();
        ctx.arc(ox, oy, r, -angle, 0);
        ctx.stroke();
      }

      // The two cranks.
      for (const [name, angle, hue] of [
        ['W', theta, HUE_A],
        ['Z', phi, HUE_B],
      ] as const) {
        const [wx, wy] = at(angle, R);
        ctx.strokeStyle = hsl(hue, 78, 60, 0.95);
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.shadowColor = hsl(hue, 90, 55, 0.6);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(wx, wy);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = hsl(hue, 80, 74);
        ctx.beginPath();
        ctx.arc(wx, wy, 5.5, 0, TAU);
        ctx.fill();
        if (R > 50) {
          const [lx, ly] = at(angle, R + type * (rayInk > 0.02 ? 1.95 : 1.1));
          ctx.font = `600 ${type * 0.9}px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = hsl(hue, 70, 82, 0.95);
          ctx.fillText(name, lx, ly);
        }
      }
      ctx.lineCap = 'butt';

      // The pivot.
      ctx.fillStyle = '#0b0e16';
      ctx.strokeStyle = 'rgba(200, 214, 245, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, 6, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (R > 50) {
        ctx.font = `500 ${type * 0.8}px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(200, 214, 245, 0.6)';
        ctx.fillText('O', ox - 9, oy + 4);
      }

      /* ------------------------------------------- configuration space */

      caption('configuration space · K₅', graph.x + type, graph.y, '#5b6784');

      const gx0 = graph.x + graph.w * 0.5;
      const gy0 = graph.y + graph.h * 0.52;
      const GR = Math.max(20, Math.min(graph.w * 0.36, graph.h * 0.34));

      // Two readable drawings of the same graph: at 0 the A edges are the
      // pentagon and the B edges the star, at 1 they change places. Neither is
      // planar, so either way five pairs of edges have to cross.
      const slotOf = (k: number): number => lerp(k, mod5(3 * k), layout);
      const nodes = Array.from({ length: N }, (_, k) => {
        const a = -Math.PI / 2 + (TAU * slotOf(k)) / N;
        return { x: gx0 + Math.cos(a) * GR, y: gy0 + Math.sin(a) * GR };
      });

      const ends = EDGES.map((e) => ({ a: nodes[e.startVertex], b: nodes[e.endVertex] }));
      /** Where each edge has to duck under another, as fractions along itself. */
      const ducks: number[][] = EDGES.map(() => []);
      for (let i = 0; i < EDGES.length; i++) {
        for (let j = i + 1; j < EDGES.length; j++) {
          const e = EDGES[i];
          const f = EDGES[j];
          const shared =
            e.startVertex === f.startVertex ||
            e.startVertex === f.endVertex ||
            e.endVertex === f.startVertex ||
            e.endVertex === f.endVertex;
          if (shared) continue;
          const p = ends[i].a;
          const q = ends[i].b;
          const r = ends[j].a;
          const s = ends[j].b;
          const den = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
          if (Math.abs(den) < 1e-6) continue;
          const ua = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / den;
          const ub = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / den;
          if (ua <= 0.02 || ua >= 0.98 || ub <= 0.02 || ub >= 0.98) continue;
          // A goes over B, and within a branch the earlier edge goes over. The
          // one underneath takes the gap, so a crossing can never read as a
          // corner: nothing joins there.
          const aOver = EDGES[i].branch === 'A' && EDGES[j].branch === 'B';
          const bOver = EDGES[i].branch === 'B' && EDGES[j].branch === 'A';
          const under = aOver ? j : bOver ? i : j;
          ducks[under].push(under === i ? ua : ub);
        }
      }

      /** Draw a length of edge from `from` to `to` along it, minus its ducks. */
      const runEdge = (i: number, from: number, to: number): void => {
        const { a, b } = ends[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const gap = length > 0 ? gapPx / length : 0;
        const cuts = ducks[i]
          .filter((d) => d > from - gap && d < to + gap)
          .sort((p, q) => p - q);
        let start = from;
        ctx.beginPath();
        for (const cut of cuts) {
          const stop = Math.max(from, cut - gap);
          if (stop > start) {
            ctx.moveTo(lerp(a.x, b.x, start), lerp(a.y, b.y, start));
            ctx.lineTo(lerp(a.x, b.x, stop), lerp(a.y, b.y, stop));
          }
          start = Math.max(start, Math.min(to, cut + gap));
        }
        if (to > start) {
          ctx.moveTo(lerp(a.x, b.x, start), lerp(a.y, b.y, start));
          ctx.lineTo(lerp(a.x, b.x, to), lerp(a.y, b.y, to));
        }
        ctx.stroke();
      };

      for (let i = 0; i < EDGES.length; i++) {
        const hue = EDGES[i].branch === 'A' ? HUE_A : HUE_B;
        const lit = walked[i] > 0;
        ctx.strokeStyle = hsl(hue, lit ? 60 : 32, lit ? 52 : 34, i === active ? 0.45 : lit ? 0.7 : 0.4);
        ctx.lineWidth = i === active ? 3.5 : 2;
        runEdge(i, 0, 1);
      }

      // The stretch of the active edge already covered, drawn from the corner
      // we left rather than from the edge's own start: the walk can run either
      // way along an edge.
      const back = dir > 0 ? 0 : 1;
      const hueNow = branch === 'A' ? HUE_A : HUE_B;
      ctx.strokeStyle = hsl(hueNow, 85, 66, 0.95);
      ctx.lineWidth = 4;
      ctx.shadowColor = hsl(hueNow, 90, 60, 0.7);
      ctx.shadowBlur = 10;
      runEdge(active, Math.min(back, u), Math.max(back, u));
      ctx.shadowBlur = 0;

      // The queued choice: the edge the marker will take when it gets there.
      if (pending) {
        const ahead = vertexAtSlot(branch, dir > 0 ? slot + 1 : slot);
        const next = edgeAfter(ahead, pending);
        ctx.strokeStyle = hsl(EDGES[next].branch === 'A' ? HUE_A : HUE_B, 90, 74,
          0.5 + Math.sin(time * 7) * 0.25);
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        runEdge(next, 0, 1);
        ctx.setLineDash([]);
      }

      // Corners. These are the only points where two branches actually meet;
      // everything else that looks like a junction is one edge passing another.
      for (let k = 0; k < N; k++) {
        const n = nodes[k];
        const here = k === lastVertex ? vertexFlash : 0;
        const nodeR = GR * 0.075 + 4 + here * 3;
        ctx.fillStyle = '#080b12';
        ctx.strokeStyle = hsl(60, 20, 90, 0.5 + here * 0.5);
        ctx.lineWidth = 1.5 + here * 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, nodeR, 0, TAU);
        ctx.fill();
        ctx.stroke();
        if (GR > 44) {
          ctx.font = `600 ${type * 0.72}px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = hsl(60, 20, 92, 0.8 + here * 0.2);
          ctx.fillText(`${k}`, n.x, n.y);
        }
        if (GR > 62) {
          // Both crank angles at this corner, in fifths of a turn. Corners out
          // to the side get the caption beside them rather than over them.
          const away = Math.atan2(n.y - gy0, n.x - gx0);
          const ax = Math.cos(away);
          const ay = Math.sin(away);
          const beside = Math.abs(ax) > 0.55;
          ctx.font = `400 ${type * 0.62}px ${MONO}`;
          ctx.textAlign = beside ? (ax > 0 ? 'left' : 'right') : 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(148, 163, 200, 0.55)';
          const out = nodeR + (beside ? 5 : type * 1.05);
          ctx.fillText(`${k}/5 ${mod5(3 * k)}/5`, n.x + ax * out, n.y + ay * out);
        }
      }

      // The marker.
      const mk = ends[active];
      const mx = lerp(mk.a.x, mk.b.x, u);
      const my = lerp(mk.a.y, mk.b.y, u);
      ctx.fillStyle = hsl(hueNow, 90, 78);
      ctx.shadowColor = hsl(hueNow, 95, 62, 0.9);
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (GR > 44) {
        ctx.font = `500 ${type * 0.66}px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = hsl(HUE_A, 60, 70, 0.85);
        ctx.fillText('A  φ = 3θ', graph.x + type, graph.y + graph.h - type * 2.6);
        ctx.fillStyle = hsl(HUE_B, 60, 70, 0.85);
        ctx.fillText('B  θ = 2φ', graph.x + type, graph.y + graph.h - type * 1.4);
        if (GR > 62) {
          ctx.fillStyle = 'rgba(148, 163, 200, 0.55)';
          ctx.fillText('corners: θ φ in fifths of a turn', graph.x + type, graph.y + graph.h - type * 0.2);
        }
      }

      /* --------------------------------------------------------- readout */

      if (readout !== 2) {
        const px = mech.x + type;
        let py = mech.y + mech.h - readoutH;
        const line = (text: string, color: string, weight = 400, size = 0.82): void => {
          ctx.font = `${weight} ${type * size}px ${MONO}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillStyle = color;
          ctx.fillText(text, px, py);
          py += type * 1.32;
        };
        const deg = (a: number): string => `${((a * 180) / Math.PI).toFixed(1).padStart(6)}°`;

        if (fullReadout) {
          line(
            `branch ${branch} · ${branch === 'A' ? 'φ = 3θ' : 'θ = 2φ'} · ${dir > 0 ? 'forward' : 'reverse'}` +
              `${held ? ' · held' : ''}${auto ? ' · auto' : ''}`,
            hsl(hueNow, 65, 78, 0.95),
            600,
          );
          line(
            `edge ${edge.branch} ${edge.startVertex}→${edge.endVertex}   ${(u * 100)
              .toFixed(0)
              .padStart(3)}%   walked ${walked.filter((w) => w > 0).length}/10`,
            '#94a3c8',
          );
          line(`θ ${deg(theta)}   φ ${deg(phi)}   t ${(t / TAU).toFixed(3)}·2π`, '#c8d4f0');
        }
        line(`rA |e^iφ − e^3iθ|  ${rA.toFixed(6)}`, hsl(HUE_A, 55, rA < 1e-9 ? 78 : 58, 0.9));
        line(`rB |e^iθ − e^2iφ|  ${rB.toFixed(6)}`, hsl(HUE_B, 55, rB < 1e-9 ? 78 : 58, 0.9));
        if (fullReadout && pendingName) {
          line(`next corner · ${pendingName}`, hsl(50, 70, 76, 0.9), 500);
        }
      }

      /* ------------------------------------------------------------ toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = `500 ${type * 0.76}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = hsl(50, 60, 80, a);
        ctx.fillText(toast.toUpperCase(), plotX + plotW, plotY + plotH);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hsl(hueNow, 80, 60, padFlash * 0.06);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };
};

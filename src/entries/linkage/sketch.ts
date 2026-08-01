import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, mulberry32, range } from '../../screensaver/util';
import type { Mechanism, Trace } from './mechanism';
import {
  checkTrace,
  configDistance,
  motionSpeed,
  pinArrangement,
  pinPoints,
  pointOn,
  rebase,
  reverseTrace,
  sampleMechanism,
  startTrace,
  stepTrace,
} from './mechanism';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/** Odd, because a mechanism needs (3n − 1)/2 pins and that has to be a whole number. */
export const ROD_COUNTS = [3, 5, 7];
export const CAMERAS = ['whole motion', 'chase', 'frozen'];
export const MARKERS = ['pins and ground', 'pins only', 'none'];
export const READOUTS = ['full', 'short', 'off'];

/** The radius the rods are sampled in. Everything else is measured in these units. */
const WORLD = 1;
/** Furthest any pinned point is allowed to travel in a single continuation step. */
const MAX_MOVE = 0.02 * WORLD;
/** Longest step in configuration space, for the moments when every pin is nearly still. */
const MAX_H = 0.12;
const MAX_STEPS_PER_FRAME = 24;
/** Steps between full singular value checks — the only place a singularity is caught. */
const CHECK_EVERY = 24;
const TRAIL_CAP = 2400;
const GHOST_CAP = 260;
/** Two configurations this close, in world units, count as the same one. */
const CLOSE_ENOUGH = 0.01 * WORLD;
/** Steps walked when sizing up a candidate, and the joint swing it has to show. */
const SCOUT_STEPS = 150;
const MIN_SWING = 0.06;
/** Travel assumed for a lap before one has been measured. */
const LAP_GUESS = 8 * WORLD;
/** Shortest stretch of a rod drawn bright, however close together its pins are. */
const MIN_SPAN = 0.12 * WORLD;

interface Trail {
  xs: Float64Array;
  ys: Float64Array;
  head: number;
  count: number;
}

const makeTrail = (): Trail => ({
  xs: new Float64Array(TRAIL_CAP),
  ys: new Float64Array(TRAIL_CAP),
  head: 0,
  count: 0,
});

const pushTrail = (trail: Trail, x: number, y: number): void => {
  trail.xs[trail.head] = x;
  trail.ys[trail.head] = y;
  trail.head = (trail.head + 1) % TRAIL_CAP;
  if (trail.count < TRAIL_CAP) trail.count++;
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

const swallow = (box: Box, x: number, y: number): void => {
  if (x < box.x0) box.x0 = x;
  if (y < box.y0) box.y0 = y;
  if (x > box.x1) box.x1 = x;
  if (y > box.y1) box.y1 = y;
};

/** Liang-Barsky: trim a segment to the drawing rectangle, or report that it misses. */
function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: Box,
  out: Float64Array,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q =
      edge === 0
        ? ax - rect.x0
        : edge === 1
          ? rect.x1 - ax
          : edge === 2
            ? ay - rect.y0
            : rect.y1 - ay;
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  out[0] = ax + t0 * dx;
  out[1] = ay + t0 * dy;
  out[2] = ax + t1 * dx;
  out[3] = ay + t1 * dy;
  return true;
}

/**
 * Random lines, pinned together until only one motion is left, and then that
 * motion followed around its loop.
 *
 * The pins are chosen by rank: a proposal is kept only when its two equations
 * are independent of every equation already accepted, so each one takes two
 * degrees of freedom away and the arrangement is still a solution afterwards.
 * Stopping at rank 3n − 1 leaves exactly one. From there the picture is pure
 * continuation — find the nullspace of the Jacobian, step along it, project
 * back onto the constraints, repeat — so what you are watching is a curve in
 * a nine- to twenty-one-dimensional space, drawn as the rods it stands for.
 */
export const createLinkage: SketchFactory = (): Sketch => {
  let mech: Mechanism | null = null;
  let trace: Trace | null = null;
  /** Lowest and highest material coordinate pinned on each rod — fixed for its life. */
  let rodSpan = new Float64Array(0);
  let trails: Trail[] = [];
  let ghosts: Float64Array[] = [];
  let ghostHead = 0;

  let seed = 1;
  let rodCount = 5;
  let groundBias = 0.5;
  let camera = 0;
  let markers = 0;
  let readout = 0;
  let showTrails = true;
  let showGhosts = true;

  let sinceTrail = 0;
  let sinceGhost = 0;
  let sinceCheck = 0;
  /** Travel since the trace left q0, and how much a whole lap turned out to be. */
  let travel = 0;
  let lapTravel = 0;
  let laps = 0;
  let stalls = 0;
  let rate = 0;
  /** Set once the trace is clear of q0, so coming back counts as a lap. */
  let leftStart = false;

  const seen = emptyBox();
  const view = { cx: 0, cy: 0, halfX: WORLD, halfY: WORLD };
  let viewFresh = true;

  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  const say = (text: string): void => {
    toast = text;
    toastAge = 0;
  };

  const resetRecording = (): void => {
    trails = [];
    ghosts = [];
    ghostHead = 0;
    sinceTrail = 0;
    sinceGhost = 0;
    sinceCheck = 0;
    travel = 0;
    lapTravel = 0;
    laps = 0;
    leftStart = false;
    if (mech) for (let i = 0; i < mech.pins.length; i++) trails.push(makeTrail());
    seen.x0 = Infinity;
    seen.y0 = Infinity;
    seen.x1 = -Infinity;
    seen.y1 = -Infinity;
  };

  const indexRods = (m: Mechanism): void => {
    rodSpan = new Float64Array(m.n * 2);
    for (let i = 0; i < m.n; i++) {
      rodSpan[i * 2] = Infinity;
      rodSpan[i * 2 + 1] = -Infinity;
    }
    const note = (rod: number, u: number): void => {
      if (u < rodSpan[rod * 2]) rodSpan[rod * 2] = u;
      if (u > rodSpan[rod * 2 + 1]) rodSpan[rod * 2 + 1] = u;
    };
    for (const pin of m.pins) {
      note(pin.i, pin.u);
      if (pin.j >= 0) note(pin.j, pin.v);
    }
    // Two pins almost on top of each other would leave nothing to see, so
    // every rod gets at least a stub of bright line.
    for (let i = 0; i < m.n; i++) {
      const short = MIN_SPAN - (rodSpan[i * 2 + 1] - rodSpan[i * 2]);
      if (short > 0) {
        rodSpan[i * 2] -= short / 2;
        rodSpan[i * 2 + 1] += short / 2;
      }
    }
  };

  /**
   * Walk a candidate a little way and report how far its joints swing, as a
   * fraction of the size of the whole thing. Some one-degree-of-freedom
   * mechanisms are all but rigid — legal, but nothing to look at — and this is
   * what tells them apart without solving anything.
   */
  const scout = (m: Mechanism, tr: Trace): number => {
    const start = pinPoints(m, m.q0, []);
    const box = emptyBox();
    for (const p of start) swallow(box, p.x, p.y);
    const extent = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    if (!(extent > 0)) return 0;

    const now: typeof start = [];
    let swing = 0;
    for (let k = 0; k < SCOUT_STEPS; k++) {
      const speed = Math.max(motionSpeed(m, tr.q, tr.t), 1e-9);
      if (stepTrace(tr, Math.min(MAX_MOVE / speed, MAX_H)) !== 'ok') break;
      pinPoints(m, tr.q, now);
      for (let i = 0; i < now.length; i++) {
        swing = Math.max(swing, Math.hypot(now[i].x - start[i].x, now[i].y - start[i].y));
      }
    }
    return swing / extent;
  };

  /** Build a mechanism, either from scratch or by re-pinning where the rods stand. */
  const build = (mode: 'fresh' | 'repin'): boolean => {
    const from = mode === 'repin' && mech && trace ? rebase(mech, trace.q) : null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const rand = mulberry32(seed++ * 2654435761);
      const next =
        from && attempt < 20
          ? pinArrangement(rand, rodCount, from, WORLD, groundBias)
          : sampleMechanism(rand, rodCount, WORLD, groundBias);
      if (!next) continue;
      let nextTrace = startTrace(next);
      if (!nextTrace) continue;
      if (scout(next, nextTrace) < MIN_SWING) continue;
      // The scout walked it off the starting configuration; wind it back.
      nextTrace = startTrace(next);
      if (!nextTrace) continue;
      mech = next;
      trace = nextTrace;
      indexRods(next);
      resetRecording();
      viewFresh = viewFresh || mode === 'fresh';
      return true;
    }
    return false;
  };

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      /* -------------------------------------------------------- controls */

      const knobs = midi.knobs;
      groundBias = range(knobs[2], 0.15, 0.85);
      const wanted = ROD_COUNTS[Math.min(ROD_COUNTS.length - 1, Math.floor(knobs[1] * ROD_COUNTS.length))];
      if (wanted !== rodCount) {
        rodCount = wanted;
        mech = null;
      }
      if (!mech || !trace) {
        build('fresh');
        if (!mech || !trace) return;
      }

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
            build('fresh');
            say(`new arrangement · ${rodCount} rods`);
            break;
          case 1:
            reverseTrace(trace);
            travel = 0;
            leftStart = false;
            say('reversed');
            break;
          case 2:
            if (build('repin')) say('re-pinned where it stands');
            break;
          case 3:
            showTrails = !showTrails;
            say(`trails · ${showTrails ? 'on' : 'off'}`);
            break;
          case 4:
            showGhosts = !showGhosts;
            say(`ghosts · ${showGhosts ? 'on' : 'off'}`);
            break;
          case 5:
            markers = (markers + 1) % MARKERS.length;
            say(`markers · ${MARKERS[markers]}`);
            break;
          case 6:
            camera = (camera + 1) % CAMERAS.length;
            say(`camera · ${CAMERAS[camera]}`);
            break;
          default:
            readout = (readout + 1) % READOUTS.length;
            say(`readout · ${READOUTS[readout]}`);
            break;
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      /* ------------------------------------------------------- the motion */

      // Mechanisms differ enormously in how far anything travels in one lap —
      // twenty times over between the smallest and the largest — so the speed
      // knob asks for a lap time rather than a speed, and each one is paced by
      // the lap it turned out to have. Eased, because that lap is only known
      // after the first one has been walked.
      const lapSeconds = range(1 - knobs[0], 3, 48);
      const lapUnit = lapTravel > 0 ? lapTravel : LAP_GUESS;
      const pace = knobs[0] < 0.02 ? 0 : lapUnit / lapSeconds;
      rate = approach(rate, pace, 0.7, dt);
      // Trails and ghosts are spaced by the lap too, so a full trail is always
      // about the same fraction of the motion rather than of the world.
      const trailSpacing = lapUnit / 900;
      const ghostSpacing = lapUnit / 220;
      const scratch = { x: 0, y: 0, ground: false };
      let budget = rate * dt;
      let taken = 0;
      while (budget > 1e-9 && taken < MAX_STEPS_PER_FRAME) {
        taken++;
        const pointSpeed = Math.max(motionSpeed(mech, trace.q, trace.t), 1e-9);
        // Ask for a step that moves the fastest pin a fixed distance, which
        // keeps the picture at one speed however the mechanism is geared.
        let h = Math.min(Math.min(budget, MAX_MOVE) / pointSpeed, MAX_H);
        let result = stepTrace(trace, h);
        for (let retry = 0; result === 'stuck' && retry < 6; retry++) {
          h *= 0.35;
          result = stepTrace(trace, h);
        }
        if (result !== 'ok') {
          stalls++;
          say(result === 'singular' ? 'singular — new arrangement' : 'projection failed — new arrangement');
          build('fresh');
          break;
        }

        const moved = h * pointSpeed;
        budget -= moved;
        travel += moved;
        sinceTrail += moved;
        sinceGhost += moved;

        if (sinceTrail >= trailSpacing) {
          sinceTrail = 0;
          for (let k = 0; k < mech.pins.length; k++) {
            const pin = mech.pins[k];
            pointOn(trace.q, pin.i, pin.u, scratch);
            pushTrail(trails[k], scratch.x, scratch.y);
          }
        }
        if (sinceGhost >= ghostSpacing) {
          sinceGhost = 0;
          if (ghosts.length < GHOST_CAP) ghosts.push(Float64Array.from(trace.q));
          else {
            ghosts[ghostHead].set(trace.q);
            ghostHead = (ghostHead + 1) % GHOST_CAP;
          }
        }

        sinceCheck++;
        if (sinceCheck >= CHECK_EVERY) {
          sinceCheck = 0;
          if (checkTrace(trace) !== 1) {
            stalls++;
            say('singular — new arrangement');
            build('fresh');
            break;
          }
        }
        // Angles are never wrapped, so a lap can come back a full turn away
        // from where it started; the distance knows that is the same place.
        const home = configDistance(mech, trace.q, mech.q0);
        if (!leftStart) leftStart = home > 4 * CLOSE_ENOUGH;
        else if (home < CLOSE_ENOUGH) {
          lapTravel = travel;
          travel = 0;
          laps++;
          leftStart = false;
        }
      }

      /* --------------------------------------------------------- geometry */

      const pinX = new Float64Array(mech.pins.length);
      const pinY = new Float64Array(mech.pins.length);
      const frame = emptyBox();
      for (let k = 0; k < mech.pins.length; k++) {
        const pin = mech.pins[k];
        pointOn(trace.q, pin.i, pin.u, scratch);
        pinX[k] = scratch.x;
        pinY[k] = scratch.y;
        swallow(frame, scratch.x, scratch.y);
        swallow(seen, scratch.x, scratch.y);
      }

      /* ----------------------------------------------------------- camera */

      const margin = Math.min(width, height) * 0.045 + 6;
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);
      const plot: Box = {
        x0: margin,
        y0: top,
        x1: Math.max(margin + 60, width - margin),
        y1: Math.max(top + 60, height - footer),
      };
      const plotW = plot.x1 - plot.x0;
      const plotH = plot.y1 - plot.y0;
      // The stage is much wider than it is tall and the mechanism is roughly
      // square, so on a wide frame the readout takes a column of its own and
      // the drawing centres itself in what is left.
      const wide = plotW - plotH > 260;
      const panel = wide ? Math.min(300, plotW * 0.26) : 0;
      const stage: Box = { x0: plot.x0 + panel, y0: plot.y0, x1: plot.x1, y1: plot.y1 };
      const stageW = stage.x1 - stage.x0;
      const stageH = stage.y1 - stage.y0;

      const box = camera === 1 ? frame : seen;
      if (camera !== 2) {
        const pad = 0.18 * WORLD;
        const targetCx = (box.x0 + box.x1) / 2;
        const targetCy = (box.y0 + box.y1) / 2;
        const targetHx = Math.max((box.x1 - box.x0) / 2 + pad, 0.35 * WORLD);
        const targetHy = Math.max((box.y1 - box.y0) / 2 + pad, 0.35 * WORLD);
        if (viewFresh) {
          view.cx = targetCx;
          view.cy = targetCy;
          view.halfX = targetHx;
          view.halfY = targetHy;
          viewFresh = false;
        } else {
          view.cx = approach(view.cx, targetCx, 0.6, dt);
          view.cy = approach(view.cy, targetCy, 0.6, dt);
          view.halfX = approach(view.halfX, targetHx, 0.6, dt);
          view.halfY = approach(view.halfY, targetHy, 0.6, dt);
        }
      }

      const zoom = range(knobs[3], 0.35, 1.65);
      const px = Math.min(stageW / (2 * view.halfX), stageH / (2 * view.halfY)) * 0.94 * zoom;
      const originX = stage.x0 + stageW / 2;
      const originY = stage.y0 + stageH / 2;
      const sx = (x: number): number => originX + (x - view.cx) * px;
      const sy = (y: number): number => originY - (y - view.cy) * px;

      /* ------------------------------------------------------- background */

      const baseHue = range(knobs[7], 0, 360);
      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, hsl(baseHue + 200, 26, 8));
      sky.addColorStop(0.55, '#04050a');
      sky.addColorStop(1, hsl(baseHue + 260, 22, 6));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // The background is a real object here — pins are fastened to it — so it
      // gets a grid, at whatever spacing the current zoom can carry.
      let grid = 0.25 * WORLD;
      while (grid * px < 30) grid *= 2;
      const gx0 = Math.ceil((view.cx - stageW / (2 * px)) / grid) * grid;
      const gy0 = Math.ceil((view.cy - stageH / (2 * px)) / grid) * grid;
      ctx.fillStyle = hsl(baseHue + 200, 35, 74, 0.22);
      for (let gx = gx0; sx(gx) <= stage.x1; gx += grid) {
        for (let gy = gy0; sy(gy) >= stage.y0; gy += grid) {
          ctx.fillRect(sx(gx) - 1, sy(gy) - 1, 2, 2);
        }
      }

      const rodHue = (i: number): number => baseHue + (i * 300) / mech!.n;
      const clipped = new Float64Array(4);
      /** Screen-space endpoints of rod `i` between two material coordinates. */
      const rodSegment = (q: Float64Array, i: number, uA: number, uB: number): boolean => {
        pointOn(q, i, uA, scratch);
        const ax = sx(scratch.x);
        const ay = sy(scratch.y);
        pointOn(q, i, uB, scratch);
        return clipSegment(ax, ay, sx(scratch.x), sy(scratch.y), stage, clipped);
      };

      /* ----------------------------------------------------------- ghosts */

      const ghostCount = Math.round(range(knobs[5], 0, 14));
      if (showGhosts && ghostCount > 0 && ghosts.length > 4) {
        ctx.lineWidth = 1;
        for (let g = 0; g < ghostCount; g++) {
          // Evenly spaced through everything recorded, newest excluded.
          const at = Math.floor(((g + 0.5) / ghostCount) * (ghosts.length - 1));
          const q = ghosts[(ghostHead + at) % ghosts.length];
          const fadeOut = 0.08 + 0.16 * (1 - g / ghostCount);
          for (let i = 0; i < mech.n; i++) {
            if (!rodSegment(q, i, rodSpan[i * 2], rodSpan[i * 2 + 1])) continue;
            ctx.strokeStyle = hsl(rodHue(i), 40, 70, fadeOut);
            ctx.beginPath();
            ctx.moveTo(clipped[0], clipped[1]);
            ctx.lineTo(clipped[2], clipped[3]);
            ctx.stroke();
          }
        }
      }

      /* ----------------------------------------------------------- trails */

      const keep = Math.round(range(knobs[4] * knobs[4], 0, TRAIL_CAP));
      if (showTrails && keep > 8) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < mech.pins.length; k++) {
          const pin = mech.pins[k];
          if (pin.j < 0) continue;
          const trail = trails[k];
          const total = Math.min(trail.count, keep);
          if (total < 3) continue;
          const hue = rodHue(pin.i);
          const bands = 5;
          const per = Math.ceil(total / bands);
          for (let b = 0; b < bands; b++) {
            const from = b * per;
            const to = Math.min(total, from + per + 1);
            if (to - from < 2) continue;
            const age = 1 - b / bands;
            ctx.strokeStyle = hsl(hue + 12, 80, 52, 0.1 + 0.5 * (1 - age));
            ctx.lineWidth = 1 + 1.4 * (1 - age);
            ctx.beginPath();
            for (let s = from; s < to; s++) {
              const idx = (trail.head - total + s + TRAIL_CAP * 2) % TRAIL_CAP;
              const x = sx(trail.xs[idx]);
              const y = sy(trail.ys[idx]);
              if (s === from) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      /* ------------------------------------------------------------- rods */

      const reach = range(knobs[6] * knobs[6], 0.12, 26) * WORLD;
      ctx.lineCap = 'butt';
      for (let i = 0; i < mech.n; i++) {
        const lo = rodSpan[i * 2];
        const hi = rodSpan[i * 2 + 1];
        const hue = rodHue(i);
        // The rod is an infinite line; how much of it to draw is a choice, and
        // the knob makes it, from just the pinned span to the whole frame.
        if (rodSegment(trace.q, i, lo - reach, hi + reach)) {
          ctx.strokeStyle = hsl(hue, 55, 62, 0.2);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(clipped[0], clipped[1]);
          ctx.lineTo(clipped[2], clipped[3]);
          ctx.stroke();
        }
        if (!rodSegment(trace.q, i, lo, hi)) continue;
        ctx.save();
        ctx.shadowColor = hsl(hue, 90, 60, 0.5);
        ctx.shadowBlur = 10;
        ctx.strokeStyle = hsl(hue, 70, 66, 0.95);
        ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.006);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(clipped[0], clipped[1]);
        ctx.lineTo(clipped[2], clipped[3]);
        ctx.stroke();
        ctx.restore();
      }

      /* ------------------------------------------------------------- pins */

      if (markers !== 2) {
        const r = clamp(Math.min(width, height) * 0.008, 3, 8);
        for (let k = 0; k < mech.pins.length; k++) {
          const pin = mech.pins[k];
          const x = sx(pinX[k]);
          const y = sy(pinY[k]);
          if (x < stage.x0 - 20 || x > stage.x1 + 20 || y < stage.y0 - 20 || y > stage.y1 + 20)
            continue;
          const hue = rodHue(pin.i);
          if (pin.j < 0) {
            if (markers !== 0) continue;
            // A pin to the background, drawn the way a fixed support is drawn.
            ctx.fillStyle = hsl(hue, 20, 88, 0.92);
            ctx.fillRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
            ctx.strokeStyle = hsl(hue, 30, 70, 0.7);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let t = -1; t <= 1; t++) {
              ctx.moveTo(x + t * r * 0.8, y + r * 0.8);
              ctx.lineTo(x + t * r * 0.8 - r * 0.7, y + r * 1.9);
            }
            ctx.moveTo(x - r * 1.3, y + r * 0.8);
            ctx.lineTo(x + r * 1.3, y + r * 0.8);
            ctx.stroke();
          } else {
            ctx.fillStyle = hsl(hue, 60, 16, 0.95);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
            ctx.strokeStyle = hsl(hue, 80, 78, 0.95);
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.fillStyle = hsl(hue, 80, 82, 0.95);
            ctx.beginPath();
            ctx.arc(x, y, r * 0.32, 0, TAU);
            ctx.fill();
          }
        }
      }

      /* ---------------------------------------------------------- readout */

      const type = clamp(Math.min(width, height) * 0.026, 9, 15);
      if (readout !== 2) {
        const grounded = mech.pins.filter((p) => p.j < 0).length;
        const cols = mech.n * 3;
        const free = cols - mech.rank;
        const lines = [
          `${mech.n} RODS · ${mech.pins.length} PINS`,
          `${grounded} OF THEM TO GROUND`,
          `RANK J ${mech.rank} OF ${cols}`,
          `${free} DEGREE${free === 1 ? '' : 'S'} OF FREEDOM`,
        ];
        if (readout === 0) {
          lines.push(
            '',
            `σ ${trace.sigmaMin.toExponential(1)} … ${trace.sigmaMax.toExponential(1)}`,
            `STEP ${trace.steps.toLocaleString('en-GB')}`,
            lapTravel > 0
              ? `LAP ${lapTravel.toFixed(1)} · ROUND ${laps + 1} · ${(100 * clamp(travel / lapTravel)).toFixed(0)}%`
              : `TRAVELLED ${travel.toFixed(2)}`,
          );
          if (stalls > 0) lines.push(`${stalls} RESTART${stalls === 1 ? '' : 'S'}`);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        setTracking(ctx, '0.16em');
        ctx.font = `500 ${type}px ${MONO}`;
        // The column is narrow when the frame is wide; shrink to fit it rather
        // than run the numbers out over the drawing.
        let widest = 0;
        for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
        const room = wide ? panel - type : stageW;
        const size = widest > room ? Math.max(8, (type * room) / widest) : type;
        ctx.font = `500 ${size}px ${MONO}`;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillStyle = i === 3 ? hsl(baseHue + 40, 55, 78, 0.92) : 'rgba(148, 163, 200, 0.72)';
          ctx.fillText(lines[i], plot.x0, plot.y0 + i * size * 1.6);
        }
        setTracking(ctx, '0em');
      }

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = `500 ${type}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = hsl(baseHue + 40, 60, 80, a);
        ctx.fillText(toast.toUpperCase(), plot.x1, plot.y1);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hsl(baseHue + 40, 80, 60, padFlash * 0.06);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // A slow breath along the bottom edge, so a paused screen still looks live.
      ctx.fillStyle = hsl(baseHue, 70, 60, 0.05 + Math.sin(time * 0.7) * 0.025);
      ctx.fillRect(stage.x0, stage.y1 - 1, stageW * (rate > 0 ? 1 : 0.25), 2);
    },
  };
};

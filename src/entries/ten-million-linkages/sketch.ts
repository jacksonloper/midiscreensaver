import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, hsl, range } from '../../screensaver/util';
import { deal, opener, type Deal } from './dataset';
import { flipBranch, solve, type Mechanism } from './kinematics';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Canvas letter-spacing is Chromium-only; harmless to set anywhere else. */
const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

const nf = (n: number): string => n.toLocaleString('en-US');
const deg = (rad: number): number => ((((rad / TAU) * 360) % 360) + 360) % 360;

/** How far one pad hit inches the crank. */
const STEP = TAU / 60;
/** How long a stalled mechanism stays on screen before another is dealt. */
const STALL_HOLD = 3;
/** Left alone, the post keeps helping itself to the dataset this often. */
const IDLE_DEAL = 120;
/** Trail points kept at most; a slow crank at 60fps would otherwise grow forever. */
const TRAIL_MAX = 4000;
/** Segments the trail fade is cut into. Per-point alpha would mean per-point strokes. */
const TRAIL_CHUNKS = 20;

interface View {
  cx: number;
  cy: number;
  /** Pixels per dataset unit. */
  fit: number;
}

/**
 * One row of LINKS-10M, fetched at random and turned by its crank.
 *
 * The drawing is deliberately literal: a dot for every joint, a line for every
 * rod, a ground symbol under everything bolted down, and the path the output
 * joint is walking. What makes it move is in `kinematics.ts`.
 */
export const createTenMillionLinkages: SketchFactory = (): Sketch => {
  const first = opener();
  let mech: Mechanism = first.mechanism;
  let note: string | null = first.note;
  /** The pose on screen — only ever overwritten by a pose that solved. */
  let pose = new Float64Array(0);
  /** Where a pose is built, so a failed solve cannot leave half a mechanism up. */
  let work = new Float64Array(0);
  let solved = true;

  let pending: Deal | null = null;
  let inflight = false;
  let dealtAt = 0;
  let stalledFor = 0;

  let theta = 0;
  let direction = 1;
  let frozen = false;
  let freezeKnob = 0;

  // Triples of travelled, x, y. `travelled` is crank angle covered, so the
  // trail stays the length the knob asks for however fast the crank turns.
  const trail: number[] = [];
  let travelled = 0;

  /** Moving joints, output first: the order pad 4 walks through, then −1. */
  let traceable: number[] = [-1];
  let traceSlot = 0;
  let flipCursor = -1;
  const flipped = new Set<number>();

  let showCurve = true;
  let showGhost = false;
  let showLabels = false;

  let view: View | null = null;

  const adopt = (d: Deal, elapsed: number): void => {
    mech = d.mechanism;
    note = d.note;
    pose = new Float64Array(mech.n * 2);
    work = new Float64Array(mech.n * 2);
    theta = 0;
    solved = solve(mech, theta, pose);
    trail.length = 0;
    travelled = 0;
    stalledFor = 0;
    frozen = false;
    flipped.clear();
    flipCursor = -1;
    dealtAt = elapsed;

    const moving: number[] = [];
    for (let j = 1; j < mech.n; j++) {
      if (mech.kind[j] !== 'ground' && j !== mech.output) moving.push(j);
    }
    traceable = [mech.output, ...moving, -1];
    traceSlot = 0;
  };

  // A bundled row is on screen from the first frame; a real one is asked for
  // on the frame after that, so nobody watches a blank stage.
  adopt(first, 0);
  dealtAt = -IDLE_DEAL;

  const request = (): void => {
    if (inflight) return;
    inflight = true;
    void deal()
      .then((d) => {
        pending = d;
      })
      .finally(() => {
        inflight = false;
      });
  };

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      const [kSpeed, kZoom, kTrace, kJoint, kRod, kGlow, kHue, kHud] = midi.knobs;

      if (pending) {
        adopt(pending, time);
        pending = null;
      }
      // Idle re-deals keep the screensaver moving on, but never while someone
      // is holding the crank or picking at the assembly.
      if (time - dealtAt > IDLE_DEAL && !frozen && flipped.size === 0) request();

      /* --------------------------------------------------------------- pads */

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
            request();
            break;
          case 1:
            direction = -direction;
            trail.length = 0;
            break;
          case 2:
            // Freeze and inch forward. Touching the speed knob lets go again.
            if (!frozen) {
              frozen = true;
              freezeKnob = kSpeed;
            }
            theta += direction * STEP;
            travelled += STEP;
            break;
          case 3:
            traceSlot = (traceSlot + 1) % traceable.length;
            trail.length = 0;
            break;
          case 4:
            showCurve = !showCurve;
            break;
          case 5:
            showGhost = !showGhost;
            break;
          case 6:
            showLabels = !showLabels;
            break;
          case 7:
            if (mech.steps.length > 0) {
              flipCursor = (flipCursor + 1) % mech.steps.length;
              flipBranch(mech, flipCursor);
              if (flipped.has(flipCursor)) flipped.delete(flipCursor);
              else flipped.add(flipCursor);
              trail.length = 0;
              solved = solve(mech, theta, pose);
            }
            break;
        }
      }
      if (frozen && Math.abs(kSpeed - freezeKnob) > 0.02) frozen = false;

      /* -------------------------------------------------------------- crank */

      // A dead zone at the bottom of the knob so the crank can be parked.
      const rpm =
        kSpeed < 0.03
          ? 0
          : Math.exp(Math.log(1.5) + ((kSpeed - 0.03) / 0.97) * Math.log(180 / 1.5));
      if (!frozen && rpm > 0) {
        const step = direction * (rpm / 60) * TAU * dt;
        theta += step;
        travelled += Math.abs(step);
      }
      theta = ((theta % TAU) + TAU) % TAU;

      solved = solve(mech, theta, work);
      if (solved) {
        pose.set(work);
        stalledFor = 0;
      } else {
        // Hold the last good pose rather than draw a half-built one, and move
        // on if the mechanism cannot get past it. A mechanism somebody has
        // been flipping branches on is theirs to sort out, so leave it alone.
        stalledFor += dt;
        trail.length = 0;
        if (stalledFor > STALL_HOLD && flipped.size === 0) request();
      }

      const traceJoint = traceable[traceSlot] ?? -1;
      if (solved && traceJoint >= 0) {
        trail.push(travelled, pose[traceJoint * 2], pose[traceJoint * 2 + 1]);
        const window = range(kTrace, 0.12, 2.4) * TAU;
        while (trail.length > 3 && travelled - trail[0] > window) trail.splice(0, 3);
        while (trail.length > TRAIL_MAX * 3) trail.splice(0, 3);
      }

      /* ------------------------------------------------------------ framing */

      const b = mech.bounds;
      const spanX = Math.max(b.maxX - b.minX, 1e-3);
      const spanY = Math.max(b.maxY - b.minY, 1e-3);
      const zoom = Math.exp(Math.log(0.55) + kZoom * Math.log(3.2 / 0.55));
      const target: View = {
        cx: (b.minX + b.maxX) / 2,
        cy: (b.minY + b.maxY) / 2,
        // Short of the full stage: the readout sits across the top of it and
        // the on-screen controller across the bottom.
        fit: Math.min((width * 0.78) / spanX, (height * 0.62) / spanY) * zoom,
      };
      view = view
        ? {
            cx: approach(view.cx, target.cx, 0.18, dt),
            cy: approach(view.cy, target.cy, 0.18, dt),
            fit: approach(view.fit, target.fit, 0.18, dt),
          }
        : target;
      const { cx, cy, fit } = view;
      const px = (x: number): number => width / 2 + (x - cx) * fit;
      const py = (y: number): number => height * 0.54 - (y - cy) * fit;

      /* ------------------------------------------------------------ drawing */

      const hueShift = (kHue - 0.5) * 170;
      const rodHue = (depth: number): number =>
        196 + (mech.maxDepth ? depth / mech.maxDepth : 0) * 118 + hueShift;
      const crankHue = 36 + hueShift * 0.3;
      const rodWidth = range(kRod, 1.2, 6.5);
      const jointR = range(kJoint, 2.4, 9);

      ctx.fillStyle = '#04050a';
      ctx.fillRect(0, 0, width, height);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (showCurve && mech.curve) {
        // Cool and dashed, so the path the row promised never reads as another
        // rod or as the trail chasing it.
        ctx.strokeStyle = hsl(202 + hueShift * 0.25, 42, 74, 0.55);
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        for (let i = 0; i < mech.curve.length; i += 2) {
          const x = px(mech.curve[i]);
          const y = py(mech.curve[i + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (showGhost) {
        ctx.strokeStyle = 'rgba(148,163,184,0.17)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < mech.rods.length; i += 2) {
          const a = mech.rods[i];
          const c = mech.rods[i + 1];
          ctx.moveTo(px(mech.start[a * 2]), py(mech.start[a * 2 + 1]));
          ctx.lineTo(px(mech.start[c * 2]), py(mech.start[c * 2 + 1]));
        }
        ctx.stroke();
      }

      if (traceJoint >= 0 && trail.length >= 6) {
        const hue = rodHue(mech.depth[traceJoint]);
        const points = trail.length / 3;
        const per = Math.max(1, Math.ceil(points / TRAIL_CHUNKS));
        ctx.lineWidth = 1.9;
        for (let start = 0; start < points - 1; start += per) {
          const end = Math.min(points - 1, start + per);
          const age = end / points; // 0 at the tail, 1 at the joint
          ctx.strokeStyle = hsl(hue, 95, 74, 0.12 + age * 0.82);
          ctx.beginPath();
          for (let i = start; i <= end; i++) {
            const x = px(trail[i * 3 + 1]);
            const y = py(trail[i * 3 + 2]);
            if (i === start) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // The circle the crank pin is confined to.
      ctx.strokeStyle = hsl(crankHue, 80, 60, 0.25);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.arc(px(mech.start[0]), py(mech.start[1]), mech.crankRadius * fit, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.save();
      if (kGlow > 0.02) {
        ctx.shadowBlur = kGlow * 22;
        ctx.shadowColor = hsl(rodHue(mech.maxDepth * 0.5), 90, 55, 0.7 * kGlow);
      }
      for (let i = 0; i < mech.rods.length; i += 2) {
        const a = mech.rods[i];
        const c = mech.rods[i + 1];
        const isCrank = (a === 0 && c === 1) || (a === 1 && c === 0);
        const depth = Math.max(mech.depth[a], mech.depth[c]);
        ctx.strokeStyle = isCrank ? hsl(crankHue, 92, 62, 0.95) : hsl(rodHue(depth), 62, 58, 0.85);
        ctx.lineWidth = isCrank ? rodWidth * 1.5 : rodWidth;
        ctx.beginPath();
        ctx.moveTo(px(pose[a * 2]), py(pose[a * 2 + 1]));
        ctx.lineTo(px(pose[c * 2]), py(pose[c * 2 + 1]));
        ctx.stroke();
      }
      ctx.restore();

      for (let j = 0; j < mech.n; j++) {
        const x = px(pose[j * 2]);
        const y = py(pose[j * 2 + 1]);

        if (mech.kind[j] === 'ground') {
          drawGround(ctx, x, y, jointR, hsl(crankHue, 30, 70, 0.75));
          continue;
        }

        const hue = j === 1 ? crankHue : rodHue(mech.depth[j]);
        if (mech.kind[j] === 'output' || j === traceJoint) {
          ctx.strokeStyle = hsl(hue, 90, 68, 0.85);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, jointR + 4.5, 0, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = hsl(hue, 78, 66, 1);
        ctx.beginPath();
        ctx.arc(x, y, jointR, 0, TAU);
        ctx.fill();
        // A dark pupil, so a pin joint reads as a hole rather than a bead.
        ctx.fillStyle = '#04050a';
        ctx.beginPath();
        ctx.arc(x, y, jointR * 0.38, 0, TAU);
        ctx.fill();
      }

      if (showLabels) {
        ctx.font = `500 9.5px ${MONO}`;
        setTracking(ctx, '0.08em');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let j = 0; j < mech.n; j++) {
          ctx.fillStyle =
            mech.kind[j] === 'ground'
              ? 'rgba(203,213,225,0.75)'
              : hsl(rodHue(mech.depth[j]), 45, 78, 0.9);
          ctx.fillText(String(j), px(pose[j * 2]), py(pose[j * 2 + 1]) - jointR - 5);
        }
        setTracking(ctx, '0em');
      }

      /* ---------------------------------------------------------------- hud */

      if (kHud > 0.02) {
        drawHud(ctx, width, height, kHud, {
          mech,
          note,
          theta,
          rpm,
          frozen,
          direction,
          solved,
          traceJoint,
          flips: flipped.size,
          loading: inflight,
          flash: midi.pads[0]?.energy ?? 0,
        });
      }
    },
  };
};

/* ------------------------------------------------------------------- paint */

/** The standard fixed-pivot symbol: a triangle on a hatched bar. */
function drawGround(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
): void {
  const w = Math.max(7, r * 1.8);
  const h = w * 1.15;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - w, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - w * 1.3, y + h);
  ctx.lineTo(x + w * 1.3, y + h);
  for (let i = 0; i < 5; i++) {
    const hx = x - w * 1.3 + (i / 4) * w * 2.6;
    ctx.moveTo(hx, y + h);
    ctx.lineTo(hx - 5, y + h + 5);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, Math.max(2.2, r * 0.62), 0, TAU);
  ctx.fill();
}

interface HudState {
  mech: Mechanism;
  note: string | null;
  theta: number;
  rpm: number;
  frozen: boolean;
  direction: number;
  solved: boolean;
  traceJoint: number;
  flips: number;
  loading: boolean;
  /** Pad 1's decaying energy, so a fresh deal announces itself. */
  flash: number;
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha: number,
  s: HudState,
): void {
  const m = s.mech;
  const pad = Math.min(24, width * 0.03);
  // The page draws its own control bar across the top of the stage.
  const top = pad + 26;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = `500 9.5px ${MONO}`;
  setTracking(ctx, '0.3em');
  ctx.fillStyle = s.loading ? '#94a3b8' : '#64748b';
  ctx.fillText(
    s.loading ? 'DEALING…' : `LINKS-10M · ${nf(m.total)} ROWS · TRAIN`,
    pad,
    top,
  );

  const titleSize = Math.max(20, Math.min(40, width * 0.04));
  ctx.font = `200 ${titleSize}px ui-sans-serif, system-ui, sans-serif`;
  setTracking(ctx, '0.16em');
  ctx.fillStyle = s.flash > 0.02 ? '#f8fafc' : '#e2e8f5';
  ctx.fillText(
    m.source === 'built-in' ? 'BUILT-IN SAMPLE' : `ROW ${nf(m.index)}`,
    pad,
    top + 20,
  );

  ctx.font = `500 10.5px ${MONO}`;
  setTracking(ctx, '0em');
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `${m.n} joints · ${m.rods.length / 2} rods · ${m.ground.length} grounded · output at joint ${m.output}`,
    pad,
    top + 30 + titleSize,
  );

  const trouble =
    s.note ??
    (!s.solved
      ? `no assembly at ${deg(s.theta).toFixed(0)}° — the two circles do not meet`
      : m.stallAngle !== null
        ? `this one stalls at ${deg(m.stallAngle).toFixed(0)}° of the turn`
        : null);
  if (trouble) {
    ctx.fillStyle = '#f0a67a';
    ctx.fillText(trouble, pad, top + 48 + titleSize);
  }

  ctx.textAlign = 'right';
  const rows: [string, string][] = [
    [
      'Crank',
      s.frozen
        ? 'held'
        : s.rpm === 0
          ? 'parked'
          : `${s.direction < 0 ? '−' : '+'}${s.rpm.toFixed(s.rpm < 10 ? 1 : 0)} rpm`,
    ],
    ['Angle', `${deg(s.theta).toFixed(0)}°`],
    ['Tracing', s.traceJoint < 0 ? 'nothing' : `joint ${s.traceJoint}`],
  ];
  if (s.flips > 0) rows.push(['Branches', `${s.flips} flipped`]);

  let y = top;
  for (const [key, value] of rows) {
    ctx.font = `500 9px ${MONO}`;
    setTracking(ctx, '0.2em');
    ctx.fillStyle = '#556274';
    ctx.fillText(key.toUpperCase(), width - pad, y);
    ctx.font = `500 10.5px ${MONO}`;
    setTracking(ctx, '0em');
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(value, width - pad, y + 12);
    y += 30;
  }

  // One tick per solve step, coloured by how deep into the order it is: the
  // shape of the stored plan, at a glance.
  const ticks = m.steps.length;
  if (ticks > 0 && height > 340) {
    const barW = Math.min(width * 0.24, ticks * 9);
    const step = barW / ticks;
    const barY = height - pad - 4;
    ctx.textAlign = 'left';
    ctx.font = `500 9px ${MONO}`;
    setTracking(ctx, '0.2em');
    ctx.fillStyle = '#556274';
    ctx.fillText('SOLVE ORDER', pad, barY - 16);
    setTracking(ctx, '0em');
    for (let i = 0; i < ticks; i++) {
      const d = m.depth[m.steps[i].joint];
      ctx.fillStyle = hsl(196 + (m.maxDepth ? d / m.maxDepth : 0) * 118, 60, 60, 0.75);
      ctx.fillRect(pad + i * step, barY - 5, Math.max(2, step - 2.5), 5);
    }
  }

  ctx.restore();
}

import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, clamp, mulberry32 } from '../../screensaver/util';
import { SEEDS, type Seed } from './bodies';
import {
  AU,
  centuriesFromJd,
  elementsAt,
  jdFromMs,
  msFromJd,
  positionAt,
} from './orbits';

/* ------------------------------------------------------------------ camera */

interface Cam {
  x: number;
  y: number;
  /** Frame width in kilometres. */
  w: number;
}

interface Trip {
  t0: number;
  dur: number;
  x0: number;
  y0: number;
  /** Body to fly to, or null for the whole system. Targets move, so the
   *  destination is re-read every frame rather than frozen at take-off. */
  target: number | null;
  l0: number;
  lm: number;
  l1: number;
  pan: Float64Array;
}

const HOLD_A = 0.4;
const HOLD_B = 0.6;
const SAMPLES = 256;
const smooth = (t: number): number => t * t * (3 - 2 * t);

function widthAt(t: Trip, u: number): number {
  if (u <= HOLD_A) return Math.exp(t.l0 + (t.lm - t.l0) * smooth(u / HOLD_A));
  if (u >= HOLD_B) return Math.exp(t.lm + (t.l1 - t.lm) * smooth((u - HOLD_B) / (1 - HOLD_B)));
  return Math.exp(t.lm);
}

/**
 * Pan is handed out in proportion to how wide the frame is, so the world
 * crosses the screen at a near-constant speed instead of whipping past while
 * we are still zoomed in tight.
 */
function buildPan(t: Trip): Float64Array {
  const acc = new Float64Array(SAMPLES + 1);
  let sum = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    sum += widthAt(t, (i - 0.5) / SAMPLES);
    acc[i] = sum;
  }
  for (let i = 0; i <= SAMPLES; i++) acc[i] = sum > 0 ? acc[i] / sum : i / SAMPLES;
  return acc;
}

function panAt(t: Trip, u: number): number {
  const f = clamp(u, 0, 1) * SAMPLES;
  const i = Math.min(SAMPLES - 1, Math.floor(f));
  return t.pan[i] + (t.pan[i + 1] - t.pan[i]) * (f - i);
}

/** Frame width that fits a span across the shorter screen edge. */
const fitSpan = (span: number, w: number, h: number, fill: number): number =>
  (w * span) / (fill * Math.min(w, h));

/* ---------------------------------------------------------------- readouts */

const nf = (n: number, d = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function humanKm(km: number): string {
  if (km < 1) return `${km.toFixed(2)} km`;
  if (km < 10_000) return `${nf(km)} km`;
  if (km < 1e6) return `${nf(km / 1000, 1)} thousand km`;
  if (km < 6e7) return `${nf(km / 1e6, 2)} million km`;
  return `${nf(km / AU, 2)} AU`;
}

function niceScale(spanKm: number): { km: number; label: string } {
  const target = spanKm * 0.24;
  const units: [string, number][] = [
    ['km', 1],
    ['thousand km', 1000],
    ['million km', 1e6],
    ['AU', AU],
  ];
  let unit = units[0];
  for (const u of units) if (target / u[1] >= 1) unit = u;
  const v = target / unit[1];
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const nice = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  return { km: nice * unit[1], label: `${nf(nice, nice < 1 ? 2 : 0)} ${unit[0]}` };
}

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Canvas letter-spacing is Chromium-only; harmless to set anywhere else. */
const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* -------------------------------------------------------------------- live */

interface Live {
  seed: Seed;
  /** Kilometres in the ecliptic plane. */
  x: number;
  y: number;
  /** Kilometres from the Sun. */
  r: number;
  /** Heliocentric ecliptic longitude, degrees. */
  lon: number;
  /** One full orbit as flat km pairs. */
  path: number[];
  /** Semi-major axis in km. */
  orbitR: number;
  /** Recent positions, flat km pairs. */
  trail: number[];
}

/** True diameter, widened to cover a ring system when there is one. */
function trueSpan(seed: Seed): number {
  const rings = seed.rings;
  if (!rings || rings.length === 0) return seed.diameter;
  let outer = 1;
  for (const band of rings) outer = Math.max(outer, band.o);
  return seed.diameter * outer * 1.08;
}

const TRAIL_MAX = 260;
const DOUBLE_TAP_MS = 700;

/**
 * The solar system as it is at this moment, solved rather than drawn, with the
 * clock on a knob and the eight planets on the eight pads.
 */
export const createRightNow: SketchFactory = (): Sketch => {
  const rand = mulberry32(7);
  const stars = Array.from({ length: 240 }, () => ({
    x: rand(),
    y: rand(),
    s: 0.4 + rand() * 1.1,
    a: 0.15 + rand() * 0.55,
    p: rand() * Math.PI * 2,
  }));

  const bodies: Live[] = SEEDS.map((seed) => ({
    seed,
    x: 0,
    y: 0,
    r: 0,
    lon: 0,
    path: [],
    orbitR: 0,
    trail: [],
  }));

  const jd0 = jdFromMs(Date.now());
  let dayOffset = 0;
  let cam: Cam = { x: 0, y: 0, w: 0 };
  let trip: Trip | null = null;
  let focus: number | null = null;
  let fill = 0.82;
  const lastTap = new Array<number>(8).fill(-1e9);
  let pathT = Number.NaN;
  let pathBuiltAt = -1e9;
  let stamp = '';
  let stampAt = -1e9;

  /** Solve every body for the current simulated instant. */
  const solve = (nowMs: number): void => {
    const jd = jd0 + dayOffset;
    const T = centuriesFromJd(jd);
    const rebuildPaths = Math.abs(T - pathT) > 1e-5 && nowMs - pathBuiltAt > 250;

    for (const body of bodies) {
      const orbit = body.seed.orbit;
      if (!orbit) continue;
      const el = elementsAt(orbit, T);
      const p = positionAt(el, el.M);
      body.x = p.x * AU;
      body.y = p.y * AU;
      body.r = Math.hypot(body.x, body.y);
      body.lon = (Math.atan2(p.y, p.x) * (180 / Math.PI) + 360) % 360;
      body.orbitR = el.a * AU;

      if (rebuildPaths || body.path.length === 0) {
        const path: number[] = [];
        for (let i = 0; i <= 256; i++) {
          const q = positionAt(el, (i / 256) * 360);
          path.push(q.x * AU, q.y * AU);
        }
        body.path = path;
      }
    }
    if (rebuildPaths) {
      pathT = T;
      pathBuiltAt = nowMs;
    }
  };

  const systemSpan = (): number => bodies[bodies.length - 1].orbitR * 2.05;

  const travel = (
    target: number | null,
    targetW: number,
    span: number,
    width: number,
    height: number,
  ): void => {
    if (!cam.w) return;
    const tx = target === null ? 0 : bodies[target].x;
    const ty = target === null ? 0 : bodies[target].y;
    const vh = (cam.w * height) / width;
    const spanX =
      Math.max(cam.x + cam.w / 2, tx + span / 2) - Math.min(cam.x - cam.w / 2, tx - span / 2);
    const spanY = Math.max(cam.y + vh / 2, ty + span / 2) - Math.min(cam.y - vh / 2, ty - span / 2);
    // Pull back far enough that both the old frame and the target are visible.
    const mid = Math.max(spanX / 0.76, ((spanY / 0.76) * width) / height, targetW);

    const t: Trip = {
      t0: performance.now(),
      dur: 0,
      x0: cam.x,
      y0: cam.y,
      target,
      l0: Math.log(cam.w),
      lm: Math.log(mid),
      l1: Math.log(targetW),
      pan: new Float64Array(0),
    };
    const decades = (Math.abs(t.lm - t.l0) + Math.abs(t.lm - t.l1)) / Math.LN10;
    t.dur = clamp(1150 + 240 * decades, 1300, 4200);
    t.pan = buildPan(t);
    trip = t;
  };

  return {
    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kTime, kZoom, kOrbits, kScale, kTrail, kStars, kLabels, kGlow] = midi.knobs;
      const now = performance.now();

      // Time: centred knob is frozen, either side runs the clock at up to
      // 400 days a second in that direction.
      const signed = (kTime - 0.5) * 2;
      const mag = Math.abs(signed);
      const daysPerSecond =
        mag < 0.04
          ? 0
          : Math.sign(signed) *
            Math.exp(Math.log(0.02) + ((mag - 0.04) / 0.96) * (Math.log(400) - Math.log(0.02)));
      dayOffset += daysPerSecond * dt;

      const zoomMult = Math.exp(Math.log(0.28) + kZoom * (Math.log(5) - Math.log(0.28)));
      const bodyScale = Math.exp(kScale * Math.log(20000));
      const trailLen = Math.round(kTrail * TRAIL_MAX);
      const hud = kLabels;
      const glow = kGlow;

      solve(now);

      for (const hit of midi.hits) {
        const index = hit.pad + 1; // pad 1 is Mercury; the Sun keeps the middle
        if (index >= bodies.length) continue;
        const doubleTap = hit.at - lastTap[hit.pad] < DOUBLE_TAP_MS;
        lastTap[hit.pad] = hit.at;
        if (doubleTap && focus === index) {
          focus = null;
          travel(null, fitSpan(systemSpan(), width, height, 0.9) * zoomMult, systemSpan(), width, height);
        } else {
          focus = index;
          // Harder hits arrive closer in.
          fill = 0.55 + hit.velocity * 0.4;
          const span = trueSpan(bodies[index].seed);
          travel(index, fitSpan(span, width, height, fill) * zoomMult, span, width, height);
        }
      }

      if (!cam.w) {
        cam = { x: 0, y: 0, w: fitSpan(systemSpan(), width, height, 0.9) * zoomMult };
      }

      const targetCentre =
        focus === null ? { x: 0, y: 0 } : { x: bodies[focus].x, y: bodies[focus].y };
      const targetWidth =
        focus === null
          ? fitSpan(systemSpan(), width, height, 0.9) * zoomMult
          : fitSpan(trueSpan(bodies[focus].seed), width, height, fill) * zoomMult;

      if (trip) {
        const u = clamp((now - trip.t0) / trip.dur, 0, 1);
        const p = panAt(trip, u);
        const tx = trip.target === null ? 0 : bodies[trip.target].x;
        const ty = trip.target === null ? 0 : bodies[trip.target].y;
        cam = {
          x: trip.x0 + (tx - trip.x0) * p,
          y: trip.y0 + (ty - trip.y0) * p,
          w: widthAt(trip, u),
        };
        if (u >= 1) trip = null;
      } else {
        // Settled: stay locked on a moving target, and ease onto whatever
        // width the zoom and scale knobs are asking for now.
        const k = 1 - Math.pow(0.5, dt / 0.22);
        cam = {
          x: targetCentre.x,
          y: targetCentre.y,
          w: cam.w * Math.pow(targetWidth / cam.w, k),
        };
      }

      const c = cam;
      const k = width / c.w; // pixels per kilometre
      // North ecliptic up, so world y climbs as screen y falls.
      const px = (wx: number): number => width / 2 + (wx - c.x) * k;
      const py = (wy: number): number => height / 2 - (wy - c.y) * k;

      /* ---------------------------------------------------------- backdrop */

      ctx.fillStyle = '#04050a';
      ctx.fillRect(0, 0, width, height);

      if (kStars > 0.02) {
        ctx.fillStyle = '#dfe6ff';
        for (const s of stars) {
          ctx.globalAlpha = s.a * kStars * (0.72 + 0.28 * Math.sin(now / 1500 + s.p * 9));
          ctx.fillRect(s.x * width, s.y * height, s.s, s.s);
        }
        ctx.globalAlpha = 1;
      }

      /* ------------------------------------------------------------ orbits */

      if (kOrbits > 0.02) {
        for (let i = 1; i < bodies.length; i++) {
          const b = bodies[i];
          const rpx = b.orbitR * k;
          // Fade out when the ring is too small to read, and again when it is
          // so large that only a straight-looking arc is on screen.
          const a =
            clamp((rpx - 5) / 25, 0, 1) * clamp((60 * width - rpx) / (30 * width), 0, 1) * kOrbits;
          if (a < 0.02) continue;
          const on = i === focus;
          ctx.globalAlpha = a * (on ? 0.65 : 0.26);
          ctx.strokeStyle = on ? b.seed.color : '#7f8db3';
          ctx.lineWidth = on ? 1.4 : 1;
          ctx.beginPath();
          for (let j = 0; j < b.path.length; j += 2) {
            const sx = px(b.path[j]);
            const sy = py(b.path[j + 1]);
            if (j === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // The reference direction: longitude zero, the vernal equinox.
        const axisR = bodies[bodies.length - 1].orbitR;
        const axisA = clamp((axisR * k - 40) / 120, 0, 1) * 0.3 * kOrbits;
        if (axisA > 0.02) {
          ctx.globalAlpha = axisA;
          ctx.strokeStyle = '#7f8db3';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 7]);
          ctx.beginPath();
          ctx.moveTo(px(0), py(0));
          ctx.lineTo(px(axisR * 1.06), py(0));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `500 9px ${MONO}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#7f8db3';
          ctx.fillText('0° LONGITUDE', px(axisR * 1.06), py(0) - 5);
          ctx.globalAlpha = 1;
        }
      }

      /* ------------------------------------------------------------ trails */

      for (const b of bodies) {
        if (!b.seed.orbit) continue;
        if (trailLen > 1) {
          b.trail.push(b.x, b.y);
          while (b.trail.length > trailLen * 2) b.trail.shift();
          ctx.globalAlpha = 0.32;
          ctx.strokeStyle = b.seed.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let j = 0; j < b.trail.length; j += 2) {
            const sx = px(b.trail[j]);
            const sy = py(b.trail[j + 1]);
            if (j === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (b.trail.length) {
          b.trail.length = 0;
        }
      }

      /* ------------------------------------------------------------ bodies */

      // Exaggeration exists so sub-pixel worlds are visible at all. It is
      // capped in screen space, so once a planet's real disc is bigger than the
      // cap the true size takes over and the frame readout still means what it
      // says.
      const sizeCap = Math.min(width, height) * 0.3;
      let maxEff = 1;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const sx = px(b.x);
        const sy = py(b.y);
        const truePx = b.seed.diameter * k;
        const eff = truePx > 0 ? Math.min(bodyScale, Math.max(1, sizeCap / truePx)) : bodyScale;
        const r = (b.seed.diameter * eff) / 2 * k;
        if (sx + r < -90 || sx - r > width + 90 || sy + r < -90 || sy - r > height + 90) continue;
        // Only count bodies that actually made it onto the screen.
        if (eff > maxEff) maxEff = eff;
        const energy = i > 0 ? midi.pads[i - 1]?.energy ?? 0 : 0;
        // Inner planets pile up on top of each other at system-wide zoom, so
        // only label what is far enough from the Sun to read.
        const nameable = i === focus || i === 0 || b.orbitR * k > 34;
        drawBody(ctx, b, sx, sy, r, width, height, i === focus, c, glow, energy, nameable);
      }

      /* --------------------------------------------------------------- HUD */

      if (hud > 0.02) {
        const b = focus === null ? null : bodies[focus];
        if (now - stampAt > 120) {
          stamp = STAMP_FORMAT.format(new Date(msFromJd(jd0 + dayOffset)));
          stampAt = now;
        }

        ctx.save();
        ctx.globalAlpha = hud;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const pad = Math.min(24, width * 0.03);
        // The page draws its own control bar across the top of the stage.
        const top = pad + 26;
        ctx.font = `500 9.5px ${MONO}`;
        setTracking(ctx, '0.3em');
        ctx.fillStyle = '#64748b';
        const label = daysPerSecond === 0 ? 'POSITIONS FOR' : 'RUNNING FROM';
        ctx.fillText(`${label} ${stamp.toUpperCase()}`, pad, top);

        const titleSize = Math.max(20, Math.min(42, width * 0.042));
        ctx.font = `200 ${titleSize}px ui-sans-serif, system-ui, sans-serif`;
        setTracking(ctx, '0.16em');
        ctx.fillStyle = b ? b.seed.light : '#e2e8f5';
        ctx.fillText((b ? b.seed.name : 'Right now').toUpperCase(), pad, top + 20);

        ctx.font = `500 10.5px ${MONO}`;
        setTracking(ctx, '0em');
        ctx.fillStyle = '#94a3b8';
        const note = b
          ? b.seed.note
          : 'Looking down on the ecliptic from the north. True distances, real elements.';
        const noteTop = top + 30 + titleSize;
        const noteRows = wrapText(ctx, note, pad, noteTop, Math.min(280, width * 0.42), 17);

        // Stats, right-aligned.
        ctx.textAlign = 'right';
        const rows: [string, string][] = [['Frame', `${humanKm(c.w)} wide`]];
        if (daysPerSecond !== 0) {
          const perSec = Math.abs(daysPerSecond);
          rows.push([
            'Clock',
            `${daysPerSecond < 0 ? '−' : '+'}${perSec < 1 ? `${nf(perSec * 24, 1)} h` : `${nf(perSec, perSec < 10 ? 1 : 0)} d`}/s`,
          ]);
        }
        if (b) {
          rows.push(['From Sun', `${nf(b.r / AU, 3)} AU`]);
          rows.push(['Longitude', `${nf(b.lon, 1)}°`]);
          rows.push(['Diameter', `${nf(b.seed.diameter)} km`]);
        }
        // Report the exaggeration actually being applied, not the knob: once
        // you are close enough, the planet on screen is its real size.
        if (maxEff > 1.05) rows.push(['Sizes', `×${nf(maxEff)} — not to scale`]);

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

        // Scale bar, tucked under the note so it clears the on-screen
        // controller along the bottom of the stage.
        const sc = niceScale(c.w);
        const barW = Math.min(Math.round(sc.km * k), Math.round(width * 0.3));
        const barY = noteTop + noteRows * 17 + 14;
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad + 0.5, barY);
        ctx.lineTo(pad + 0.5, barY + 7);
        ctx.lineTo(pad + barW + 0.5, barY + 7);
        ctx.lineTo(pad + barW + 0.5, barY);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = `500 10px ${MONO}`;
        setTracking(ctx, '0.16em');
        ctx.fillStyle = '#64748b';
        ctx.fillText(sc.label, pad, barY + 12);

        setTracking(ctx, '0em');
        ctx.restore();
      }
    },
  };
};

/* ------------------------------------------------------------------ paint */

/** Draws wrapped text and returns the number of lines it used. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + row * lineHeight);
      line = word;
      row += 1;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + row * lineHeight);
    row += 1;
  }
  return row;
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  b: Live,
  sx: number,
  sy: number,
  r: number,
  width: number,
  height: number,
  isActive: boolean,
  cam: Cam,
  glow: number,
  energy: number,
  nameable: boolean,
): void {
  const seed = b.seed;

  // A pad that was just hit rings its planet, however small it is on screen.
  if (energy > 0.02) {
    ctx.globalAlpha = Math.min(0.7, energy * 0.7);
    ctx.strokeStyle = seed.light;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(r, 3) + 6 + (1 - Math.min(1, energy)) * 40, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Under a pixel: an × on its orbit line. That is the honest answer.
  if (r < 1) {
    if (seed.sun) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
      g.addColorStop(0, 'rgba(255,228,155,0.95)');
      g.addColorStop(0.35, 'rgba(255,180,60,0.42)');
      g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, TAU);
      ctx.fill();
    } else {
      const a = 4.5;
      ctx.strokeStyle = seed.color;
      ctx.globalAlpha = isActive ? 1 : 0.72;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(sx - a, sy - a);
      ctx.lineTo(sx + a, sy + a);
      ctx.moveTo(sx + a, sy - a);
      ctx.lineTo(sx - a, sy + a);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (nameable) label(ctx, seed, sx, sy + 20, isActive);
    return;
  }

  if (seed.sun) {
    const halo = ctx.createRadialGradient(sx, sy, r * 0.85, sx, sy, r * (2 + glow * 2.8));
    halo.addColorStop(0, `rgba(255,190,80,${0.2 + glow * 0.45})`);
    halo.addColorStop(0.4, `rgba(255,150,50,${0.05 + glow * 0.12})`);
    halo.addColorStop(1, 'rgba(255,130,40,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * (2 + glow * 2.8), 0, TAU);
    ctx.fill();
    const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    disc.addColorStop(0, '#fffdf2');
    disc.addColorStop(0.55, seed.light);
    disc.addColorStop(0.9, seed.color);
    disc.addColorStop(1, seed.dark);
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.fill();
    if (nameable && r < Math.min(width, height) * 0.34) label(ctx, seed, sx, sy + r + 18, isActive);
    return;
  }

  // Sunward direction, in screen space.
  const d = Math.max(1, Math.hypot(b.x, b.y));
  const lx = -b.x / d;
  const ly = b.y / d; // screen y is flipped
  const pole = seed.pole ?? { x: 0, y: 0 };

  // Rings, nearly face-on from up here, and clear of the disc.
  if (seed.rings && r > 1.5) {
    const squash = seed.ringSquash ?? 0.9;
    const rot = Math.atan2(pole.y, pole.x);
    for (const band of seed.rings) {
      const p = new Path2D();
      p.moveTo(sx + r * band.o * squash, sy);
      p.ellipse(sx, sy, r * band.o * squash, r * band.o, rot, 0, TAU);
      p.closePath();
      p.moveTo(sx + r * band.i * squash, sy);
      p.ellipse(sx, sy, r * band.i * squash, r * band.i, rot, 0, TAU);
      p.closePath();
      ctx.globalAlpha = band.a;
      ctx.fillStyle = seed.light;
      ctx.fill(p, 'evenodd');
    }
    ctx.globalAlpha = 1;
  }

  if (seed.atmo && r > 14) {
    const g = ctx.createRadialGradient(sx, sy, r * 0.93, sx, sy, r * 1.11);
    g.addColorStop(0, `${seed.atmo}00`);
    g.addColorStop(0.45, `${seed.atmo}55`);
    g.addColorStop(1, `${seed.atmo}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.11, 0, TAU);
    ctx.fill();
  }

  const disc = new Path2D();
  disc.arc(sx, sy, r, 0, TAU);

  const g = ctx.createRadialGradient(
    sx + lx * r * 0.45,
    sy + ly * r * 0.45,
    r * 0.04,
    sx,
    sy,
    r * 1.18,
  );
  g.addColorStop(0, seed.light);
  g.addColorStop(0.5, seed.color);
  g.addColorStop(1, seed.dark);
  ctx.fillStyle = g;
  ctx.fill(disc);

  if (r > 5) {
    ctx.save();
    ctx.clip(disc);

    if (seed.bands) {
      const cxp = sx + pole.x * r;
      const cyp = sy + pole.y * r;
      for (const s of seed.bands) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.c;
        if (seed.linearBands) {
          ctx.fillRect(sx - r, sy + (s.i * 2 - 1) * r, r * 2, (s.o - s.i) * 2 * r);
        } else {
          const p = new Path2D();
          p.moveTo(cxp + s.o * r * 1.35, cyp);
          p.arc(cxp, cyp, s.o * r * 1.35, 0, TAU);
          p.closePath();
          p.moveTo(cxp + s.i * r * 1.35, cyp);
          p.arc(cxp, cyp, s.i * r * 1.35, 0, TAU);
          p.closePath();
          ctx.fill(p, 'evenodd');
        }
      }
    }
    if (seed.blobs) {
      for (const s of seed.blobs) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.ellipse(sx + s.x * r, sy + s.y * r, s.r * r, s.r * r * 0.78, 0, 0, TAU);
        ctx.fill();
      }
    }
    if (seed.spot) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = seed.spot.c;
      ctx.beginPath();
      ctx.ellipse(
        sx + seed.spot.x * r,
        sy + seed.spot.y * r,
        seed.spot.r * r,
        seed.spot.r * r * 0.7,
        0,
        0,
        TAU,
      );
      ctx.fill();
    }
    if (seed.cap) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#f2f7ff';
      ctx.beginPath();
      ctx.ellipse(sx + pole.x * r, sy + pole.y * r, r * seed.cap, r * seed.cap * 0.9, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // From straight above, a planet is exactly half lit.
    const term = ctx.createLinearGradient(
      sx + lx * r * 0.15,
      sy + ly * r * 0.15,
      sx - lx * r,
      sy - ly * r,
    );
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.5, 'rgba(1,2,6,0.5)');
    term.addColorStop(1, 'rgba(1,2,6,0.88)');
    ctx.fillStyle = term;
    ctx.fill(disc);

    const limb = ctx.createRadialGradient(sx, sy, r * 0.68, sx, sy, r);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(2,3,8,0.5)');
    ctx.fillStyle = limb;
    ctx.fill(disc);
    ctx.restore();
  }

  // A reticle, so a two-pixel world is still findable.
  if (r < 4.5) {
    ctx.strokeStyle = seed.color;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // While zoomed in, point at where the Sun is.
  if (isActive && r > Math.min(width, height) * 0.2 && cam.w < b.r) {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffd489';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(sx + lx * r * 1.12, sy + ly * r * 1.12);
    ctx.lineTo(sx + lx * r * 1.7, sy + ly * r * 1.7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 9px ${MONO}`;
    setTracking(ctx, '0.16em');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd489';
    ctx.fillText('SUN', sx + lx * r * 1.9, sy + ly * r * 1.9);
    setTracking(ctx, '0em');
    ctx.globalAlpha = 1;
  }

  if (nameable && r < Math.min(width, height) * 0.34) label(ctx, seed, sx, sy + r + 18, isActive);
}

function label(
  ctx: CanvasRenderingContext2D,
  seed: Seed,
  sx: number,
  y: number,
  isActive: boolean,
): void {
  ctx.save();
  ctx.font = `500 10px ${MONO}`;
  setTracking(ctx, '0.18em');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isActive ? seed.light : 'rgba(148,163,184,0.78)';
  ctx.fillText(seed.name.toUpperCase(), sx, y);
  ctx.restore();
}

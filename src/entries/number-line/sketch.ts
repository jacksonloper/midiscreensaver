import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, mulberry32, padHue, range } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/**
 * What each pad adds. Sign by row, magnitude by column — pads 1-4 are the
 * bottom row of the LPD8, so the negatives sit under their positive twins.
 */
export const DELTAS = [-1, -5, -10, -25, 1, 5, 10, 25];

/** Never zoom in tighter than this many units, or zero has nowhere to sit. */
const MIN_EXTENT = 2.5;
/** Half-lives, in seconds, for the two directions the window can move. */
const ZOOM_OUT = 0.06;
const ZOOM_IN = 0.4;
const MAX_GHOSTS = 150;
const MAX_SPARKS = 420;

/** A previous position of the ball, kept so the arc draws itself. */
interface Ghost {
  v: number;
  h: number;
  life: number;
}

interface Spark {
  /** Number-line position. */
  v: number;
  /** Pixels above the axis. */
  h: number;
  /** Units per second. */
  vv: number;
  /** Pixels per second. */
  vh: number;
  life: number;
  hue: number;
}

interface Ripple {
  v: number;
  /** Pixels. */
  r: number;
  life: number;
  hue: number;
  power: number;
}

/** The "+25" that floats off the ball when a pad is hit. */
interface Flash {
  v: number;
  delta: number;
  age: number;
  hue: number;
}

/** 1, 2, 5, 10, 20, 50 … — the tick spacing that puts about `count` on screen. */
const niceStep = (span: number, count: number): number => {
  const raw = Math.max(span / Math.max(count, 2), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1.2 ? 1 : norm <= 2.5 ? 2 : norm <= 6 ? 5 : 10;
  return mult * mag;
};

/** Real minus sign, because the axis labels sit next to each other. */
const signed = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const plain = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

/**
 * One ball on one number line. Eight pads add ±1, ±5, ±10 and ±25 to a running
 * total; the ball hops toward the new total in a settling series of arcs, and
 * the axis always runs from zero to wherever the ball currently is, so the
 * scale is a consequence of the arithmetic rather than something fixed.
 */
export const createNumberLine: SketchFactory = (): Sketch => {
  const rand = mulberry32(20260726);

  /** Where the ball is, and the integer it has been told to reach. */
  let value = 0;
  let target = 0;
  /** Where the hop currently in the air is going to come down. */
  let landing = 0;

  /** Bottom of the ball, in pixels above the axis. */
  let hop = 0;
  /** Units per second. */
  let vv = 0;
  /** Pixels per second. */
  let vh = 0;
  let airborne = false;
  /** Positive is flattened, negative is stretched. */
  let squash = 0;
  let spin = 0;
  let idle = 0;
  let nextIdle = 1.8;
  let hueSeed = 208;
  let flashPulse = 0;

  /** The view, smoothed — these chase zero-to-the-ball every frame. */
  let lo = -0.4;
  let hi = 2.85;

  const ghosts: Ghost[] = [];
  const sparks: Spark[] = [];
  const ripples: Ripple[] = [];
  const flashes: Flash[] = [];
  /** The last few deltas, shown as a running tape. */
  const tape: number[] = [];

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      const [kHue, kBounce, kTempo, kReach, kSquash, kTrail, kRuler, kSparkle] = midi.knobs;

      const hueShift = kHue * 360;
      const bounce = range(kBounce, 0.35, 1.8);
      const tempo = range(kTempo, 0.6, 2.1);
      const reach = range(kReach, 0.3, 0.95);
      const squashAmount = range(kSquash, 0, 1.3);
      const detail = kRuler;
      const sparkle = kSparkle;

      const axisY = Math.round(height * 0.68) + 0.5;
      // Arcs stop short of the top so they clear the stage's own control bar.
      const ceiling = axisY * 0.76;
      const g = height * 2.6 * tempo * tempo;
      const ballR = clamp(Math.min(width, height) * 0.034, 6, 26);

      /* ------------------------------------------------------------- view */

      // Zero on one side, the ball on the other, plus a margin at each end.
      // Mid-hop the window also allows for where the ball is about to land, so
      // the frame is already the right size when it gets there.
      const far = airborne ? Math.max(Math.abs(value), Math.abs(landing)) : Math.abs(value);
      const extent = Math.max(far, MIN_EXTENT);
      const wantLo = value >= 0 ? -extent * 0.18 : -extent * 1.22;
      const wantHi = value >= 0 ? extent * 1.22 : extent * 0.18;
      // Zooming out is quick and zooming back in is slow, so a long jump never
      // outruns the frame but the scale does not twitch on the way back.
      lo = approach(lo, wantLo, wantLo < lo ? ZOOM_OUT : ZOOM_IN, dt);
      hi = approach(hi, wantHi, wantHi > hi ? ZOOM_OUT : ZOOM_IN, dt);
      // Last resort: whatever the smoothing is doing, keep the ball on screen.
      const keep = (hi - lo) * 0.05;
      if (value > hi - keep) hi = value + keep;
      if (value < lo + keep) lo = value - keep;
      const span = Math.max(hi - lo, 1e-6);
      const perUnit = width / span;
      const sx = (v: number): number => (v - lo) * perUnit;

      /* ---------------------------------------------------------- physics */

      /**
       * Throw the ball at `fraction` of the distance still to go. Anything
       * under 1 lands short and the next hop covers a fraction of what is
       * left, which is how the whole thing converges; over 1 overshoots and
       * the ball has to come back.
       */
      const launch = (fraction: number, energy: number): void => {
        const step = (target - value) * fraction;
        // Arc height comes from how far the hop looks on screen, not how many
        // units it covers — a jump of 25 out of 400 is a small jump.
        const throwHeight = Math.abs(step) * perUnit * 0.44 * bounce * energy;
        const apex = clamp(throwHeight, height * 0.04, ceiling);
        // A pad hit can arrive mid-arc, so the throw is measured from wherever
        // the ball happens to be — the top of the new arc is the same height
        // either way, and the fall back down is longer when it starts up high.
        const rise = Math.max(apex - hop, height * 0.015);
        vh = Math.sqrt(2 * g * rise);
        const airtime = (vh + Math.sqrt(vh * vh + 2 * g * hop)) / g;
        vv = airtime > 0 ? step / airtime : 0;
        landing = value + step;
        airborne = true;
        squash = Math.min(squash, -0.28);
        idle = 0;
      };

      /** A hop that goes nowhere: the ball is bored. */
      const bob = (apex: number): void => {
        vh = Math.sqrt(2 * g * apex);
        vv = 0;
        landing = value;
        airborne = true;
        squash = Math.min(squash, -0.1);
      };

      const land = (): void => {
        hop = 0;
        const impact = clamp(Math.abs(vh) / (height * 2.2), 0, 1);
        const hue = (hueSeed + hueShift) % 360;
        ripples.push({ v: value, r: 0, life: 1, hue, power: 0.35 + impact });
        if (ripples.length > 14) ripples.shift();
        squash = Math.max(squash, 0.28 + impact * 0.7);

        const count = Math.round((1 + impact * 13) * sparkle);
        for (let i = 0; i < count; i++) {
          const a = (0.1 + rand() * 0.8) * Math.PI;
          const speed = (70 + rand() * 320) * (0.35 + impact);
          sparks.push({
            v: value,
            h: 1,
            vv: (Math.cos(a) * speed) / perUnit,
            vh: Math.sin(a) * speed,
            life: 0.45 + rand() * 0.8,
            hue: (hue + (rand() - 0.5) * 46 + 360) % 360,
          });
        }
        if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);

        // More than a couple of pixels still to cover? Take another hop.
        if (Math.abs(target - value) * perUnit > 2.5) {
          launch(reach, 1);
          return;
        }
        // Otherwise dribble to a stop where it stands.
        vh = -vh * 0.42;
        vv *= 0.3;
        landing = value;
        if ((vh * vh) / (2 * g) < 1.2) {
          vh = 0;
          vv = 0;
          airborne = false;
        }
      };

      for (const hit of midi.hits) {
        const delta = DELTAS[hit.pad] ?? 0;
        target += delta;
        hueSeed = padHue(hit.pad);
        flashes.push({ v: value, delta, age: 0, hue: (hueSeed + hueShift) % 360 });
        if (flashes.length > 8) flashes.shift();
        tape.push(delta);
        if (tape.length > 9) tape.shift();
        flashPulse = 1;
        // Velocity buys reach and height, so a hard hit can sail past the
        // number and have to walk itself back.
        launch(clamp(reach * (0.68 + hit.velocity * 0.72), 0.28, 1.3), 0.85 + hit.velocity * 0.7);
      }

      if (airborne) {
        vh -= g * dt;
        hop += vh * dt;
        value += vv * dt;
        spin += (vv * perUnit * dt) / ballR;
        if (hop <= 0) land();
      } else {
        // The last fraction of a unit is walked in rather than hopped, so the
        // readout settles on the integer instead of hunting either side of it.
        value = approach(value, target, 0.09, dt);
        if (Math.abs(target - value) < 1e-4) value = target;
        idle += dt;
        if (value === target && idle > nextIdle) {
          idle = 0;
          nextIdle = 1.6 + rand() * 2.2;
          bob(height * 0.02 * bounce + 2);
        }
      }

      squash = approach(squash, 0, 0.075, dt);
      flashPulse = approach(flashPulse, 0, 0.13, dt);

      /* -------------------------------------------------------- particles */

      if (airborne || Math.abs(target - value) > 1e-4) {
        ghosts.push({ v: value, h: hop, life: 1 });
        if (ghosts.length > MAX_GHOSTS) ghosts.shift();
      }
      const ghostDecay = dt / range(kTrail, 0.09, 1.2);
      for (const ghost of ghosts) ghost.life -= ghostDecay;
      while (ghosts.length > 0 && ghosts[0].life <= 0) ghosts.shift();

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.vh -= g * 0.55 * dt;
        s.h += s.vh * dt;
        s.v += s.vv * dt;
        s.life -= dt;
        if (s.h < 0) {
          s.h = 0;
          s.vh *= -0.34;
          s.vv *= 0.55;
        }
        if (s.life <= 0) sparks.splice(i, 1);
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.r += height * 1.15 * dt;
        r.life -= dt * 1.7;
        if (r.life <= 0) ripples.splice(i, 1);
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].age += dt;
        if (flashes[i].age > 1.5) flashes.splice(i, 1);
      }

      /* ------------------------------------------------------------- draw */

      const hue = (hueSeed + hueShift) % 360;
      const bx = sx(value);
      const zeroX = sx(0);

      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, hsl(hue, 34, 7));
      sky.addColorStop(0.62, '#04050a');
      sky.addColorStop(1, hsl(hue + 30, 26, 5));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Ground haze under the ball, so the eye finds it before the numbers.
      const haze = ctx.createRadialGradient(bx, axisY, 0, bx, axisY, height * 0.55);
      haze.addColorStop(0, hsl(hue, 90, 55, 0.14 + flashPulse * 0.16));
      haze.addColorStop(1, hsl(hue, 90, 55, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      /* ------------------------------------------------------------- ruler */

      const step = niceStep(span, range(detail, 4, 15));
      const minorStep = step >= 5 ? step / 5 : step === 2 ? 1 : 0;
      const labelSize = clamp(width * 0.011, 9, 13);

      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';

      if (minorStep > 0 && minorStep * perUnit > 5) {
        ctx.strokeStyle = hsl(hue, 30, 70, 0.16);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let v = Math.ceil(lo / minorStep) * minorStep; v <= hi; v += minorStep) {
          const x = Math.round(sx(v)) + 0.5;
          ctx.moveTo(x, axisY);
          ctx.lineTo(x, axisY + 5);
        }
        ctx.stroke();
      }

      // Individual integers, once there is room for them to read as units.
      if (step > 1 && perUnit > 11) {
        ctx.fillStyle = hsl(hue, 30, 70, 0.13);
        for (let v = Math.ceil(lo); v <= hi; v += 1) {
          ctx.fillRect(Math.round(sx(v)), axisY + 2, 1, 1.5);
        }
      }

      ctx.strokeStyle = hsl(hue, 34, 74, 0.42);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const x = Math.round(sx(v)) + 0.5;
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, axisY + (v === 0 ? 15 : 10));
      }
      ctx.stroke();

      ctx.font = `500 ${labelSize}px ${MONO}`;
      setTracking(ctx, '0.06em');
      const inset = labelSize * 2.6;
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const x = sx(v);
        // A number half off the edge is worse than no number.
        if (x < inset || x > width - inset) continue;
        const n = Math.round(v);
        ctx.fillStyle = n === 0 ? hsl(hue, 60, 82, 0.92) : hsl(hue, 24, 72, 0.5);
        ctx.fillText(plain(n), x, axisY + (n === 0 ? 19 : 14));
      }
      setTracking(ctx, '0em');

      /* -------------------------------------------------------- the axis */

      // The full line is dim; zero-to-the-ball is lit, because that stretch is
      // the number the whole picture is about.
      ctx.strokeStyle = hsl(hue, 30, 70, 0.28);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, axisY);
      ctx.lineTo(width, axisY);
      ctx.stroke();

      const measured = ctx.createLinearGradient(zeroX, 0, bx, 0);
      measured.addColorStop(0, hsl(hue, 80, 60, 0.25));
      measured.addColorStop(1, hsl(hue, 92, 66, 0.95));
      ctx.strokeStyle = measured;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(zeroX, axisY);
      ctx.lineTo(bx, axisY);
      ctx.stroke();

      // Zero: the post everything is measured from.
      ctx.strokeStyle = hsl(hue, 40, 80, 0.2);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(Math.round(zeroX) + 0.5, axisY - height * 0.32);
      ctx.lineTo(Math.round(zeroX) + 0.5, axisY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hsl(hue, 50, 88, 0.9);
      ctx.beginPath();
      ctx.arc(zeroX, axisY, 3, 0, TAU);
      ctx.fill();

      // Where the ball has been told to go.
      const goalGap = Math.abs(target - value);
      if (goalGap * perUnit > 1) {
        const gx = Math.round(sx(target)) + 0.5;
        const a = clamp(0.25 + goalGap * perUnit * 0.01, 0.25, 0.85);
        ctx.strokeStyle = hsl(hue + 40, 70, 70, a);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(gx, axisY - height * 0.2);
        ctx.lineTo(gx, axisY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `500 ${labelSize}px ${MONO}`;
        ctx.fillStyle = hsl(hue + 40, 70, 78, a);
        ctx.textBaseline = 'bottom';
        ctx.fillText(plain(target), gx, axisY - height * 0.2 - 4);
        ctx.textBaseline = 'top';
      }

      /* ------------------------------------------------------ impact marks */

      ctx.globalCompositeOperation = 'lighter';

      for (const r of ripples) {
        const x = sx(r.v);
        const a = r.life * r.life * 0.5 * r.power;
        ctx.strokeStyle = hsl(r.hue, 90, 66, a);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(x, axisY, r.r, r.r * 0.42, 0, Math.PI, TAU);
        ctx.stroke();
        ctx.strokeStyle = hsl(r.hue, 90, 70, a * 0.7);
        ctx.beginPath();
        ctx.moveTo(x - r.r * 1.3, axisY);
        ctx.lineTo(x + r.r * 1.3, axisY);
        ctx.stroke();
      }

      for (const s of sparks) {
        const x = sx(s.v);
        const y = axisY - s.h;
        const a = clamp(s.life, 0, 1) * 0.85;
        ctx.strokeStyle = hsl(s.hue, 95, 68, a);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (s.vv * perUnit) * 0.014, y + s.vh * 0.014);
        ctx.stroke();
      }

      /* ------------------------------------------------------------- ball */

      for (const ghost of ghosts) {
        const a = ghost.life * ghost.life * 0.45;
        if (a < 0.01) continue;
        ctx.fillStyle = hsl(hue, 85, 62, a);
        ctx.beginPath();
        ctx.arc(sx(ghost.v), axisY - ghost.h - ballR, ballR * (0.22 + ghost.life * 0.5), 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';

      const airStretch = airborne ? -clamp(Math.abs(vh) / (height * 2.4), 0, 0.42) : 0;
      const sq = clamp((squash + airStretch) * squashAmount, -0.55, 0.7);
      const rx = ballR * (1 + sq * 0.5);
      const ry = ballR * (1 - sq * 0.42);
      const by = axisY - hop - ry;

      // Shadow: tight and dark underfoot, wide and faint at the top of an arc.
      const lift = clamp(hop / (axisY * 0.7), 0, 1);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * (1 - lift * 0.75)})`;
      ctx.beginPath();
      const shadowW = rx * (1 + lift * 0.9);
      const shadowH = ballR * 0.3 * (1 - lift * 0.4);
      ctx.ellipse(bx, axisY + 1.5, shadowW, shadowH, 0, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(rx / ballR, ry / ballR);

      const body = ctx.createRadialGradient(
        -ballR * 0.35,
        -ballR * 0.4,
        ballR * 0.1,
        0,
        0,
        ballR * 1.15,
      );
      body.addColorStop(0, hsl(hue + 12, 95, 78));
      body.addColorStop(0.55, hsl(hue, 88, 58));
      body.addColorStop(1, hsl(hue - 18, 80, 32));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 0, ballR, 0, TAU);
      ctx.fill();

      // A seam, so the roll is visible rather than implied.
      ctx.strokeStyle = hsl(hue - 30, 70, 22, 0.65);
      ctx.lineWidth = Math.max(1, ballR * 0.11);
      ctx.beginPath();
      ctx.ellipse(0, 0, ballR * 0.62, ballR * 0.94, spin, 0, TAU);
      ctx.stroke();

      ctx.fillStyle = hsl(hue + 30, 100, 92, 0.75);
      ctx.beginPath();
      ctx.ellipse(-ballR * 0.34, -ballR * 0.38, ballR * 0.26, ballR * 0.18, -0.6, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.globalCompositeOperation = 'lighter';
      const bloom = ballR * (3 + flashPulse * 3);
      const glow = ctx.createRadialGradient(bx, by, ballR * 0.6, bx, by, bloom);
      glow.addColorStop(0, hsl(hue, 95, 62, 0.32 + flashPulse * 0.4));
      glow.addColorStop(1, hsl(hue, 95, 62, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(bx - bloom, by - bloom, bloom * 2, bloom * 2);

      /* ---------------------------------------------------------- readout */

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const f of flashes) {
        const t = f.age / 1.5;
        const a = (1 - t) * (1 - t);
        ctx.font = `600 ${clamp(width * 0.026, 15, 34)}px ${MONO}`;
        ctx.fillStyle = hsl(f.hue, 95, 74, a);
        ctx.fillText(signed(f.delta), sx(f.v), axisY - ballR * 2.4 - t * height * 0.22);
      }

      ctx.globalCompositeOperation = 'source-over';

      const pad = Math.min(26, width * 0.032);
      // The page draws its own control bar across the top of the stage.
      const top = pad + 26;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      ctx.font = `500 9.5px ${MONO}`;
      setTracking(ctx, '0.3em');
      ctx.fillStyle = '#64748b';
      ctx.fillText(airborne ? 'IN FLIGHT' : goalGap > 0 ? 'SETTLING' : 'AT REST', pad, top);

      const bigSize = clamp(width * 0.058, 30, 74);
      ctx.font = `200 ${bigSize}px ${MONO}`;
      setTracking(ctx, '0.02em');
      ctx.fillStyle = '#e6ecff';
      const shown =
        value === target
          ? plain(target)
          : `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
      ctx.fillText(shown, pad, top + 16);

      ctx.font = `500 10.5px ${MONO}`;
      setTracking(ctx, '0.18em');
      ctx.fillStyle = hsl(hue, 45, 68, 0.85);
      const tapeLine = tape.length > 0 ? tape.map(signed).join(' ') : 'HIT A PAD';
      ctx.fillText(tapeLine, pad, top + 24 + bigSize);
      ctx.fillStyle = '#4a5570';
      ctx.fillText(
        `WINDOW ${plain(Math.round(lo))} → ${plain(Math.round(hi))}`,
        pad,
        top + 42 + bigSize,
      );
      setTracking(ctx, '0em');

      // A slow breath on the horizon line, so a paused-looking screen isn't.
      ctx.fillStyle = hsl(hue, 70, 60, 0.05 + Math.sin(time * 0.6) * 0.02);
      ctx.fillRect(0, axisY - 1, width, 2);
    },
  };
};

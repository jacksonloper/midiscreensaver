import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, clamp, fade, hsl, padHue, range } from '../../screensaver/util';

interface Body {
  /** Angle around the centre, radians. */
  angle: number;
  /** Distance from the centre, in units of the short screen radius. */
  radius: number;
  radialVelocity: number;
  /** Excitement, drives brightness and size. */
  charge: number;
  trail: { x: number; y: number }[];
}

/** Small-integer ratios, so the eight orbits keep drifting in and out of phase. */
const HARMONICS = [1, 1.5, 2, 2.5, 3, 4, 4.5, 6];
const MAX_TRAIL = 90;

/**
 * Eight bodies on one string. Each pad kicks its body outward; the spring pulls
 * it back, and because every orbit runs at a different harmonic of the same
 * base rate, the whole set slides through phase alignments on its own.
 */
export const createOrbitalChoir: SketchFactory = (): Sketch => {
  const bodies: Body[] = Array.from({ length: 8 }, (_, i) => ({
    angle: (i / 8) * TAU,
    radius: 0.34 + (i % 3) * 0.05,
    radialVelocity: 0,
    charge: 0,
    trail: [],
  }));

  return {
    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kSpin, kSpring, kDamp, kTrail, kLinks, kSize, kScale, kHue] = midi.knobs;

      const spin = range(kSpin, 0.04, 1.5);
      const spring = range(kSpring, 1.2, 14);
      const damping = range(kDamp, 0.35, 4.2);
      const trailAlpha = range(kTrail, 0.42, 0.035);
      const linkDistance = range(kLinks, 0, 0.62);
      const bodySize = range(kSize, 2, 14);
      const scale = range(kScale, 0.2, 0.62);
      const hueShift = kHue * 360;

      const cx = width / 2;
      const cy = height / 2;
      const unit = Math.min(width, height);

      for (const hit of midi.hits) {
        const body = bodies[hit.pad];
        if (!body) continue;
        body.radialVelocity += 0.9 + hit.velocity * 2.4;
        body.charge = Math.min(1.8, body.charge + 0.5 + hit.velocity);
      }

      fade(ctx, width, height, trailAlpha);
      ctx.globalCompositeOperation = 'lighter';

      const points: { x: number; y: number; hue: number; charge: number }[] = [];

      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const rest = scale * (0.55 + (i / bodies.length) * 0.75);

        // Damped spring toward the rest orbit — a kick becomes a decaying wobble.
        const accel = (rest - body.radius) * spring - body.radialVelocity * damping;
        body.radialVelocity += accel * dt;
        body.radius = clamp(body.radius + body.radialVelocity * dt, 0.02, 1.6);
        body.angle += spin * HARMONICS[i] * dt * (1 + body.charge * 0.35);
        body.charge *= Math.pow(0.5, dt / 0.9);

        const r = body.radius * unit;
        const x = cx + Math.cos(body.angle) * r;
        const y = cy + Math.sin(body.angle) * r * 0.82;
        body.trail.push({ x, y });
        if (body.trail.length > MAX_TRAIL) body.trail.shift();

        const hue = padHue(i, hueShift);
        points.push({ x, y, hue, charge: body.charge });

        ctx.strokeStyle = hsl(hue, 88, 62, 0.1 + body.charge * 0.35);
        ctx.lineWidth = 1 + body.charge * 2.2;
        ctx.beginPath();
        for (let t = 0; t < body.trail.length; t++) {
          const p = body.trail[t];
          if (t === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Constellation lines between bodies that happen to be near each other.
      if (linkDistance > 0.01) {
        const threshold = linkDistance * unit;
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const a = points[i];
            const b = points[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > threshold) continue;
            const closeness = 1 - d / threshold;
            ctx.strokeStyle = hsl(
              (a.hue + b.hue) / 2,
              70,
              64,
              closeness * closeness * (0.12 + (a.charge + b.charge) * 0.2),
            );
            ctx.lineWidth = 0.6 + closeness * 1.4;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of points) {
        const r = bodySize * (1 + p.charge * 1.5);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        grad.addColorStop(0, hsl(p.hue, 95, 78, 0.95));
        grad.addColorStop(0.35, hsl(p.hue, 90, 60, 0.35 + p.charge * 0.3));
        grad.addColorStop(1, hsl(p.hue, 90, 50, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    },
  };
};

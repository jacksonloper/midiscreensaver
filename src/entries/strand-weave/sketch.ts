import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, clamp, fade, hsl, makeNoise2D, mulberry32, padHue, range } from '../../screensaver/util';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  life: number;
  width: number;
}

const COUNT = 1400;

/**
 * A flow field with dye in it. Particles ride a slowly rotating noise field and
 * leave thin strokes; a pad hit sprays a few dozen fresh particles, tinted to
 * that pad, into the field from one of eight injection points.
 */
export const createStrandWeave: SketchFactory = (): Sketch => {
  const noise = makeNoise2D(4711);
  const rand = mulberry32(20260725);
  const particles: Particle[] = [];
  const sites: { x: number; y: number }[] = [];
  let w = 1;
  let h = 1;
  let drift = 0;

  const spawn = (x: number, y: number, hue: number, energy: number): Particle => ({
    x,
    y,
    vx: (rand() - 0.5) * 40,
    vy: (rand() - 0.5) * 40,
    hue: hue + (rand() - 0.5) * 24,
    life: 0.8 + rand() * 2.6 + energy,
    width: 0.4 + rand() * 1.6,
  });

  return {
    setup({ width, height }) {
      w = width;
      h = height;
      sites.length = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2;
        sites.push({
          x: width / 2 + Math.cos(a) * width * 0.31,
          y: height / 2 + Math.sin(a) * height * 0.31,
        });
      }
      if (particles.length === 0) {
        for (let i = 0; i < COUNT; i++) {
          particles.push(spawn(rand() * width, rand() * height, 210, 0));
        }
      }
    },

    draw({ ctx, width, height, dt, midi }: DrawContext) {
      w = width;
      h = height;
      const [kScale, kCurl, kSpeed, kTrail, kWidth, kDrift, kJet, kHue] = midi.knobs;

      const fieldScale = range(kScale, 0.0008, 0.009);
      const curl = range(kCurl, 0.6, 5.2);
      const speed = range(kSpeed, 25, 320);
      const trailAlpha = range(kTrail, 0.35, 0.012);
      const strokeWidth = range(kWidth, 0.35, 3.2);
      const driftRate = range(kDrift, 0.01, 0.5);
      const jet = range(kJet, 0, 260);
      const hueShift = kHue * 360;

      for (const hit of midi.hits) {
        const site = sites[hit.pad] ?? { x: width / 2, y: height / 2 };
        const burst = Math.round(40 + hit.velocity * 90);
        for (let i = 0; i < burst; i++) {
          const angle = rand() * TAU;
          const spread = rand() * 26;
          const p = spawn(
            site.x + Math.cos(angle) * spread,
            site.y + Math.sin(angle) * spread,
            padHue(hit.pad, hueShift),
            hit.velocity,
          );
          const push = jet * (0.4 + hit.velocity);
          p.vx += Math.cos(angle) * push;
          p.vy += Math.sin(angle) * push;
          // Recycle the oldest particle rather than growing without bound.
          particles[(i * 7 + Math.floor(rand() * particles.length)) % particles.length] = p;
        }
      }

      drift += dt * driftRate;
      fade(ctx, width, height, trailAlpha);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (const p of particles) {
        const angle =
          noise(p.x * fieldScale + drift, p.y * fieldScale - drift * 0.7) * TAU * curl + drift;
        const ax = Math.cos(angle) * speed;
        const ay = Math.sin(angle) * speed;

        // Blend toward the field direction instead of snapping to it: injected
        // particles keep their momentum for a moment before the weave takes over.
        p.vx += (ax - p.vx) * clamp(dt * 3.5, 0, 1);
        p.vy += (ay - p.vy) * clamp(dt * 3.5, 0, 1);

        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;

        ctx.strokeStyle = hsl(p.hue, 78, 60, clamp(p.life * 0.22, 0.02, 0.5));
        ctx.lineWidth = p.width * strokeWidth;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();

        p.x = nx;
        p.y = ny;
        p.life -= dt * 0.32;

        const outside = p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20;
        if (outside || p.life <= 0) {
          p.x = rand() * w;
          p.y = rand() * h;
          p.vx = 0;
          p.vy = 0;
          p.life = 1.2 + rand() * 2.4;
          p.hue = 200 + hueShift + (rand() - 0.5) * 50;
          p.width = 0.4 + rand() * 1.6;
        }
      }

      // A faint marker at each injection site, lit by that pad's energy.
      for (let i = 0; i < 8; i++) {
        const energy = midi.pads[i]?.energy ?? 0;
        const site = sites[i];
        if (!site || energy < 0.02) continue;
        ctx.fillStyle = hsl(padHue(i, hueShift), 90, 70, clamp(energy * 0.5, 0, 0.6));
        ctx.beginPath();
        ctx.arc(site.x, site.y, 3 + energy * 18, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    },
  };
};

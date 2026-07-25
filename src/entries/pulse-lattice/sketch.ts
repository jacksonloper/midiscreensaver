import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { clamp, fade, hsl, makeNoise2D, padHue, range } from '../../screensaver/util';

interface Ring {
  x: number;
  y: number;
  /** Current radius in pixels. */
  r: number;
  /** 1 at birth, 0 when it should be forgotten. */
  life: number;
  hue: number;
  power: number;
}

const MAX_RINGS = 18;

/**
 * A field of dots at rest. Every pad hit drops a ring into the field from that
 * pad's corner of the grid, and the dots lean away from the wavefront as it
 * passes — the whole picture is just "how far is this dot from a ring edge".
 */
export const createPulseLattice: SketchFactory = (): Sketch => {
  const rings: Ring[] = [];
  const anchors: { x: number; y: number }[] = [];
  const noise = makeNoise2D(9101);
  let shimmer = 0;

  return {
    setup({ width, height }) {
      anchors.length = 0;
      for (let i = 0; i < 8; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        anchors.push({
          x: (width * (col + 0.5)) / 4,
          y: (height * (row + 0.7)) / 2.4,
        });
      }
    },

    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kCell, kSpeed, kWidth, kTrail, kHue, kDot, kWarp, kCalm] = midi.knobs;

      const cell = range(kCell, 34, 11);
      const speed = range(kSpeed, 120, 900);
      const bandWidth = range(kWidth, 14, 130);
      const hueShift = kHue * 360;
      const dotSize = range(kDot, 1.2, 5.5);
      const warp = range(kWarp, 0, 26);
      const calm = kCalm;

      for (const hit of midi.hits) {
        const a = anchors[hit.pad] ?? { x: width / 2, y: height / 2 };
        if (rings.length >= MAX_RINGS) rings.shift();
        rings.push({
          x: a.x,
          y: a.y,
          r: 0,
          life: 1,
          hue: padHue(hit.pad, hueShift),
          power: 0.4 + hit.velocity,
        });
      }

      const reach = Math.hypot(width, height);
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.r += speed * dt;
        ring.life -= dt * (0.32 + (ring.r / reach) * 0.5);
        if (ring.life <= 0) rings.splice(i, 1);
      }

      shimmer += dt * range(calm, 0.05, 0.9);
      fade(ctx, width, height, range(kTrail, 0.5, 0.06));

      const cols = Math.ceil(width / cell) + 1;
      const rows = Math.ceil(height / cell) + 1;
      const half = cell / 2;
      const ambient = range(calm, 0.02, 0.3);

      ctx.globalCompositeOperation = 'lighter';

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const gx = col * cell + half;
          const gy = row * cell + half;

          // Resting motion: a slow noise field so the lattice breathes when idle.
          const n = noise(gx * 0.008 + shimmer, gy * 0.008 - shimmer * 0.6);
          let amp = ambient * n;
          let hueMix = 0;
          let hueWeight = 0;
          let pushX = 0;
          let pushY = 0;

          for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            const dx = gx - ring.x;
            const dy = gy - ring.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const delta = dist - ring.r;
            if (delta > bandWidth || delta < -bandWidth) continue;
            const falloff = 1 - Math.abs(delta) / bandWidth;
            const strength = falloff * falloff * ring.life * ring.power * 1.15;
            if (strength <= 0.001) continue;
            amp += strength;
            hueMix += ring.hue * strength;
            hueWeight += strength;
            if (dist > 0.001) {
              const shove = (strength * warp) / dist;
              pushX += dx * shove;
              pushY += dy * shove;
            }
          }

          if (amp < 0.012) continue;
          const a = clamp(amp, 0, 1.3);
          const hue = hueWeight > 0 ? hueMix / hueWeight : (200 + hueShift + n * 40) % 360;
          const size = dotSize * (0.7 + a * 1.7);
          // Lightness is capped below white so overlapping rings stay chromatic.
          ctx.fillStyle = hsl(hue, 88, clamp(30 + a * 34, 0, 74), clamp(0.1 + a * 0.75, 0, 0.95));
          ctx.fillRect(gx + pushX - size / 2, gy + pushY - size / 2, size, size);
        }
      }

      // Wavefronts themselves, drawn faintly so the geometry stays legible.
      ctx.lineWidth = 1.5;
      for (const ring of rings) {
        ctx.strokeStyle = hsl(ring.hue, 90, 62, ring.life * 0.26);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Anchors glow with their pad's residual energy.
      for (let i = 0; i < 8; i++) {
        const energy = midi.pads[i]?.energy ?? 0;
        if (energy < 0.02) continue;
        const a = anchors[i];
        if (!a) continue;
        const r = 4 + energy * 26;
        const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
        grad.addColorStop(0, hsl(padHue(i, hueShift), 90, 70, clamp(energy, 0, 0.8)));
        grad.addColorStop(1, hsl(padHue(i, hueShift), 90, 60, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    },
  };
};

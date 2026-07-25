export const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Map 0..1 onto lo..hi. Knob values arrive normalised, sketches rarely want them that way. */
export const range = (t: number, lo: number, hi: number): number => lo + (hi - lo) * t;

/** Frame-rate independent approach: pull `a` toward `b` with a half-life in seconds. */
export const approach = (a: number, b: number, halfLife: number, dt: number): number =>
  b + (a - b) * Math.pow(0.5, dt / halfLife);

export const hsl = (h: number, s: number, l: number, a = 1): string =>
  `hsla(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;

/** Deterministic 32-bit PRNG so a sketch looks the same on every reload. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice — enough character for flow fields, cheap enough for 60fps. */
export function makeNoise2D(seed = 1337): (x: number, y: number) => number {
  const size = 256;
  const rand = mulberry32(seed);
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rand();

  const at = (xi: number, yi: number): number =>
    table[(((yi & (size - 1)) << 8) | (xi & (size - 1))) >>> 0];

  const fade = (t: number): number => t * t * (3 - 2 * t);

  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const top = lerp(at(xi, yi), at(xi + 1, yi), xf);
    const bottom = lerp(at(xi, yi + 1), at(xi + 1, yi + 1), xf);
    return lerp(top, bottom, yf);
  };
}

/**
 * Paint a translucent black rectangle over everything.
 * The standard trick for motion trails: lower alpha, longer tails.
 */
export function fade(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(4, 5, 10, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

/** Palette anchor for pad n, spread around the wheel with a warm bias. */
export const padHue = (pad: number, shift = 0): number => (pad * 41 + 194 + shift) % 360;

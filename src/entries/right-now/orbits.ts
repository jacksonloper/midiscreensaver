/**
 * JPL's approximate Keplerian elements for the eight planets, valid 1800–2050,
 * and just enough machinery to solve them.
 *
 * Everything here is time-dependent: give it a Julian century and it hands back
 * where a planet actually is, which is what lets the screensaver run the clock
 * forwards and backwards instead of drawing a diagram.
 */

export const AU = 149_597_870.7;
const D2R = Math.PI / 180;

/** a, ȧ, e, ė, I, İ, L, L̇, ϖ, ϖ̇, Ω, Ω̇ — rates are per Julian century. */
export type Kepler = [
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

export interface Elements {
  a: number;
  e: number;
  I: number;
  w: number;
  om: number;
  M: number;
}

export function elementsAt(k: Kepler, T: number): Elements {
  const a = k[0] + k[1] * T;
  const e = k[2] + k[3] * T;
  const I = k[4] + k[5] * T;
  const L = k[6] + k[7] * T;
  const peri = k[8] + k[9] * T;
  const om = k[10] + k[11] * T;
  let M = (L - peri) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  return { a, e, I, w: peri - om, om, M };
}

/** Newton–Raphson on Kepler's equation, then rotate into the ecliptic. */
export function positionAt(el: Elements, meanAnomalyDeg: number): { x: number; y: number } {
  const M = meanAnomalyDeg * D2R;
  let E = M;
  for (let i = 0; i < 30; i++) {
    const d = (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cw = Math.cos(el.w * D2R);
  const sw = Math.sin(el.w * D2R);
  const cO = Math.cos(el.om * D2R);
  const sO = Math.sin(el.om * D2R);
  const ci = Math.cos(el.I * D2R);
  return {
    x: (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    y: (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
  };
}

/** Julian date for a JavaScript timestamp, and back again. */
export const jdFromMs = (ms: number): number => ms / 86_400_000 + 2_440_587.5;
export const msFromJd = (jd: number): number => (jd - 2_440_587.5) * 86_400_000;
export const centuriesFromJd = (jd: number): number => (jd - 2_451_545.0) / 36_525;

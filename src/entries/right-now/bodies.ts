import { mulberry32 } from '../../screensaver/util';
import type { Kepler } from './orbits';

/** Concentric cloud belts — what banding looks like from over a pole. */
export interface Band {
  i: number;
  o: number;
  c: string;
  a: number;
}

export interface Blob {
  x: number;
  y: number;
  r: number;
  c: string;
  a: number;
}

function ringBands(seed: number, cols: string[], aMin: number, aMax: number): Band[] {
  const r = mulberry32(seed);
  const out: Band[] = [];
  let i = 0;
  while (i < 0.99) {
    const h = 0.05 + r() * 0.13;
    out.push({
      i,
      o: Math.min(1, i + h),
      c: cols[Math.floor(r() * cols.length)],
      a: aMin + r() * (aMax - aMin),
    });
    i += h + r() * 0.02;
  }
  return out;
}

function blobSet(seed: number, n: number, cols: string[], rMax: number, aMax: number): Blob[] {
  const r = mulberry32(seed);
  const out: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.88;
    out.push({
      x: Math.cos(ang) * rad,
      y: Math.sin(ang) * rad,
      r: 0.07 + r() * rMax,
      c: cols[Math.floor(r() * cols.length)],
      a: 0.1 + r() * aMax,
    });
  }
  return out;
}

export interface Seed {
  name: string;
  /** Kilometres. */
  diameter: number;
  color: string;
  light: string;
  dark: string;
  atmo?: string;
  /** Where the rotation pole falls on the visible disc, seen from the north. */
  pole?: { x: number; y: number };
  cap?: number;
  bands?: Band[];
  linearBands?: boolean;
  blobs?: Blob[];
  rings?: { i: number; o: number; a: number }[];
  ringSquash?: number;
  spot?: { x: number; y: number; r: number; c: string };
  sun?: boolean;
  orbit?: Kepler;
  note: string;
}

/** The Sun first, then the eight planets in order — one per pad. */
export const SEEDS: Seed[] = [
  {
    name: 'Sun',
    diameter: 1_391_400,
    color: '#ffbe45',
    light: '#fff6d8',
    dark: '#e0761a',
    sun: true,
    note: 'Everything else here is falling around this.',
  },
  {
    name: 'Mercury',
    diameter: 4_879,
    color: '#9a8f85',
    light: '#cec4b8',
    dark: '#4a423c',
    blobs: blobSet(11, 26, ['#7d7268', '#b6aa9d', '#6a6058'], 0.2, 0.3),
    orbit: [
      0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235,
      149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081,
    ],
    note: 'Fastest orbit here: a year every 88 days.',
  },
  {
    name: 'Venus',
    diameter: 12_104,
    color: '#dcc08a',
    light: '#fbf0d2',
    dark: '#7a5f34',
    atmo: '#f3dda5',
    pole: { x: 0.04, y: -0.06 },
    bands: ringBands(23, ['#f0dcae', '#c9a875', '#e6cd9a'], 0.07, 0.2),
    orbit: [
      0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995,
      58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418,
    ],
    note: 'The roundest orbit of the eight.',
  },
  {
    name: 'Earth',
    diameter: 12_756,
    color: '#2f6cad',
    light: '#7fb4e0',
    dark: '#0b2645',
    atmo: '#8fc4f0',
    pole: { x: 0.12, y: -0.33 },
    cap: 0.2,
    blobs: blobSet(37, 16, ['#4a7c46', '#6d8f4a', '#3d6b3f', '#b8a678'], 0.26, 0.5),
    orbit: [
      1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166,
      35999.37244981, 102.93768193, 0.32327364, 0, 0,
    ],
    note: 'You are somewhere on this one.',
  },
  {
    name: 'Mars',
    diameter: 6_792,
    color: '#b8532c',
    light: '#e08a5c',
    dark: '#4d1c0e',
    pole: { x: 0.16, y: -0.36 },
    cap: 0.17,
    blobs: blobSet(53, 20, ['#8f3d20', '#cf7248', '#6d3018'], 0.24, 0.35),
    orbit: [
      1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205,
      19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343,
    ],
    note: 'Its orbit is lopsided enough to notice from here.',
  },
  {
    name: 'Jupiter',
    diameter: 142_984,
    color: '#c99a68',
    light: '#f0dcbe',
    dark: '#5c3d22',
    atmo: '#e8cfa8',
    pole: { x: 0.02, y: -0.05 },
    bands: ringBands(71, ['#f2e0c4', '#a8703f', '#d9b389', '#8a5a32'], 0.13, 0.38),
    spot: { x: 0.34, y: 0.42, r: 0.14, c: '#c25a3a' },
    orbit: [
      5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051,
      3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106,
    ],
    note: 'Tilted only 3°, so from up here you see its pole.',
  },
  {
    name: 'Saturn',
    diameter: 120_536,
    color: '#d6bb84',
    light: '#f7ecd0',
    dark: '#6b562c',
    atmo: '#efdcae',
    pole: { x: 0.14, y: -0.4 },
    bands: ringBands(89, ['#f5e8c8', '#c0a06e', '#dcc394'], 0.09, 0.26),
    rings: [
      { i: 1.24, o: 1.52, a: 0.3 },
      { i: 1.52, o: 1.95, a: 0.6 },
      { i: 1.95, o: 2.02, a: 0.07 },
      { i: 2.02, o: 2.27, a: 0.36 },
    ],
    ringSquash: 0.89,
    orbit: [
      9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423,
      1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794,
    ],
    note: 'From this angle the rings sit nearly face-on.',
  },
  {
    name: 'Uranus',
    diameter: 51_118,
    color: '#8fd0d4',
    light: '#d6f3f4',
    dark: '#2c6a70',
    atmo: '#b6e6e8',
    linearBands: true,
    bands: ringBands(101, ['#a8dde0', '#78bcc2'], 0.05, 0.13),
    orbit: [
      19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451,
      428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589,
    ],
    note: 'Rolled 98° over, so its equator faces us instead.',
  },
  {
    name: 'Neptune',
    diameter: 49_528,
    color: '#3a5fc4',
    light: '#8fa8ea',
    dark: '#141f52',
    atmo: '#7d9be8',
    pole: { x: 0.1, y: -0.42 },
    bands: ringBands(113, ['#5a7cd8', '#2a4497'], 0.09, 0.22),
    spot: { x: -0.3, y: 0.36, r: 0.12, c: '#1b2c72' },
    orbit: [
      30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969,
      218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664,
    ],
    note: 'One lap takes 165 years. It has done one since discovery.',
  },
];

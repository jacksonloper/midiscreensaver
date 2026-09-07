import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, lerp, mulberry32, range } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const DEG = 180 / Math.PI;

export const WORLDS = ['temperate', 'desert', 'jungle', 'frozen'];
export const TOWNS = ['village', 'town', 'city', 'wilderness'];

/** The four corners of a building's footprint, in east/north tangent signs. */
const BOX: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** How tall and how wide the buildings of each town style are. */
const STYLE_H = [0.6, 1, 1.6, 0];
const STYLE_W = [1.3, 1, 0.78, 1];

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Ink {
  h: number;
  s: number;
  l: number;
}

interface World {
  sea: Ink;
  land: Ink;
  ice: Ink;
  /** Hue of the air, used for the rim glow. */
  sky: number;
}

const WORLD_INK: World[] = [
  {
    sea: { h: 205, s: 55, l: 33 },
    land: { h: 104, s: 34, l: 41 },
    ice: { h: 196, s: 22, l: 88 },
    sky: 202,
  },
  {
    sea: { h: 184, s: 44, l: 34 },
    land: { h: 33, s: 52, l: 48 },
    ice: { h: 42, s: 20, l: 87 },
    sky: 34,
  },
  {
    sea: { h: 190, s: 52, l: 29 },
    land: { h: 132, s: 44, l: 36 },
    ice: { h: 168, s: 18, l: 86 },
    sky: 158,
  },
  {
    sea: { h: 213, s: 38, l: 38 },
    land: { h: 208, s: 12, l: 64 },
    ice: { h: 202, s: 16, l: 93 },
    sky: 208,
  },
];

const NAMES = [
  'ADA', 'BO', 'CLEO', 'DEV', 'ESME', 'FEN', 'GUS', 'HANA',
  'INES', 'JO', 'KIT', 'LEV', 'MARA', 'NILS', 'ODE', 'PIA',
  'QUIN', 'REX', 'SANA', 'TAM', 'UMA', 'VIC', 'WREN', 'YURI',
];

const sphere = (lat: number, lon: number): Vec3 => ({
  x: Math.cos(lat) * Math.cos(lon),
  y: Math.sin(lat),
  z: Math.cos(lat) * Math.sin(lon),
});

const norm = (v: Vec3): Vec3 => {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Unit tangent pointing the way the ground moves as the planet turns — east,
 * by definition. Undefined at the poles, where nothing stands anyway.
 */
const eastAt = (n: Vec3): Vec3 => norm({ x: -n.z, y: 0, z: n.x });

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Rotation about a unit axis by `ang`, as a row-major 3x3. */
function spinAbout(
  ax: number,
  ay: number,
  az: number,
  ang: number,
  out: Float64Array,
): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const k = 1 - c;
  out[0] = c + ax * ax * k;
  out[1] = ax * ay * k - az * s;
  out[2] = ax * az * k + ay * s;
  out[3] = ay * ax * k + az * s;
  out[4] = c + ay * ay * k;
  out[5] = ay * az * k - ax * s;
  out[6] = az * ax * k - ay * s;
  out[7] = az * ay * k + ax * s;
  out[8] = c + az * az * k;
}

const MUL_TMP = new Float64Array(9);

/** out = a · b, safe to call with out aliasing either. */
function mul3(a: Float64Array, b: Float64Array, out: Float64Array): void {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      MUL_TMP[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  out.set(MUL_TMP);
}

const ink = (c: Ink, a = 1): string => hsl(c.h, c.s, c.l, a);

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** 34.2 -> "34°N". The equator gets no letter. */
const latText = (deg: number): string => {
  const r = Math.round(Math.abs(deg));
  return r === 0 ? '0°' : `${r}°${deg > 0 ? 'N' : 'S'}`;
};

/* --------------------------------------------------------------- the world */

const TOWN_COUNT = 16;
/** Person, building, tree. */
type Kind = 0 | 1 | 2;

interface Thing {
  kind: Kind;
  town: number;
  /** Where it lives, in planet coordinates, before the planet has turned. */
  n: Vec3;
  east: Vec3;
  /** The other tangent, so a walk can go any direction across the ground. */
  north: Vec3;
  lat: number;
  lon: number;
  /** Index into the walkers' arrays, or -1 for whatever stays put. */
  walk: number;
  /** How far from home this one strays, in radians, and how fast it doubles back. */
  strayR: number;
  strayA: number;
  strayB: number;
  strayP: number;
  strayQ: number;
  /** Height above the ground, as a fraction of the planet's radius. */
  h: number;
  /** Half width, same units. Buildings only. */
  w: number;
  hue: number;
  /** 0..1, fixed per thing: footprint depth, window rows, lamp flicker. */
  seed: number;
  name: string;
}

interface Continent {
  n: Vec3;
  radius: number;
  phase: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  seed: number;
}

/**
 * Everything on the surface, laid out once. Towns are clusters: a handful of
 * buildings with people standing between them, so the crowd knob can reveal
 * whole settlements rather than scattering strangers over the ocean.
 */
function buildThings(land: Continent[]): Thing[] {
  const rand = mulberry32(20260907);
  const things: Thing[] = [];
  let walkers = 0;

  for (let town = 0; town < TOWN_COUNT; town++) {
    // Towns go on a continent rather than anywhere on the sphere: well inside
    // it, so they are still on dry land when the sea comes up.
    const home = land[town % land.length];
    const away = home.radius * 0.4 * Math.sqrt(rand());
    const bearing = rand() * TAU;
    const he = eastAt(home.n);
    const hn = cross(home.n, he);
    const ca = Math.cos(away);
    const sa = Math.sin(away);
    const cb = Math.cos(bearing);
    const sb = Math.sin(bearing);
    const c = norm({
      x: home.n.x * ca + (he.x * cb + hn.x * sb) * sa,
      y: home.n.y * ca + (he.y * cb + hn.y * sb) * sa,
      z: home.n.z * ca + (he.z * cb + hn.z * sb) * sa,
    });
    const e = eastAt(c);
    const up = cross(c, e);
    const spread = 0.045 + rand() * 0.075;

    const place = (kind: Kind, h: number, w: number, hue: number, name: string): void => {
      const du = (rand() * 2 - 1) * spread;
      const dv = (rand() * 2 - 1) * spread;
      const n = norm({
        x: c.x + e.x * du + up.x * dv,
        y: c.y + e.y * du + up.y * dv,
        z: c.z + e.z * du + up.z * dv,
      });
      const east = eastAt(n);
      const walker = kind === 0;
      things.push({
        kind,
        town,
        n,
        east,
        north: cross(n, east),
        lat: Math.asin(clamp(n.y, -1, 1)),
        lon: Math.atan2(n.z, n.x),
        // Two out-of-step sways across the ground make a loop that never quite
        // repeats — an amble round the village rather than a lap of a circle.
        walk: walker ? walkers++ : -1,
        strayR: walker ? spread * (0.5 + rand() * 0.7) : 0,
        strayA: 0.5 + rand() * 0.5,
        strayB: 0.31 + rand() * 0.4,
        strayP: rand() * TAU,
        strayQ: rand() * TAU,
        h,
        w,
        hue,
        seed: rand(),
        name,
      });
    };

    const houses = 2 + Math.floor(rand() * 5);
    for (let i = 0; i < houses; i++) {
      place(1, 0.038 + rand() * 0.062, 0.016 + rand() * 0.012, 24 + rand() * 34, '');
    }
    const folk = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < folk; i++) {
      const dressed = rand() < 0.55 ? 6 + rand() * 52 : 208 + rand() * 92;
      place(0, 0.055 + rand() * 0.022, 0, dressed, NAMES[things.length % NAMES.length]);
    }
    const trees = Math.floor(rand() * 5);
    for (let i = 0; i < trees; i++) {
      place(2, 0.034 + rand() * 0.03, 0, 96 + rand() * 46, '');
    }
  }

  return things;
}

const LAND_COUNT = 14;
/** The golden angle, which spreads points over a sphere without clumping. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function buildContinents(): Continent[] {
  const rand = mulberry32(4711);
  const out: Continent[] = [];
  for (let i = 0; i < LAND_COUNT; i++) {
    // Spiralled rather than scattered, so no hemisphere comes up all ocean.
    // The 0.8 keeps them off the poles: ice stays ice and towns stay habitable.
    const lat = Math.asin(((1 - (2 * i + 1) / LAND_COUNT) * 0.8 + (rand() - 0.5) * 0.08));
    out.push({
      n: sphere(lat, i * GOLDEN + (rand() - 0.5) * 0.5),
      radius: 0.22 + rand() * 0.3,
      phase: rand() * TAU,
    });
  }
  return out;
}

function buildStars(): Star[] {
  const rand = mulberry32(90210);
  const out: Star[] = [];
  for (let i = 0; i < 260; i++) {
    out.push({ x: rand(), y: rand(), r: 0.3 + rand() * rand() * 1.9, seed: rand() * TAU });
  }
  return out;
}

/** How many points trace the edge of a continent or an ice cap. */
const CAP_SEG = 56;
/** How many trace the horizon, and how many the day-night line. */
const HZ_SEG = 128;
const TERM_STEPS = 96;
const HZ_ARC = 96;
const LOOP_MAX = TERM_STEPS + HZ_ARC + 4;

/**
 * A tiny planet, drawn the way a picture book draws one: a whole world small
 * enough to hold in view at once, with people standing on it at right angles
 * to the ground and their houses beside them. The sphere is projected
 * orthographically, so a citizen at the limb is seen from the side and one in
 * the middle of the disc is seen from directly above — as a dot, which is what
 * a person looks like from over their head.
 *
 * The sun is a fixed direction; the planet turns under it, so day and night are
 * not drawn on, they are where each citizen happens to be standing. The axis
 * leans, and the sun sits somewhere in the orbital plane, which between them
 * decide the seasons and whether a pole is in permanent daylight.
 */
export const createTinyPlanet: SketchFactory = (): Sketch => {
  const continents = buildContinents();
  const things = buildThings(continents);
  const people = things.filter((t) => t.kind === 0);
  const stars = buildStars();

  // Scratch for the loop tracer below: a closed run of points on the planet,
  // their camera-space coordinates, and where each one lands on screen.
  const loopCam = new Float64Array(LOOP_MAX * 3);
  const loopDepth = new Float64Array(LOOP_MAX);
  const loopSX = new Float64Array(LOOP_MAX);
  const loopSY = new Float64Array(LOOP_MAX);
  // Planet-to-camera as one 3x3, so the descent can compose its own turn onto
  // the end of it without another pass over every point.
  const mBase = new Float64Array(9);
  const mAim = new Float64Array(9);
  const mSwing = new Float64Array(9);
  const mat = new Float64Array(9);

  // Where every walker has got to. Their own clock rather than the sketch's,
  // because they slow down at night, so they cannot share one.
  const walkT = new Float64Array(people.length);
  const strideT = new Float64Array(people.length);
  const walkAt = new Float64Array(people.length * 3);
  const walkDir = new Float64Array(people.length * 3);

  /** Visible things, refilled and depth-sorted every frame. */
  const shown: {
    thing: Thing;
    /** Where it is standing this frame, in planet coordinates. */
    at: Vec3;
    /** Which way it is walking, in planet coordinates; zero for a fixture. */
    dir: Vec3;
    stride: number;
    /** How far in front of the camera it is, which is what sorts them. */
    z: number;
    lit: number;
  }[] = [];

  let spin = 0;
  let world = 0;
  let style = 1;
  let graticule = true;
  let labels = true;
  let caps = true;
  let lamps = true;
  let starry = true;
  let follow = 0;

  let sTilt = 0;
  let sView = 0;
  let sFolk = 1;
  let sSky = 1;
  let sAlt = 0;
  /** Where the camera is heading, in planet coordinates, eased. */
  const aimAt: Vec3 = { x: 0, y: 0, z: 1 };
  let started = false;

  let toast = '';
  let toastAge = 99;

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      const [kSpin, kTilt, kSun, kFolk, kView, kAlt, kCrowd, kSkyline] = midi.knobs;

      /* ------------------------------------------------------------ pads */

      const say = (text: string): void => {
        toast = text;
        toastAge = 0;
      };

      const townsShown = Math.round(range(kCrowd, 1, TOWN_COUNT));
      const nextPerson = (from: number): number => {
        for (let i = 1; i <= people.length; i++) {
          const j = (from + i) % people.length;
          if (people[j].town < townsShown) return j;
        }
        return from;
      };

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
            world = (world + 1) % WORLDS.length;
            say(`world · ${WORLDS[world]}`);
            break;
          case 1:
            graticule = !graticule;
            say(`grid · ${graticule ? 'on' : 'off'}`);
            break;
          case 2:
            labels = !labels;
            say(`labels · ${labels ? 'on' : 'off'}`);
            break;
          case 3:
            caps = !caps;
            say(`ice caps · ${caps ? 'on' : 'off'}`);
            break;
          case 4:
            style = (style + 1) % TOWNS.length;
            say(`buildings · ${TOWNS[style]}`);
            break;
          case 5:
            lamps = !lamps;
            say(`night lights · ${lamps ? 'on' : 'off'}`);
            break;
          case 6:
            starry = !starry;
            say(`stars · ${starry ? 'on' : 'off'}`);
            break;
          default:
            follow = nextPerson(follow);
            say(`following ${people[follow].name.toLowerCase()}`);
            break;
        }
      }

      if (people[follow].town >= townsShown) follow = nextPerson(follow);
      toastAge += dt;

      /* ----------------------------------------------------------- knobs */

      const turnsPerSecond = range(kSpin, 0, 0.42);
      spin += turnsPerSecond * TAU * dt;

      const tilt = range(kTilt, 0, 0.73);
      const sunPhase = range(kSun, 0, TAU);
      const view = range(kView, -0.16, 1.24);
      const folk = range(kFolk, 0.35, 1.9);
      const skyline = range(kSkyline, 0.45, 1.75);
      // Altitude above the ground, in planet radii, on a log scale: the same
      // turn of the knob is the same fraction of the way up, all the way from
      // standing among the houses to a long way out.
      const altLog = range(kAlt, Math.log(0.16), Math.log(26));

      // Ease the shape of the world so a knob sweep is a camera move, not a
      // jump. The first frame takes the knobs as they are: there is no previous
      // position to come from, and no dt to come from it with.
      if (started) {
        sTilt = approach(sTilt, tilt, 0.07, dt);
        sView = approach(sView, view, 0.07, dt);
        sFolk = approach(sFolk, folk, 0.07, dt);
        sSky = approach(sSky, skyline, 0.07, dt);
        sAlt = approach(sAlt, altLog, 0.07, dt);
      } else {
        sTilt = tilt;
        sView = view;
        sFolk = folk;
        sSky = skyline;
        sAlt = altLog;
        started = true;
      }

      const cx = width / 2;
      // The page lays its own control strip over the bottom of the stage, so
      // the planet lives in what is left and the south pole stays in view.
      const stage = height * 0.78;
      const cy = stage * 0.5;
      const frame = Math.min(width, stage);
      const pal = WORLD_INK[world];

      /* ------------------------------------------------------- the camera */

      // A camera with a lens, hanging `alt` radii above the ground on the +z
      // axis and looking back down it. Everything below is written in that
      // frame, which is what makes the whole horizon one inequality: a point
      // on the surface can be seen exactly when its z is above 1/D.
      const alt = Math.exp(sAlt);
      const D = 1 + alt;
      const invD = 1 / D;
      /** Radius of the horizon, taken as a circle of latitude about +z. */
      const hzR = Math.sqrt(Math.max(0, 1 - invD * invD));
      /** Focal length in pixels: a fixed field of view, about 55° tall. */
      const f = frame * 0.95;
      /** What the planet's radius comes to on screen — unbounded up close. */
      const R = f / Math.sqrt(Math.max(1e-6, D * D - 1));
      /** A bounded stand-in for it, for line weights and glows. */
      const gauge = Math.min(R, frame * 0.6);
      // On the way down the camera tips up, from looking at the middle of the
      // planet to looking a little over the horizon. Without it you arrive
      // nose-down, with the people directly beneath you and no sky at all.
      const drop = clamp((1.3 - alt) / 1.25, 0, 1);
      /** How far down the descent has come, 0 out in space and 1 on the ground. */
      const aim = drop * drop * (3 - 2 * drop);
      const pitch = aim * (Math.asin(invD) + 0.12);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const NEAR = 0.0025;
      /** Where a point that has slipped behind the camera gets thrown. */
      const FAR = Math.hypot(width, height) * 9;

      /* ------------------------------------------------ planet to camera */

      const cs = Math.cos(spin);
      const ss = Math.sin(spin);
      const ct = Math.cos(sTilt);
      const st = Math.sin(sTilt);
      const cv = Math.cos(sView);
      const sv = Math.sin(sView);

      // Turn the planet on its axis, lean the axis over by the tilt, then tip
      // the whole thing towards the viewer — gathered up as one matrix so the
      // descent below can add its own turn to the end of it.
      let px = 0;
      let py = 0;
      let pz = 0;
      const chain = (x: number, y: number, z: number, col: number): void => {
        const x0 = x * cs - z * ss;
        const z0 = x * ss + z * cs;
        const x1 = x0 * ct + y * st;
        const y1 = -x0 * st + y * ct;
        mBase[col] = x1;
        mBase[3 + col] = y1 * cv - z0 * sv;
        mBase[6 + col] = y1 * sv + z0 * cv;
      };
      chain(1, 0, 0, 0);
      chain(0, 1, 0, 1);
      chain(0, 0, 1, 2);

      // Swing the target under the camera, and then a little in front of it,
      // by however much of the way down we are. `standOff` is where a ray
      // through the lower part of the frame meets the ground, so the person
      // being followed ends up standing there rather than under your feet.
      const tX = mBase[0] * aimAt.x + mBase[1] * aimAt.y + mBase[2] * aimAt.z;
      const tY = mBase[3] * aimAt.x + mBase[4] * aimAt.y + mBase[5] * aimAt.z;
      const tZ = mBase[6] * aimAt.x + mBase[7] * aimAt.y + mBase[8] * aimAt.z;
      const swing = Math.hypot(tX, tY);
      const ray = Math.max(0.02, pitch - Math.atan2(stage * 0.22, f));
      const standOff = Math.asin(clamp(D * Math.sin(ray), 0, 0.999)) - ray;
      if (swing > 1e-6) {
        spinAbout(tY / swing, -tX / swing, 0, Math.acos(clamp(tZ, -1, 1)) * aim, mAim);
      } else {
        spinAbout(1, 0, 0, 0, mAim);
      }
      spinAbout(1, 0, 0, -standOff * aim, mSwing);
      mul3(mSwing, mAim, mAim);
      mul3(mAim, mBase, mat);

      const rot = (x: number, y: number, z: number): void => {
        px = mat[0] * x + mat[1] * y + mat[2] * z;
        py = mat[3] * x + mat[4] * y + mat[5] * z;
        pz = mat[6] * x + mat[7] * y + mat[8] * z;
      };
      const rotV = (v: Vec3): Vec3 => {
        rot(v.x, v.y, v.z);
        return { x: px, y: py, z: pz };
      };

      let sX = 0;
      let sY = 0;
      let sZ = 0;
      /**
       * Camera coordinates onto the screen. `sZ` comes back as the distance in
       * front of the camera, which is both what to sort by and what to divide
       * sizes by — one planet radius is `f / sZ` pixels at that distance.
       */
      const proj = (x: number, y: number, z: number): void => {
        const dz = z - D;
        const vy = y * cosP + dz * sinP;
        sZ = y * sinP - dz * cosP;
        const k = f / (sZ > NEAR ? sZ : NEAR);
        sX = cx + x * k;
        sY = cy - vy * k;
      };

      /**
       * A closed run of points in `loopCam` as a path. Whatever has gone
       * behind the camera is cut off at the near plane and the path closed
       * round the outside of the frame — which is what lets the ground still
       * be a region to fill when you are standing on it and the horizon runs
       * off both sides of the picture.
       */
      const addLoop = (count: number): boolean => {
        let front = 0;
        for (let i = 0; i < count; i++) {
          proj(loopCam[i * 3], loopCam[i * 3 + 1], loopCam[i * 3 + 2]);
          loopDepth[i] = sZ;
          loopSX[i] = sX;
          loopSY[i] = sY;
          if (sZ > NEAR) front++;
        }
        if (front === 0) return false;
        if (front === count) {
          ctx.moveTo(loopSX[0], loopSY[0]);
          for (let i = 1; i < count; i++) ctx.lineTo(loopSX[i], loopSY[i]);
          ctx.closePath();
          return true;
        }

        let start = 0;
        for (let i = 0; i < count; i++) {
          if (loopDepth[i] > NEAR && loopDepth[(i + count - 1) % count] <= NEAR) {
            start = i;
            break;
          }
        }
        /** The point where edge a→b crosses the near plane, thrown far out. */
        const edge = (a: number, b: number): void => {
          const t = (NEAR - loopDepth[a]) / (loopDepth[b] - loopDepth[a]);
          proj(
            loopCam[a * 3] + (loopCam[b * 3] - loopCam[a * 3]) * t,
            loopCam[a * 3 + 1] + (loopCam[b * 3 + 1] - loopCam[a * 3 + 1]) * t,
            loopCam[a * 3 + 2] + (loopCam[b * 3 + 2] - loopCam[a * 3 + 2]) * t,
          );
          const dx = sX - cx;
          const dy = sY - cy;
          const m = Math.hypot(dx, dy) || 1;
          sX = cx + (dx / m) * FAR;
          sY = cy + (dy / m) * FAR;
        };

        edge((start + count - 1) % count, start);
        const inAx = sX;
        const inAy = sY;
        ctx.moveTo(inAx, inAy);
        let sumX = 0;
        let sumY = 0;
        let held = 0;
        let last = start;
        for (let i = start; loopDepth[i] > NEAR; i = (i + 1) % count) {
          ctx.lineTo(loopSX[i], loopSY[i]);
          sumX += loopSX[i];
          sumY += loopSY[i];
          held++;
          last = i;
          if ((i + 1) % count === start) break;
        }
        edge((last + 1) % count, last);
        ctx.lineTo(sX, sY);

        // Close the far side the way round that keeps the region itself in.
        // Any average of the visible boundary is inside it, these shapes being
        // convex, so that is the point the arc has to sweep past.
        const phiB = Math.atan2(sY - cy, sX - cx);
        const phiA = Math.atan2(inAy - cy, inAx - cx);
        const phiI = Math.atan2(sumY / held - cy, sumX / held - cx);
        const spanBA = (((phiA - phiB) % TAU) + TAU) % TAU;
        const spanBI = (((phiI - phiB) % TAU) + TAU) % TAU;
        ctx.arc(cx, cy, FAR, phiB, phiA, spanBI > spanBA);
        ctx.closePath();
        return true;
      };

      /** The ground: everything this side of the horizon. */
      const addGround = (): boolean => {
        for (let i = 0; i < HZ_SEG; i++) {
          const a = (i / HZ_SEG) * TAU;
          loopCam[i * 3] = hzR * Math.cos(a);
          loopCam[i * 3 + 1] = hzR * Math.sin(a);
          loopCam[i * 3 + 2] = invD;
        }
        return addLoop(HZ_SEG);
      };

      // The sun is a direction, not a place: it sits in the orbital plane, and
      // only the view tips it. The axis leans against it, which is the season.
      const sun0 = {
        x: Math.cos(sunPhase),
        y: -Math.sin(sunPhase) * sv,
        z: Math.sin(sunPhase) * cv,
      };
      const sun = {
        x: mAim[0] * sun0.x + mAim[1] * sun0.y + mAim[2] * sun0.z,
        y: mAim[3] * sun0.x + mAim[4] * sun0.y + mAim[5] * sun0.z,
        z: mAim[6] * sun0.x + mAim[7] * sun0.y + mAim[8] * sun0.z,
      };
      const axis = rotV({ x: 0, y: 1, z: 0 });
      const subsolarLat = Math.asin(clamp(Math.cos(sunPhase) * st, -1, 1));
      // Where noon is, in planet longitude — the sun's direction taken back
      // through the tilt and the spin.
      const swX = Math.cos(sunPhase) * ct;
      const swZ = Math.sin(sunPhase);
      const subsolarLon = Math.atan2(swZ * cs - swX * ss, swX * cs + swZ * ss);

      // Everybody takes a step, whichever side of the planet they are on, so
      // nobody is standing exactly where you left them when they come back
      // round. The sun in planet coordinates says whether it is day where each
      // of them is: they amble about in the light and shuffle at night.
      const sunHere = sphere(subsolarLat, subsolarLon);
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const t = walkT[i];
        const du = p.strayR * Math.sin(p.strayA * t + p.strayP);
        const dv = p.strayR * Math.sin(p.strayB * t + p.strayQ);
        const at = norm({
          x: p.n.x + p.east.x * du + p.north.x * dv,
          y: p.n.y + p.east.y * du + p.north.y * dv,
          z: p.n.z + p.east.z * du + p.north.z * dv,
        });
        walkAt[i * 3] = at.x;
        walkAt[i * 3 + 1] = at.y;
        walkAt[i * 3 + 2] = at.z;

        const dU = p.strayR * p.strayA * Math.cos(p.strayA * t + p.strayP);
        const dV = p.strayR * p.strayB * Math.cos(p.strayB * t + p.strayQ);
        const dir = norm({
          x: p.east.x * dU + p.north.x * dV,
          y: p.east.y * dU + p.north.y * dV,
          z: p.east.z * dU + p.north.z * dV,
        });
        walkDir[i * 3] = dir.x;
        walkDir[i * 3 + 1] = dir.y;
        walkDir[i * 3 + 2] = dir.z;

        const day = clamp((at.x * sunHere.x + at.y * sunHere.y + at.z * sunHere.z + 0.07) / 0.2);
        const pace = 0.5 + 1.7 * day;
        walkT[i] += dt * pace;
        // One stride per half a body length covered, so the legs keep up with
        // whatever the speed and the size knob are doing.
        const speed = Math.hypot(dU, dV) * pace;
        strideT[i] += (dt * speed) / Math.max(0.006, p.h * sFolk * 0.42);
      }

      /* ---------------------------------------------------- coming down */

      // Where the descent is headed: whoever is being followed. Without this
      // you come down at whatever spot the knobs happen to point at, which is
      // usually a stretch of empty ocean. Eased, so switching who you are
      // following swings the camera round rather than cutting to them.
      const me = people[follow];
      const meAt: Vec3 = {
        x: walkAt[me.walk * 3],
        y: walkAt[me.walk * 3 + 1],
        z: walkAt[me.walk * 3 + 2],
      };
      if (started) {
        aimAt.x = approach(aimAt.x, meAt.x, 0.32, dt);
        aimAt.y = approach(aimAt.y, meAt.y, 0.32, dt);
        aimAt.z = approach(aimAt.z, meAt.z, 0.32, dt);
        const m = Math.hypot(aimAt.x, aimAt.y, aimAt.z) || 1;
        aimAt.x /= m;
        aimAt.y /= m;
        aimAt.z /= m;
      } else {
        aimAt.x = meAt.x;
        aimAt.y = meAt.y;
        aimAt.z = meAt.z;
      }

      /* ----------------------------------------------------- the daylight */

      // The terminator is the great circle at right angles to the sun. The run
      // of it above the horizon, closed along the horizon on the sunward side,
      // encloses everywhere it is currently day.
      const sunSpan = Math.hypot(sun.x, sun.y);
      let ux = 0;
      let uy = 0;
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (sunSpan > 1e-6) {
        ux = sun.y / sunSpan;
        uy = -sun.x / sunSpan;
        vx = (sun.z * sun.x) / sunSpan;
        vy = (sun.z * sun.y) / sunSpan;
        vz = -sunSpan;
      }
      // Along the circle, z is -sunSpan·sin t, so the visible run is the arc
      // where that clears the horizon. When it never does, the whole of what
      // you can see is on one side of the line or the other.
      const termK = sunSpan > 1e-6 ? invD / sunSpan : 2;
      const termSeen = termK < 0.999;
      const termA = termSeen ? Math.asin(clamp(termK, -1, 1)) : 0;
      /** A point on the visible run of the terminator, 0..1 across it. */
      const termPoint = (u: number): Vec3 => {
        const t = -Math.PI + termA + (Math.PI - 2 * termA) * u;
        const c = Math.cos(t);
        const s = Math.sin(t);
        return { x: ux * c + vx * s, y: uy * c + vy * s, z: vz * s };
      };
      const addLit = (): boolean => {
        let n = 0;
        for (let i = 0; i <= TERM_STEPS; i++) {
          const p = termPoint(i / TERM_STEPS);
          loopCam[n * 3] = p.x;
          loopCam[n * 3 + 1] = p.y;
          loopCam[n * 3 + 2] = p.z;
          n++;
        }
        // Both ends sit on the horizon; come back round it the lit way.
        const phi1 = Math.atan2(loopCam[(n - 1) * 3 + 1], loopCam[(n - 1) * 3]);
        const phi0 = Math.atan2(loopCam[1], loopCam[0]);
        let span = (((phi0 - phi1) % TAU) + TAU) % TAU;
        const mid = phi1 + span / 2;
        if (hzR * Math.cos(mid) * sun.x + hzR * Math.sin(mid) * sun.y + invD * sun.z <= 0) {
          span -= TAU;
        }
        for (let i = 1; i < HZ_ARC; i++) {
          const a = phi1 + (span * i) / HZ_ARC;
          loopCam[n * 3] = hzR * Math.cos(a);
          loopCam[n * 3 + 1] = hzR * Math.sin(a);
          loopCam[n * 3 + 2] = invD;
          n++;
        }
        return addLoop(n);
      };
      // With no line in sight, the ground under the camera settles it.
      const anyDay = termSeen || sun.z > 0;
      const anyNight = termSeen || sun.z <= 0;

      /* ------------------------------------------------------- the canvas */

      ctx.globalCompositeOperation = 'source-over';
      const space = ctx.createLinearGradient(0, 0, 0, height);
      space.addColorStop(0, '#04050c');
      space.addColorStop(1, hsl(pal.sky, 26, 6));
      ctx.fillStyle = space;
      ctx.fillRect(0, 0, width, height);

      if (starry) {
        for (const s of stars) {
          const tw = 0.55 + 0.45 * Math.sin(time * 1.7 + s.seed);
          ctx.fillStyle = hsl(210, 30, 92, 0.16 + tw * 0.5);
          ctx.beginPath();
          ctx.arc(s.x * width, s.y * height, s.r, 0, TAU);
          ctx.fill();
        }
      }

      // The sun. It is a direction rather than a place, so it projects like
      // one: when it is in front of the camera — which, down on the ground,
      // means near sunrise or sunset — it goes where it really is. Otherwise
      // it is behind you, and all that is left is a glow off that side.
      const sunAhead = sun.y * sinP - sun.z * cosP;
      if (sunAhead > 0.08) {
        const k = f / sunAhead;
        const sx = cx + sun.x * k;
        const sy = cy - (sun.y * cosP + sun.z * sinP) * k;
        const halo = f * 0.2;
        const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, halo);
        disc.addColorStop(0, 'rgba(255, 250, 230, 1)');
        disc.addColorStop(0.12, 'rgba(255, 244, 208, 0.92)');
        disc.addColorStop(0.24, 'rgba(255, 206, 126, 0.34)');
        disc.addColorStop(1, 'rgba(255, 180, 90, 0)');
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(sx, sy, halo, 0, TAU);
        ctx.fill();
      } else if (sunSpan > 0.09) {
        const d = Math.min(width, height) * 0.46;
        const sx = cx + (sun.x / sunSpan) * d;
        const sy = cy - (sun.y / sunSpan) * d;
        const flare = ctx.createRadialGradient(sx, sy, 0, sx, sy, gauge * 0.9);
        flare.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
        flare.addColorStop(0.14, 'rgba(255, 208, 128, 0.42)');
        flare.addColorStop(1, 'rgba(255, 180, 90, 0)');
        ctx.fillStyle = flare;
        ctx.beginPath();
        ctx.arc(sx, sy, gauge * 0.9, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 214, 150, 0.32)';
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 10; i++) {
          const a = (i / 12) * TAU + time * 0.06;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * gauge * 0.16, sy + Math.sin(a) * gauge * 0.16);
          ctx.lineTo(sx + Math.cos(a) * gauge * 0.26, sy + Math.sin(a) * gauge * 0.26);
          ctx.stroke();
        }
      }

      /* ------------------------------------------------------- the sphere */

      // The axis, drawn first so the planet hides the half behind it. Close
      // in, one end or the other has usually gone past the camera, and there
      // is no sensible line left to draw.
      proj(axis.x * 1.14, axis.y * 1.14, axis.z * 1.14);
      const northX = sX;
      const northY = sY;
      const northAhead = sZ > NEAR;
      proj(-axis.x * 1.14, -axis.y * 1.14, -axis.z * 1.14);
      if (northAhead && sZ > NEAR) {
        ctx.strokeStyle = 'rgba(174, 196, 224, 0.34)';
        ctx.lineWidth = Math.max(1, gauge * 0.006);
        ctx.setLineDash([gauge * 0.03, gauge * 0.03]);
        ctx.beginPath();
        ctx.moveTo(northX, northY);
        ctx.lineTo(sX, sY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.save();
      ctx.beginPath();
      addGround();
      ctx.clip();

      ctx.fillStyle = ink(pal.sea);
      ctx.fillRect(0, 0, width, height);

      /**
       * One spherical patch — a continent or an ice cap — as the polygon its
       * coastline projects to. Coast that has gone over the horizon is pinned
       * to the limb, so a patch running off the edge is cut off there rather
       * than folding back over the face of the planet.
       */
      const fillCap = (
        c: Vec3,
        radius: number,
        ripple: number,
        phase: number,
        paint: string,
      ): void => {
        const helper: Vec3 = Math.abs(c.y) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        const e1 = norm(cross(helper, c));
        const e2 = cross(c, e1);
        rot(c.x, c.y, c.z);
        let seen = pz > invD;
        for (let j = 0; j < CAP_SEG; j++) {
          const t = (j / CAP_SEG) * TAU;
          const cq = Math.cos(t);
          const sq = Math.sin(t);
          const a =
            radius *
            (1 + ripple * (Math.sin(3 * t + phase) * 0.5 + Math.sin(5 * t + phase * 1.7) * 0.32));
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          rot(
            c.x * ca + (e1.x * cq + e2.x * sq) * sa,
            c.y * ca + (e1.y * cq + e2.y * sq) * sa,
            c.z * ca + (e1.z * cq + e2.z * sq) * sa,
          );
          let x = px;
          let y = py;
          let z = pz;
          if (z > invD) seen = true;
          else {
            // Over the horizon: slide it down its own meridian until it sits
            // on the horizon, so a coastline running off the edge is cut off
            // there rather than folding back over the face of the planet.
            const m = Math.hypot(x, y) || 1;
            x = (x / m) * hzR;
            y = (y / m) * hzR;
            z = invD;
          }
          loopCam[j * 3] = x;
          loopCam[j * 3 + 1] = y;
          loopCam[j * 3 + 2] = z;
        }
        if (!seen) return;
        ctx.beginPath();
        if (!addLoop(CAP_SEG)) return;
        ctx.fillStyle = paint;
        ctx.fill();
      };

      const landStyle = ink(pal.land);
      for (const c of continents) fillCap(c.n, c.radius, 0.2, c.phase, landStyle);

      if (caps) {
        const iceStyle = ink(pal.ice, 0.95);
        fillCap({ x: 0, y: 1, z: 0 }, 0.34, 0.16, 1.1, iceStyle);
        fillCap({ x: 0, y: -1, z: 0 }, 0.3, 0.16, 2.4, iceStyle);
      }

      /** A curve on the sphere, drawn only where it faces us. */
      const strokeCurve = (at: (t: number) => Vec3, steps: number): void => {
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= steps; i++) {
          const p = rotV(at(i / steps));
          if (p.z <= invD) {
            pen = false;
            continue;
          }
          proj(p.x, p.y, p.z);
          if (sZ <= NEAR) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(sX, sY);
          else {
            ctx.moveTo(sX, sY);
            pen = true;
          }
        }
        ctx.stroke();
      };

      if (graticule) {
        ctx.lineWidth = Math.max(0.7, gauge * 0.0035);
        ctx.strokeStyle = 'rgba(232, 244, 255, 0.16)';
        for (let k = -2; k <= 2; k++) {
          if (k === 0) continue;
          const lat = (k * 30) / DEG;
          strokeCurve((t) => sphere(lat, t * TAU), 96);
        }
        for (let k = 0; k < 12; k++) {
          const lon = (k / 12) * TAU;
          strokeCurve((t) => sphere(-Math.PI / 2 + t * Math.PI, lon), 56);
        }
        ctx.lineWidth = Math.max(1, gauge * 0.006);
        ctx.strokeStyle = 'rgba(255, 238, 208, 0.34)';
        strokeCurve((t) => sphere(0, t * TAU), 128);
      }

      // Night: all the ground outside the daylight path.
      if (anyNight) {
        ctx.beginPath();
        addGround();
        if (termSeen) addLit();
        ctx.fillStyle = 'rgba(6, 11, 32, 0.74)';
        ctx.fill('evenodd');
      }

      // Sunlight, brightest on the ground that faces the sun most squarely —
      // the sun's own footprint if that is in sight, the horizon under it
      // otherwise.
      if (anyDay) {
        if (sun.z > invD) proj(sun.x, sun.y, sun.z);
        else {
          const m = Math.hypot(sun.x, sun.y) || 1;
          proj((sun.x / m) * hzR, (sun.y / m) * hzR, invD);
        }
        const glow = ctx.createRadialGradient(sX, sY, 0, sX, sY, gauge * 1.5);
        glow.addColorStop(0, 'rgba(255, 246, 214, 0.3)');
        glow.addColorStop(1, 'rgba(255, 230, 180, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }
      // The ground going dark towards the limb, which is only a thing to see
      // while the whole planet is in the frame.
      if (alt > 0.6) {
        proj(0, 0, 1);
        const edge = ctx.createRadialGradient(sX, sY, R * 0.55, sX, sY, R);
        edge.addColorStop(0, 'rgba(3, 5, 14, 0)');
        edge.addColorStop(1, `rgba(3, 5, 14, ${0.5 * clamp((alt - 0.6) / 0.8)})`);
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, width, height);
      }

      // The terminator itself: a warm band of dawn and dusk.
      if (termSeen) {
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= TERM_STEPS; i++) {
          const p = termPoint(i / TERM_STEPS);
          proj(p.x, p.y, p.z);
          if (sZ <= NEAR) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(sX, sY);
          else {
            ctx.moveTo(sX, sY);
            pen = true;
          }
        }
        ctx.lineWidth = gauge * 0.05;
        ctx.strokeStyle = 'rgba(255, 176, 104, 0.11)';
        ctx.stroke();
        if (labels) {
          ctx.lineWidth = Math.max(1, gauge * 0.004);
          ctx.strokeStyle = 'rgba(255, 226, 190, 0.5)';
          ctx.stroke();
        }
      }

      ctx.restore();

      // Air: a glow laid along the horizon itself, in a few passes, so it
      // reads as a rim from outside and as haze on the skyline from down on
      // the ground.
      ctx.beginPath();
      addGround();
      ctx.lineJoin = 'round';
      for (const [wide, a] of [
        [0.1, 0.08],
        [0.045, 0.12],
        [0.015, 0.2],
      ]) {
        ctx.lineWidth = Math.max(1, gauge * wide);
        ctx.strokeStyle = hsl(pal.sky, 72, 68, a);
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(1, gauge * 0.004);
      ctx.strokeStyle = 'rgba(226, 240, 255, 0.22)';
      ctx.stroke();
      ctx.lineJoin = 'miter';

      /* ------------------------------------------------ people and houses */

      const styleH = STYLE_H[style];
      const styleW = STYLE_W[style];
      const sunSide = (n: Vec3): number => n.x * sun.x + n.y * sun.y + n.z * sun.z;

      shown.length = 0;
      for (const thing of things) {
        if (thing.town >= townsShown) continue;
        if (thing.kind === 1 && styleH === 0) continue;
        const w = thing.walk;
        const at =
          w < 0
            ? thing.n
            : { x: walkAt[w * 3], y: walkAt[w * 3 + 1], z: walkAt[w * 3 + 2] };
        const n = rotV(at);
        if (n.z <= invD) continue;
        proj(n.x, n.y, n.z);
        if (sZ <= 0.02) continue;
        shown.push({
          thing,
          at,
          dir:
            w < 0
              ? ZERO
              : { x: walkDir[w * 3], y: walkDir[w * 3 + 1], z: walkDir[w * 3 + 2] },
          stride: w < 0 ? 0 : Math.sin(strideT[w]),
          z: sZ,
          lit: sunSide(n),
        });
      }
      // Furthest away first, so nearer things paint over them.
      shown.sort((a, b) => b.z - a.z);

      const night = time * 3;
      /** How wide a band of the surface is left between horizon and overhead. */
      const band = Math.max(1e-4, (1 - invD) * 0.06);

      for (const item of shown) {
        const t = item.thing;
        const n = rotV(item.at);
        const e = rotV(t.walk < 0 ? t.east : eastAt(item.at));
        const day = clamp((item.lit + 0.07) / 0.2, 0, 1);
        const fade = clamp((n.z - invD) / band, 0, 1);
        /** Pixels per planet radius at this thing's distance. */
        const scale = f / item.z;
        const stroke = Math.max(0.8, scale * 0.0055);
        proj(n.x, n.y, n.z);
        const bx = sX;
        const by = sY;

        if (t.kind === 1) {
          const h = t.h * styleH * sSky;
          const w = t.w * styleW;
          const d = w * (0.6 + t.seed * 0.7);
          // North, so the building has a footprint and not just a face: seen
          // from overhead it is a roof, seen from the limb it is a wall.
          const faceN = cross(n, e);
          // Skylight while this patch of ground is in daylight, plus whatever
          // the face catches of the sun directly.
          const shade = (nx: number, ny: number, nz: number): number => {
            const d = nx * sun.x + ny * sun.y + nz * sun.z;
            return clamp(day * 0.32 + (d > 0 ? d * 0.8 : 0), 0, 1);
          };

          const bX: number[] = [];
          const bY: number[] = [];
          const tX: number[] = [];
          const tY: number[] = [];
          const oZ: number[] = [];
          for (const [su, sv] of BOX) {
            const ox = e.x * su * w + faceN.x * sv * d;
            const oy = e.y * su * w + faceN.y * sv * d;
            const oz = e.z * su * w + faceN.z * sv * d;
            proj(n.x + ox, n.y + oy, n.z + oz);
            bX.push(sX);
            bY.push(sY);
            oZ.push(sZ);
            proj(n.x * (1 + h) + ox, n.y * (1 + h) + oy, n.z * (1 + h) + oz);
            tX.push(sX);
            tY.push(sY);
          }

          // Outward normals of the four walls, in wall order.
          const walls = [
            { x: -faceN.x, y: -faceN.y, z: -faceN.z },
            { x: e.x, y: e.y, z: e.z },
            { x: faceN.x, y: faceN.y, z: faceN.z },
            { x: -e.x, y: -e.y, z: -e.z },
          ];
          const faces: { pts: number[]; light: number; depth: number; wall: number }[] = [];
          for (let k = 0; k < 4; k++) {
            const k2 = (k + 1) % 4;
            faces.push({
              pts: [bX[k], bY[k], bX[k2], bY[k2], tX[k2], tY[k2], tX[k], tY[k]],
              light: shade(walls[k].x, walls[k].y, walls[k].z),
              depth: (oZ[k] + oZ[k2]) / 2,
              wall: k,
            });
          }
          faces.push({
            pts: [tX[0], tY[0], tX[1], tY[1], tX[2], tY[2], tX[3], tY[3]],
            light: shade(n.x, n.y, n.z),
            depth: item.z - h * 0.5,
            wall: -1,
          });
          faces.sort((a, b) => b.depth - a.depth);

          ctx.globalAlpha = fade;
          ctx.lineWidth = Math.max(0.4, stroke * 0.45);
          ctx.strokeStyle = `rgba(10, 12, 24, ${0.2 + day * 0.35})`;
          for (const face of faces) {
            ctx.beginPath();
            ctx.moveTo(face.pts[0], face.pts[1]);
            ctx.lineTo(face.pts[2], face.pts[3]);
            ctx.lineTo(face.pts[4], face.pts[5]);
            ctx.lineTo(face.pts[6], face.pts[7]);
            ctx.closePath();
            const l = face.light;
            ctx.fillStyle = hsl(t.hue, lerp(12, 36, l), lerp(12, 66, l));
            ctx.fill();
            ctx.stroke();
          }

          if (style === 2) {
            // Towers get a mast rather than a roof.
            proj(n.x * (1 + h * 1.2), n.y * (1 + h * 1.2), n.z * (1 + h * 1.2));
            const mx = sX;
            const my = sY;
            ctx.lineWidth = Math.max(0.7, stroke * 0.5);
            ctx.strokeStyle = `rgba(220, 232, 255, ${0.2 + day * 0.4})`;
            ctx.beginPath();
            ctx.moveTo((tX[0] + tX[2]) / 2, (tY[0] + tY[2]) / 2);
            ctx.lineTo(mx, my);
            ctx.stroke();
          } else {
            // Four slopes up to a point, drawn back to front like the walls.
            const rise = h * (style === 0 ? 0.44 : 0.3);
            const peak = 1 + h + rise;
            proj(n.x * peak, n.y * peak, n.z * peak);
            const ax = sX;
            const ay = sY;
            const slopes = [0, 1, 2, 3]
              .map((k) => ({ k, depth: (oZ[k] + oZ[(k + 1) % 4]) / 2 }))
              .sort((a, b) => a.depth - b.depth);
            for (const { k } of slopes) {
              const k2 = (k + 1) % 4;
              const l = shade(
                walls[k].x * 0.5 + n.x * 0.86,
                walls[k].y * 0.5 + n.y * 0.86,
                walls[k].z * 0.5 + n.z * 0.86,
              );
              ctx.beginPath();
              ctx.moveTo(tX[k], tY[k]);
              ctx.lineTo(tX[k2], tY[k2]);
              ctx.lineTo(ax, ay);
              ctx.closePath();
              ctx.fillStyle = hsl(t.hue - 16, lerp(14, 46, l), lerp(11, 52, l));
              ctx.fill();
              ctx.stroke();
            }
          }

          // Lit windows on the wall facing us, once it is big enough to hold them.
          const nearest = faces[faces.length - 1];
          const wallH = Math.hypot(tX[0] - bX[0], tY[0] - bY[0]);
          if (lamps && day < 0.55 && nearest.wall >= 0 && wallH > 9) {
            const p = nearest.pts;
            const rows = Math.max(1, Math.round(wallH / (scale * 0.03)));
            const flicker = 0.55 + 0.45 * Math.sin(night * (0.4 + t.seed) + t.seed * 9);
            ctx.fillStyle = `rgba(255, 206, 120, ${(0.45 + flicker * 0.45) * (1 - day) * fade})`;
            const dot = Math.max(1, scale * 0.005);
            for (let r = 0; r < rows; r++) {
              const v = (r + 0.6) / (rows + 0.4);
              for (const u of [0.3, 0.7]) {
                // Bilinear across the wall: base edge at v = 0, top edge at v = 1.
                const lowX = p[0] + (p[2] - p[0]) * u;
                const lowY = p[1] + (p[3] - p[1]) * u;
                const highX = p[6] + (p[4] - p[6]) * u;
                const highY = p[7] + (p[5] - p[7]) * u;
                const wx = lowX + (highX - lowX) * v;
                const wy = lowY + (highY - lowY) * v;
                ctx.fillRect(wx - dot / 2, wy - dot / 2, dot, dot);
              }
            }
          }
          ctx.globalAlpha = 1;
          continue;
        }

        if (t.kind === 2) {
          const h = t.h;
          proj(n.x * (1 + h * 0.55), n.y * (1 + h * 0.55), n.z * (1 + h * 0.55));
          const tx = sX;
          const ty = sY;
          ctx.globalAlpha = fade;
          ctx.lineWidth = stroke;
          ctx.strokeStyle = hsl(28, lerp(10, 30, day), lerp(12, 30, day));
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.fillStyle = hsl(t.hue, lerp(14, 46, day), lerp(13, 34, day));
          proj(n.x * (1 + h * 0.8), n.y * (1 + h * 0.8), n.z * (1 + h * 0.8));
          ctx.beginPath();
          ctx.arc(sX, sY, Math.max(1.6, scale * 0.014), 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        // A person: a figure standing straight up out of the ground, so the
        // projection foreshortens them all by itself. Legs and arms swing
        // along the way they are walking, which is the same trick: the swing
        // is a real direction across the surface, not a screen-space wiggle.
        const h = t.h * sFolk;
        // Two tangents to hang a body off: the way they are walking, and
        // across it, which is what keeps the legs apart when the stride is
        // passing through nothing and they are momentarily standing.
        const d = t.walk < 0 ? e : rotV(item.dir);
        const side = cross(n, d);
        const at = (rad: number, fore: number, wide: number): number => {
          proj(
            n.x * rad + d.x * fore + side.x * wide,
            n.y * rad + d.y * fore + side.y * wide,
            n.z * rad + d.z * fore + side.z * wide,
          );
          return sX;
        };
        const up = (rad: number, fore: number, wide: number): number => {
          proj(
            n.x * rad + d.x * fore + side.x * wide,
            n.y * rad + d.y * fore + side.y * wide,
            n.z * rad + d.z * fore + side.z * wide,
          );
          return sY;
        };
        const headX = at(1 + h, 0, 0);
        const headY = up(1 + h, 0, 0);
        const headR = Math.max(1.1, scale * h * 0.088);

        ctx.globalAlpha = fade;
        ctx.lineCap = 'round';
        ctx.lineWidth = clamp(scale * h * 0.085, stroke * 0.85, scale * 0.018);
        ctx.strokeStyle = hsl(t.hue, lerp(18, 62, day), lerp(26, 60, day));
        ctx.beginPath();
        if (Math.hypot(headX - bx, headY - by) < 7) {
          // Too small, or too nearly overhead, for limbs to be anything but mush.
          ctx.moveTo(bx, by);
          ctx.lineTo(headX, headY);
        } else {
          const step = item.stride * 0.22 * h;
          const reach = item.stride * 0.17 * h;
          const hip = 0.44 * h;
          const shoulder = 0.72 * h;
          ctx.moveTo(at(1 + hip, 0, 0), up(1 + hip, 0, 0));
          ctx.lineTo(at(1 + 0.94 * h, 0, 0), up(1 + 0.94 * h, 0, 0));
          ctx.moveTo(at(1 + shoulder, 0, 0.1 * h), up(1 + shoulder, 0, 0.1 * h));
          ctx.lineTo(at(1 + shoulder, 0, -0.1 * h), up(1 + shoulder, 0, -0.1 * h));
          ctx.moveTo(at(1, step, 0.06 * h), up(1, step, 0.06 * h));
          ctx.lineTo(at(1 + hip, 0, 0), up(1 + hip, 0, 0));
          ctx.lineTo(at(1, -step, -0.06 * h), up(1, -step, -0.06 * h));
          ctx.moveTo(at(1 + 0.5 * h, -reach, 0.13 * h), up(1 + 0.5 * h, -reach, 0.13 * h));
          ctx.lineTo(at(1 + shoulder, 0, 0.1 * h), up(1 + shoulder, 0, 0.1 * h));
          ctx.moveTo(at(1 + 0.5 * h, reach, -0.13 * h), up(1 + 0.5 * h, reach, -0.13 * h));
          ctx.lineTo(at(1 + shoulder, 0, -0.1 * h), up(1 + shoulder, 0, -0.1 * h));
        }
        ctx.stroke();
        ctx.fillStyle = hsl(t.hue, lerp(16, 48, day), lerp(30, 74, day));
        ctx.beginPath();
        ctx.arc(headX, headY, headR, 0, TAU);
        ctx.fill();
        if (lamps && day < 0.4) {
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, headR * 5);
          g.addColorStop(0, `rgba(255, 198, 110, ${0.36 * (1 - day) * fade})`);
          g.addColorStop(1, 'rgba(255, 190, 100, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, headR * 5, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
      }

      /* ------------------------------------------------- poles and labels */

      const type = clamp(Math.min(width, height) * 0.026, 11, 22);
      ctx.font = `500 ${type * 0.78}px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      const drawPole = (dir: number, mark: string): void => {
        const ex = axis.x * dir;
        const ey = axis.y * dir;
        const ez = axis.z * dir;
        const front = ez > invD;
        proj(ex, ey, ez);
        const footX = sX;
        const footY = sY;
        const footAhead = sZ > NEAR;
        const near = f / Math.max(sZ, NEAR);
        if (front && footAhead) {
          proj(ex * 1.14, ey * 1.14, ez * 1.14);
          if (sZ > NEAR) {
            ctx.strokeStyle = 'rgba(226, 240, 255, 0.75)';
            ctx.lineWidth = Math.max(1.2, near * 0.008);
            ctx.beginPath();
            ctx.moveTo(footX, footY);
            ctx.lineTo(sX, sY);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          ctx.arc(footX, footY, Math.max(2, near * 0.011), 0, TAU);
          ctx.fill();
        }
        if (!labels || (!front && alt < 1)) return;
        proj(ex * 1.24, ey * 1.24, ez * 1.24);
        if (sZ <= NEAR) return;
        ctx.textAlign = 'center';
        ctx.fillStyle = front ? 'rgba(236, 246, 255, 0.92)' : 'rgba(236, 246, 255, 0.34)';
        ctx.fillText(mark, sX, sY);
      };
      if (R > 40) {
        drawPole(1, 'N');
        drawPole(-1, 'S');
      }

      if (labels && R > 40 && alt > 0.4) {
        // Equator, labelled where it comes closest to us.
        let bestZ = -2;
        let ex = 0;
        let ey = 0;
        for (let i = 0; i < 180; i++) {
          const p = rotV(sphere(0, (i / 180) * TAU));
          if (p.z > bestZ) {
            bestZ = p.z;
            ex = p.x;
            ey = p.y;
          }
        }
        ctx.textAlign = 'center';
        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        ctx.fillStyle = 'rgba(255, 232, 198, 0.6)';
        if (bestZ > invD) {
          proj(ex, ey, bestZ);
          if (sZ > NEAR) ctx.fillText('EQUATOR', sX, sY + type * 1.1);
        }

        if (termSeen) {
          // Ground on the terminator that is turning into the sun is at dawn;
          // the rest of it is at dusk. The sign flips once along the run.
          const into = (u: number): number => {
            const p = termPoint(u);
            const v = cross(axis, p);
            return -(v.x * sun.x + v.y * sun.y + v.z * sun.z);
          };
          let split = 1;
          const first = into(0) > 0;
          for (let i = 1; i <= TERM_STEPS; i++) {
            if (into(i / TERM_STEPS) > 0 !== first) {
              split = i / TERM_STEPS;
              break;
            }
          }
          const tag = (a: number, b: number, dawn: boolean): void => {
            if (b - a < 0.125) return;
            const p = termPoint((a + b) / 2);
            proj(p.x * 1.07, p.y * 1.07, p.z * 1.07);
            if (sZ <= NEAR) return;
            ctx.fillStyle = 'rgba(255, 206, 150, 0.7)';
            ctx.fillText(dawn ? 'DAWN' : 'DUSK', sX, sY);
          };
          tag(0, split, first);
          tag(split, 1, !first);
        }
      }

      /* ----------------------------------------------------- the readout */

      // Their latitude and their clock come off wherever they have walked to,
      // not off the doorstep they started from.
      const meHere = meAt;
      const meCam = rotV(meHere);
      const meLit = sunSide(meCam);
      const meVel = cross(axis, meCam);
      const meInto = -(meVel.x * sun.x + meVel.y * sun.y + meVel.z * sun.z);
      const meState =
        meLit > 0.12 ? 'DAYLIGHT' : meLit < -0.12 ? 'NIGHT' : meInto > 0 ? 'SUNRISE' : 'SUNSET';
      const meLon = Math.atan2(meHere.z, meHere.x);
      const hours = (((meLon - subsolarLon) / TAU) * 24 + 36) % 24;
      const clock = `${pad2(Math.floor(hours))}:${pad2(Math.floor((hours % 1) * 60))}`;

      const meSeen = meCam.z > invD;
      if (meSeen) {
        const meH = me.h * sFolk;
        const ring = 1 + meH * 1.28;
        proj(meCam.x * ring, meCam.y * ring, meCam.z * ring);
        if (sZ > NEAR) {
          const near = f / sZ;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = Math.max(1, near * 0.004);
          ctx.beginPath();
          ctx.arc(sX, sY, clamp(near * meH * 0.42, 3, frame * 0.04), 0, TAU);
          ctx.stroke();
        }
      }

      const left = Math.min(26, width * 0.032);
      // The page draws its own control bar across the top of the stage.
      let y = left + 26;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(196, 214, 236, 0.72)';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      ctx.fillText(
        `${me.name} · ${latText(Math.asin(clamp(meHere.y, -1, 1)) * DEG)} · ${
          meSeen ? meState : 'OVER THE HORIZON'
        }`,
        left,
        y,
      );
      y += type * 1.5;
      ctx.fillStyle = 'rgba(240, 248, 255, 0.94)';
      ctx.font = `200 ${type * 2.5}px ${MONO}`;
      ctx.fillText(clock, left, y);
      y += type * 3;
      ctx.font = `400 ${type * 0.78}px ${MONO}`;
      ctx.fillStyle = 'rgba(186, 204, 228, 0.78)';
      const dayLen = turnsPerSecond > 0.001 ? `${(1 / turnsPerSecond).toFixed(1)}s` : 'never';
      ctx.fillText(`day ${dayLen} · tilt ${Math.round(sTilt * DEG)}°`, left, y);
      y += type * 1.25;
      const tropic = subsolarLat * DEG;
      const season =
        tropic > 4 ? 'north in summer' : tropic < -4 ? 'north in winter' : 'equinox';
      ctx.fillText(`sun over ${latText(subsolarLat * DEG)} · ${season}`, left, y);
      y += type * 1.25;
      const pop = shown.reduce((a, s) => a + (s.thing.kind === 0 ? 1 : 0), 0);
      const built = shown.reduce((a, s) => a + (s.thing.kind === 1 ? 1 : 0), 0);
      ctx.fillText(`${pop} people · ${built} buildings · ${townsShown} towns`, left, y);

      if (toastAge < 2.4) {
        ctx.globalAlpha = clamp(1 - (toastAge - 1.6) / 0.8, 0, 1);
        ctx.textAlign = 'right';
        ctx.font = `500 ${type * 0.76}px ${MONO}`;
        ctx.fillStyle = 'rgba(226, 240, 255, 0.8)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(toast.toUpperCase(), width - left, height - left);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  };
};

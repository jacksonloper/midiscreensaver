import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/** The widest the factor axis goes. Every column is checked against every row each frame. */
export const MAX_X = 200;
/** Past this the trial division behind the row labels starts to cost frames. */
const MAX_Y = 1e10;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------ knob maps */

/** Knob 1: the right-hand end of the factor axis, 2..200 on a log scale. */
export const knobToXMax = (k: number): number => Math.round(2 * Math.pow(100, clamp(k)));
/** Knob 2: how many numbers fit on screen at once, 8..480 on a log scale. */
export const knobToSpan = (k: number): number => Math.round(8 * Math.pow(60, clamp(k)));
/** Knob 3: rows per second. The bottom of the knob is a dead stop. */
export const knobToSpeed = (k: number): number =>
  k < 0.03 ? 0 : 0.25 * Math.pow(1200, (clamp(k) - 0.03) / 0.97);
/** Knob 4: the left-hand end of the factor axis, as a fraction of the way to the right-hand end. */
export const knobToXMin = (k: number, xMax: number): number =>
  1 + Math.round(clamp(k) * Math.max(0, xMax - 2));

/* --------------------------------------------------------- number stuff */

const SIEVE = (() => {
  const s = new Uint8Array(MAX_X + 1).fill(1);
  s[0] = 0;
  s[1] = 0;
  for (let i = 2; i * i <= MAX_X; i++) {
    if (s[i]) for (let j = i * i; j <= MAX_X; j += i) s[j] = 0;
  }
  return s;
})();
const isSmallPrime = (n: number): boolean => n <= MAX_X && SIEVE[n] === 1;

/** Each prime's position in the list of primes, which is what its colour is spun from. */
const PRIME_INDEX = (() => {
  const idx = new Int16Array(MAX_X + 1).fill(-1);
  let k = 0;
  for (let i = 2; i <= MAX_X; i++) if (SIEVE[i]) idx[i] = k++;
  return idx;
})();

const primeHue = (p: number, shift: number): number =>
  (shift + 196 + Math.max(0, PRIME_INDEX[Math.min(p, MAX_X)]) * 137.508) % 360;

/** How many times p goes into n. */
const multiplicity = (n: number, p: number): number => {
  let k = 0;
  while (n % p === 0) {
    n /= p;
    k++;
  }
  return k;
};

type Factors = Array<[number, number]>;
const factorCache = new Map<number, Factors>();

/** Trial division, remembered — the same rows are labelled frame after frame. */
const factorise = (n: number): Factors => {
  const hit = factorCache.get(n);
  if (hit) return hit;
  const out: Factors = [];
  let m = n;
  for (let p = 2; p * p <= m; p += p === 2 ? 1 : 2) {
    if (m % p !== 0) continue;
    let k = 0;
    while (m % p === 0) {
      m /= p;
      k++;
    }
    out.push([p, k]);
  }
  if (m > 1) out.push([m, 1]);
  if (factorCache.size > 6000) factorCache.clear();
  factorCache.set(n, out);
  return out;
};

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (k: number): string => (k <= 1 ? '' : String(k).split('').map((d) => SUP[+d]).join(''));

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 1, 2, 5, 10, 20, 50 … — the label spacing that puts about `count` on an axis. */
const niceStep = (span: number, count: number): number => {
  const raw = Math.max(span / Math.max(count, 1), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
};

/* --------------------------------------------------------------- sketch */

interface Flash {
  text: string;
  age: number;
}

/**
 * A divisibility table that scrolls. Columns are candidate factors, rows are
 * the numbers being factored, counting upward. A column puts a big dot on every
 * row it is a prime factor of and a small dot on every row it merely divides,
 * so each prime column is a dotted line with a period of its own, and a row's
 * big dots are its factorisation — or as much of it as fits on the axis.
 */
export const createPrimeFactors: SketchFactory = (): Sketch => {
  /** The number sitting on the bottom edge of the plot. Fractional, so the scroll is smooth. */
  let pos = 1;
  let velocity = 0;
  let direction = 1;
  let paused = false;

  let primesOnly = false;
  let labels = true;
  let survivors = false;
  let rings = false;

  /** Smoothed versions of the two axis lengths, so a knob turn zooms rather than jumps. */
  let spanS = knobToSpan(0.32);
  let colsS = 30;
  let lastPrimesOnly = primesOnly;

  const flashes: Flash[] = [];
  const say = (text: string): void => {
    flashes.push({ text, age: 0 });
    if (flashes.length > 3) flashes.shift();
  };

  return {
    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kXMax, kSpan, kSpeed, kXMin, kBig, kSmall, kHue, kType] = midi.knobs;

      /* --------------------------------------------------------- pads */

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
            direction = -direction;
            say(direction > 0 ? 'UPWARD' : 'DOWNWARD');
            break;
          case 1:
            paused = !paused;
            say(paused ? 'PAUSED' : 'MOVING');
            break;
          case 2:
            pos = 1;
            velocity = 0;
            say('BACK TO 1');
            break;
          case 3:
            if (pos >= MAX_Y) {
              say('ALREADY AT THE TOP');
              break;
            }
            pos = Math.min(MAX_Y, Math.max(1, Math.floor(pos)) * 10);
            say(pos >= MAX_Y ? '×10 — AS FAR AS IT GOES' : '×10');
            break;
          case 4:
            primesOnly = !primesOnly;
            say(primesOnly ? 'PRIME COLUMNS ONLY' : 'EVERY COLUMN');
            break;
          case 5:
            labels = !labels;
            say(labels ? 'FACTORISATIONS ON' : 'FACTORISATIONS OFF');
            break;
          case 6:
            survivors = !survivors;
            say(survivors ? 'MARKING ROWS WITH NO DOT' : 'ROW MARKS OFF');
            break;
          case 7:
            rings = !rings;
            say(rings ? 'RINGS FOR REPEATED FACTORS' : 'RINGS OFF');
            break;
        }
      }

      /* ------------------------------------------------------ the axes */

      const xMax = knobToXMax(kXMax);
      const xMin = Math.min(knobToXMin(kXMin, xMax), xMax - 1);
      const columns: number[] = [];
      for (let x = xMin; x <= xMax; x++) if (!primesOnly || isSmallPrime(x)) columns.push(x);
      if (columns.length === 0) columns.push(xMax);

      if (primesOnly !== lastPrimesOnly) {
        colsS = columns.length;
        lastPrimesOnly = primesOnly;
      }
      colsS = approach(colsS, columns.length, 0.12, dt);
      spanS = approach(spanS, knobToSpan(kSpan), 0.12, dt);

      const speed = knobToSpeed(kSpeed);
      velocity = approach(velocity, paused ? 0 : direction * speed, 0.2, dt);
      pos += velocity * dt;
      if (pos < 1) {
        pos = 1;
        velocity = 0;
      }
      if (pos > MAX_Y) {
        pos = MAX_Y;
        velocity = 0;
      }

      /* --------------------------------------------------------- layout */

      const hueShift = kHue * 360;
      const type = clamp(Math.min(width, height) * 0.024, 10, 17) * range(kType, 0.7, 1.5);
      const margin = Math.min(width, height) * 0.04 + 6;
      // The page floats its control bar over the top of the stage and the
      // knobs and pads across the bottom, so the drawing keeps out of both.
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);

      const vHi = Math.floor(pos + spanS) + 1;
      const yLabelW = type * 0.62 * (fmt(vHi).length + 0.8);
      const panelW = labels ? Math.min(type * 0.62 * 24, width * 0.36) : 0;

      const plotX = margin + yLabelW;
      const plotY = top + type * 2.2;
      const plotW = Math.max(80, width - plotX - margin - panelW);
      const plotH = Math.max(60, height - plotY - footer - type * 2.2);
      const plotB = plotY + plotH;

      const cellW = plotW / Math.max(colsS, 1);
      const cellH = plotH / Math.max(spanS, 1);
      const cell = Math.min(cellW, cellH);
      const rBig = Math.max(0.7, cell * 0.5 * range(kBig, 0.2, 1.05));
      const rSmall = kSmall < 0.02 ? 0 : Math.max(0.5, cell * 0.5 * range(kSmall, 0.08, 0.7));

      const colX = (i: number): number => plotX + (i + 0.5) * cellW;
      const rowY = (v: number): number => plotB - (v - pos + 0.5) * cellH;

      const vLo = Math.max(1, Math.floor(pos) - 1);

      /* ----------------------------------------------------- background */

      ctx.fillStyle = '#05060b';
      ctx.fillRect(0, 0, width, height);
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, hsl(hueShift + 220, 30, 8, 0.9));
      sky.addColorStop(1, hsl(hueShift + 260, 24, 4, 0.9));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX, plotY, plotW, plotH);
      ctx.clip();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
      ctx.fillRect(plotX, plotY, plotW, plotH);

      // Each prime column gets a faint stripe in its own colour, so the eye can
      // follow it down the screen even where its dots are far apart.
      for (let i = 0; i < columns.length; i++) {
        const x = columns[i];
        if (!isSmallPrime(x)) continue;
        ctx.fillStyle = hsl(primeHue(x, hueShift), 70, 60, 0.05);
        ctx.fillRect(colX(i) - cellW * 0.5, plotY, cellW, plotH);
      }

      // Rows nothing on screen divides: the survivors of a sieve run up to the
      // right-hand edge. Below the square of that edge, they are the primes.
      if (survivors) {
        const xPrimes = columns.filter(isSmallPrime);
        ctx.fillStyle = hsl(hueShift + 48, 90, 62, 0.16);
        for (let v = vLo; v <= vHi; v++) {
          if (v < 2) continue;
          let hit = false;
          for (const p of xPrimes) {
            if (v % p === 0) {
              hit = true;
              break;
            }
          }
          if (!hit) ctx.fillRect(plotX, rowY(v) - cellH * 0.5, plotW, Math.max(1, cellH));
        }
      }

      if (cellH > 7) {
        ctx.fillStyle = 'rgba(160, 175, 220, 0.05)';
        for (let v = vLo; v <= vHi; v++) ctx.fillRect(plotX, Math.round(rowY(v) + cellH * 0.5), plotW, 1);
      }

      /* ----------------------------------------------------------- dots */

      const dot = (x: number, y: number, r: number): void => {
        if (r < 1.3) {
          ctx.rect(x - r, y - r, r * 2, r * 2);
        } else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
      };

      // One path per column: every dot in a column is the same colour, and
      // this keeps a few thousand dots to a few hundred fills.
      for (let i = 0; i < columns.length; i++) {
        const x = columns[i];
        const cx = colX(i);
        if (cx - cellW > plotX + plotW) break;
        const prime = isSmallPrime(x);
        const r = prime ? rBig : rSmall;
        if (r <= 0) continue;
        const first = Math.ceil(vLo / x) * x;
        if (first > vHi) continue;

        ctx.beginPath();
        for (let v = first; v <= vHi; v += x) dot(cx, rowY(v), r);
        if (prime) {
          const h = primeHue(x, hueShift);
          ctx.fillStyle = hsl(h, 82, 64);
          ctx.shadowColor = hsl(h, 90, 60, 0.6);
          ctx.shadowBlur = rBig > 3 ? rBig * 1.2 : 0;
        } else {
          ctx.fillStyle = 'rgba(200, 210, 235, 0.55)';
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        // A ring for every extra time the prime goes in: 12 = 2·2·3 puts one
        // ring round the dot in column 2.
        if (prime && rings && rBig > 1.5) {
          ctx.strokeStyle = hsl(primeHue(x, hueShift), 82, 70, 0.85);
          ctx.lineWidth = Math.max(1, rBig * 0.18);
          ctx.beginPath();
          for (let v = first; v <= vHi; v += x) {
            const k = multiplicity(v, x);
            const y = rowY(v);
            for (let j = 1; j < k; j++) {
              const rr = rBig * (1 + j * 0.42);
              if (rr > cell * 0.5 * 1.6) break;
              ctx.moveTo(cx + rr, y);
              ctx.arc(cx, y, rr, 0, TAU);
            }
          }
          ctx.stroke();
        }
      }

      ctx.restore();

      ctx.strokeStyle = 'rgba(150, 165, 210, 0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(plotX) + 0.5, Math.round(plotY) + 0.5, Math.round(plotW), Math.round(plotH));

      /* ---------------------------------------------------------- x axis */

      ctx.font = `500 ${type * 0.86}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Primes get first claim on the axis, then round numbers fill the gaps,
      // and nothing is drawn on top of a label already placed.
      const xNice = niceStep(type * 0.62 * (String(xMax).length + 1.4) / cellW, 1);
      const order: number[] = [];
      for (let i = 0; i < columns.length; i++) if (isSmallPrime(columns[i])) order.push(i);
      for (let i = 0; i < columns.length; i++) {
        if (!isSmallPrime(columns[i]) && (primesOnly ? i : columns[i]) % xNice === 0) order.push(i);
      }
      const taken: Array<[number, number]> = [];
      for (const i of order) {
        const x = columns[i];
        const cx = colX(i);
        if (cx > plotX + plotW) continue;
        const half = (ctx.measureText(String(x)).width + type * 0.5) / 2;
        if (taken.some(([a, b]) => cx + half > a && cx - half < b)) continue;
        taken.push([cx - half, cx + half]);
        ctx.fillStyle = isSmallPrime(x) ? hsl(primeHue(x, hueShift), 75, 72) : 'rgba(150, 160, 190, 0.6)';
        ctx.fillText(String(x), cx, plotB + type * 0.45);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b6683';
      setTracking(ctx, '0.2em');
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      ctx.fillText('FACTOR →', plotX, plotB + type * 1.55);
      setTracking(ctx, '0em');

      /* ---------------------------------------------------------- y axis */

      ctx.font = `500 ${type * 0.86}px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const yStep = niceStep((type * 1.6) / cellH, 1);
      for (let v = Math.ceil(vLo / yStep) * yStep; v <= vHi; v += yStep) {
        const y = rowY(v);
        if (y < plotY + type * 0.4 || y > plotB - type * 0.4) continue;
        ctx.fillStyle = 'rgba(170, 180, 210, 0.7)';
        ctx.fillText(fmt(v), plotX - type * 0.5, y);
        ctx.fillStyle = 'rgba(170, 180, 210, 0.35)';
        ctx.fillRect(plotX - type * 0.3, Math.round(y), type * 0.3, 1);
      }

      /* ------------------------------------------------ factor labels */

      if (labels) {
        // Every row if there is room, otherwise every n-th — on multiples of
        // n, so the labels ride along with their rows instead of flickering.
        const stride = Math.max(1, Math.ceil((type * 1.15) / cellH));
        const step = stride === 1 ? 1 : niceStep(stride, 1);
        const lx = plotX + plotW + type * 0.8;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `500 ${type * 0.86}px ${MONO}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx - 2, plotY, width - lx, plotH);
        ctx.clip();
        for (let v = Math.ceil(vLo / step) * step; v <= vHi; v += step) {
          const y = rowY(v);
          if (y < plotY - cellH || y > plotB + cellH) continue;
          let at = lx;
          const put = (text: string, color: string): void => {
            ctx.fillStyle = color;
            ctx.fillText(text, at, y);
            at += ctx.measureText(text).width;
          };
          put(`${fmt(v)} `, 'rgba(225, 232, 250, 0.9)');
          if (v === 1) {
            put('= 1', 'rgba(140, 150, 180, 0.7)');
            continue;
          }
          const f = factorise(v);
          if (f.length === 1 && f[0][1] === 1) {
            put('prime', hsl(hueShift + 48, 90, 68));
            continue;
          }
          put('= ', 'rgba(140, 150, 180, 0.7)');
          f.forEach(([p, k], j) => {
            if (j > 0) put('·', 'rgba(140, 150, 180, 0.7)');
            const onAxis = p >= xMin && p <= xMax;
            put(
              `${fmt(p)}${sup(k)}`,
              isSmallPrime(p) && onAxis ? hsl(primeHue(p, hueShift), 80, 70) : 'rgba(200, 205, 220, 0.5)',
            );
          });
        }
        ctx.restore();
      }

      /* -------------------------------------------------------- readout */

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${type * 0.78}px ${MONO}`;
      setTracking(ctx, '0.16em');
      const rate = Math.abs(velocity);
      const atEnd = pos >= MAX_Y;
      const rateText = atEnd
        ? 'END OF THE LINE'
        : paused || rate < 0.01 ? 'STILL' : `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} ROWS/S ${velocity >= 0 ? '↑' : '↓'}`;
      ctx.fillStyle = '#7c88a8';
      ctx.fillText(
        `ROWS ${fmt(Math.max(1, Math.floor(pos)))}–${fmt(Math.floor(pos + spanS))}   FACTORS ${xMin}–${xMax}${primesOnly ? ' (PRIMES)' : ''}   ${rateText}`,
        plotX,
        top,
      );
      setTracking(ctx, '0em');

      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].age += dt;
        if (flashes[i].age > 1.6) flashes.splice(i, 1);
      }
      ctx.textAlign = 'right';
      ctx.font = `600 ${type * 0.9}px ${MONO}`;
      setTracking(ctx, '0.2em');
      flashes.forEach((f, j) => {
        const a = clamp(1 - f.age / 1.6) ** 2;
        ctx.fillStyle = hsl(hueShift + 48, 90, 72, a);
        ctx.fillText(f.text, plotX + plotW - type * 0.6, plotY + type * 0.7 + (flashes.length - 1 - j) * type * 1.3);
      });
      setTracking(ctx, '0em');

      // The table stops at ten billion on purpose. Say so, rather than leave a
      // frozen screen that looks broken.
      if (atEnd) {
        const cx = plotX + plotW / 2;
        const cy = plotY + plotH / 2;
        const lines = [
          'The table stops at ten billion.',
          'Past here, factoring the rows on the right by trial division',
          'starts to cost frames, so the scroll halts.',
          'Pad 1 reverses, pad 3 goes back to 1.',
        ];
        ctx.font = `500 ${type * 0.86}px ${MONO}`;
        const boxW = Math.min(plotW - type, Math.max(...lines.map((l) => ctx.measureText(l).width)) + type * 2.4);
        const titleSize = type * 1.3;
        const boxH = titleSize * 1.9 + lines.length * type * 1.35 + type * 1.2;
        ctx.fillStyle = 'rgba(5, 6, 11, 0.86)';
        ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
        ctx.strokeStyle = hsl(hueShift + 48, 90, 62, 0.5);
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(cx - boxW / 2) + 0.5, Math.round(cy - boxH / 2) + 0.5, Math.round(boxW), Math.round(boxH));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = `600 ${titleSize}px ${MONO}`;
        setTracking(ctx, '0.2em');
        ctx.fillStyle = hsl(hueShift + 48, 90, 72);
        ctx.fillText('END OF THE LINE', cx, cy - boxH / 2 + type * 0.8);
        setTracking(ctx, '0em');
        ctx.font = `500 ${type * 0.86}px ${MONO}`;
        ctx.fillStyle = 'rgba(200, 210, 235, 0.85)';
        lines.forEach((l, i) => ctx.fillText(l, cx, cy - boxH / 2 + type * 0.8 + titleSize * 1.9 + i * type * 1.35, plotW - type * 2));
      }
    },
  };
};

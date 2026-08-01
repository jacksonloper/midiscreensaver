import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, lerp } from '../../screensaver/util';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, value: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
};

/** Four terms a side, each 0..3 — so the board is twelve units square and holds 144. */
export const TERMS = 4;
export const MAX_TERM = 3;
export const BOARD = TERMS * MAX_TERM;

/** A knob position, 0..1, as one of the four whole numbers it can mean. */
export const quantise = (v: number): number => Math.round(clamp(v) * MAX_TERM);

export const PALETTES = ['spectrum', 'columns', 'diagonals', 'magnitude'];
export const FILLS = ['solid', 'dots', 'hatch', 'outline'];
export const GAP_NAMES = ['flush', 'split', 'exploded'];
/** Gap between blocks, in board units. */
const GAPS = [0, 0.16, 0.44];
export const READOUTS = ['full', 'product', 'bare'];

const SUBS = ['₁', '₂', '₃', '₄'];
const BASE_HUE = 206;
/** Seconds each partial product holds the highlight during a sweep. */
const SWEEP_STEP = 0.55;

interface Ink {
  h: number;
  s: number;
  l: number;
}

/** Colour for the block at column `i`, row `j`, holding `n` unit squares. */
const cellInk = (palette: number, i: number, j: number, n: number): Ink => {
  switch (palette) {
    case 1:
      return { h: BASE_HUE + i * 47, s: 64, l: 30 + j * 8 };
    case 2:
      return { h: BASE_HUE + (i + j) * 27, s: 68, l: 46 };
    case 3: {
      const t = n / (MAX_TERM * MAX_TERM);
      return { h: lerp(238, 14, t), s: 52 + t * 34, l: 26 + t * 26 };
    }
    default:
      return { h: BASE_HUE + i * 31 + j * 13, s: 70, l: 42 + ((i + j) % 2) * 7 };
  }
};

/**
 * The area model of multiplication, wired to the controller. Knobs 1-4 are the
 * four terms of the left-hand factor, knobs 5-8 the four terms of the right,
 * each snapping to 0, 1, 2 or 3. The screen is the rectangle they multiply out
 * to, cut into the sixteen partial products — so the distributive law is the
 * picture rather than a caption underneath it. The pads only change how it is
 * drawn; the arithmetic is entirely in the knobs.
 */
export const createAreaModel: SketchFactory = (): Sketch => {
  /** What the knobs say, and the smoothed version the blocks are drawn at. */
  const xn = [0, 0, 0, 0];
  const yn = [0, 0, 0, 0];
  const xs = [0, 0, 0, 0];
  const ys = [0, 0, 0, 0];
  const colPulse = [0, 0, 0, 0];
  const rowPulse = [0, 0, 0, 0];

  let palette = 0;
  let fill = 0;
  let gapMode = 1;
  let readout = 0;
  let grid = true;
  let labels = true;
  let glow = true;
  let sweeping = false;

  let sweepCell = 0;
  let sweepClock = 0;
  let sweepSum = 0;
  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  return {
    draw({ ctx, width, height, time, dt, midi }: DrawContext) {
      /* -------------------------------------------------------- controls */

      for (let i = 0; i < TERMS; i++) {
        const nx = quantise(midi.knobs[i]);
        const ny = quantise(midi.knobs[i + TERMS]);
        if (nx !== xn[i]) colPulse[i] = 1;
        if (ny !== yn[i]) rowPulse[i] = 1;
        xn[i] = nx;
        yn[i] = ny;
        xs[i] = approach(xs[i], nx, 0.075, dt);
        ys[i] = approach(ys[i], ny, 0.075, dt);
        colPulse[i] = approach(colPulse[i], 0, 0.16, dt);
        rowPulse[i] = approach(rowPulse[i], 0, 0.16, dt);
      }

      const say = (text: string): void => {
        toast = text;
        toastAge = 0;
      };

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
            palette = (palette + 1) % PALETTES.length;
            say(`palette · ${PALETTES[palette]}`);
            break;
          case 1:
            grid = !grid;
            say(`unit grid · ${grid ? 'on' : 'off'}`);
            break;
          case 2:
            labels = !labels;
            say(`partial products · ${labels ? 'shown' : 'hidden'}`);
            break;
          case 3:
            gapMode = (gapMode + 1) % GAPS.length;
            say(`blocks · ${GAP_NAMES[gapMode]}`);
            break;
          case 4:
            fill = (fill + 1) % FILLS.length;
            say(`fill · ${FILLS[fill]}`);
            break;
          case 5:
            glow = !glow;
            say(`glow · ${glow ? 'on' : 'off'}`);
            break;
          case 6:
            sweeping = !sweeping;
            sweepCell = 0;
            sweepClock = 0;
            sweepSum = 0;
            say(`sweep · ${sweeping ? 'running' : 'off'}`);
            break;
          default:
            readout = (readout + 1) % READOUTS.length;
            say(`readout · ${READOUTS[readout]}`);
            break;
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }

      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const sumXn = xn[0] + xn[1] + xn[2] + xn[3];
      const sumYn = yn[0] + yn[1] + yn[2] + yn[3];
      const product = sumXn * sumYn;

      if (sweeping) {
        sweepClock += dt;
        while (sweepClock >= SWEEP_STEP) {
          sweepClock -= SWEEP_STEP;
          sweepSum += xn[sweepCell % TERMS] * yn[Math.floor(sweepCell / TERMS)];
          sweepCell = (sweepCell + 1) % (TERMS * TERMS);
          if (sweepCell === 0) sweepSum = 0;
        }
      }
      const sweepI = sweepCell % TERMS;
      const sweepJ = Math.floor(sweepCell / TERMS);

      /* ---------------------------------------------------------- layout */

      const margin = Math.min(width, height) * 0.045 + 6;
      // The page floats its own control bar over the top of the stage and the
      // knobs and pads across the bottom, so the drawing keeps out of both.
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);
      const plotX = margin;
      const plotY = top;
      const plotW = Math.max(120, width - margin * 2);
      const plotH = Math.max(90, height - top - footer);

      const type = clamp(Math.min(width, height) * 0.028, 10, 19);
      // Room above the board for the x terms, and to its left for the y terms;
      // the two totals are measured off the far side of the rectangle, so the
      // right and bottom edges get a gutter of their own.
      const gutter = type * 2.3;
      const dim = type * 2.2;
      const availW = plotW - gutter - dim;
      const availH = plotH - gutter - dim;
      // Wide enough for a column of arithmetic beside the board? Otherwise the
      // answer goes on one line underneath it.
      const wide = availW - availH > 250;
      const side = wide
        ? Math.min(availH, availW - 250)
        : Math.min(availW, availH - type * 2.6);
      const boardSize = Math.max(48, side);

      const gap = GAPS[gapMode];
      // Gaps are extra width, so the fully exploded board still fits the frame.
      const unit = boardSize / (BOARD + (TERMS - 1) * gap);
      const boardX = plotX + gutter;
      const boardY = plotY + gutter + Math.max(0, (availH - boardSize) * 0.5);

      const colX = (i: number): number => {
        let at = boardX + i * gap * unit;
        for (let k = 0; k < i; k++) at += xs[k] * unit;
        return at;
      };
      const rowY = (j: number): number => {
        let at = boardY + j * gap * unit;
        for (let k = 0; k < j; k++) at += ys[k] * unit;
        return at;
      };
      const rectW = colX(TERMS - 1) + xs[TERMS - 1] * unit - boardX;
      const rectH = rowY(TERMS - 1) + ys[TERMS - 1] * unit - boardY;

      /* ------------------------------------------------------ background */

      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, hsl(BASE_HUE, 30, 8));
      sky.addColorStop(0.55, '#04050a');
      sky.addColorStop(1, hsl(BASE_HUE + 40, 24, 6));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // The board is always twelve by twelve: every rectangle you can make is
      // some corner of the same hundred and forty-four squares.
      ctx.fillStyle = hsl(BASE_HUE, 40, 74, 0.26);
      for (let i = 0; i <= BOARD; i++) {
        for (let j = 0; j <= BOARD; j++) {
          ctx.fillRect(boardX + i * unit - 0.75, boardY + j * unit - 0.75, 1.5, 1.5);
        }
      }
      ctx.strokeStyle = hsl(BASE_HUE, 40, 70, 0.22);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.strokeRect(
        Math.round(boardX) + 0.5,
        Math.round(boardY) + 0.5,
        boardSize,
        boardSize,
      );
      ctx.setLineDash([]);

      /* ----------------------------------------------------------- blocks */

      for (let j = 0; j < TERMS; j++) {
        for (let i = 0; i < TERMS; i++) {
          const w = xs[i] * unit;
          const h = ys[j] * unit;
          if (w < 0.4 || h < 0.4) continue;

          const cx = colX(i);
          const cy = rowY(j);
          const n = xn[i] * yn[j];
          const ink = cellInk(palette, i, j, n);
          const heat = clamp(Math.max(colPulse[i], rowPulse[j]));
          const lit = sweeping && sweepI === i && sweepJ === j;
          const l = ink.l + heat * 16 + (lit ? 12 : 0);

          ctx.save();
          if (glow) {
            ctx.shadowColor = hsl(ink.h, 90, 55, 0.55);
            ctx.shadowBlur = unit * (0.5 + heat * 1.4 + (lit ? 0.8 : 0));
          }

          if (fill === 3) {
            ctx.strokeStyle = hsl(ink.h, ink.s + 14, l + 22, 0.9);
            ctx.lineWidth = Math.max(1.2, unit * 0.07);
            ctx.strokeRect(cx + 1, cy + 1, w - 2, h - 2);
          } else {
            const face = ctx.createLinearGradient(cx, cy, cx + w, cy + h);
            face.addColorStop(0, hsl(ink.h + 8, ink.s, l + 7, fill === 0 ? 0.95 : 0.24));
            face.addColorStop(1, hsl(ink.h - 10, ink.s, l - 6, fill === 0 ? 0.95 : 0.16));
            ctx.fillStyle = face;
            ctx.fillRect(cx, cy, w, h);
          }
          ctx.shadowBlur = 0;

          // Unit rules, dots and hatching all step at the block's own unit
          // width, which is the eased one — so they stay square while a term
          // is on its way from two to three.
          const stepX = xn[i] > 0 ? w / xn[i] : w;
          const stepY = yn[j] > 0 ? h / yn[j] : h;

          if (fill === 1) {
            ctx.fillStyle = hsl(ink.h, ink.s + 16, l + 30, 0.92);
            const r = Math.max(1.1, Math.min(stepX, stepY) * 0.13);
            for (let a = 0; a < xn[i]; a++) {
              for (let b = 0; b < yn[j]; b++) {
                ctx.beginPath();
                ctx.arc(cx + (a + 0.5) * stepX, cy + (b + 0.5) * stepY, r, 0, TAU);
                ctx.fill();
              }
            }
          } else if (fill === 2) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx, cy, w, h);
            ctx.clip();
            ctx.strokeStyle = hsl(ink.h, ink.s + 12, l + 26, 0.6);
            ctx.lineWidth = Math.max(1, unit * 0.05);
            const pitch = Math.max(4, unit * 0.28);
            ctx.beginPath();
            for (let d = -h; d < w; d += pitch) {
              ctx.moveTo(cx + d, cy + h);
              ctx.lineTo(cx + d + h, cy);
            }
            ctx.stroke();
            ctx.restore();
          }

          if (grid && Math.min(stepX, stepY) > 5) {
            ctx.strokeStyle = hsl(ink.h, 30, 92, fill === 0 ? 0.22 : 0.14);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let a = 1; a < xn[i]; a++) {
              const gx = Math.round(cx + a * stepX) + 0.5;
              ctx.moveTo(gx, cy);
              ctx.lineTo(gx, cy + h);
            }
            for (let b = 1; b < yn[j]; b++) {
              const gy = Math.round(cy + b * stepY) + 0.5;
              ctx.moveTo(cx, gy);
              ctx.lineTo(cx + w, gy);
            }
            ctx.stroke();
          }

          ctx.strokeStyle = hsl(ink.h, 45, 88, lit ? 0.95 : 0.4);
          ctx.lineWidth = lit ? 2.4 : 1;
          ctx.strokeRect(Math.round(cx) + 0.5, Math.round(cy) + 0.5, Math.round(w), Math.round(h));
          ctx.restore();

          if (!labels) continue;

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Dots and hatching run right under the numbers, so anything but a
          // solid fill gets a plate behind the text to read against.
          const plate = (text: string, tx: number, ty: number, size: number, color: string) => {
            ctx.font = `${size > type * 1.2 ? 300 : 500} ${size}px ${MONO}`;
            if (fill !== 0) {
              const tw = ctx.measureText(text).width;
              ctx.fillStyle = 'rgba(4, 5, 10, 0.62)';
              ctx.fillRect(tx - tw / 2 - size * 0.2, ty - size * 0.6, tw + size * 0.4, size * 1.2);
            }
            ctx.fillStyle = color;
            ctx.fillText(text, tx, ty);
          };

          const room = Math.min(w, h);
          if (h > type * 3.4 && w > type * 2.6) {
            plate(`${xn[i]}×${yn[j]}`, cx + w / 2, cy + h / 2 - type, type * 0.85,
              hsl(ink.h, 40, 92, 0.72));
            plate(`${n}`, cx + w / 2, cy + h / 2 + type * 0.7,
              Math.min(w * 0.42, h * 0.36, type * 1.9), hsl(ink.h, 30, 97, 0.94));
          } else if (room > type * 1.5) {
            plate(`${n}`, cx + w / 2, cy + h / 2, Math.min(room * 0.5, type * 1.5),
              hsl(ink.h, 30, 97, 0.9));
          }
        }
      }

      /* ------------------------------------------------------ term labels */

      ctx.font = `500 ${type * 0.82}px ${MONO}`;
      setTracking(ctx, '0.04em');

      // Terms sitting at zero have no column to sit over, and a one-unit column
      // is narrower than its own label, so the labels are laid out left to
      // right and pushed apart just enough never to collide. The bracket under
      // each one still shows where the column actually is.
      let lastRight = -1e9;
      for (let i = 0; i < TERMS; i++) {
        const w = xs[i] * unit;
        const on = xn[i] > 0;
        const heat = clamp(colPulse[i]);
        const text = `x${SUBS[i]}=${xn[i]}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const half = ctx.measureText(text).width / 2;
        let cx = colX(i) + w / 2;
        if (cx - half < lastRight) cx = lastRight + half;
        lastRight = cx + half + type * 0.35;
        ctx.fillStyle = hsl(BASE_HUE + i * 31, on ? 55 : 20, on ? 82 + heat * 15 : 48, on ? 0.9 : 0.5);
        ctx.fillText(text, cx, boardY - type * 0.9);
        if (on) {
          ctx.strokeStyle = hsl(BASE_HUE + i * 31, 55, 78, 0.35 + heat * 0.5);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(colX(i) + 1, boardY - type * 0.55);
          ctx.lineTo(colX(i) + w - 1, boardY - type * 0.55);
          ctx.stroke();
        }
      }

      let lastBottom = -1e9;
      for (let j = 0; j < TERMS; j++) {
        const h = ys[j] * unit;
        const on = yn[j] > 0;
        const heat = clamp(rowPulse[j]);
        let cy = rowY(j) + h / 2;
        if (cy - type * 0.6 < lastBottom) cy = lastBottom + type * 0.6;
        lastBottom = cy + type * 0.6;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hsl(
          BASE_HUE + 120 + j * 31,
          on ? 55 : 20,
          on ? 82 + heat * 15 : 48,
          on ? 0.9 : 0.5,
        );
        ctx.fillText(`y${SUBS[j]}=${yn[j]}`, boardX - type * 0.9, cy);
        if (on) {
          ctx.strokeStyle = hsl(BASE_HUE + 120 + j * 31, 55, 78, 0.35 + heat * 0.5);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(boardX - type * 0.55, rowY(j) + 1);
          ctx.lineTo(boardX - type * 0.55, rowY(j) + h - 1);
          ctx.stroke();
        }
      }

      /* ------------------------------------------------- dimension lines */

      if (sumXn > 0 && sumYn > 0) {
        ctx.strokeStyle = hsl(BASE_HUE, 60, 80, 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(boardX, boardY + rectH + type * 0.7);
        ctx.lineTo(boardX + rectW, boardY + rectH + type * 0.7);
        ctx.moveTo(boardX + rectW + type * 0.7, boardY);
        ctx.lineTo(boardX + rectW + type * 0.7, boardY + rectH);
        ctx.stroke();

        ctx.font = `500 ${type}px ${MONO}`;
        ctx.fillStyle = hsl(BASE_HUE, 60, 88, 0.9);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${sumXn}`, boardX + rectW / 2, boardY + rectH + type * 1.05);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${sumYn}`, boardX + rectW + type * 1.05, boardY + rectH / 2);
      }
      setTracking(ctx, '0em');

      /* ---------------------------------------------------------- readout */

      if (readout !== 2) {
        const bigSize = wide
          ? clamp(Math.min(plotW - boardSize, plotH) * 0.3, 30, 108)
          : clamp(type * 2.2, 22, 44);
        if (wide) {
          const px = boardX + boardSize + dim + type * 1.2;
          let py = boardY + type * 0.2;

          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `500 ${type * 0.72}px ${MONO}`;
          setTracking(ctx, '0.3em');
          ctx.fillStyle = '#64748b';
          ctx.fillText('THE RECTANGLE IS', px, py);
          setTracking(ctx, '0em');
          py += type * 1.6;

          ctx.font = `200 ${bigSize}px ${MONO}`;
          ctx.fillStyle = '#e6ecff';
          ctx.fillText(`${product}`, px, py);
          py += bigSize * 1.18;

          if (readout === 0) {
            ctx.font = `400 ${type}px ${MONO}`;
            ctx.fillStyle = hsl(BASE_HUE, 45, 76, 0.9);
            ctx.fillText(`x = ${xn.join(' + ')} = ${sumXn}`, px, py);
            py += type * 1.5;
            ctx.fillStyle = hsl(BASE_HUE + 120, 45, 76, 0.9);
            ctx.fillText(`y = ${yn.join(' + ')} = ${sumYn}`, px, py);
            py += type * 1.5;
            ctx.fillStyle = '#94a3c8';
            ctx.fillText(`${sumXn} × ${sumYn} = ${product}`, px, py);
            py += type * 2.1;

            // How much of the twelve-by-twelve board the rectangle has taken.
            const barW = Math.min(plotX + plotW - px, type * 14);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(px, py, barW, type * 0.5);
            ctx.fillStyle = hsl(BASE_HUE + 30, 70, 62, 0.85);
            ctx.fillRect(px, py, (barW * product) / (BOARD * BOARD), type * 0.5);
            py += type * 1.3;
            ctx.font = `500 ${type * 0.72}px ${MONO}`;
            setTracking(ctx, '0.18em');
            ctx.fillStyle = '#4a5570';
            ctx.fillText(`${product} OF 144 SQUARES`, px, py);
            py += type * 1.9;

            if (sweeping) {
              const n = xn[sweepI] * yn[sweepJ];
              ctx.font = `500 ${type * 0.86}px ${MONO}`;
              setTracking(ctx, '0.08em');
              ctx.fillStyle = hsl(BASE_HUE + 40, 70, 84, 0.95);
              ctx.fillText(
                `x${SUBS[sweepI]}y${SUBS[sweepJ]} = ${xn[sweepI]}×${yn[sweepJ]} = ${n}`,
                px,
                py,
              );
              py += type * 1.5;
              ctx.fillStyle = '#94a3c8';
              ctx.fillText(`running total ${sweepSum + n}`, px, py);
            }
            setTracking(ctx, '0em');
          }
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = `200 ${bigSize}px ${MONO}`;
          ctx.fillStyle = '#e6ecff';
          const line =
            readout === 0 ? `${sumXn} × ${sumYn} = ${product}` : `${product}`;
          ctx.fillText(line, plotX + plotW / 2, boardY + boardSize + type * 1.2);
        }
      }

      /* ------------------------------------------------------------ toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        // Bottom right: the only corner the page does not put a control in.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = `500 ${type * 0.76}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = hsl(BASE_HUE + 40, 60, 80, a);
        ctx.fillText(toast.toUpperCase(), plotX + plotW, plotY + plotH);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hsl(BASE_HUE + 40, 80, 60, padFlash * 0.07);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // A slow breath along the top edge of the board, so a screen nobody is
      // touching still looks switched on.
      ctx.fillStyle = hsl(BASE_HUE, 70, 60, 0.05 + Math.sin(time * 0.7) * 0.025);
      ctx.fillRect(boardX, boardY - 1, boardSize, 2);
    },
  };
};

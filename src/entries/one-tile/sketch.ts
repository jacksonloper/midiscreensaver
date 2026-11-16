import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';
import { EMPTY, LETTERS, RULE_SETS, SIZES, makeInstance, tiles as countTiles, type Attack, type Instance, type Rule, type Size, type Walk } from './grid';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, v: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
};

export const PALETTES = ['night', 'chalkboard', 'violet', 'ember'];

/** Knob 1: how many swaps the generator makes. */
export const lambdaFor = (k: number): number => Math.round(range(clamp(k), 4, 40));
export const knobForLambda = (n: number): number => (n - 4) / 36;
/** Knob 5: which set of rules. */
export const rulesFor = (k: number): number => Math.min(RULE_SETS.length - 1, Math.floor(clamp(k) * RULE_SETS.length));
export const knobForRules = (i: number): number => (i + 0.5) / RULE_SETS.length;
/** Knob 6: how big the board is. */
export const sizeFor = (k: number): number => Math.min(SIZES.length - 1, Math.floor(clamp(k) * SIZES.length));
export const knobForSize = (i: number): number => (i + 0.5) / SIZES.length;
/** Knob 3: which of 64 instances. */
export const seedFor = (k: number): number => Math.round(clamp(k) * 63);

/* ----------------------------------------------------------------- acts */

const ACTS = ['grow', 'greedy', 'standard', 'search', 'planted'] as const;
type Act = (typeof ACTS)[number];

const ACT_LABEL: Record<Act, string> = {
  grow: 'generator · one tile becomes a mess',
  greedy: 'attacker 1 · remove a tile whenever possible',
  standard: 'attacker 2 · simplify both boards',
  search: 'attacker 3 · try everything',
  planted: "with the key · the generator's way back",
};

const ACT_SHORT: Record<Act, string> = {
  grow: 'generator',
  greedy: 'remove a tile whenever possible',
  standard: 'simplify both boards',
  search: 'try everything',
  planted: "the generator's way back",
};

const commas = (n: number): string => n.toLocaleString('en-US');
const walkOf = (inst: Instance, act: Act): Walk => (act === 'grow' ? inst.grown : inst[act]);

const verdict = (inst: Instance, act: Act): string => {
  if (act === 'grow') return `${countTiles(inst.mess)} tiles after ${inst.grown.steps.length} swaps. The claim: this can be turned back into the one tile.`;
  const a = inst[act] as Attack;
  const steps = a.steps.length;
  const left = countTiles(a.frames[a.frames.length - 1]);
  if (act === 'planted') return `back to the one tile in ${steps} swaps`;
  if (act === 'greedy') {
    return a.outcome === 'found' ? `back to the one tile in ${steps} swaps` : `stuck with ${left} tiles: no swap removes one`;
  }
  if (act === 'standard') {
    return a.outcome === 'found'
      ? `the mess and the one tile simplify to the same board: a path of ${steps} swaps`
      : `the mess simplifies to ${left} tiles and stops, which proves nothing`;
  }
  const s = inst.search;
  return s.outcome === 'found'
    ? `found the shortest path, ${steps} swaps, after looking at ${commas(s.seen)} boards`
    : `gave up after looking at ${commas(s.seen)} boards`;
};

/* ------------------------------------------------------------- palettes */

interface Palette {
  bg: [string, string];
  text: string;
  dim: string;
  sat: number;
  light: number;
}

const INKS: Palette[] = [
  { bg: [hsl(226, 30, 10), '#04050a'], text: hsl(218, 30, 88), dim: hsl(218, 14, 54), sat: 86, light: 66 },
  { bg: [hsl(152, 26, 15), hsl(160, 30, 9)], text: hsl(60, 20, 93), dim: hsl(140, 12, 60), sat: 80, light: 76 },
  { bg: [hsl(262, 34, 14), hsl(250, 40, 6)], text: hsl(270, 40, 92), dim: hsl(262, 16, 60), sat: 90, light: 72 },
  { bg: [hsl(18, 34, 11), hsl(8, 30, 5)], text: hsl(32, 50, 88), dim: hsl(24, 20, 54), sat: 84, light: 64 },
];

const ACT_HUE: Record<Act, number> = { grow: 28, planted: 158, greedy: 350, standard: 52, search: 268 };
/** One colour per letter. */
const LETTER_HUE = [8, 205, 44];

/** One walk as a polyline of (step, tiles on the board), thinned for a log-scaled axis. */
const thin = (walk: Walk, maxSteps: number): { i: number; n: number }[] => {
  const out: { i: number; n: number }[] = [];
  let bucket = -1;
  walk.frames.forEach((f, i) => {
    const b = Math.floor((Math.log1p(i) / Math.log1p(maxSteps)) * 600);
    const n = countTiles(f);
    if (b !== bucket || i === walk.frames.length - 1) {
      out.push({ i, n });
      bucket = b;
    } else if (n > out[out.length - 1].n) out[out.length - 1] = { i, n };
  });
  return out;
};

/* --------------------------------------------------------------- sketch */

/**
 * A board with one tile on it, a list of allowed swaps, and a mess. The
 * generator shows the one tile growing into the mess; three attackers who
 * were given only the two ends try to turn the mess back into the tile; then
 * the generator's own way back is played.
 */
export const createOneTile: SketchFactory = (): Sketch => {
  let runs = 0;
  let manual = false;
  let target = 0;

  let act: Act = 'grow';
  let progress = 0;
  let rest = 0;

  let inst: Instance | null = null;
  let key = '';
  let curves: Partial<Record<Act, { i: number; n: number }[]>> = {};
  let maxSteps = 1;
  let maxTiles = 2;

  let lastRules = -1;
  let lastPalette = -1;

  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  const say = (text: string): void => {
    toast = text;
    toastAge = 0;
  };

  const startAct = (next: Act): void => {
    act = next;
    progress = 0;
    target = 0;
    rest = 0;
  };

  const nextAct = (): void => {
    const i = ACTS.indexOf(act);
    if (i === ACTS.length - 1) runs++;
    startAct(ACTS[(i + 1) % ACTS.length]);
  };

  return {
    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kLambda, kPace, kSeed, kPalette, kRules, kSize, kHold, kGraph] = midi.knobs;

      /* ------------------------------------------------------ controls */

      for (const hit of midi.hits) {
        if (hit.pad < 5) {
          startAct(ACTS[hit.pad]);
          manual = false;
          say(ACT_SHORT[ACTS[hit.pad]]);
        } else if (hit.pad === 5) {
          if (!manual) {
            manual = true;
            target = Math.floor(progress) + 1;
          } else target += 1;
          say('one swap at a time');
        } else if (hit.pad === 6) {
          manual = false;
          say('play');
        } else {
          runs++;
          startAct('grow');
          manual = false;
          say('new board');
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const ruleSet = rulesFor(kRules);
      const palette = Math.min(PALETTES.length - 1, Math.floor(clamp(kPalette) * PALETTES.length));
      if (lastRules >= 0 && ruleSet !== lastRules) say(`rules · ${RULE_SETS[ruleSet]}`);
      if (lastPalette >= 0 && palette !== lastPalette) say(`palette · ${PALETTES[palette]}`);
      lastRules = ruleSet;
      lastPalette = palette;

      const spec = { rules: ruleSet, lambda: lambdaFor(kLambda), size: sizeFor(kSize), seed: (seedFor(kSeed) + runs * 17) % 997 };
      const nextKey = JSON.stringify(spec);
      if (nextKey !== key) {
        const fresh = makeInstance(spec);
        if (inst) startAct('grow');
        inst = fresh;
        key = nextKey;
        maxSteps = 1;
        maxTiles = 2;
        curves = {};
        for (const a of ACTS) if (a !== 'grow') maxSteps = Math.max(maxSteps, fresh[a].steps.length);
        for (const a of ACTS) {
          if (a === 'grow') continue;
          curves[a] = thin(fresh[a], maxSteps);
          for (const p of curves[a]!) maxTiles = Math.max(maxTiles, p.n);
        }
      }
      const I = inst!;
      const end = walkOf(I, act).frames.length - 1;

      const perSecond = Math.max(1 / range(kPace, 2.6, 0.18), end / 14);
      const fast = perSecond > 7;
      const hold = range(kHold, 0.8, 7);

      if (manual) {
        if (target > end) nextAct();
        else progress = Math.min(target, progress + dt * perSecond);
      } else if (progress >= end) {
        rest += dt;
        if (rest > hold) nextAct();
      } else progress = Math.min(end, progress + dt * perSecond);

      /* --------------------------------------------------------- state */

      const w = walkOf(I, act);
      const last = w.frames.length - 1;
      const k = Math.min(Math.floor(progress), last);
      const f = progress - k;
      const stepping = k < last && (f > 0 || fast);
      // A slow swap outlines the cells about to change, then shows them changed.
      const before = fast || f < 0.5 || !stepping;
      const shown = stepping && !before ? w.frames[k + 1] : w.frames[k];
      const heat = !stepping ? 0 : fast ? 0.75 : before ? clamp(f / 0.3) : clamp(1 - (f - 0.5) / 0.5);
      const atEnd = k === last && !stepping;
      const st = stepping ? w.steps[k] : null;

      /* --------------------------------------------------------- frame */

      const pal = INKS[palette];
      const ink = (a: Act, alpha = 1): string => hsl(ACT_HUE[a], pal.sat, pal.light, alpha);
      const margin = Math.min(width, height) * 0.045 + 6;
      // The page floats its controls over the top and bottom of the stage.
      const top = 30 + margin * 0.5;
      const footer = Math.min(height * 0.24, 128);
      const plotX = margin;
      const plotY = top;
      const plotW = Math.max(120, width - margin * 2);
      const plotH = Math.max(90, height - top - footer);
      const type = clamp(Math.min(width, height) * 0.024, 10, 17);

      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, pal.bg[0]);
      sky.addColorStop(1, pal.bg[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      const panelW = Math.min(type * 21, plotW * 0.34);
      const wide = plotW - panelW > plotH * 1.05;
      const stageX = plotX;
      const stageW = wide ? plotW - panelW - type * 1.8 : plotW;
      const graphH = kGraph < 0.03 ? 0 : range(kGraph, type * 2.2, plotH * 0.26);

      /** Draw a pattern or a whole board: `cols` cells to a row. Empty cells are faint outlines. */
      const cells = (pattern: string, cols: number, x: number, y: number, cell: number, alpha: number): void => {
        const gap = cell * 0.1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${cell * 0.56}px ${MONO}`;
        for (let i = 0; i < pattern.length; i++) {
          const cx = x + (i % cols) * cell;
          const cy = y + Math.floor(i / cols) * cell;
          ctx.beginPath();
          ctx.roundRect(cx + gap / 2, cy + gap / 2, cell - gap, cell - gap, cell * 0.18);
          if (pattern[i] === EMPTY) {
            ctx.strokeStyle = pal.dim;
            ctx.globalAlpha = 0.28 * alpha;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
            continue;
          }
          const hue = LETTER_HUE[LETTERS.indexOf(pattern[i]) % LETTER_HUE.length];
          ctx.fillStyle = hsl(hue, 58, 44, alpha);
          ctx.fill();
          if (cell > 9) {
            ctx.fillStyle = hsl(hue, 30, 96, alpha);
            ctx.fillText(pattern[i], cx + cell / 2, cy + cell / 2 + cell * 0.03);
          }
        }
      };

      /* -------------------------------------------------------- header */

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      setTracking(ctx, '0.2em');
      const head = `${ACT_LABEL[act]} · ${atEnd ? 'done' : `swap ${commas(Math.min(k + 1, last))} of ${commas(last)}`}`;
      ctx.fillStyle = ink(act, 0.95);
      ctx.fillText(head.toUpperCase(), stageX, plotY);
      setTracking(ctx, '0em');

      ctx.font = `500 ${type * 0.95}px ${MONO}`;
      ctx.fillStyle = atEnd ? pal.text : pal.dim;
      let line = atEnd ? verdict(I, act) : `${countTiles(shown)} tiles on the board`;
      while (line.length > 8 && ctx.measureText(line).width > stageW) line = line.slice(0, -2) + '…';
      ctx.fillText(line, stageX, plotY + type * 1.35);

      /* ----------------------------------------------- every allowed swap */

      // Always on screen: the complete list of swaps anyone may make. The one in use is outlined.
      let y = plotY + type * 3.1;
      ctx.font = `500 ${type * 0.62}px ${MONO}`;
      setTracking(ctx, '0.18em');
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.dim;
      ctx.fillText(`EVERY ALLOWED SWAP · EITHER WAY ROUND · ${RULE_SETS[I.spec.rules].toUpperCase()}`, stageX, y);
      setTracking(ctx, '0em');
      y += type * 1.1;
      const rc = type * 0.95;
      const ruleW = (r: Rule): number => r.w * 2 * rc + rc * 1.5;
      const rowH = rc * 2.5;
      let rx = stageX;
      I.rules.forEach((r, i) => {
        if (rx + ruleW(r) > stageX + stageW) {
          rx = stageX;
          y += rowH;
        }
        const on = st !== null && st.rule === i && heat > 0;
        const ry = y + (2 - r.h) * rc * 0.5;
        cells(r.l, r.w, rx, ry, rc, 1);
        ctx.font = `500 ${rc}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = on ? ink(act, 1) : pal.dim;
        ctx.fillText('↔', rx + r.w * rc + rc * 0.75, y + rc);
        cells(r.r, r.w, rx + r.w * rc + rc * 1.5, ry, rc, 1);
        if (on) {
          ctx.strokeStyle = ink(act, 0.4 + 0.6 * heat);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(rx - rc * 0.2, y - rc * 0.15, ruleW(r) + rc * 0.4, rc * 2.3, rc * 0.3);
          ctx.stroke();
        }
        rx += ruleW(r) + rc * 1.3;
      });
      y += rowH + type * 0.4;

      /* --------------------------------------------------------- board */

      const size: Size = I.size;
      const boardTop = y;
      const boardH = Math.max(40, plotY + plotH - boardTop - (graphH > 0 ? graphH + type * 2.9 : 0));
      // The claim, small, on the left: this mess is the same as this one tile.
      const thumb = Math.min(type * 0.85, boardH / (size.h * 2 + 3.2));
      const claimW = thumb * size.w + type * 1.2;
      const cell = Math.min(type * 3.2, (stageW - claimW) / size.w, boardH / size.h);
      const bx = stageX + claimW + Math.max(0, (stageW - claimW - cell * size.w) / 2);
      const by = boardTop + Math.max(0, (boardH - cell * size.h) / 2);

      ctx.font = `500 ${type * 0.6}px ${MONO}`;
      setTracking(ctx, '0.16em');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = pal.dim;
      const cy0 = boardTop + Math.max(0, (boardH - (thumb * size.h * 2 + type * 3)) / 2);
      ctx.fillText('THE MESS', stageX, cy0);
      cells(I.mess, size.w, stageX, cy0 + type * 0.9, thumb, shown === I.mess ? 1 : 0.6);
      ctx.fillStyle = pal.dim;
      ctx.font = `500 ${type * 0.6}px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('THE ONE TILE', stageX, cy0 + type * 1.5 + thumb * size.h);
      cells(I.one, size.w, stageX, cy0 + type * 2.4 + thumb * size.h, thumb, shown === I.one ? 1 : 0.6);
      setTracking(ctx, '0em');

      cells(shown, size.w, bx, by, cell, 1);
      if (st && heat > 0) {
        const r = I.rules[st.rule];
        ctx.strokeStyle = ink(act, 0.35 + 0.65 * heat);
        ctx.lineWidth = Math.max(2, cell * 0.08);
        ctx.shadowColor = ink(act, 0.6 * heat);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.roundRect(bx + (st.at % size.w) * cell, by + Math.floor(st.at / size.w) * cell, r.w * cell, r.h * cell, cell * 0.22);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      /* --------------------------------------------------------- graph */

      const count = countTiles(shown);
      if (graphH > 0) {
        const gx = stageX;
        const gw = stageW;
        const gy = plotY + plotH - graphH - type * 0.7;
        const X = (i: number): number => gx + (Math.log1p(i) / Math.log1p(maxSteps)) * gw;
        const Y = (n: number): number => gy + graphH - ((n - 1) / Math.max(1, maxTiles - 1)) * graphH;

        ctx.font = `500 ${type * 0.58}px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        for (let d = 10; d <= maxSteps; d *= 10) {
          ctx.fillStyle = pal.dim;
          ctx.globalAlpha = 0.22;
          ctx.fillRect(X(d), gy, 1, graphH);
          ctx.globalAlpha = 0.7;
          ctx.fillText(commas(d), X(d), gy + graphH + 3);
        }
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = pal.dim;
        ctx.fillRect(gx, gy + graphH, gw, 1);
        ctx.globalAlpha = 1;

        const live: Act = act === 'grow' ? 'planted' : act;
        for (const a of ACTS) {
          const pts = curves[a];
          if (!pts) continue;
          const on = a === live;
          ctx.beginPath();
          pts.forEach((p, j) => {
            if (j === 0) ctx.moveTo(X(p.i), Y(p.n));
            else {
              ctx.lineTo(X(p.i), Y(pts[j - 1].n));
              ctx.lineTo(X(p.i), Y(p.n));
            }
          });
          ctx.strokeStyle = ink(a, on ? 0.95 : 0.4);
          ctx.lineWidth = on ? 2 : 1.2;
          ctx.stroke();
          const lastPt = pts[pts.length - 1];
          const ex = X(lastPt.i);
          const ey = Y(lastPt.n);
          const how = (I[a as Exclude<Act, 'grow'>] as Attack).outcome;
          ctx.strokeStyle = ink(a, on ? 1 : 0.6);
          ctx.fillStyle = ink(a, on ? 1 : 0.6);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          if (how === 'found') {
            ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
            ctx.fill();
          } else if (how === 'stuck') {
            ctx.moveTo(ex - 4, ey - 4);
            ctx.lineTo(ex + 4, ey + 4);
            ctx.moveTo(ex + 4, ey - 4);
            ctx.lineTo(ex - 4, ey + 4);
            ctx.stroke();
          } else {
            ctx.moveTo(ex, ey - 6);
            ctx.lineTo(ex, ey + 6);
            ctx.stroke();
          }
        }
        // Where the board on screen sits. The generator runs its way back right to left.
        const total = I[live].frames.length - 1;
        ctx.fillStyle = ink(act, 1);
        ctx.beginPath();
        ctx.arc(X(act === 'grow' ? total - progress : progress), Y(count), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = pal.bg[1];
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        setTracking(ctx, '0.18em');
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.dim;
        ctx.fillText('TILES ON THE BOARD ALONG EACH WAY BACK · SWAPS →', gx, gy - 5);
        setTracking(ctx, '0em');
      }

      /* ---------------------------------------------------- scoreboard */

      if (wide) {
        const x0 = plotX + plotW - panelW;
        const t = type * 0.8;
        const lineH = t * 1.42;
        let py = plotY;

        const caps = (text: string, color: string): void => {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `500 ${t * 0.82}px ${MONO}`;
          setTracking(ctx, '0.16em');
          ctx.fillStyle = color;
          ctx.fillText(text.toUpperCase(), x0, py);
          setTracking(ctx, '0em');
          py += lineH;
        };
        const para = (text: string, color: string, indent = 0): void => {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `400 ${t}px ${MONO}`;
          ctx.fillStyle = color;
          let row = '';
          for (const word of text.split(' ')) {
            const trial = row ? `${row} ${word}` : word;
            if (row && ctx.measureText(trial).width > panelW - indent) {
              ctx.fillText(row, x0 + indent, py);
              py += lineH;
              row = word;
            } else row = trial;
          }
          ctx.fillText(row, x0 + indent, py);
          py += lineH;
        };

        caps('the claim', ink('grow'));
        para(`These ${countTiles(I.mess)} tiles can be turned into one tile. The generator took ${I.grown.steps.length} swaps to make them.`, pal.text);
        py += lineH * 0.4;

        for (const a of ACTS) {
          if (a === 'grow') continue;
          const on = a === act || (act === 'grow' && a === 'planted');
          ctx.globalAlpha = on ? 1 : 0.62;
          ctx.fillStyle = ink(a);
          ctx.beginPath();
          ctx.arc(x0 - t * 0.75, py + t * 0.45, on ? t * 0.3 : t * 0.2, 0, Math.PI * 2);
          ctx.fill();
          caps(ACT_SHORT[a], ink(a));
          para(verdict(I, a), pal.text, t);
          ctx.globalAlpha = 1;
          py += lineH * 0.25;
        }

        // How fast "everything" grows: new boards at each distance from the mess.
        if (py + lineH * 3 < plotY + plotH) {
          py += lineH * 0.2;
          caps('new boards at each distance from the mess', pal.dim);
          para(`${I.search.rings[0].map(commas).join(', ')}${I.search.outcome === 'found' ? '' : ', …'}`, pal.text, t);
        }
      }

      /* ---------------------------------------------------------- toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.font = `500 ${type * 0.72}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = ink('planted', a);
        ctx.fillText(toast.toUpperCase(), stageX + stageW, plotY + type * 1.4);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = ink(act, padFlash * 0.05);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };
};

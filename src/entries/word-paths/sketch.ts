import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';
import { LETTERS, MAX_LENGTH, RULE_SETS, distance, makeInstance, type Attack, type Instance } from './words';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, v: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
};

export const PALETTES = ['night', 'chalkboard', 'violet', 'ember'];

/** Knob 1: how many swaps the generator makes. */
export const lambdaFor = (k: number): number => Math.round(range(clamp(k), 4, 60));
export const knobForLambda = (n: number): number => (n - 4) / 56;
/** Knob 5: which set of rules. */
export const rulesFor = (k: number): number => Math.min(RULE_SETS.length - 1, Math.floor(clamp(k) * RULE_SETS.length));
export const knobForRules = (i: number): number => (i + 0.5) / RULE_SETS.length;
/** Knob 6: how long the first word is. */
export const lengthFor = (k: number): number => Math.round(range(clamp(k), 6, 16));
export const knobForLength = (n: number): number => (n - 6) / 10;
/** Knob 3: which of 64 instances. */
export const seedFor = (k: number): number => Math.round(clamp(k) * 63);

/* ----------------------------------------------------------------- acts */

const ACTS = ['planted', 'greedy', 'standard', 'search'] as const;
type Act = (typeof ACTS)[number];

const ACT_LABEL: Record<Act, string> = {
  planted: 'generator · its own chain of swaps',
  greedy: 'attacker 1 · get closer each time',
  standard: 'attacker 2 · simplify both words',
  search: 'attacker 3 · try everything',
};

const ACT_SHORT: Record<Act, string> = {
  planted: "the generator's chain",
  greedy: 'get closer each time',
  standard: 'simplify both words',
  search: 'try everything',
};

const commas = (n: number): string => n.toLocaleString('en-US');

const verdict = (inst: Instance, act: Act): string => {
  const a = inst[act] as Attack;
  const steps = a.steps.length;
  if (act === 'planted') return `${steps} swaps from the first word to the last`;
  if (act === 'greedy') {
    return a.outcome === 'found'
      ? `got there in ${steps} swaps`
      : `stuck after ${steps} swaps: every swap from here leaves it further off`;
  }
  if (act === 'standard') {
    return a.outcome === 'found'
      ? `both words simplify to the same word: a path of ${steps} swaps`
      : 'the two words simplify to different words, which proves nothing';
  }
  const s = inst.search;
  return s.outcome === 'found'
    ? `found the shortest path, ${steps} swaps, after looking at ${commas(s.seen)} words`
    : `gave up after looking at ${commas(s.seen)} words`;
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

const ACT_HUE: Record<Act, number> = { planted: 158, greedy: 350, standard: 52, search: 268 };
/** One colour per letter. */
const LETTER_HUE = [8, 44, 150, 205, 285];

/** One walk as a polyline of (step, distance to the target), thinned for a log-scaled axis. */
const thin = (walk: Attack, to: string, maxSteps: number): { i: number; n: number }[] => {
  const out: { i: number; n: number }[] = [];
  let bucket = -1;
  walk.frames.forEach((f, i) => {
    const b = Math.floor((Math.log1p(i) / Math.log1p(maxSteps)) * 600);
    const n = distance(f, to);
    if (b !== bucket || i === walk.frames.length - 1) {
      out.push({ i, n });
      bucket = b;
    } else if (n > out[out.length - 1].n) out[out.length - 1] = { i, n };
  });
  return out;
};

/* --------------------------------------------------------------- sketch */

/**
 * Two words and a list of rules. The generator shows its chain of swaps from
 * one word to the other; then three attackers who were given only the two
 * words try to find a chain of their own.
 */
export const createWordPaths: SketchFactory = (): Sketch => {
  let runs = 0;
  let manual = false;
  let target = 0;
  let palette = 0;

  let act: Act = 'planted';
  let progress = 0;
  let rest = 0;

  let inst: Instance | null = null;
  let key = '';
  let curves: Partial<Record<Act, { i: number; n: number }[]>> = {};
  let maxSteps = 1;
  let maxDist = 1;

  let tilePx = 0;
  let lastRules = -1;

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
      const [kLambda, kPace, kSeed, kTile, kRules, kLength, kHold, kGraph] = midi.knobs;

      /* ------------------------------------------------------ controls */

      for (const hit of midi.hits) {
        if (hit.pad < 4) {
          startAct(ACTS[hit.pad]);
          manual = false;
          say(ACT_SHORT[ACTS[hit.pad]]);
        } else if (hit.pad === 4) {
          if (!manual) {
            manual = true;
            target = Math.floor(progress) + 1;
          } else target += 1;
          say('one swap at a time');
        } else if (hit.pad === 5) {
          manual = false;
          say('play');
        } else if (hit.pad === 6) {
          runs++;
          startAct('planted');
          manual = false;
          say('new words');
        } else {
          palette = (palette + 1) % PALETTES.length;
          say(`palette · ${PALETTES[palette]}`);
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const ruleSet = rulesFor(kRules);
      if (lastRules >= 0 && ruleSet !== lastRules) say(`rules · ${RULE_SETS[ruleSet]}`);
      lastRules = ruleSet;

      const spec = { rules: ruleSet, lambda: lambdaFor(kLambda), length: lengthFor(kLength), seed: (seedFor(kSeed) + runs * 17) % 997 };
      const nextKey = JSON.stringify(spec);
      if (nextKey !== key) {
        const fresh = makeInstance(spec);
        if (inst) startAct('planted');
        inst = fresh;
        key = nextKey;
        maxSteps = 1;
        maxDist = 1;
        curves = {};
        for (const a of ACTS) maxSteps = Math.max(maxSteps, fresh[a].steps.length);
        for (const a of ACTS) {
          curves[a] = thin(fresh[a], fresh.to, maxSteps);
          for (const p of curves[a]!) maxDist = Math.max(maxDist, p.n);
        }
      }
      const I = inst!;
      const walk = I[act] as Attack;
      const end = walk.frames.length - 1;

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

      const w = I[act] as Attack;
      const last = w.frames.length - 1;
      const k = Math.min(Math.floor(progress), last);
      const f = progress - k;
      const stepping = k < last && (f > 0 || fast);
      // A slow step outlines the letters about to go, then the letters that replaced them.
      const before = fast || f < 0.5 || !stepping;
      const shown = stepping && !before ? w.frames[k + 1] : w.frames[k];
      const heat = !stepping ? 0 : fast ? 0.75 : before ? clamp(f / 0.3) : clamp(1 - (f - 0.5) / 0.5);
      const atEnd = k === last && !stepping;
      const st = stepping ? w.steps[k] : null;
      const rule = st ? I.rules[st.rule] : null;
      const was = st && rule ? (st.dir === 1 ? rule.l : rule.r) : '';
      const now = st && rule ? (st.dir === 1 ? rule.r : rule.l) : '';
      const lit: [number, number] | null = st ? [st.at, st.at + (before ? was.length : now.length)] : null;

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

      const panelW = Math.min(type * 23, plotW * 0.36);
      const wide = plotW - panelW > plotH * 1.05;
      const stageX = plotX;
      const stageW = wide ? plotW - panelW - type * 1.8 : plotW;
      const graphH = kGraph < 0.03 ? 0 : range(kGraph, type * 2.4, plotH * 0.34);
      const headH = type * 3.6;
      const stageY = plotY + headH;
      const stageH = Math.max(40, plotH - headH - (graphH > 0 ? graphH + type * 2.9 : 0));

      /** A row of letter tiles. `box` outlines some of them. */
      const tiles = (word: string, x: number, y: number, size: number, alpha: number, box: [number, number] | null, boxInk = ''): void => {
        const gap = size * 0.12;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${size * 0.58}px ${MONO}`;
        for (let i = 0; i < word.length; i++) {
          const hue = LETTER_HUE[LETTERS.indexOf(word[i]) % LETTER_HUE.length];
          ctx.fillStyle = hsl(hue, 58, 44, alpha);
          ctx.beginPath();
          ctx.roundRect(x + i * (size + gap), y, size, size, size * 0.2);
          ctx.fill();
          ctx.fillStyle = hsl(hue, 30, 96, alpha);
          ctx.fillText(word[i], x + i * (size + gap) + size / 2, y + size / 2 + size * 0.03);
        }
        if (box && box[1] > box[0]) {
          ctx.strokeStyle = boxInk;
          ctx.lineWidth = Math.max(2, size * 0.09);
          ctx.beginPath();
          ctx.roundRect(x + box[0] * (size + gap) - gap, y - gap, (box[1] - box[0]) * (size + gap) + gap, size + gap * 2, size * 0.26);
          ctx.stroke();
        }
      };
      const span = (letters: number, size: number): number => letters * size * 1.12 - size * 0.12;

      /* -------------------------------------------------------- header */

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      setTracking(ctx, '0.2em');
      const head = `${ACT_LABEL[act]} · ${atEnd ? 'done' : `swap ${commas(Math.min(k + 1, last))} of ${commas(last)}`}`;
      ctx.fillStyle = ink(act, 0.95);
      ctx.fillText(head.toUpperCase(), stageX, plotY);
      setTracking(ctx, '0em');

      if (atEnd) {
        ctx.font = `500 ${type * 1.05}px ${MONO}`;
        ctx.fillStyle = pal.text;
        let text = verdict(I, act);
        while (text.length > 8 && ctx.measureText(text).width > stageW) text = text.slice(0, -2) + '…';
        ctx.fillText(text, stageX, plotY + type * 1.45);
      } else if (st && rule) {
        // The rule in use, written in tiles: these letters become those.
        const s = type * 1.35;
        const y = plotY + type * 1.35;
        tiles(was, stageX, y, s, 1, null);
        ctx.font = `500 ${type * 1.1}px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = ink(act, 1);
        ctx.fillText('→', stageX + span(was.length, s) + s * 0.45, y + s / 2);
        tiles(now, stageX + span(was.length, s) + s * 1.7, y, s, 1, null);
      }

      /* --------------------------------------------------------- words */

      const small = (size: number): number => size * 0.52;
      const fit = Math.min(type * 2.6 * range(kTile, 0.6, 1.4), stageW / (MAX_LENGTH * 1.12 + 3), stageH / 3.6);
      tilePx = tilePx === 0 ? fit : approach(tilePx, fit, 0.12, dt);
      const size = Math.min(tilePx, fit);
      const sm = small(size);
      const labelW = type * 4.2;
      const blockH = size + sm * 2 + size * 1.5;
      const y0 = stageY + Math.max(0, (stageH - blockH) / 2);

      ctx.font = `500 ${type * 0.66}px ${MONO}`;
      setTracking(ctx, '0.18em');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = pal.dim;
      ctx.fillText('FROM', stageX, y0 + sm / 2);
      ctx.fillText('NOW', stageX, y0 + sm + size * 0.75 + size / 2);
      ctx.fillText('TO', stageX, y0 + sm + size * 2.5 + sm / 2);
      setTracking(ctx, '0em');

      tiles(I.from, stageX + labelW, y0, sm, 0.6, null);
      tiles(shown, stageX + labelW, y0 + sm + size * 0.75, size, 1, heat > 0 ? lit : null, ink(act, 0.35 + 0.65 * heat));
      tiles(I.to, stageX + labelW, y0 + sm + size * 2.5, sm, shown === I.to ? 1 : 0.6, null);

      /* --------------------------------------------------------- graph */

      const off = distance(shown, I.to);
      if (graphH > 0) {
        const gx = stageX;
        const gw = stageW;
        const gy = plotY + plotH - graphH - type * 0.7;
        const X = (i: number): number => gx + (Math.log1p(i) / Math.log1p(maxSteps)) * gw;
        const Y = (n: number): number => gy + graphH - (n / maxDist) * graphH;

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

        for (const a of ACTS) {
          const pts = curves[a];
          if (!pts) continue;
          const on = a === act;
          ctx.beginPath();
          pts.forEach((p, j) => (j ? ctx.lineTo(X(p.i), Y(p.n)) : ctx.moveTo(X(p.i), Y(p.n))));
          ctx.strokeStyle = ink(a, on ? 0.95 : 0.4);
          ctx.lineWidth = on ? 2 : 1.2;
          ctx.stroke();
          const lastPt = pts[pts.length - 1];
          const ex = X(lastPt.i);
          const ey = Y(lastPt.n);
          const how = (I[a] as Attack).outcome;
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
        ctx.fillStyle = ink(act, 1);
        ctx.beginPath();
        ctx.arc(X(progress), Y(off), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = pal.bg[1];
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        setTracking(ctx, '0.18em');
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.dim;
        ctx.fillText(`LETTERS DIFFERENT FROM THE TARGET · NOW ${off} · SWAPS →`, gx, gy - 5);
        setTracking(ctx, '0em');
      }

      /* ---------------------------------------------------- scoreboard */

      if (wide) {
        const x0 = plotX + plotW - panelW;
        const t = type * 0.8;
        const lineH = t * 1.42;
        let y = plotY;

        const caps = (text: string, color: string): void => {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `500 ${t * 0.82}px ${MONO}`;
          setTracking(ctx, '0.16em');
          ctx.fillStyle = color;
          ctx.fillText(text.toUpperCase(), x0, y);
          setTracking(ctx, '0em');
          y += lineH;
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
              ctx.fillText(row, x0 + indent, y);
              y += lineH;
              row = word;
            } else row = trial;
          }
          ctx.fillText(row, x0 + indent, y);
          y += lineH;
        };

        // The rules, in two columns. The one in use is outlined.
        caps(`the rules · ${RULE_SETS[I.spec.rules]}`, pal.dim);
        const rs = t * 1.25;
        const colW = panelW / 2;
        const perCol = Math.ceil(I.rules.length / 2);
        I.rules.forEach((r, i) => {
          const cx = x0 + (i < perCol ? 0 : colW);
          const cy = y + (i % perCol) * rs * 1.5;
          const on = st !== null && st.rule === i && heat > 0;
          tiles(r.l, cx, cy, rs, 1, null);
          ctx.font = `500 ${t}px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = on ? ink(act, 1) : pal.dim;
          const mid = cx + span(r.l.length, rs) + rs * 0.75;
          ctx.fillText('↔', mid, cy + rs / 2);
          tiles(r.r, mid + rs * 0.75, cy, rs, 1, null);
          if (on) {
            ctx.strokeStyle = ink(act, 0.9);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(cx - rs * 0.2, cy - rs * 0.2, span(r.l.length + r.r.length, rs) + rs * 2.1, rs * 1.4, rs * 0.3);
            ctx.stroke();
          }
        });
        y += perCol * rs * 1.5 + lineH * 0.4;

        for (const a of ACTS) {
          const on = a === act;
          ctx.globalAlpha = on ? 1 : 0.62;
          ctx.fillStyle = ink(a);
          ctx.beginPath();
          ctx.arc(x0 - t * 0.75, y + t * 0.45, on ? t * 0.3 : t * 0.2, 0, Math.PI * 2);
          ctx.fill();
          caps(ACT_SHORT[a], ink(a));
          para(verdict(I, a), pal.text, t);
          ctx.globalAlpha = 1;
          y += lineH * 0.25;
        }

        // How fast "everything" grows: new words at each distance from the first word.
        if (y + lineH * 3 < plotY + plotH) {
          y += lineH * 0.2;
          caps('new words at each distance', pal.dim);
          const ring = I.search.rings[0];
          para(`${ring.map(commas).join(', ')}${I.search.outcome === 'found' ? '' : ', …'}`, pal.text, t);
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
        ctx.fillText(toast.toUpperCase(), stageX + stageW, plotY);
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

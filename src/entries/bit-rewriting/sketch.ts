import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';
import {
  LEVELS,
  edgeCounts,
  evaluate,
  makeInstance,
  ruleText,
  tokens,
  type Attack,
  type Expr,
  type Instance,
  type Token,
  type Walk,
} from './rewrite';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, v: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
};

export const PALETTES = ['night', 'chalkboard', 'violet', 'ember'];

/** Knob 1: the security parameter, how many times the generator hides something. */
export const lambdaFor = (k: number): number => Math.round(range(clamp(k), 4, 40));
export const knobForLambda = (n: number): number => (n - 4) / 36;
/** Knob 5: which generator. */
export const levelFor = (k: number): number => Math.min(LEVELS.length - 1, Math.floor(clamp(k) * LEVELS.length));
export const knobForLevel = (level: number): number => (level + 0.5) / LEVELS.length;
/** Knob 3: which of 64 instances. */
export const seedFor = (k: number): number => Math.round(clamp(k) * 63);

/* ----------------------------------------------------------------- acts */

/** What is on screen: the generator at work, then each way back down from E. */
const ACTS = ['grow', 'greedy', 'sorted', 'canonical', 'planted'] as const;
type Act = (typeof ACTS)[number];

const ACT_LABEL: Record<Act, string> = {
  grow: 'generator · hiding a zero',
  greedy: 'attacker 1 · downhill only',
  sorted: 'attacker 2 · sort, then downhill',
  canonical: 'attacker 3 · multiply everything out',
  planted: 'with the key · the planted path',
};

const ACT_SHORT: Record<Act, string> = {
  grow: 'generator',
  greedy: 'downhill only',
  sorted: 'sort, then downhill',
  canonical: 'multiply everything out',
  planted: 'the planted path',
};

const walkOf = (inst: Instance, act: Act): Walk => (act === 'grow' ? inst.grown : inst[act]);

const commas = (n: number): string => n.toLocaleString('en-US');

const verdict = (inst: Instance, act: Act): string => {
  if (act === 'grow') return `this is E: ${inst.E.n} nodes, and all an attacker is given`;
  const a = inst[act] as Attack;
  const steps = commas(a.steps.length);
  const end = a.frames[a.frames.length - 1].n;
  if (act === 'planted') return `back at ${inst.bit} in ${steps} steps`;
  if (a.outcome === 'reached') {
    return `reached ${inst.bit} in ${steps} steps` + (a.peak > inst.E.n ? `, by way of ${commas(a.peak)} nodes` : '');
  }
  if (a.outcome === 'stuck') {
    return a.steps.length === 0
      ? 'stuck at once: nothing here makes E shorter'
      : `stuck at ${end} nodes after ${steps} steps`;
  }
  return `gave up at ${steps} steps, holding ${commas(end)} nodes`;
};

/* ------------------------------------------------------------- palettes */

interface Palette {
  bg: [string, string];
  text: string;
  dim: string;
  op: string;
  paren: string;
  /** Saturation and lightness shared by the five act colours. */
  sat: number;
  light: number;
}

const INKS: Palette[] = [
  { bg: [hsl(226, 30, 10), '#04050a'], text: hsl(218, 30, 88), dim: hsl(218, 14, 54), op: hsl(218, 26, 66), paren: hsl(218, 14, 46), sat: 86, light: 66 },
  { bg: [hsl(152, 26, 15), hsl(160, 30, 9)], text: hsl(60, 20, 93), dim: hsl(140, 12, 60), op: hsl(60, 12, 76), paren: hsl(140, 10, 56), sat: 80, light: 76 },
  { bg: [hsl(262, 34, 14), hsl(250, 40, 6)], text: hsl(270, 40, 92), dim: hsl(262, 16, 60), op: hsl(262, 26, 72), paren: hsl(262, 16, 50), sat: 90, light: 72 },
  { bg: [hsl(18, 34, 11), hsl(8, 30, 5)], text: hsl(32, 50, 88), dim: hsl(24, 20, 54), op: hsl(30, 26, 68), paren: hsl(24, 16, 46), sat: 84, light: 64 },
];

const ACT_HUE: Record<Act, number> = { grow: 28, greedy: 350, sorted: 52, canonical: 268, planted: 158 };

/* --------------------------------------------------------------- layout */

interface Laid {
  tok: Token;
  x: number;
  line: number;
  w: number;
}

/** Room either side of an operator, as a fraction of the type size. */
const OP_GAP = 0.42;

/**
 * Break the expression into lines no wider than `maxW`. A line only breaks in
 * front of an operator, so a continuation starts with + or −, the way it
 * would be written by hand. The type is monospaced, so widths are arithmetic.
 */
const wrap = (toks: Token[], px: number, charW: number, maxW: number): { laid: Laid[]; lines: number[] } => {
  const gap = px * OP_GAP * 2;
  const cw = px * charW;
  const laid: Laid[] = [];
  const lines: number[] = [];
  let x = 0;
  let line = 0;
  let i = 0;
  while (i < toks.length) {
    let j = i + 1;
    while (j < toks.length && toks[j].kind !== 'op') j++;
    let w = 0;
    for (let k = i; k < j; k++) w += toks[k].text.length * cw + (toks[k].kind === 'op' ? gap : 0);
    if (x > 0 && x + w > maxW && toks[i].kind === 'op') {
      lines.push(x);
      x = 0;
      line++;
    }
    for (let k = i; k < j; k++) {
      const tw = toks[k].text.length * cw + (toks[k].kind === 'op' ? gap : 0);
      laid.push({ tok: toks[k], x, line, w: tw });
      x += tw;
    }
    i = j;
  }
  lines.push(x);
  return { laid, lines };
};

/** One walk as a polyline of (step, size), thinned to what a log-scaled axis can show. */
const thin = (walk: Walk, maxSteps: number): { i: number; n: number }[] => {
  const out: { i: number; n: number }[] = [];
  let bucket = -1;
  walk.frames.forEach((f, i) => {
    const b = Math.floor((Math.log1p(i) / Math.log1p(maxSteps)) * 600);
    if (b !== bucket || i === walk.frames.length - 1) {
      out.push({ i, n: f.n });
      bucket = b;
    } else if (f.n > out[out.length - 1].n) out[out.length - 1] = { i, n: f.n };
  });
  return out;
};

/* --------------------------------------------------------------- sketch */

/**
 * One instance of the hiding game at a time. The generator walks uphill from
 * 0 to a long expression E; three attackers who are given only E try to
 * walk back down; then the generator's own walk is played backwards. The
 * graph underneath is the size of the expression along each walk.
 */
export const createBitRewriting: SketchFactory = (): Sketch => {
  let runs = 0;
  let manual = false;
  let target = 0;

  let act: Act = 'grow';
  /** Steps through the current act's walk; frame k sits at progress k. */
  let progress = 0;
  /** Time spent sitting at the end of the current act. */
  let rest = 0;

  let inst: Instance | null = null;
  let key = '';
  let curves: Partial<Record<Act, { i: number; n: number }[]>> = {};
  let maxSteps = 1;
  let maxSize = 2;

  let fontPx = 0;
  let charW = 0;
  let lastLevel = -1;
  let lastPalette = -1;

  // Small caches, each keyed on the expression object now on screen.
  let tokFor: Expr | null = null;
  let tokHot = '';
  let toks: Token[] = [];
  const valueOf = new WeakMap<Expr, number>();
  const edgesOf = new WeakMap<Expr, { down: number; level: number; up: number }>();

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
      const [kLambda, kPace, kSeed, kType, kLevel, kPalette, kHold, kGraph] = midi.knobs;

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
          say('one step at a time');
        } else if (hit.pad === 6) {
          manual = false;
          say('play');
        } else {
          runs++;
          startAct('grow');
          manual = false;
          say('new instance');
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const level = levelFor(kLevel);
      const palette = Math.min(PALETTES.length - 1, Math.floor(clamp(kPalette) * PALETTES.length));
      if (lastLevel >= 0 && level !== lastLevel) say(`generator · ${LEVELS[level]}`);
      if (lastPalette >= 0 && palette !== lastPalette) say(`palette · ${PALETTES[palette]}`);
      lastLevel = level;
      lastPalette = palette;

      const spec = { level, lambda: lambdaFor(kLambda), seed: (seedFor(kSeed) + runs * 17) % 997 };
      const nextKey = JSON.stringify(spec);
      if (nextKey !== key) {
        const fresh = makeInstance(spec);
        if (inst) startAct('grow');
        inst = fresh;
        key = nextKey;
        maxSteps = 1;
        maxSize = 2;
        for (const a of ACTS) {
          if (a === 'grow') continue;
          maxSteps = Math.max(maxSteps, fresh[a].steps.length);
          maxSize = Math.max(maxSize, fresh[a].peak);
        }
        curves = {};
        for (const a of ACTS) if (a !== 'grow') curves[a] = thin(fresh[a], maxSteps);
      }
      const I = inst!;
      const walk = walkOf(I, act);
      const last = walk.frames.length - 1;

      // A long walk is hurried along so that no act outstays its welcome.
      const perSecond = Math.max(1 / range(kPace, 2.6, 0.18), last / 14);
      const fast = perSecond > 7;
      const hold = range(kHold, 0.8, 7);

      if (manual) {
        if (target > last) nextAct();
        else progress = Math.min(target, progress + dt * perSecond);
      } else if (progress >= last) {
        rest += dt;
        if (rest > hold) nextAct();
      } else progress = Math.min(last, progress + dt * perSecond);

      /* --------------------------------------------------------- state */

      const w2 = walkOf(I, act);
      const end = w2.frames.length - 1;
      const k = Math.min(Math.floor(progress), end);
      const f = progress - k;
      const stepping = k < end && (f > 0 || fast);
      // A slow step points at the subterm about to go, then at what replaced
      // it. A fast one just flashes where the rewrite landed.
      const before = fast || f < 0.5 || !stepping;
      const shown = stepping && !before ? w2.frames[k + 1] : w2.frames[k];
      const hotPath = stepping ? w2.steps[k].path : null;
      const heat = !stepping ? 0 : fast ? 0.75 : before ? clamp(f / 0.3) : clamp(1 - (f - 0.5) / 0.5);
      const atEnd = k === end && !stepping;

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

      const type = clamp(Math.min(width, height) * 0.024, 10, 17) * range(kType, 0.6, 1.5);

      const sky = ctx.createLinearGradient(0, 0, width, height);
      sky.addColorStop(0, pal.bg[0]);
      sky.addColorStop(1, pal.bg[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      const panelW = Math.min(type * 23, plotW * 0.36);
      const wide = plotW - panelW > plotH * 1.05;
      const exprX = plotX;
      const exprW = wide ? plotW - panelW - type * 1.8 : plotW;

      const graphH = kGraph < 0.03 ? 0 : range(kGraph, type * 2.4, plotH * 0.42);
      const headH = type * 3.4;
      const exprY = plotY + headH;
      const exprH = Math.max(40, plotH - headH - (graphH > 0 ? graphH + type * 2.9 : 0));

      /* -------------------------------------------------------- header */

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      setTracking(ctx, '0.2em');
      const head = `${ACT_LABEL[act]} · ${atEnd ? 'done' : `step ${commas(Math.min(k + 1, end))} of ${commas(end)}`}`;
      ctx.fillStyle = ink(act, 0.95);
      ctx.fillText(head.toUpperCase(), exprX, plotY);
      const headW = ctx.measureText(head.toUpperCase()).width;

      let worth = valueOf.get(shown);
      if (worth === undefined) {
        worth = Math.round(evaluate(shown, I.env) * 1000) / 1000 + 0;
        valueOf.set(shown, worth);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.dim;
      const tally = `WORTH ${worth} · ${commas(shown.n)} NODES`;
      if (headW + ctx.measureText(tally).width + type * 2 < exprW) ctx.fillText(tally, exprX + exprW, plotY);
      setTracking(ctx, '0em');

      ctx.textAlign = 'left';
      ctx.font = `500 ${type * 1.1}px ${MONO}`;
      if (atEnd) {
        ctx.fillStyle = pal.text;
        ctx.fillText(verdict(I, act), exprX, plotY + type * 1.35);
      } else if (stepping) {
        ctx.fillStyle = ink(act, fast ? 0.9 : 0.4 + 0.6 * clamp(heat * 1.5));
        let rule = ruleText(w2.steps[k], w2.frames[k], w2.frames[k + 1]);
        while (rule.length > 8 && ctx.measureText(rule).width > exprW) rule = rule.slice(0, -2) + '…';
        ctx.fillText(rule, exprX, plotY + type * 1.35);
      }

      /* ---------------------------------------------------- expression */

      const hotKey = hotPath ? hotPath.join('') + (before ? 'b' : 'a') : '';
      if (tokFor !== shown || tokHot !== hotKey) {
        toks = tokens(shown, hotPath);
        tokFor = shown;
        tokHot = hotKey;
      }
      if (charW === 0) {
        ctx.font = `400 100px ${MONO}`;
        charW = ctx.measureText('0').width / 100;
      }
      // The largest type that fits, but never so large a lone 0 looks silly.
      const MIN_PX = 5.5;
      const fits = (px: number): boolean => {
        const { lines } = wrap(toks, px, charW, exprW);
        return lines.length * px * 1.5 <= exprH && Math.max(...lines) <= exprW;
      };
      let want = Math.min(type * 6, exprH / 1.5);
      while (want > MIN_PX && !fits(want)) want *= 0.93;
      want = Math.max(want, MIN_PX);
      fontPx = fontPx === 0 || fast ? want : approach(fontPx, want, 0.12, dt);
      const px = fontPx > want && !fits(fontPx) ? want : fontPx;

      const { laid, lines } = wrap(toks, px, charW, exprW);
      const lh = px * 1.5;
      const rows = Math.max(1, Math.floor(exprH / lh));
      const cut = lines.length > rows;
      const blockH = Math.min(lines.length, rows) * lh;
      const y0 = exprY + Math.max(0, (exprH - blockH) / 2);
      const lineX = (line: number): number => (lines.length === 1 ? exprX + (exprW - lines[line]) / 2 : exprX);

      // Light up the subterm in play, one box per line it spans.
      if (heat > 0) {
        const spans = new Map<number, [number, number]>();
        for (const l of laid) {
          if (!l.tok.hot || l.line >= rows) continue;
          const s = spans.get(l.line);
          spans.set(l.line, s ? [Math.min(s[0], l.x), Math.max(s[1], l.x + l.w)] : [l.x, l.x + l.w]);
        }
        ctx.save();
        ctx.shadowColor = ink(act, 0.7 * heat);
        ctx.shadowBlur = px > 9 ? 14 : 0;
        ctx.fillStyle = ink(act, 0.18 * heat);
        for (const [line, [a, b]] of spans) {
          const h = px * 1.25;
          ctx.beginPath();
          ctx.roundRect(lineX(line) + a - px * 0.12, y0 + line * lh + (lh - h) / 2, b - a + px * 0.24, h, Math.min(px * 0.25, h / 2));
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `400 ${px}px ${MONO}`;
      for (const l of laid) {
        if (l.line >= rows) break;
        const kind = l.tok.kind;
        ctx.fillStyle =
          l.tok.hot && heat > 0
            ? ink(act, 0.55 + 0.45 * heat)
            : kind === 'num' || kind === 'var'
              ? pal.text
              : kind === 'paren'
                ? pal.paren
                : pal.op;
        ctx.fillText(l.tok.text, lineX(l.line) + l.x + (kind === 'op' ? px * OP_GAP : 0), y0 + l.line * lh + lh / 2);
      }
      if (cut) {
        // Too long to show even at the smallest type: say so rather than pretend.
        const note = `only the first part fits · ${commas(shown.n)} nodes in all`;
        ctx.font = `500 ${type * 0.72}px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const nw = ctx.measureText(note).width;
        ctx.fillStyle = pal.bg[1];
        ctx.fillRect(exprX + exprW - nw - type, exprY + exprH - type * 1.3, nw + type, type * 1.3);
        ctx.fillStyle = ink(act, 0.9);
        ctx.fillText(note, exprX + exprW, exprY + exprH - type * 0.2);
      }

      /* --------------------------------------------------------- graph */

      if (graphH > 0) {
        const gx = exprX;
        const gw = exprW;
        const gy = plotY + plotH - graphH - type * 0.7;
        const X = (i: number): number => gx + (Math.log1p(i) / Math.log1p(maxSteps)) * gw;
        const Y = (n: number): number => gy + graphH - (n / maxSize) * graphH;

        // Faint decades along the bottom: 1, 10, 100, 1000 steps.
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
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.dim;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(gx, gy + graphH, gw, 1);
        ctx.globalAlpha = 1;

        const live: Act = act === 'grow' ? 'planted' : act;
        for (const a of ACTS) {
          const pts = curves[a];
          if (!pts) continue;
          const on = a === live;
          ctx.beginPath();
          pts.forEach((p, j) => (j ? ctx.lineTo(X(p.i), Y(p.n)) : ctx.moveTo(X(p.i), Y(p.n))));
          ctx.strokeStyle = ink(a, on ? 0.95 : 0.4);
          ctx.lineWidth = on ? 2 : 1.2;
          ctx.stroke();
          // How it ended: a dot on the floor, a cross where it stuck, a bar where it gave up.
          const lastPt = pts[pts.length - 1];
          const ex = X(lastPt.i);
          const ey = Y(lastPt.n);
          const out = I[a as Exclude<Act, 'grow'>].outcome;
          ctx.strokeStyle = ink(a, on ? 1 : 0.6);
          ctx.fillStyle = ink(a, on ? 1 : 0.6);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          if (out === 'reached') {
            ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
            ctx.fill();
          } else if (out === 'stuck') {
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

        // Where the expression on screen sits. The generator runs the planted path right to left.
        const total = I[live].frames.length - 1;
        const pos = act === 'grow' ? total - progress : progress;
        const a0 = I[live].frames[clamp(Math.floor(pos), 0, total)].n;
        const a1 = I[live].frames[clamp(Math.floor(pos) + 1, 0, total)].n;
        const mx = X(pos);
        const my = Y(a0 + (a1 - a0) * (pos - Math.floor(pos)));
        ctx.fillStyle = ink(act, 1);
        ctx.beginPath();
        ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = pal.bg[1];
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        setTracking(ctx, '0.18em');
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.dim;
        ctx.fillText('SIZE ALONG EACH WAY DOWN FROM E · STEPS →', gx, gy - 5);
        setTracking(ctx, '0em');
      }

      /* ---------------------------------------------------- scoreboard */

      if (wide) {
        const x0 = plotX + plotW - panelW;
        const t = type * 0.8;
        const lineH = t * 1.42;
        let y = plotY;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const caps = (text: string, color: string): void => {
          ctx.font = `500 ${t * 0.82}px ${MONO}`;
          setTracking(ctx, '0.16em');
          ctx.fillStyle = color;
          ctx.fillText(text.toUpperCase(), x0, y);
          setTracking(ctx, '0em');
          y += lineH;
        };
        const para = (text: string, color: string, indent = 0): void => {
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

        caps(`generator ${I.spec.level} · ${LEVELS[I.spec.level]}`, ink('grow'));
        para(`λ = ${I.spec.lambda}, E has ${I.E.n} nodes`, pal.text);
        y += lineH * 0.45;

        caps('plug in numbers', pal.dim);
        para(`E is worth ${Math.round(I.sample * 1000) / 1000 + 0} at a random point. An answer, but not a path.`, pal.text, t);
        y += lineH * 0.3;

        for (const a of ACTS) {
          if (a === 'grow') continue;
          const on = a === act || (act === 'grow' && a === 'planted');
          ctx.globalAlpha = on ? 1 : 0.62;
          ctx.fillStyle = ink(a);
          ctx.beginPath();
          ctx.arc(x0 - t * 0.75, y + t * 0.45, on ? t * 0.3 : t * 0.2, 0, Math.PI * 2);
          ctx.fill();
          caps(ACT_SHORT[a], ink(a));
          para(verdict(I, a), pal.text, t);
          ctx.globalAlpha = 1;
          y += lineH * 0.3;
        }

        // The neighbourhood of the expression on screen, when it is small enough to count.
        if (shown.n <= 400 && y + lineH * 3 < plotY + plotH) {
          let c = edgesOf.get(shown);
          if (!c) {
            c = edgeCounts(shown);
            edgesOf.set(shown, c);
          }
          y += lineH * 0.3;
          caps('edges out of this expression', pal.dim);
          para(`${c.down} shorter · ${c.level} same size · ${c.up} longer, and no end of ones that invent a term`, pal.text, t);
        }
      }

      /* ---------------------------------------------------------- toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.font = `500 ${type * 0.72}px ${MONO}`;
        setTracking(ctx, '0.22em');
        const tw = ctx.measureText(toast.toUpperCase()).width;
        ctx.globalAlpha = a;
        ctx.fillStyle = pal.bg[0];
        ctx.fillRect(exprX + exprW - tw - type, plotY + type * 1.3, tw + type, type * 1.5);
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink('planted', a);
        ctx.fillText(toast.toUpperCase(), exprX + exprW, plotY + type * 1.6);
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

import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';
import {
  GROW_RULES,
  STRATEGIES,
  makeRun,
  resimplify,
  size,
  tokens,
  value,
  type Run,
  type Token,
} from './rewrite';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, v: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
};

export const PALETTES = ['night', 'chalkboard', 'violet', 'ember'];

/** Knob 1: how many rewrites the growth makes. */
export const rewritesFor = (k: number): number => Math.round(range(clamp(k), 3, 60));
export const knobForRewrites = (n: number): number => (n - 3) / 57;
/** Knob 5: how many of the growth rules are switched on. */
export const wildnessFor = (k: number): number => Math.round(range(clamp(k), 2, GROW_RULES.length));
/** Knob 3: which of 64 runs. */
export const seedFor = (k: number): number => Math.round(clamp(k) * 63);

/* ------------------------------------------------------------- palettes */

interface Palette {
  bg: [string, string];
  text: string;
  dim: string;
  grow: (a: number) => string;
  shrink: (a: number) => string;
  op: string;
  paren: string;
}

const INKS: Palette[] = [
  {
    bg: [hsl(226, 30, 10), '#04050a'],
    text: hsl(218, 30, 88),
    dim: hsl(218, 14, 52),
    grow: (a) => hsl(28, 96, 64, a),
    shrink: (a) => hsl(168, 74, 60, a),
    op: hsl(218, 26, 66),
    paren: hsl(218, 14, 46),
  },
  {
    bg: [hsl(152, 26, 15), hsl(160, 30, 9)],
    text: hsl(60, 20, 93),
    dim: hsl(140, 12, 58),
    grow: (a) => hsl(350, 85, 78, a),
    shrink: (a) => hsl(48, 100, 70, a),
    op: hsl(60, 12, 76),
    paren: hsl(140, 10, 56),
  },
  {
    bg: [hsl(262, 34, 14), hsl(250, 40, 6)],
    text: hsl(270, 40, 92),
    dim: hsl(262, 16, 58),
    grow: (a) => hsl(316, 86, 72, a),
    shrink: (a) => hsl(52, 96, 66, a),
    op: hsl(262, 26, 72),
    paren: hsl(262, 16, 50),
  },
  {
    bg: [hsl(18, 34, 11), hsl(8, 30, 5)],
    text: hsl(32, 50, 88),
    dim: hsl(24, 20, 52),
    grow: (a) => hsl(4, 88, 66, a),
    shrink: (a) => hsl(190, 64, 64, a),
    op: hsl(30, 26, 68),
    paren: hsl(24, 16, 46),
  },
];

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
 * Break the expression into lines no wider than `maxW`. A line may only break
 * in front of an operator, so a continuation always starts with + or −, the
 * way it would be written by hand.
 */
const wrap = (
  ctx: CanvasRenderingContext2D,
  toks: Token[],
  px: number,
  maxW: number,
): { laid: Laid[]; lines: number[] } => {
  ctx.font = `400 ${px}px ${MONO}`;
  const gap = px * OP_GAP;
  const widths = toks.map((t) => ctx.measureText(t.text).width + (t.kind === 'op' ? gap * 2 : 0));
  const laid: Laid[] = [];
  const lines: number[] = [];
  let x = 0;
  let line = 0;
  let i = 0;
  while (i < toks.length) {
    // The chunk is an operator plus whatever follows it up to the next one.
    let j = i + 1;
    while (j < toks.length && toks[j].kind !== 'op') j++;
    let w = 0;
    for (let k = i; k < j; k++) w += widths[k];
    if (x > 0 && x + w > maxW && toks[i].kind === 'op') {
      lines.push(x);
      x = 0;
      line++;
    }
    for (let k = i; k < j; k++) {
      laid.push({ tok: toks[k], x, line, w: widths[k] });
      x += widths[k];
    }
    i = j;
  }
  lines.push(x);
  return { laid, lines };
};

/* --------------------------------------------------------------- sketch */

/**
 * A single bit, grown into a long expression by rewrites that never change
 * its value, and then cut back down to the same bit one rewrite at a time.
 * Every frame shows one expression and, lit up, the subterm the next rule is
 * about to replace, or the one it has just put in.
 */
export const createBitRewriting: SketchFactory = (): Sketch => {
  let bit: 0 | 1 = 1;
  let runs = 0;
  let strategy = 0;
  let names = true;
  let palette = 0;
  let manual = false;
  let target = 0;

  /** Steps through the run so far; frame k sits at progress k. */
  let progress = 0;
  /** Time spent at the end of a run, before the next one starts. */
  let rest = 0;
  /** Time spent at the longest expression, before simplifying starts. */
  let peak = 0;

  let run: Run | null = null;
  let key = '';
  let fontPx = 0;

  let padFlash = 0;
  let toast = '';
  let toastAge = 99;

  const say = (text: string): void => {
    toast = text;
    toastAge = 0;
  };

  return {
    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kRewrites, kPace, kSeed, kType, kWild, kGlow, kHold, kGraph] = midi.knobs;

      /* ------------------------------------------------------ controls */

      for (const hit of midi.hits) {
        switch (hit.pad) {
          case 0:
          case 1:
            bit = hit.pad as 0 | 1;
            progress = 0;
            rest = 0;
            peak = 0;
            manual = false;
            say(`start from ${bit}`);
            break;
          case 2:
            if (!manual) {
              manual = true;
              target = Math.floor(progress) + 1;
            } else target += 1;
            say('one step at a time');
            break;
          case 3:
            manual = false;
            say('play');
            break;
          case 4:
            if (run && progress < run.grown) {
              progress = run.grown;
              target = run.grown;
              peak = 99;
              say('simplify now');
            }
            break;
          case 5:
            strategy = (strategy + 1) % STRATEGIES.length;
            say(`strategy · ${STRATEGIES[strategy]}`);
            break;
          case 6:
            names = !names;
            say(`rule list · ${names ? 'on' : 'off'}`);
            break;
          default:
            palette = (palette + 1) % PALETTES.length;
            say(`palette · ${PALETTES[palette]}`);
            break;
        }
        padFlash = 0.5 + hit.velocity * 0.5;
      }
      padFlash = approach(padFlash, 0, 0.16, dt);
      toastAge += dt;

      const spec = {
        bit,
        seed: (seedFor(kSeed) + runs * 17) % 997,
        rewrites: rewritesFor(kRewrites),
        wildness: wildnessFor(kWild),
        strategy,
      };
      const nextKey = JSON.stringify(spec);
      if (nextKey !== key) {
        // The growth is shared between runs that differ only in length or
        // strategy, so changing those mid-run keeps the place.
        const prev = key ? (JSON.parse(key) as typeof spec) : null;
        const onlyStrategy =
          prev !== null &&
          run !== null &&
          JSON.stringify({ ...prev, strategy }) === nextKey &&
          progress > run.grown;
        run = onlyStrategy ? resimplify(run!, Math.floor(progress), strategy) : makeRun(spec);
        key = nextKey;
        progress = Math.min(progress, run.frames.length - 1);
        target = Math.min(target, run.frames.length - 1);
      }
      const r = run!;
      const last = r.frames.length - 1;

      const secondsPerStep = range(kPace, 2.6, 0.18);
      const hold = range(kHold, 0.4, 6);

      if (manual) {
        if (target > last) {
          // Stepping past the end starts the next run.
          runs++;
          bit = bit === 1 ? 0 : 1;
          progress = 0;
          target = 0;
        } else progress = Math.min(target, progress + dt / secondsPerStep);
      } else if (progress >= last) {
        rest += dt;
        if (rest > hold) {
          rest = 0;
          peak = 0;
          runs++;
          bit = bit === 1 ? 0 : 1;
          progress = 0;
        }
      } else if (progress >= r.grown && peak < hold * 0.6) {
        peak += dt;
      } else {
        // Stop on the longest expression for a moment before cutting it down.
        const cap = progress < r.grown ? r.grown : last;
        progress = Math.min(cap, progress + dt / secondsPerStep);
      }

      /* --------------------------------------------------------- state */

      // Each step spends its first part pointing at the subterm that is about
      // to go, and its second part on the subterm that replaced it.
      const k = Math.min(Math.floor(progress), last);
      const f = progress - k;
      const stepping = k < last && f > 0;
      const step = stepping ? r.steps[k] : k > 0 ? r.steps[k - 1] : null;
      const before = f < 0.5 || !stepping;
      const shown = stepping && !before ? r.frames[k + 1] : r.frames[k];
      let hotPath = null as number[] | null;
      let heat = 0;
      if (stepping) {
        hotPath = r.steps[k].path;
        heat = before ? clamp(f / 0.3) : clamp(1 - (f - 0.5) / 0.5);
      }
      const phase: 'grow' | 'shrink' | 'start' | 'end' =
        k === last && !stepping ? 'end' : k === 0 && !stepping ? 'start' : step!.phase;
      const hotColor = (stepping ? r.steps[k].phase : 'grow') === 'grow' ? 'grow' : 'shrink';

      /* --------------------------------------------------------- frame */

      const pal = INKS[palette];
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

      const panelW = names ? Math.min(type * 22, plotW * 0.34) : 0;
      const wide = names && plotW - panelW > plotH * 1.1;
      const exprX = plotX;
      const exprW = wide ? plotW - panelW - type * 1.8 : plotW;

      const graphH = kGraph < 0.03 ? 0 : range(kGraph, type * 2.2, plotH * 0.3);
      const headH = type * 3.4;
      const exprY = plotY + headH;
      const exprH = Math.max(40, plotH - headH - graphH - type * 1.6);

      /* -------------------------------------------------------- header */

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      setTracking(ctx, '0.2em');
      const growN = r.grown;
      const shrinkN = last - r.grown;
      const head =
        phase === 'start'
          ? `a single bit · ${bit}`
          : phase === 'end'
            ? `back to the bit · ${growN} rewrites out, ${shrinkN} back`
            : phase === 'grow'
              ? `growing · rewrite ${Math.min(k + 1, growN)} of ${growN}`
              : `simplifying · step ${Math.min(k + 1 - growN, shrinkN)} of ${shrinkN} · ${STRATEGIES[strategy]}`;
      ctx.fillStyle =
        phase === 'grow' ? pal.grow(0.95) : phase === 'shrink' ? pal.shrink(0.95) : pal.dim;
      ctx.fillText(head.toUpperCase(), exprX, plotY);
      const headW = ctx.measureText(head.toUpperCase()).width;
      setTracking(ctx, '0em');

      const ruleNow = stepping ? r.steps[k].rule : phase === 'end' ? `value ${bit}` : '';
      if (ruleNow) {
        ctx.font = `500 ${type * 1.15}px ${MONO}`;
        ctx.fillStyle = stepping ? pal[hotColor](0.4 + 0.6 * clamp(heat * 1.5)) : pal.text;
        ctx.fillText(ruleNow, exprX, plotY + type * 1.35);
      }

      // The invariant, top right: every expression on screen is worth this.
      ctx.textAlign = 'right';
      ctx.font = `500 ${type * 0.72}px ${MONO}`;
      setTracking(ctx, '0.2em');
      ctx.fillStyle = pal.dim;
      const tally = `VALUE ${value(shown)} · ${size(shown)} NODES`;
      if (headW + ctx.measureText(tally).width + type * 2 < exprW) {
        ctx.fillText(tally, exprX + exprW, plotY);
      }
      setTracking(ctx, '0em');

      /* ---------------------------------------------------- expression */

      const toks = tokens(shown, hotPath);
      // The largest type that fits, but never so large the lone bit looks silly.
      const fit = (px: number): boolean => {
        const { lines } = wrap(ctx, toks, px, exprW);
        return lines.length * px * 1.5 <= exprH && Math.max(...lines) <= exprW;
      };
      let want = Math.min(type * 6, exprH / 1.5);
      while (want > 7 && !fit(want)) want *= 0.93;
      fontPx = fontPx === 0 ? want : approach(fontPx, want, 0.12, dt);
      // Easing can briefly overshoot a shrinking fit; take the smaller.
      const px = Math.min(fontPx, fit(fontPx) ? fontPx : want);

      const { laid, lines } = wrap(ctx, toks, px, exprW);
      const lh = px * 1.5;
      const blockH = lines.length * lh;
      const y0 = exprY + Math.max(0, (exprH - blockH) / 2);
      const lineX = (line: number): number =>
        lines.length === 1 ? exprX + (exprW - lines[line]) / 2 : exprX;

      // Glow behind the subterm in play, one box per line it spans.
      if (heat > 0) {
        const glow = range(kGlow, 0, 26);
        const spans = new Map<number, [number, number]>();
        for (const l of laid) {
          if (!l.tok.hot) continue;
          const s = spans.get(l.line);
          spans.set(l.line, s ? [Math.min(s[0], l.x), Math.max(s[1], l.x + l.w)] : [l.x, l.x + l.w]);
        }
        ctx.save();
        ctx.shadowColor = pal[hotColor](0.7 * heat);
        ctx.shadowBlur = glow;
        ctx.fillStyle = pal[hotColor](0.16 * heat);
        for (const [line, [a, b]] of spans) {
          const x = lineX(line) + a - px * 0.12;
          const y = y0 + line * lh + (lh - px * 1.25) / 2;
          const w = b - a + px * 0.24;
          const h = px * 1.25;
          const rad = Math.min(px * 0.25, h / 2);
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, rad);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `400 ${px}px ${MONO}`;
      for (const l of laid) {
        const x = lineX(l.line) + l.x + (l.tok.kind === 'op' ? px * OP_GAP : 0);
        const y = y0 + l.line * lh + lh / 2;
        let ink = l.tok.kind === 'num' ? pal.text : l.tok.kind === 'op' ? pal.op : pal.paren;
        if (l.tok.hot && heat > 0) ink = pal[hotColor](0.55 + 0.45 * heat);
        ctx.fillStyle = ink;
        ctx.fillText(l.tok.text, x, y);
      }

      /* ---------------------------------------------------- size graph */

      if (graphH > 0) {
        const gx = exprX;
        const gw = exprW;
        const gy = plotY + plotH - graphH;
        const sizes = r.frames.map(size);
        const maxS = Math.max(...sizes);
        const X = (i: number): number => gx + (i / Math.max(1, last)) * gw;
        const Y = (s: number): number => gy + graphH - (s / maxS) * graphH;

        const area = (from: number, to: number, color: (a: number) => string): void => {
          ctx.beginPath();
          ctx.moveTo(X(from), gy + graphH);
          for (let i = from; i <= to; i++) ctx.lineTo(X(i), Y(sizes[i]));
          ctx.lineTo(X(to), gy + graphH);
          ctx.closePath();
          ctx.fillStyle = color(0.14);
          ctx.fill();
          ctx.beginPath();
          for (let i = from; i <= to; i++) {
            if (i === from) ctx.moveTo(X(i), Y(sizes[i]));
            else ctx.lineTo(X(i), Y(sizes[i]));
          }
          ctx.strokeStyle = color(0.75);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        };
        area(0, r.grown, pal.grow);
        area(r.grown, last, pal.shrink);

        const s0 = sizes[k];
        const s1 = sizes[Math.min(last, k + 1)];
        const mx = X(progress);
        const my = Y(s0 + (s1 - s0) * f);
        ctx.strokeStyle = pal.dim;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, gy);
        ctx.lineTo(mx, gy + graphH);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = progress <= r.grown ? pal.grow(1) : pal.shrink(1);
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        setTracking(ctx, '0.18em');
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.dim;
        ctx.fillText(`SIZE · LONGEST ${maxS} NODES`, gx, gy - 4);
        setTracking(ctx, '0em');
      }

      /* ------------------------------------------------------ rule list */

      if (wide) {
        const px0 = plotX + plotW - panelW;
        const t = type * 0.78;
        const rowH = t * 1.45;
        const rows = Math.max(3, Math.floor(plotH / rowH));
        // Keep the current step about two thirds of the way down the list.
        const cur = stepping ? k : Math.max(0, k - 1);
        const first = clamp(cur - Math.floor(rows * 0.66), 0, Math.max(0, r.steps.length - rows));
        ctx.font = `400 ${t}px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let i = 0; i < rows && first + i < r.steps.length; i++) {
          const n = first + i;
          const s = r.steps[n];
          const done = n < k || (n === k && !before);
          const now = n === cur && (stepping || phase !== 'start');
          const color = s.phase === 'grow' ? pal.grow : pal.shrink;
          ctx.globalAlpha = now ? 1 : done ? 0.8 : 0.38;
          ctx.fillStyle = now ? color(1) : done ? pal.text : pal.dim;
          const label = s.phase === 'grow' ? `${n + 1}`.padStart(3) : `${n + 1 - r.grown}`.padStart(3);
          let text = `${label}  ${s.rule}`;
          while (text.length > 4 && ctx.measureText(text).width > panelW) text = text.slice(0, -2) + '…';
          ctx.fillText(text, px0, plotY + i * rowH);
          if (n === r.grown - 1 && n + 1 < r.steps.length) {
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = pal.dim;
            ctx.fillRect(px0, plotY + (i + 1) * rowH - t * 0.25, panelW * 0.9, 1);
          }
        }
        ctx.globalAlpha = 1;
      }

      /* ---------------------------------------------------------- toast */

      if (toastAge < 2.2) {
        const a = clamp(1 - (toastAge - 1.4) / 0.8) * 0.9;
        ctx.textAlign = 'right';
        ctx.font = `500 ${type * 0.72}px ${MONO}`;
        setTracking(ctx, '0.22em');
        ctx.fillStyle = pal.shrink(a);
        ctx.textBaseline = 'top';
        ctx.fillText(toast.toUpperCase(), exprX + exprW, plotY + type * 1.6);
        setTracking(ctx, '0em');
      }

      if (padFlash > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = pal.grow(padFlash * 0.05);
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };
};

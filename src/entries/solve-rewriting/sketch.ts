import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { approach, clamp, hsl, range } from '../../screensaver/util';
import {
  GIVEN_COUNT,
  LEVELS,
  UNKNOWNS,
  edgeCounts,
  makeInstance,
  ruleText,
  sideOf,
  stray,
  tokens,
  type Attack,
  type Instance,
  type Path,
  type System,
  type Token,
  type Walk,
} from './solve';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const setTracking = (ctx: CanvasRenderingContext2D, v: string): void => {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
};

export const PALETTES = ['night', 'chalkboard', 'violet', 'ember'];

/** Knob 1: how many times the generator does something to the system. */
export const lambdaFor = (k: number): number => Math.round(range(clamp(k), 2, 16));
export const knobForLambda = (n: number): number => (n - 2) / 14;
/** Knob 5: which generator. */
export const levelFor = (k: number): number => Math.min(LEVELS.length - 1, Math.floor(clamp(k) * LEVELS.length));
export const knobForLevel = (level: number): number => (level + 0.5) / LEVELS.length;
/** Knob 3: which of 64 instances. */
export const seedFor = (k: number): number => Math.round(clamp(k) * 63);

/* ----------------------------------------------------------------- acts */

const ACTS = ['grow', 'greedy', 'school', 'expanded', 'planted'] as const;
type Act = (typeof ACTS)[number];

const ACT_LABEL: Record<Act, string> = {
  grow: 'generator · scrambling a solved system',
  greedy: 'attacker 1 · downhill only',
  school: 'attacker 2 · isolate and substitute',
  expanded: 'attacker 3 · the same, multiplying out',
  planted: "with the key · the generator's way back",
};

const ACT_SHORT: Record<Act, string> = {
  grow: 'generator',
  greedy: 'downhill only',
  school: 'isolate and substitute',
  expanded: 'the same, multiplying out',
  planted: "the generator's way back",
};

const walkOf = (inst: Instance, act: Act): Walk => (act === 'grow' ? inst.grown : inst[act]);
const commas = (n: number): string => n.toLocaleString('en-US');

const verdict = (inst: Instance, act: Act): string => {
  if (act === 'grow') return `this is all an attacker gets: ${stray(inst.E)} unknowns out of place`;
  const a = inst[act] as Attack;
  const steps = commas(a.steps.length);
  const left = stray(a.frames[a.frames.length - 1]);
  if (a.outcome === 'solved') return `solved in ${steps} steps`;
  if (a.outcome === 'stuck') {
    return a.steps.length === 0
      ? 'stuck at once: no single step helps'
      : `stuck after ${steps} steps, ${left} unknowns still out of place`;
  }
  return `gave up at ${steps} steps, ${left} unknowns still out of place`;
};

/* ------------------------------------------------------------- palettes */

interface Palette {
  bg: [string, string];
  text: string;
  dim: string;
  op: string;
  paren: string;
  sat: number;
  light: number;
}

const INKS: Palette[] = [
  { bg: [hsl(226, 30, 10), '#04050a'], text: hsl(218, 30, 88), dim: hsl(218, 14, 54), op: hsl(218, 26, 66), paren: hsl(218, 14, 46), sat: 86, light: 66 },
  { bg: [hsl(152, 26, 15), hsl(160, 30, 9)], text: hsl(60, 20, 93), dim: hsl(140, 12, 60), op: hsl(60, 12, 76), paren: hsl(140, 10, 56), sat: 80, light: 76 },
  { bg: [hsl(262, 34, 14), hsl(250, 40, 6)], text: hsl(270, 40, 92), dim: hsl(262, 16, 60), op: hsl(262, 26, 72), paren: hsl(262, 16, 50), sat: 90, light: 72 },
  { bg: [hsl(18, 34, 11), hsl(8, 30, 5)], text: hsl(32, 50, 88), dim: hsl(24, 20, 54), op: hsl(30, 26, 68), paren: hsl(24, 16, 46), sat: 84, light: 64 },
];

const ACT_HUE: Record<Act, number> = { grow: 28, greedy: 350, school: 52, expanded: 268, planted: 158 };
/** One colour per unknown, the same everywhere it appears. */
const UNKNOWN_HUE = [44, 190, 320];

/* --------------------------------------------------------------- layout */

interface Laid {
  tok: Token;
  x: number;
  line: number;
  w: number;
}

const OP_GAP = 0.42;
const spaced = (t: Token): boolean => t.kind === 'op' || t.kind === 'eq';

/** Break one equation into lines no wider than `maxW`, only ever in front of an operator or the equals sign. */
const wrap = (toks: Token[], px: number, charW: number, maxW: number): { laid: Laid[]; lines: number[] } => {
  const gap = px * OP_GAP * 2;
  const cw = px * charW;
  const width = (t: Token): number => t.text.length * cw + (spaced(t) ? gap : 0);
  const laid: Laid[] = [];
  const lines: number[] = [];
  let x = 0;
  let line = 0;
  let i = 0;
  while (i < toks.length) {
    let j = i + 1;
    while (j < toks.length && !spaced(toks[j])) j++;
    let w = 0;
    for (let k = i; k < j; k++) w += width(toks[k]);
    if (x > 0 && x + w > maxW && spaced(toks[i])) {
      lines.push(x);
      x = 0;
      line++;
    }
    for (let k = i; k < j; k++) {
      laid.push({ tok: toks[k], x, line, w: width(toks[k]) });
      x += width(toks[k]);
    }
    i = j;
  }
  lines.push(x);
  return { laid, lines };
};

/** What a step lights up: some subterms, and perhaps the equation it borrowed from. */
interface Hot {
  spots: { eq: number; side: 0 | 1; path: Path }[];
  from: number | null;
}

const rowsOf = (s: System, hot: Hot | null): Token[][] =>
  s.eqs.map((q, eq) => {
    const spot = (side: 0 | 1): Path | null => hot?.spots.find((h) => h.eq === eq && h.side === side)?.path ?? null;
    return [...tokens(sideOf(q, 0), spot(0)), { text: '=', kind: 'eq', hot: false } as Token, ...tokens(sideOf(q, 1), spot(1))];
  });

/** One walk as a polyline of (step, unknowns out of place), thinned to what a log-scaled axis can show. */
const thin = (walk: Walk, maxSteps: number): { i: number; n: number }[] => {
  const out: { i: number; n: number }[] = [];
  let bucket = -1;
  walk.frames.forEach((f, i) => {
    const b = Math.floor((Math.log1p(i) / Math.log1p(maxSteps)) * 600);
    const n = stray(f);
    if (b !== bucket || i === walk.frames.length - 1) {
      out.push({ i, n });
      bucket = b;
    } else if (n > out[out.length - 1].n) out[out.length - 1] = { i, n };
  });
  return out;
};

/* --------------------------------------------------------------- sketch */

/**
 * One system of equations at a time. The generator scrambles a solved system
 * and keeps how; three attackers who see only the scrambled system try to
 * solve it by rewriting; then the generator's own walk is played backwards.
 * The graph underneath counts the unknowns still out of place along each walk.
 */
export const createSolveRewriting: SketchFactory = (): Sketch => {
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
  let maxStray = 1;

  let fontPx = 0;
  let charW = 0;
  let lastLevel = -1;
  let lastPalette = -1;

  let rowsFor: System | null = null;
  let rowsHot = '';
  let rows: Token[][] = [];
  const strayOf = new WeakMap<System, number>();
  const edgesOf = new WeakMap<System, { down: number; level: number; up: number }>();

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
          say('new system');
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
        maxStray = 1;
        curves = {};
        for (const a of ACTS) {
          if (a === 'grow') continue;
          maxSteps = Math.max(maxSteps, fresh[a].steps.length);
        }
        for (const a of ACTS) {
          if (a === 'grow') continue;
          curves[a] = thin(fresh[a], maxSteps);
          for (const p of curves[a]!) maxStray = Math.max(maxStray, p.n);
        }
      }
      const I = inst!;
      const last = walkOf(I, act).frames.length - 1;

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

      const walk = walkOf(I, act);
      const end = walk.frames.length - 1;
      const k = Math.min(Math.floor(progress), end);
      const f = progress - k;
      const stepping = k < end && (f > 0 || fast);
      // A slow step points at what is about to change, then at what it became.
      const before = fast || f < 0.5 || !stepping;
      const shown = stepping && !before ? walk.frames[k + 1] : walk.frames[k];
      const heat = !stepping ? 0 : fast ? 0.75 : before ? clamp(f / 0.3) : clamp(1 - (f - 0.5) / 0.5);
      const atEnd = k === end && !stepping;

      const st = stepping ? walk.steps[k] : null;
      let hot: Hot | null = null;
      if (st) {
        const both = [
          { eq: st.eq, side: 0 as const, path: [1] },
          { eq: st.eq, side: 1 as const, path: [1] },
        ];
        if (st.kind === 'id') hot = { spots: [{ eq: st.eq, side: st.side, path: st.path }], from: null };
        else if (st.kind === 'subst') hot = { spots: [{ eq: st.eq, side: st.side, path: st.path }], from: st.from };
        else if (st.kind === 'swap') hot = { spots: [{ eq: st.eq, side: 0, path: [] }, { eq: st.eq, side: 1, path: [] }], from: null };
        // The added term exists only after "both" and only before "cancel".
        else if ((st.kind === 'both') !== before) hot = { spots: both, from: null };
      }

      /* --------------------------------------------------------- frame */

      const pal = INKS[palette];
      const ink = (a: Act, alpha = 1): string => hsl(ACT_HUE[a], pal.sat, pal.light, alpha);
      const unknownInk = (name: string, alpha = 1): string =>
        hsl(UNKNOWN_HUE[UNKNOWNS.indexOf(name) % UNKNOWN_HUE.length], pal.sat, pal.light, alpha);
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

      const graphH = kGraph < 0.03 ? 0 : range(kGraph, type * 2.4, plotH * 0.36);
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

      let out = strayOf.get(shown);
      if (out === undefined) {
        out = stray(shown);
        strayOf.set(shown, out);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.dim;
      const tally = `${out} OUT OF PLACE · ${commas(shown.n)} NODES`;
      if (headW + ctx.measureText(tally).width + type * 2 < exprW) ctx.fillText(tally, exprX + exprW, plotY);
      setTracking(ctx, '0em');

      ctx.textAlign = 'left';
      ctx.font = `500 ${type * 1.1}px ${MONO}`;
      if (atEnd) {
        ctx.fillStyle = pal.text;
        ctx.fillText(verdict(I, act), exprX, plotY + type * 1.35);
      } else if (st) {
        ctx.fillStyle = ink(act, fast ? 0.9 : 0.4 + 0.6 * clamp(heat * 1.5));
        let rule = ruleText(st, walk.frames[k]);
        while (rule.length > 8 && ctx.measureText(rule).width > exprW) rule = rule.slice(0, -2) + '…';
        ctx.fillText(rule, exprX, plotY + type * 1.35);
      }

      /* ------------------------------------------------------ equations */

      const hotKey = hot ? `${JSON.stringify(hot.spots)}:${before ? 'b' : 'a'}` : '';
      if (rowsFor !== shown || rowsHot !== hotKey) {
        rows = rowsOf(shown, hot);
        rowsFor = shown;
        rowsHot = hotKey;
      }
      if (charW === 0) {
        ctx.font = `400 100px ${MONO}`;
        charW = ctx.measureText('0').width / 100;
      }
      const place = (px: number) => {
        const labelW = 4 * charW * px;
        const avail = exprW - labelW;
        let y = 0;
        let widest = 0;
        const parts = rows.map((toks) => {
          const w = wrap(toks, px, charW, avail);
          const at = y;
          y += w.lines.length * px * 1.5 + px * 0.7;
          widest = Math.max(widest, ...w.lines);
          return { ...w, top: at };
        });
        return { parts, height: y, ok: y <= exprH && widest <= avail, labelW };
      };
      const MIN_PX = 5.5;
      let want = Math.min(type * 2.6, exprH / 6);
      while (want > MIN_PX && !place(want).ok) want *= 0.93;
      want = Math.max(want, MIN_PX);
      fontPx = fontPx === 0 || fast ? want : approach(fontPx, want, 0.12, dt);
      const px = fontPx > want && !place(fontPx).ok ? want : fontPx;

      const L = place(px);
      const lh = px * 1.5;
      const y0 = exprY + Math.max(0, (exprH - L.height) / 2);
      const bodyX = exprX + L.labelW;
      const visible = (at: number, line: number): boolean => at + (line + 1) * lh <= exprH + 1;

      // Equation numbers. One lights up when a step borrows from that equation.
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `500 ${px * 0.8}px ${MONO}`;
      L.parts.forEach((part, eq) => {
        if (!visible(part.top, 0)) return;
        const lit = heat > 0 && hot !== null && hot.from === eq;
        ctx.fillStyle = lit ? ink(act, 1) : pal.dim;
        ctx.fillText(`${eq + 1}`, exprX, y0 + part.top + lh / 2);
        if (lit) {
          ctx.fillRect(exprX, y0 + part.top + lh * 0.92, px * 0.8 * charW, 1.5);
        }
      });

      if (heat > 0) {
        ctx.save();
        ctx.shadowColor = ink(act, 0.7 * heat);
        ctx.shadowBlur = px > 9 ? 14 : 0;
        ctx.fillStyle = ink(act, 0.2 * heat);
        for (const part of L.parts) {
          const spans = new Map<number, [number, number][]>();
          let open: [number, number] | null = null;
          let openLine = -1;
          for (const l of part.laid) {
            if (l.tok.hot && visible(part.top, l.line)) {
              if (open && openLine === l.line) open[1] = l.x + l.w;
              else {
                open = [l.x, l.x + l.w];
                openLine = l.line;
                spans.set(l.line, [...(spans.get(l.line) ?? []), open]);
              }
            } else open = null;
          }
          for (const [line, list] of spans) {
            for (const [a, b] of list) {
              const h = px * 1.25;
              ctx.beginPath();
              ctx.roundRect(bodyX + a - px * 0.12, y0 + part.top + line * lh + (lh - h) / 2, b - a + px * 0.24, h, Math.min(px * 0.25, h / 2));
              ctx.fill();
            }
          }
        }
        ctx.restore();
      }

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const part of L.parts) {
        for (const l of part.laid) {
          if (!visible(part.top, l.line)) break;
          const kind = l.tok.kind;
          // Unknowns keep their own colour even inside a lit subterm: they are what to watch.
          ctx.font = `${kind === 'unknown' ? 700 : 400} ${px}px ${MONO}`;
          ctx.fillStyle =
            kind === 'unknown'
              ? unknownInk(l.tok.text)
              : l.tok.hot && heat > 0
                ? ink(act, 0.55 + 0.45 * heat)
                : kind === 'num' || kind === 'var'
                  ? pal.text
                  : kind === 'paren'
                    ? pal.paren
                    : kind === 'eq'
                      ? pal.text
                      : pal.op;
          ctx.fillText(l.tok.text, bodyX + l.x + (spaced(l.tok) ? px * OP_GAP : 0), y0 + part.top + l.line * lh + lh / 2);
        }
      }
      if (L.height > exprH + 1) {
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
        const Y = (n: number): number => gy + graphH - (n / maxStray) * graphH;

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
          // Steps, not slopes: the count only ever changes by whole unknowns.
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
          const how = I[a as Exclude<Act, 'grow'>].outcome;
          ctx.strokeStyle = ink(a, on ? 1 : 0.6);
          ctx.fillStyle = ink(a, on ? 1 : 0.6);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          if (how === 'solved') {
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

        // Where the system on screen sits. The generator runs its way back right to left.
        const total = I[live].frames.length - 1;
        const pos = act === 'grow' ? total - progress : progress;
        ctx.fillStyle = ink(act, 1);
        ctx.beginPath();
        ctx.arc(X(pos), Y(out), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = pal.bg[1];
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = `500 ${type * 0.62}px ${MONO}`;
        setTracking(ctx, '0.18em');
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.dim;
        ctx.fillText('UNKNOWNS OUT OF PLACE ALONG EACH WAY OF SOLVING · STEPS →', gx, gy - 5);
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
        para(`λ = ${I.spec.lambda}. Solve for ${UNKNOWNS.join(', ')}: ${stray(I.E)} out of place, ${I.E.n} nodes.`, pal.text);
        y += lineH * 0.45;

        caps('try every case', pal.dim);
        para(`${GIVEN_COUNT} givens and ${UNKNOWNS.length} unknowns: ${1 << (GIVEN_COUNT + UNKNOWNS.length)} cases give the answer as a table. A table is not a derivation.`, pal.text, t);
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

        if (shown.n <= 220 && y + lineH * 3 < plotY + plotH) {
          let c = edgesOf.get(shown);
          if (!c) {
            c = edgeCounts(shown);
            edgesOf.set(shown, c);
          }
          y += lineH * 0.3;
          caps('single steps from here', pal.dim);
          para(`${c.down} help · ${c.level} change nothing that counts · ${c.up} make it worse`, pal.text, t);
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

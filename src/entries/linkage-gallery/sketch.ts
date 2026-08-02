import type { DrawContext, Sketch, SketchFactory } from '../../screensaver/types';
import { TAU, approach, clamp, hsl, range } from '../../screensaver/util';
import type { CoordSpec, Frame, Mechanism, Vec } from './linkages';
import { MECHANISMS, coordFraction, coordValue } from './linkages';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif';

/** How many trail points the longest setting of knob 6 keeps. */
const MAX_TRAIL = 1400;

/**
 * The stage bar floats over the top of the canvas at every size. The knobs and
 * pads float over the bottom too, until the page gets narrow enough to stack
 * them underneath instead — below that width there is nothing to dodge.
 */
const SAFE_TOP = 54;
const safeBottom = (width: number): number => (width <= 660 ? 16 : 126);

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** A coordinate at a given fraction of its own range — used for view fitting. */
const valueAtFraction = (spec: CoordSpec, f: number): number =>
  spec.kind === 'angle' ? TAU * f : spec.lo + (spec.hi - spec.lo) * f;

/**
 * The bounding box of everything the mechanism can reach, so the view is set
 * by the whole motion rather than by the current pose. Without this the
 * picture would breathe in and out as the linkage folds.
 */
const fitBox = (mech: Mechanism, m: number, branch: number): Box => {
  const specs = mech.coords(m);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, pad = 0) => {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  };
  const take = (frame: Frame) => {
    for (const p of frame.pins) grow(p.at.x, p.at.y);
    for (const d of frame.domains) {
      if (d.kind === 'annulus') grow(d.center.x, d.center.y, d.outer);
      else if (d.kind === 'arc') {
        for (let k = 0; k <= 12; k++) {
          const a = d.from + ((d.to - d.from) * k) / 12;
          grow(d.center.x + Math.cos(a) * d.radius, d.center.y + Math.sin(a) * d.radius);
        }
      } else {
        grow(d.a.x, d.a.y);
        grow(d.b.x, d.b.y);
      }
    }
  };

  if (mech.dof === 1) {
    let previous: Frame | null = null;
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const q = [valueAtFraction(specs[0], i / steps)];
      const frame = mech.solve({ q, m, branch, flip: false, previous });
      previous = frame;
      take(frame);
    }
  } else {
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const q = [valueAtFraction(specs[0], i / steps), valueAtFraction(specs[1], j / steps)];
        take(mech.solve({ q, m, branch, flip: false, previous: null }));
      }
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(x1 - x0, 0.3), h: Math.max(y1 - y0, 0.3) };
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
};

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

/** Radians, printed the way the readouts want them. */
const rad = (x: number): string => `${x >= 0 ? ' ' : '−'}${Math.abs(x).toFixed(3)}`;
const deg = (x: number): string => `${(((x / TAU) % 1) * 360).toFixed(0)}°`;
const sci = (x: number): string => (x === 0 ? '0' : x.toExponential(1));

/**
 * A gallery of eight planar linkages. One pad each; knobs 1 and 2 are the
 * generalized coordinates, and everything on screen is computed from them.
 */
export const createLinkageGallery: SketchFactory = (): Sketch => {
  let current = 0;
  const branches = new Array(MECHANISMS.length).fill(0);
  let flipPending = false;
  let phase = 0;
  let frame: Frame | null = null;
  let lastProportion = -1;

  const inputTrail: Vec[] = [];
  const outputTrail: Vec[] = [];

  /** The fitted view, and the smoothed version actually drawn. */
  let fitKey = '';
  let target: Box = { cx: 0, cy: 0, w: 2, h: 2 };
  let view = { cx: 0, cy: 0, scale: 100 };
  let viewReady = false;
  /** Rises to 1 after a pad hit, to flash the new mechanism's name. */
  let arrival = 0;

  const clearTrails = () => {
    inputTrail.length = 0;
    outputTrail.length = 0;
  };

  const pushTrail = (trail: Vec[], p: Vec, cap: number) => {
    const last = trail[trail.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.0025) return;
    trail.push({ x: p.x, y: p.y });
    while (trail.length > cap) trail.shift();
  };

  return {
    setup() {
      fitKey = '';
    },

    draw({ ctx, width, height, dt, midi }: DrawContext) {
      const [kA, kB, kSpeed, kShape, kZoom, kTrail, kLabels, kHue] = midi.knobs;

      for (const hit of midi.hits) {
        if (hit.pad === current) {
          const mech = MECHANISMS[current];
          if (mech.branches > 1) {
            flipPending = true;
            branches[current] = (branches[current] + 1) % mech.branches;
          }
        } else {
          current = hit.pad;
          // A different mechanism's pins mean nothing to this one's branch
          // tracking, so start it cold rather than from a stale frame.
          frame = null;
        }
        clearTrails();
        arrival = 1;
      }
      arrival = approach(arrival, 0, 0.35, dt);

      const mech = MECHANISMS[current];
      const branch = branches[current];
      const proportion = kShape;
      if (Math.abs(proportion - lastProportion) > 0.004) {
        clearTrails();
        lastProportion = proportion;
      }

      // Autoplay walks one path through the configuration space. Off, the
      // knobs hold the coordinates still wherever the reader left them.
      const speed = kSpeed < 0.03 ? 0 : range(kSpeed, 0.12, 1.9);
      phase += speed * dt;

      const specs = mech.coords(proportion);
      const q = specs.map((spec, i) => coordValue(spec, i === 0 ? kA : kB, phase));
      const solved = mech.solve({ q, m: proportion, branch, flip: flipPending, previous: frame });
      flipPending = false;
      if (solved.ok || !frame) frame = solved;
      const f = frame;

      // View fitting, quantised so a knob sweep does not refit every frame.
      const key = `${mech.key}|${branch}|${Math.round(proportion * 48)}`;
      if (key !== fitKey) {
        fitKey = key;
        target = fitBox(mech, proportion, branch);
      }
      const ui = clamp(Math.min(width / 960, height / 620), 0.58, 1.3);
      const zoom = range(kZoom, 0.62, 1.5);
      // The page's own chrome sits over the canvas: the stage bar along the
      // top, the knobs and pads along the bottom. Everything here stays inside
      // what is left.
      const top = SAFE_TOP;
      const floor = height - safeBottom(width);
      const availW = Math.max(width - 470 * ui, width * 0.42);
      const availH = Math.max((floor - top) * 0.94, height * 0.3);
      const wanted = Math.min(availW / target.w, availH / target.h) * zoom;
      if (!viewReady) {
        view = { cx: target.cx, cy: target.cy, scale: wanted };
        viewReady = true;
      } else {
        view.cx = approach(view.cx, target.cx, 0.09, dt);
        view.cy = approach(view.cy, target.cy, 0.09, dt);
        view.scale = approach(view.scale, wanted, 0.09, dt);
      }
      const originX = width * 0.5;
      const originY = (top + floor) * 0.5;
      const sx = (p: Vec): number => originX + (p.x - view.cx) * view.scale;
      const sy = (p: Vec): number => originY - (p.y - view.cy) * view.scale;

      const trailCap = Math.round(range(kTrail, 0, MAX_TRAIL));
      const separateInput = f.input !== f.output;
      if (trailCap > 0) {
        if (separateInput) pushTrail(inputTrail, f.pins[f.input].at, trailCap);
        pushTrail(outputTrail, f.pins[f.output].at, trailCap);
      } else clearTrails();

      const hue = kHue * 360;
      const outHue = hue + 28;
      const inHue = hue + 186;
      const labels = kLabels < 0.34 ? 0 : kLabels < 0.67 ? 1 : 2;

      // ---- background -------------------------------------------------
      ctx.globalCompositeOperation = 'source-over';
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, hsl(hue + 220, 26, 8));
      sky.addColorStop(1, '#04050a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Unit grid, so the reader can see the rods keep their lengths.
      if (view.scale > 22) {
        ctx.strokeStyle = hsl(hue + 210, 30, 60, 0.07);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gx0 = Math.floor(view.cx - width / 2 / view.scale);
        const gx1 = Math.ceil(view.cx + width / 2 / view.scale);
        const gy0 = Math.floor(view.cy - height / 2 / view.scale);
        const gy1 = Math.ceil(view.cy + height / 2 / view.scale);
        for (let i = gx0; i <= gx1; i++) {
          const x = sx({ x: i, y: 0 });
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let j = gy0; j <= gy1; j++) {
          const y = sy({ x: 0, y: j });
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();
      }

      // ---- domains: where the input pin is allowed to be ----------------
      for (const d of f.domains) {
        if (d.kind === 'annulus') {
          ctx.fillStyle = hsl(inHue, 60, 50, 0.07);
          ctx.beginPath();
          ctx.arc(sx(d.center), sy(d.center), d.outer * view.scale, 0, TAU);
          ctx.arc(sx(d.center), sy(d.center), d.inner * view.scale, 0, TAU, true);
          ctx.fill();
        } else if (d.kind === 'arc') {
          ctx.strokeStyle = hsl(inHue, 60, 60, 0.26);
          ctx.setLineDash([4 * ui, 5 * ui]);
          ctx.lineWidth = 1.2 * ui;
          ctx.beginPath();
          ctx.arc(sx(d.center), sy(d.center), d.radius * view.scale, -d.to, -d.from);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = hsl(outHue, 80, 66, 0.34);
          ctx.setLineDash([7 * ui, 6 * ui]);
          ctx.lineWidth = 1.4 * ui;
          ctx.beginPath();
          ctx.moveTo(sx(d.a), sy(d.a));
          ctx.lineTo(sx(d.b), sy(d.b));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // ---- trails -------------------------------------------------------
      const stroke = (trail: Vec[], h: number, wgt: number) => {
        if (trail.length < 2) return;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = hsl(h, 82, 62, 0.28);
        ctx.lineWidth = wgt * ui;
        ctx.beginPath();
        ctx.moveTo(sx(trail[0]), sy(trail[0]));
        for (let i = 1; i < trail.length; i++) ctx.lineTo(sx(trail[i]), sy(trail[i]));
        ctx.stroke();
        const recent = Math.max(0, trail.length - 90);
        ctx.strokeStyle = hsl(h, 90, 70, 0.75);
        ctx.lineWidth = (wgt + 0.4) * ui;
        ctx.beginPath();
        ctx.moveTo(sx(trail[recent]), sy(trail[recent]));
        for (let i = recent + 1; i < trail.length; i++) ctx.lineTo(sx(trail[i]), sy(trail[i]));
        ctx.stroke();
      };
      stroke(inputTrail, inHue, 1.3);
      stroke(outputTrail, outHue, 1.9);

      // ---- rods ---------------------------------------------------------
      ctx.lineCap = 'round';
      for (const rod of f.rods) {
        const a = f.pins[rod.a].at;
        const b = f.pins[rod.b].at;
        const ground = rod.style === 'ground';
        ctx.strokeStyle = ground
          ? hsl(hue + 210, 18, 62, 0.4)
          : rod.style === 'long'
            ? hsl(hue + 200, 22, 82, 0.78)
            : hsl(hue + 205, 20, 90, 0.92);
        ctx.lineWidth = (ground ? 3 : rod.style === 'long' ? 4.4 : 5.6) * ui;
        if (ground) ctx.setLineDash([6 * ui, 5 * ui]);
        ctx.beginPath();
        ctx.moveTo(sx(a), sy(a));
        ctx.lineTo(sx(b), sy(b));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (labels === 2) {
        ctx.font = `${10.5 * ui}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const rod of f.rods) {
          const a = f.pins[rod.a].at;
          const b = f.pins[rod.b].at;
          const mx = (sx(a) + sx(b)) / 2;
          const my = (sy(a) + sy(b)) / 2;
          ctx.fillStyle = hsl(hue + 205, 24, 74, 0.72);
          ctx.fillText(rod.nominal.toFixed(2), mx, my - 9 * ui);
        }
      }

      // ---- pins ---------------------------------------------------------
      for (let i = 0; i < f.pins.length; i++) {
        const pin = f.pins[i];
        const x = sx(pin.at);
        const y = sy(pin.at);
        const isIn = i === f.input && separateInput;
        const isOut = i === f.output;
        if (pin.role === 'fixed') {
          // Ground symbol: a bar with hatching under it.
          ctx.strokeStyle = hsl(hue + 210, 16, 70, 0.75);
          ctx.lineWidth = 1.6 * ui;
          ctx.beginPath();
          ctx.moveTo(x - 11 * ui, y + 9 * ui);
          ctx.lineTo(x + 11 * ui, y + 9 * ui);
          for (let k = -2; k <= 2; k++) {
            ctx.moveTo(x + k * 5 * ui, y + 9 * ui);
            ctx.lineTo(x + k * 5 * ui - 4 * ui, y + 15 * ui);
          }
          ctx.stroke();
        }
        const r = (isIn || isOut ? 6.2 : 4.6) * ui;
        const h = isOut ? outHue : isIn ? inHue : hue + 205;
        ctx.fillStyle = isOut || isIn ? hsl(h, 88, 62) : hsl(h, 18, 88);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(6, 8, 16, 0.92)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.42, 0, TAU);
        ctx.fill();

        if (labels >= 1) {
          ctx.font = `600 ${12.5 * ui}px ${MONO}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = isOut || isIn ? hsl(h, 80, 72) : hsl(hue + 205, 16, 78, 0.85);
          ctx.fillText(pin.name, x + 8 * ui, y - 6 * ui);
        }
      }

      // ---- readouts -----------------------------------------------------
      const pad = 18 * ui;
      ctx.textBaseline = 'alphabetic';

      // Title block.
      ctx.textAlign = 'left';
      ctx.font = `600 ${10.5 * ui}px ${MONO}`;
      ctx.fillStyle = hsl(outHue, 70, 66, 0.85);
      ctx.fillText(`PAD ${current + 1}  ·  ${current + 1} OF ${MECHANISMS.length}`, pad, top + 14 * ui);
      ctx.font = `600 ${Math.round(23 * ui)}px ${SANS}`;
      ctx.fillStyle = `rgba(238, 241, 252, ${0.9 + 0.1 * arrival})`;
      ctx.fillText(mech.title, pad, top + 42 * ui);

      ctx.font = `${12 * ui}px ${SANS}`;
      ctx.fillStyle = 'rgba(198, 205, 228, 0.72)';
      let ty = top + 61 * ui;
      for (const line of wrap(ctx, mech.role, 280 * ui)) {
        ctx.fillText(line, pad, ty);
        ty += 15 * ui;
      }

      // Facts.
      ty += 9 * ui;
      const fact = (label: string, value: string) => {
        ctx.font = `${10.5 * ui}px ${MONO}`;
        ctx.fillStyle = 'rgba(150, 160, 190, 0.7)';
        ctx.fillText(label, pad, ty);
        ctx.fillStyle = 'rgba(226, 232, 248, 0.92)';
        ctx.fillText(value, pad + 132 * ui, ty);
        ty += 15 * ui;
      };
      fact('degrees of freedom', `${mech.dof}`);
      fact('links', mech.links);
      fact('knob 4 stretches', mech.proportionLabel);
      fact('assembly mode', mech.branches > 1 ? `${branch + 1} of ${mech.branches}` : 'only one');

      // Coordinates: the numbers everything else is computed from.
      ty += 11 * ui;
      ctx.font = `600 ${10.5 * ui}px ${MONO}`;
      ctx.fillStyle = hsl(inHue, 60, 68, 0.9);
      ctx.fillText('GENERALIZED COORDINATES  q', pad, ty);
      ty += 9 * ui;
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const frac = clamp(coordFraction(spec, q[i]));
        const barY = ty + 5 * ui;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        roundRect(ctx, pad, barY, 200 * ui, 4 * ui, 2 * ui);
        ctx.fill();
        ctx.fillStyle = hsl(inHue, 80, 62, 0.95);
        roundRect(ctx, pad, barY, Math.max(3 * ui, 200 * ui * frac), 4 * ui, 2 * ui);
        ctx.fill();
        ty += 21 * ui;
        ctx.font = `${11.5 * ui}px ${MONO}`;
        ctx.fillStyle = 'rgba(226, 232, 248, 0.92)';
        const shown = spec.kind === 'angle' ? spec.lo + (spec.hi - spec.lo) * frac : q[i];
        ctx.fillText(
          spec.kind === 'angle'
            ? `${spec.label} = ${rad(shown)} rad   ${deg(shown)}`
            : `${spec.label} = ${rad(shown)}   in [${spec.lo.toFixed(2)}, ${spec.hi.toFixed(2)}]`,
          pad,
          ty,
        );
        ty += 13 * ui;
      }
      ctx.font = `${10.5 * ui}px ${MONO}`;
      ctx.fillStyle = 'rgba(150, 160, 190, 0.7)';
      if (specs.length === 1) {
        ctx.fillText('knob 2 idle — one coordinate is the whole state', pad, ty);
        ty += 14 * ui;
      }
      ctx.fillText(
        speed > 0
          ? `autoplay ×${speed.toFixed(2)} — knob 3 down for hands on`
          : `held — ${specs.length === 1 ? 'knob 1 is' : 'knobs 1 and 2 are'} yours`,
        pad,
        ty,
      );

      // The gallery list, so all eight are visible at once.
      const rx = width - pad;
      if (width > 700) {
        ctx.textAlign = 'right';
        let gy = top + 14 * ui;
        ctx.font = `600 ${10.5 * ui}px ${MONO}`;
        ctx.fillStyle = 'rgba(150, 160, 190, 0.6)';
        ctx.fillText('THE GALLERY', rx, gy);
        gy += 17 * ui;
        for (let i = 0; i < MECHANISMS.length; i++) {
          const on = i === current;
          ctx.font = `${on ? 600 : 400} ${11 * ui}px ${MONO}`;
          ctx.fillStyle = on
            ? hsl(outHue, 85, 70, 0.95)
            : `rgba(190, 198, 222, ${0.3 + 0.5 * midi.pads[i].energy})`;
          ctx.fillText(`${i + 1}  ${MECHANISMS[i].title}  ${MECHANISMS[i].dof} DOF`, rx, gy);
          gy += 15 * ui;
        }
      }

      // Relation and the error readouts, bottom right of the safe band.
      ctx.textAlign = 'right';
      let by = floor - pad;
      ctx.font = `${10.5 * ui}px ${MONO}`;
      ctx.fillStyle = 'rgba(150, 160, 190, 0.7)';
      ctx.fillText(`rod length error   ${sci(f.barError)}`, rx, by);
      by -= 15 * ui;
      ctx.fillText(`${mech.residualLabel}   =   ${sci(f.residual)}`, rx, by);
      by -= 21 * ui;
      ctx.font = `600 ${13 * ui}px ${MONO}`;
      ctx.fillStyle = hsl(outHue, 80, 70, 0.95);
      ctx.fillText(mech.relation, rx, by);
      if (mech.note && width > 700) {
        by -= 19 * ui;
        ctx.font = `${11.5 * ui}px ${SANS}`;
        ctx.fillStyle = 'rgba(190, 198, 222, 0.62)';
        for (const line of wrap(ctx, mech.note, 280 * ui).reverse()) {
          ctx.fillText(line, rx, by);
          by -= 14 * ui;
        }
      }

      // ---- configuration space inset ------------------------------------
      if (floor - top > 300 && ui > 0.7) {
        const size = 96 * ui;
        const bx = pad;
        const byy = floor - pad - size;
        drawConfigSpace(ctx, bx, byy, size, specs, q, kA, kB, inHue, outHue, ui);
        ctx.textAlign = 'left';
        ctx.font = `600 ${10 * ui}px ${MONO}`;
        ctx.fillStyle = hsl(inHue, 60, 68, 0.9);
        ctx.fillText('CONFIGURATION SPACE', bx + size + 12 * ui, byy + 14 * ui);
        ctx.font = `${11 * ui}px ${MONO}`;
        ctx.fillStyle = 'rgba(226, 232, 248, 0.85)';
        ctx.fillText(mech.configSpace, bx + size + 12 * ui, byy + 33 * ui);
        ctx.fillStyle = 'rgba(150, 160, 190, 0.7)';
        ctx.fillText(`mechanism DOF ${mech.dof}`, bx + size + 12 * ui, byy + 52 * ui);
        ctx.fillText(
          speed > 0 ? 'displayed trajectory dimension 1' : 'autoplay off — both coordinates yours',
          bx + size + 12 * ui,
          byy + 68 * ui,
        );
      }
    },
  };
};

/**
 * The little diagram bottom left. For one degree of freedom it is a circle or
 * an interval; for two it is the torus cut open, or the annulus the input pin
 * lives in. The faint dots are the demonstration trajectory autoplay follows —
 * a curve through the space, never the space itself.
 */
function drawConfigSpace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  specs: CoordSpec[],
  q: number[],
  kA: number,
  kB: number,
  inHue: number,
  outHue: number,
  ui: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  roundRect(ctx, x, y, size, size, 8 * ui);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const cx = x + size / 2;
  const cy = y + size / 2;
  const dot = (px: number, py: number) => {
    ctx.fillStyle = hsl(outHue, 88, 66);
    ctx.beginPath();
    ctx.arc(px, py, 4 * ui, 0, TAU);
    ctx.fill();
  };
  const trace = (points: [number, number][]) => {
    ctx.fillStyle = hsl(inHue, 70, 62, 0.5);
    for (const [px, py] of points) ctx.fillRect(px - 0.7 * ui, py - 0.7 * ui, 1.6 * ui, 1.6 * ui);
  };

  const twoAngles = specs.length === 2 && specs.every((s) => s.kind === 'angle');
  if (twoAngles) {
    // Torus, cut open into a square. Opposite edges are the same points.
    const inset = 12 * ui;
    const w = size - inset * 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.setLineDash([3 * ui, 3 * ui]);
    ctx.strokeRect(x + inset, y + inset, w, w);
    ctx.setLineDash([]);
    const pts: [number, number][] = [];
    for (let i = 0; i < 900; i++) {
      const p = (i / 900) * TAU * 9;
      const a = coordFraction(specs[0], coordValue(specs[0], kA, p));
      const b = coordFraction(specs[1], coordValue(specs[1], kB, p));
      pts.push([x + inset + a * w, y + inset + (1 - b) * w]);
    }
    trace(pts);
    dot(
      x + inset + coordFraction(specs[0], q[0]) * w,
      y + inset + (1 - coordFraction(specs[1], q[1])) * w,
    );
  } else if (specs.length === 2) {
    // One bounded coordinate and one angle: an annulus, drawn as one.
    const outer = size * 0.4;
    const inner = size * 0.15;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.arc(cx, cy, inner, 0, TAU, true);
    ctx.fill();
    const radial = specs[0].kind === 'interval' ? 0 : 1;
    const angular = 1 - radial;
    const pts: [number, number][] = [];
    for (let i = 0; i < 700; i++) {
      const p = (i / 700) * TAU;
      const rr = coordFraction(specs[radial], coordValue(specs[radial], radial === 0 ? kA : kB, p));
      const th = coordFraction(specs[angular], coordValue(specs[angular], angular === 0 ? kA : kB, p));
      const rad2 = inner + (outer - inner) * clamp(rr);
      pts.push([cx + Math.cos(th * TAU) * rad2, cy - Math.sin(th * TAU) * rad2]);
    }
    trace(pts);
    const rr = inner + (outer - inner) * clamp(coordFraction(specs[radial], q[radial]));
    const th = coordFraction(specs[angular], q[angular]) * TAU;
    dot(cx + Math.cos(th) * rr, cy - Math.sin(th) * rr);
  } else if (specs[0].kind === 'angle') {
    // A single circle, and autoplay covers all of it.
    const r = size * 0.32;
    ctx.strokeStyle = hsl(inHue, 60, 62, 0.75);
    ctx.lineWidth = 2 * ui;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    const a = coordFraction(specs[0], q[0]) * TAU;
    dot(cx + Math.cos(a) * r, cy - Math.sin(a) * r);
  } else {
    // An interval, with the singular poses fenced off at both ends.
    const w = size * 0.66;
    ctx.strokeStyle = hsl(inHue, 60, 62, 0.75);
    ctx.lineWidth = 2 * ui;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy);
    ctx.lineTo(cx + w / 2, cy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 120, 120, 0.7)';
    ctx.lineWidth = 1.6 * ui;
    for (const end of [-1, 1]) {
      const ex = cx + (end * w) / 2;
      ctx.beginPath();
      ctx.moveTo(ex - 4 * ui, cy - 7 * ui);
      ctx.lineTo(ex + 4 * ui, cy + 7 * ui);
      ctx.moveTo(ex + 4 * ui, cy - 7 * ui);
      ctx.lineTo(ex - 4 * ui, cy + 7 * ui);
      ctx.stroke();
    }
    dot(cx - w / 2 + w * clamp(coordFraction(specs[0], q[0])), cy);
  }

  ctx.textAlign = 'left';
  ctx.font = `${9.5 * ui}px ${MONO}`;
  ctx.fillStyle = `rgba(190, 198, 222, 0.55)`;
  ctx.fillText(specs.map((s) => s.label).join(', '), x + 8 * ui, y + size - 7 * ui);
  ctx.restore();
}

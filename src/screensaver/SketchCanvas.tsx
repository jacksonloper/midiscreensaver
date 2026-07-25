import { useEffect, useRef } from 'react';
import { midi } from '../midi/engine';
import { KNOB_COUNT } from '../midi/types';
import type { SketchFactory } from './types';

interface Props {
  factory: SketchFactory;
  knobDefaults: readonly number[];
  running: boolean;
  className?: string;
}

/** Longest step a sketch is asked to integrate; keeps physics sane after a tab switch. */
const MAX_DT = 1 / 20;

export function SketchCanvas({ factory, knobDefaults, running, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read through refs inside the loop so changing either never restarts the sketch.
  const runningRef = useRef(running);
  const defaultsRef = useRef(knobDefaults);
  runningRef.current = running;
  defaultsRef.current = knobDefaults;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const sketch = factory();
    const knobs = new Array<number>(KNOB_COUNT).fill(0.5);
    let width = 0;
    let height = 0;
    let raf = 0;
    let started = 0;
    let last = 0;
    let elapsed = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#04050a';
      ctx.fillRect(0, 0, width, height);
      sketch.setup?.({ ctx, width, height });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!started) {
        started = now;
        last = now;
      }
      const rawDt = (now - last) / 1000;
      last = now;
      if (!runningRef.current) return;

      const dt = Math.min(MAX_DT, Math.max(0, rawDt));
      elapsed += dt;
      const midiFrame = midi.beginFrame(dt, defaultsRef.current, knobs);

      ctx.save();
      sketch.draw({ ctx, width, height, time: elapsed, dt, midi: midiFrame });
      ctx.restore();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      // Coming back from a hidden tab: drop the accumulated gap.
      if (!document.hidden) last = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [factory]);

  return <canvas ref={canvasRef} className={className ?? 'sketch-canvas'} aria-hidden="true" />;
}

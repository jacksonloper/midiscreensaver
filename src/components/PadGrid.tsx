import { useEffect, useRef, useState } from 'react';
import { midi } from '../midi/engine';
import { PAD_COUNT } from '../midi/types';
import type { PadSpec } from '../screensaver/types';

/** LPD8 pad order: pad 1 is bottom-left, pad 5 is top-left. */
const VISUAL_ORDER = [4, 5, 6, 7, 0, 1, 2, 3];

/**
 * Sample pad brightness on an animation frame rather than on every MIDI
 * message, so the lights fall off smoothly even on pages with no canvas
 * driving the engine.
 */
function usePadGlow(): number[] {
  const [glow, setGlow] = useState<number[]>(() => new Array(PAD_COUNT).fill(0));
  const previous = useRef(glow);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const next = midi.pads.map((pad) => {
        if (pad.down) return 1;
        const since = (now - pad.lastHitAt) / 420;
        if (since > 4) return 0;
        // Quantised so we only re-render when it visibly changes.
        return Math.round(Math.exp(-since) * 20) / 20;
      });
      const changed = next.some((v, i) => v !== previous.current[i]);
      if (changed) {
        previous.current = next;
        setGlow(next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return glow;
}

interface Props {
  pads: PadSpec[];
  compact?: boolean;
}

export function PadGrid({ pads, compact }: Props) {
  const glow = usePadGlow();

  return (
    <div className={`pad-grid${compact ? ' is-compact' : ''}`}>
      {VISUAL_ORDER.map((slot) => {
        const spec = pads[slot];
        const lit = glow[slot] ?? 0;
        return (
          <button
            key={slot}
            type="button"
            className="pad"
            style={{ '--lit': lit, '--hue': `${(slot * 41 + 194) % 360}` } as React.CSSProperties}
            title={spec?.label ?? `Pad ${slot + 1}`}
            aria-label={spec?.label ?? `Pad ${slot + 1}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              midi.press(slot, 0.9);
            }}
            onPointerUp={() => midi.release(slot)}
            onPointerCancel={() => midi.release(slot)}
            onPointerLeave={() => midi.release(slot)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                midi.press(slot, 0.9);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') midi.release(slot);
            }}
          >
            <span className="pad-number">{slot + 1}</span>
            {!compact && spec ? <span className="pad-label">{spec.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

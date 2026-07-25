import { useCallback, useRef } from 'react';
import { midi } from '../midi/engine';

interface Props {
  index: number;
  label: string;
  value: number;
  /** True when the value comes from the sketch default rather than a real move. */
  untouched: boolean;
}

const SWEEP = 280; // degrees of travel, like a real pot
const DRAG_RANGE = 180; // pixels for a full sweep

/**
 * One knob of the eight. Drag vertically, use the arrow keys, or move the real
 * thing on the controller — all three write to the same engine slot.
 */
export function Knob({ index, label, value, untouched }: Props) {
  const dragRef = useRef<{ y: number; from: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { y: e.clientY, from: value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (drag.y - e.clientY) / DRAG_RANGE;
      midi.setKnob(index, drag.from + delta);
    },
    [index],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') midi.setKnob(index, value + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') midi.setKnob(index, value - step);
      else if (e.key === 'Home') midi.resetKnob(index);
      else return;
      e.preventDefault();
    },
    [index, value],
  );

  const angle = -SWEEP / 2 + value * SWEEP;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const arc = (value * SWEEP * circumference) / 360;
  const gap = circumference - arc;

  return (
    <div className="knob">
      <div
        className={`knob-dial${untouched ? ' is-default' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={`${label}, knob ${index + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={`${Math.round(value * 100)} percent`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => midi.resetKnob(index)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle className="knob-track" cx="20" cy="20" r={radius} />
          <circle
            className="knob-fill"
            cx="20"
            cy="20"
            r={radius}
            strokeDasharray={`${arc} ${gap}`}
            transform={`rotate(${90 + (360 - SWEEP) / 2} 20 20)`}
          />
          <line
            className="knob-pointer"
            x1="20"
            y1="20"
            x2="20"
            y2="7"
            transform={`rotate(${angle} 20 20)`}
          />
        </svg>
      </div>
      <div className="knob-meta">
        <span className="knob-label">{label}</span>
        <span className="knob-value">{Math.round(value * 100)}</span>
      </div>
    </div>
  );
}

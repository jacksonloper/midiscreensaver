import { midi } from '../midi/engine';
import { useMidiVersion } from '../midi/useMidi';
import type { KnobSpec, PadSpec } from '../screensaver/types';
import { Knob } from './Knob';
import { PadGrid } from './PadGrid';

interface Props {
  knobs: KnobSpec[];
  pads: PadSpec[];
  compact?: boolean;
}

/** The eight knobs and eight pads, mirroring whatever the hardware is doing. */
export function ControllerPanel({ knobs, pads, compact }: Props) {
  useMidiVersion();

  return (
    <div className={`controller${compact ? ' is-compact' : ''}`}>
      <div className="controller-knobs">
        {knobs.map((spec, i) => {
          const raw = midi.knobRaw[i];
          return (
            <Knob
              key={i}
              index={i}
              label={spec.label}
              value={raw === null ? spec.default : raw}
              untouched={raw === null}
            />
          );
        })}
      </div>
      <div className="controller-pads">
        <PadGrid pads={pads} compact={compact} />
      </div>
    </div>
  );
}

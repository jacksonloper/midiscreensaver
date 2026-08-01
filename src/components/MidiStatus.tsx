import { midi } from '../midi/engine';
import { useMidiVersion } from '../midi/useMidi';

const KIND_LABEL: Record<string, string> = {
  'note-on': 'note on',
  'note-off': 'note off',
  cc: 'cc',
  other: '—',
};

function statusLine(): { tone: 'ok' | 'warn' | 'idle'; text: string } {
  switch (midi.status) {
    case 'ready':
      return midi.devices.length
        ? { tone: 'ok', text: midi.devices.join(', ') }
        : { tone: 'idle', text: 'no controller found — plug one in, or play the pads below' };
    case 'denied':
      return { tone: 'warn', text: 'MIDI access was declined — reload and allow it to use hardware' };
    case 'unsupported':
      return { tone: 'warn', text: 'this browser has no Web MIDI — try Chrome, Edge or Opera' };
    default:
      return { tone: 'idle', text: 'asking for MIDI access…' };
  }
}

/** Connection state, the note/CC mapping, and a live view of incoming messages. */
export function MidiStatus() {
  useMidiVersion();
  const { tone, text } = statusLine();

  return (
    <section className="midi-status">
      <div className={`midi-chip is-${tone}`}>
        <span className="midi-dot" aria-hidden="true" />
        <span className="midi-chip-label">MIDI</span>
        <span className="midi-chip-text">{text}</span>
        {midi.status !== 'ready' && midi.status !== 'unsupported' ? (
          <button type="button" className="ghost-button" onClick={() => void midi.connect()}>
            retry
          </button>
        ) : null}
      </div>

      <details className="midi-details">
        <summary>Mapping and message log</summary>

        <p className="hint">
          An LPD8 mk2 in its first program sends pads on notes 36–43 and knobs on CC 70–77. If yours
          has been reprogrammed, set the base numbers here, or leave adoption on and play the pads in
          order — the first eight notes and first eight CCs it hears are claimed as they arrive.
        </p>

        <div className="midi-form">
          <label>
            Pad 1 note
            <input
              type="number"
              min={0}
              max={120}
              value={midi.mapping.padBaseNote}
              onChange={(e) => midi.setMapping({ padBaseNote: Number(e.target.value) })}
            />
          </label>
          <label>
            Knob 1 CC
            <input
              type="number"
              min={0}
              max={120}
              value={midi.mapping.knobBaseCc}
              onChange={(e) => midi.setMapping({ knobBaseCc: Number(e.target.value) })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={midi.mapping.adopt}
              onChange={(e) => midi.setMapping({ adopt: e.target.checked })}
            />
            Adopt unknown notes and CCs
          </label>
          <button type="button" className="ghost-button" onClick={() => midi.resetAllKnobs()}>
            reset knobs to this post's defaults
          </button>
        </div>

        <ol className="midi-log">
          {midi.log.length === 0 ? (
            <li className="midi-log-empty">nothing received yet</li>
          ) : (
            midi.log.map((entry) => (
              <li key={entry.id}>
                <span className="log-kind">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                <span className="log-nums">
                  ch {entry.channel} · {entry.a} · {entry.b}
                </span>
                <span className="log-slot">
                  {entry.slot >= 0 ? `→ ${entry.kind === 'cc' ? 'knob' : 'pad'} ${entry.slot + 1}` : 'ignored'}
                </span>
              </li>
            ))
          )}
        </ol>
      </details>
    </section>
  );
}

import { useEffect, useSyncExternalStore } from 'react';
import { midi } from './engine';
import { PAD_COUNT } from './types';

/**
 * Re-render whenever the engine publishes (at most once per animation frame).
 * Components read `midi` directly; this hook only supplies the invalidation.
 */
export function useMidiVersion(): number {
  return useSyncExternalStore(midi.subscribe, midi.getVersion, midi.getVersion);
}

/** Ask for MIDI access once, on mount. */
export function useMidiConnection(): void {
  useEffect(() => {
    void midi.connect();
  }, []);
}

const KEY_ROW = ['1', '2', '3', '4', '5', '6', '7', '8'];
/** The keys sit under the fingers in the same 4x2 shape as the pads. */
const KEY_GRID = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f'];

function slotForKey(key: string): number {
  const lower = key.toLowerCase();
  const row = KEY_ROW.indexOf(lower);
  if (row >= 0) return row;
  return KEY_GRID.indexOf(lower);
}

/**
 * Play the pads from the keyboard so the site still works with no hardware
 * plugged in. Ignores repeats and anything typed into a form field.
 */
export function usePadKeyboard(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const held = new Set<number>();

    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const slot = slotForKey(e.key);
      if (slot < 0 || slot >= PAD_COUNT || held.has(slot)) return;
      held.add(slot);
      midi.press(slot, 0.85);
    };
    const up = (e: KeyboardEvent) => {
      const slot = slotForKey(e.key);
      if (slot < 0) return;
      held.delete(slot);
      midi.release(slot);
    };
    const blur = () => {
      for (const slot of held) midi.release(slot);
      held.clear();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      blur();
    };
  }, [enabled]);
}

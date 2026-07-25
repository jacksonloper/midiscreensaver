import {
  DEFAULT_MAPPING,
  KNOB_COUNT,
  PAD_COUNT,
  type MidiAccessLike,
  type MidiFrame,
  type MidiInputLike,
  type MidiLogEntry,
  type MidiMapping,
  type MidiMessageLike,
  type MidiPortLike,
  type MidiSupport,
  type PadHit,
  type PadState,
} from './types';

const STORAGE_KEY = 'eightpads.mapping.v1';
/** Seconds for pad energy to fall to ~1/e of its value. */
const ENERGY_TAU = 0.42;

function loadMapping(): MidiMapping {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_MAPPING };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MAPPING };
    const parsed = JSON.parse(raw) as Partial<MidiMapping>;
    return {
      padBaseNote: clampInt(parsed.padBaseNote, 0, 120, DEFAULT_MAPPING.padBaseNote),
      knobBaseCc: clampInt(parsed.knobBaseCc, 0, 120, DEFAULT_MAPPING.knobBaseCc),
      adopt: parsed.adopt ?? DEFAULT_MAPPING.adopt,
    };
  } catch {
    return { ...DEFAULT_MAPPING };
  }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function makePad(): PadState {
  return { down: false, velocity: 0, energy: 0, hits: 0, lastHitAt: -1e9 };
}


/**
 * Turns raw note or CC numbers into slots 0..count-1.
 *
 * Three cases, in order of how likely they are:
 *
 * 1. The number is inside the configured window — an LPD8 mk2 in its factory
 *    program sends notes 36-43, and that is where the window starts.
 * 2. It is outside, but everything seen so far still spans less than one bank.
 *    Controllers lay their pads out contiguously (the mk1 uses 40-47), so the
 *    window slides down to the lowest number seen and every slot is re-derived
 *    from it. This recovers the hardware's own left-to-right order regardless
 *    of which pad happened to be hit first.
 * 3. The numbers are genuinely scattered — a drum-kit layout, say. Then each
 *    new number takes the lowest slot nobody else holds.
 */
class SlotLearner {
  private assigned = new Map<number, number>();
  private seen = new Set<number>();

  constructor(
    private readonly count: number,
    public base: number,
  ) {}

  reset(base: number): void {
    this.assigned.clear();
    this.seen.clear();
    this.base = base;
  }

  slotFor(value: number, adopt: boolean): number {
    const cached = this.assigned.get(value);
    if (cached !== undefined) return cached;

    const inWindow = value - this.base;
    if (inWindow >= 0 && inWindow < this.count) {
      this.seen.add(value);
      this.assigned.set(value, inWindow);
      return inWindow;
    }
    if (!adopt) return -1;

    this.seen.add(value);
    let lowest = Infinity;
    let highest = -Infinity;
    for (const n of this.seen) {
      if (n < lowest) lowest = n;
      if (n > highest) highest = n;
    }

    if (highest - lowest < this.count) {
      // One contiguous bank: slide the window and re-derive every slot.
      this.base = lowest;
      this.assigned.clear();
      for (const n of this.seen) this.assigned.set(n, n - lowest);
      return value - lowest;
    }

    const used = new Set(this.assigned.values());
    let slot = 0;
    while (slot < this.count && used.has(slot)) slot++;
    if (slot === this.count) slot = this.assigned.size % this.count;
    this.assigned.set(value, slot);
    return slot;
  }
}

/**
 * Owns every byte that arrives from the controller.
 *
 * Deliberately not a React store: MIDI can fire hundreds of messages a second
 * while a knob sweeps, and re-rendering on each one would be silly. Sketches
 * read the mutable state once per animation frame; React views subscribe to a
 * version counter that is published at most once per frame.
 */
export class MidiEngine {
  readonly pads: PadState[] = Array.from({ length: PAD_COUNT }, makePad);
  /** Raw knob positions, 0..1. `null` means "never touched". */
  readonly knobRaw: (number | null)[] = Array.from({ length: KNOB_COUNT }, () => null);

  mapping: MidiMapping = loadMapping();
  status: MidiSupport = 'unknown';
  error: string | null = null;
  devices: string[] = [];
  log: MidiLogEntry[] = [];
  version = 0;

  private padLearner = new SlotLearner(PAD_COUNT, this.mapping.padBaseNote);
  private knobLearner = new SlotLearner(KNOB_COUNT, this.mapping.knobBaseCc);

  private pendingHits: PadHit[] = [];
  private listeners = new Set<() => void>();
  private access: MidiAccessLike | null = null;
  private inputs: MidiInputLike[] = [];
  private notifyQueued = false;
  private logSeq = 0;
  private lastLiveAt = -1e9;

  // ---------------------------------------------------------------- lifecycle

  async connect(): Promise<void> {
    // Cast through `unknown`: lib.dom's own Web MIDI types come and go between
    // TypeScript releases, and the local interfaces are the ones this file uses.
    const nav = navigator as unknown as {
      requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<unknown>;
    };
    if (typeof nav.requestMIDIAccess !== 'function') {
      this.status = 'unsupported';
      this.error =
        'This browser has no Web MIDI. Chrome, Edge and Opera have it; Safari and Firefox do not.';
      this.notify();
      return;
    }
    try {
      const access = (await nav.requestMIDIAccess({ sysex: false })) as MidiAccessLike;
      this.access = access;
      this.status = 'ready';
      this.error = null;
      access.onstatechange = (e) => this.handleStateChange(e.port);
      this.bindInputs();
    } catch (err) {
      this.status = 'denied';
      this.error = err instanceof Error ? err.message : 'MIDI access was refused.';
    }
    this.notify();
  }

  private bindInputs(): void {
    if (!this.access) return;
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [...this.access.inputs.values()];
    for (const input of this.inputs) {
      input.onmidimessage = (e) => this.handleMessage(e, input.name ?? 'midi in');
    }
    this.devices = this.inputs
      .filter((i) => i.state === 'connected')
      .map((i) => i.name ?? 'unnamed device');
  }

  private handleStateChange(port: MidiPortLike | null): void {
    if (port && port.type !== 'input') return;
    this.bindInputs();
    this.notify();
  }

  // ----------------------------------------------------------------- messages

  private handleMessage(event: MidiMessageLike, source: string): void {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    if (status < 0x80) return;
    const kind = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const a = data[1];
    const b = data.length > 2 ? data[2] : 0;

    // A note-on with zero velocity is a note-off; plenty of gear sends it that way.
    if (kind === 0x90 && b > 0) {
      const slot = this.padSlot(a);
      if (slot >= 0) this.press(slot, b / 127, true);
      this.pushLog('note-on', channel, a, b, slot, source);
    } else if (kind === 0x80 || (kind === 0x90 && b === 0)) {
      const slot = this.padSlot(a);
      if (slot >= 0) this.release(slot);
      this.pushLog('note-off', channel, a, b, slot, source);
    } else if (kind === 0xb0) {
      const slot = this.knobSlot(a);
      if (slot >= 0) this.knobRaw[slot] = b / 127;
      this.pushLog('cc', channel, a, b, slot, source);
    } else {
      this.pushLog('other', channel, a, b, -1, source);
      return;
    }

    this.lastLiveAt = performance.now();
    this.notify();
  }

  private padSlot(note: number): number {
    const before = this.padLearner.base;
    const slot = this.padLearner.slotFor(note, this.mapping.adopt);
    if (this.padLearner.base !== before) {
      this.mapping = { ...this.mapping, padBaseNote: this.padLearner.base };
      this.persistMapping();
      // Slots just moved; nothing can still be legitimately held.
      for (const pad of this.pads) pad.down = false;
    }
    return slot;
  }

  private knobSlot(cc: number): number {
    const before = this.knobLearner.base;
    const slot = this.knobLearner.slotFor(cc, this.mapping.adopt);
    if (this.knobLearner.base !== before) {
      this.mapping = { ...this.mapping, knobBaseCc: this.knobLearner.base };
      this.persistMapping();
    }
    return slot;
  }

  private pushLog(
    kind: MidiLogEntry['kind'],
    channel: number,
    a: number,
    b: number,
    slot: number,
    source: string,
  ): void {
    this.log.unshift({ id: this.logSeq++, at: performance.now(), kind, channel, a, b, slot, source });
    if (this.log.length > 24) this.log.length = 24;
  }

  // ------------------------------------------------------------- input (any)

  /** Trigger a pad from anywhere: MIDI, the on-screen grid, or the keyboard. */
  press(slot: number, velocity: number, fromHardware = false): void {
    const pad = this.pads[slot];
    if (!pad) return;
    const v = Math.min(1, Math.max(0.05, velocity));
    pad.down = true;
    pad.velocity = v;
    pad.energy = Math.min(1.6, pad.energy * 0.35 + v);
    pad.hits += 1;
    pad.lastHitAt = performance.now();
    this.pendingHits.push({ pad: slot, velocity: v, at: pad.lastHitAt });
    if (this.pendingHits.length > 64) this.pendingHits.shift();
    if (!fromHardware) this.notify();
  }

  release(slot: number): void {
    const pad = this.pads[slot];
    if (!pad) return;
    pad.down = false;
  }

  setKnob(slot: number, value: number): void {
    if (slot < 0 || slot >= KNOB_COUNT) return;
    this.knobRaw[slot] = Math.min(1, Math.max(0, value));
    this.notify();
  }

  /** Hand a knob back to whatever default the current sketch asked for. */
  resetKnob(slot: number): void {
    if (slot < 0 || slot >= KNOB_COUNT) return;
    this.knobRaw[slot] = null;
    this.notify();
  }

  resetAllKnobs(): void {
    for (let i = 0; i < KNOB_COUNT; i++) this.knobRaw[i] = null;
    this.notify();
  }

  setMapping(next: Partial<MidiMapping>): void {
    this.mapping = { ...this.mapping, ...next };
    this.padLearner.reset(this.mapping.padBaseNote);
    this.knobLearner.reset(this.mapping.knobBaseCc);
    this.persistMapping();
    this.notify();
  }

  private persistMapping(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mapping));
    } catch {
      /* private browsing, storage full — the mapping just won't persist */
    }
  }

  get live(): boolean {
    return this.devices.length > 0;
  }

  /** True if hardware sent something in the last few seconds. */
  recentlyLive(now = performance.now()): boolean {
    return now - this.lastLiveAt < 3000;
  }

  // -------------------------------------------------------------- frame feed

  /**
   * Advance decay and hand the sketch its view of the controller.
   *
   * `defaults` are the sketch's preferred knob positions; a knob keeps that
   * value until someone actually moves it, so every screensaver opens looking
   * the way its author intended.
   */
  beginFrame(dt: number, defaults: readonly number[], out: number[]): MidiFrame {
    const decay = Math.exp(-dt / ENERGY_TAU);
    for (const pad of this.pads) {
      pad.energy = pad.down ? Math.max(pad.energy * decay, pad.velocity * 0.55) : pad.energy * decay;
      if (pad.energy < 1e-4) pad.energy = 0;
    }
    for (let i = 0; i < KNOB_COUNT; i++) {
      const raw = this.knobRaw[i];
      out[i] = raw === null ? defaults[i] ?? 0.5 : raw;
    }
    const hits = this.pendingHits;
    this.pendingHits = [];
    return { pads: this.pads, knobs: out, hits, live: this.live };
  }

  // ------------------------------------------------------------ subscription

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  /** Coalesce notifications to one per animation frame. */
  private notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    const flush = () => {
      this.notifyQueued = false;
      this.version += 1;
      for (const fn of this.listeners) fn();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }
}

export const midi = new MidiEngine();

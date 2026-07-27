# eight pads

Every post on this blog is a screensaver you play with an **Akai Professional LPD8 mk2** — eight
velocity-sensitive pads and eight knobs over USB. Each post says what its own controls do.

A static single-page app: React, TypeScript, Vite, Canvas 2D and the Web MIDI API. No animation
libraries, no shaders, no backend.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck, then bundle to dist/
npm run preview  # serve the built site on :4173
```

Web MIDI needs Chrome, Edge, or Opera — Safari and Firefox do not implement it. Everything is
playable without hardware: the on-screen pads are clickable, keys <kbd>1</kbd>–<kbd>8</kbd> (or
<kbd>q</kbd><kbd>w</kbd><kbd>e</kbd><kbd>r</kbd>/<kbd>a</kbd><kbd>s</kbd><kbd>d</kbd><kbd>f</kbd>)
play them, and knobs drag or take arrow keys.

## Deploying

`netlify.toml` has what Netlify needs: `npm run build`, publish `dist`, and a `/* → /index.html 200`
rewrite so client-side routes survive a hard refresh (`public/_redirects` carries the same rule).
Point Netlify at the repo; there is nothing else to configure.

## How a post works

Each post lives in `src/entries/<slug>/` as two files:

- `sketch.ts` — a `SketchFactory`: a function returning `{ setup?, draw }`.
- `index.tsx` — the metadata, the knob and pad labels, and the prose.

Register it in `src/entries/index.ts` and it appears on the index, in the previous/next navigation,
and at `/posts/<slug>`.

The harness (`src/screensaver/SketchCanvas.tsx`) owns the canvas, resizing, device-pixel-ratio
scaling, and the clock. Every frame it hands `draw` a `DrawContext`:

```ts
draw({ ctx, width, height, time, dt, midi }) {
  const [k1, k2] = midi.knobs;         // eight values, 0..1
  for (const hit of midi.hits) { ... } // pad hits since the last frame, with velocity
  midi.pads[3].energy;                 // decaying excitement per pad, 0..1
}
```

A sketch never touches the MIDI layer, so a real pad, a click and a keypress behave identically.
Knobs the reader has not touched report the post's own defaults, so a post opens looking the way it
was written.

## Talking to the controller

`src/midi/engine.ts` holds all the MIDI state. It is not a React store: a knob sweep fires hundreds
of messages a second, so sketches read mutable state once per frame and React views subscribe to a
version counter published at most once per animation frame.

Slot mapping (`SlotLearner`) handles three cases in order:

1. The number is in the configured window — an LPD8 mk2 in its factory program sends pads on notes
   36–43 and knobs on CC 70–77.
2. It is outside, but everything seen so far still spans less than one bank of eight. Pads are laid
   out contiguously (the mk1 uses 40–47), so the window slides to the lowest number seen and every
   slot is re-derived from it. Hardware order is recovered no matter which pad was hit first.
3. The numbers are genuinely scattered — a drum-kit layout. Each new number takes the lowest free
   slot.

What it learns is saved to `localStorage`, and the base numbers can be set by hand in the "Mapping
and message log" panel, which also shows every message coming in and where it was routed.

## Tests

`tests/midi-mapping.mjs` stubs `navigator.requestMIDIAccess` with a fake LPD8 and drives the site
through Playwright — the part that cannot be checked by hand without the hardware. It covers the mk2
factory bank, an mk1-style bank arriving out of order, scattered layouts, CC-to-knob routing, and
mapping persistence.

```bash
npm run build
npx vite preview --port 4173 &
npx playwright@latest install chromium   # once
node tests/midi-mapping.mjs              # CHROME_PATH=... to use an existing Chromium
```

Playwright is not a dependency. This script is the only thing that uses it, and leaving it out
keeps the deploy build small.

## The posts

| Post | What the pads do |
| --- | --- |
| Multiplication as a rectangle | Change how the area model is drawn — palette, grid, labels, spacing, fill, glow, sweep, readout |
| Adding on a number line | Add or subtract 1, 2, 5 or 10 from the total the ball has to hop to |
| The planets, right now | Fly the camera to any of the eight planets |
| Waves through a grid of dots | Drop an expanding ring into the grid from one of eight anchors |
| Eight orbits on a spring | Kick one of the eight orbiting bodies outward |
| Dye in a flow field | Inject coloured dye into the field at one of eight sites |
| Falling glyphs | Re-seed a band of glyphs, one alphabet per pad |

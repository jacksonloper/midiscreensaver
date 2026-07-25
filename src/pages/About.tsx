import { MidiStatus } from '../components/MidiStatus';

export function About() {
  return (
    <div className="page about">
      <h1>About</h1>
      <div className="prose">
        <p>
          Every post here is a screensaver. Not a video of one — the real thing, running in your
          browser on a canvas, waiting for input. The input is an{' '}
          <strong>Akai Professional LPD8 mk2</strong>: eight velocity-sensitive pads and eight knobs,
          about the size of a paperback, connected over USB.
        </p>

        <h2>Getting the controller working</h2>
        <ol>
          <li>Plug the LPD8 into a USB port. There is no driver to install.</li>
          <li>
            Open this site in Chrome, Edge, or Opera. Web MIDI is not implemented in Safari or
            Firefox, and there is nothing this site can do about that.
          </li>
          <li>Allow the MIDI permission prompt when it appears.</li>
          <li>
            Hit a pad. The status strip below should name your device, and the on-screen pads should
            light up in sympathy.
          </li>
        </ol>

        <h2>If nothing lights up</h2>
        <p>
          In its factory program the LPD8 mk2 sends pads on notes 36–43 and knobs on CC 70–77, and
          that is what this site expects. Controllers get reprogrammed, though, so by default it will
          also adopt whatever it hears: the first eight distinct notes become pads one through eight,
          and the first eight distinct CCs become knobs one through eight, in the order they arrive.
          Play the pads left to right once and it sorts itself out. The message log in the status
          strip shows exactly what is coming in and where it is being routed.
        </p>

        <h2>No controller</h2>
        <p>
          Everything works without hardware. The pads on screen are clickable, the keys <kbd>1</kbd>{' '}
          through <kbd>8</kbd> play them (as do <kbd>q</kbd> <kbd>w</kbd> <kbd>e</kbd> <kbd>r</kbd> /{' '}
          <kbd>a</kbd> <kbd>s</kbd> <kbd>d</kbd> <kbd>f</kbd> if you prefer the shape), and the knobs
          can be dragged or nudged with the arrow keys. Double-click a knob, or press <kbd>Home</kbd>{' '}
          while it is focused, to hand it back to the post's own default.
        </p>

        <h2>How a post is built</h2>
        <p>
          A post is a title, some prose, and a sketch factory: a function returning{' '}
          <code>{'{ setup?, draw }'}</code>. The harness owns the canvas, the resize handling, the
          device-pixel-ratio scaling, and the clock. Each frame it hands <code>draw</code> the eight
          knob values, the eight pad states with their decaying energy, and the list of hits that
          landed since the last frame. A sketch never touches the MIDI layer directly, which is why
          the same code responds identically to a real pad, a click, and a keypress.
        </p>
        <p>
          Knob values are the one subtlety. A knob a reader has never touched reports whatever
          default the post asked for, so every screensaver opens looking the way it was written to
          look. The moment you move a knob — physically or on screen — it becomes yours, until you
          reset it or move to another post.
        </p>

        <h2>Colophon</h2>
        <p>
          React, TypeScript, Vite, the Canvas 2D API and the Web MIDI API. No animation libraries and
          no shaders. Deployed as a static single-page app on Netlify.
        </p>
      </div>

      <MidiStatus />
    </div>
  );
}

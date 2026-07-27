import { MidiStatus } from '../components/MidiStatus';

export function About() {
  return (
    <div className="page about">
      <h1>About</h1>
      <div className="prose">
        <p>
          Every post here is a screensaver running on a canvas in your browser. The controls are an{' '}
          <strong>Akai Professional LPD8 mk2</strong>: eight velocity-sensitive pads and eight knobs,
          connected over USB. You do not need one — see below.
        </p>

        <h2>Getting the controller working</h2>
        <ol>
          <li>Plug the LPD8 into a USB port. There is no driver to install.</li>
          <li>Open this site in Chrome, Edge or Opera. Safari and Firefox have no Web MIDI.</li>
          <li>Allow the MIDI permission prompt when it appears.</li>
          <li>
            Hit a pad. The status strip below should name your device, and the pads on screen should
            light up with it.
          </li>
        </ol>

        <h2>If nothing lights up</h2>
        <p>
          In its first program the LPD8 mk2 sends pads on notes 36–43 and knobs on CC 70–77, which is
          what this site expects. If yours has been reprogrammed, it will adopt what it hears instead:
          the first eight distinct notes become pads 1 to 8, and the first eight distinct CCs become
          knobs 1 to 8, in the order they arrive. Playing the pads left to right once is usually
          enough. The message log in the status strip shows what is coming in and where it is routed.
        </p>

        <h2>Without a controller</h2>
        <p>
          The pads on screen are clickable, and the keys <kbd>1</kbd> to <kbd>8</kbd> play them (so do{' '}
          <kbd>q</kbd> <kbd>w</kbd> <kbd>e</kbd> <kbd>r</kbd> / <kbd>a</kbd> <kbd>s</kbd> <kbd>d</kbd>{' '}
          <kbd>f</kbd>). Knobs can be dragged or moved with the arrow keys. Double-click a knob, or
          press <kbd>Home</kbd> while it is focused, to put it back to the post's default.
        </p>

        <h2>How a post is built</h2>
        <p>
          A post is a title, some prose, and a sketch: a function returning{' '}
          <code>{'{ setup?, draw }'}</code>. The harness owns the canvas, the resizing, the
          device-pixel-ratio scaling and the clock. Each frame it hands <code>draw</code> the eight
          knob values, the eight pad states with their decaying energy, and the hits that landed since
          the last frame. A sketch never reads MIDI directly, so a real pad, a click and a keypress
          behave the same.
        </p>
        <p>
          A knob you have not touched reports the post's own default, so a post opens looking the way
          it was written. Once you move it, your value stays until you reset it or open another post.
        </p>

        <h2>Built with</h2>
        <p>
          React, TypeScript, Vite, the Canvas 2D API and the Web MIDI API. No animation libraries and
          no shaders. Deployed as a static single-page app on Netlify.
        </p>
      </div>

      <MidiStatus />
    </div>
  );
}

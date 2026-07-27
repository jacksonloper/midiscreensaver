import { Link } from 'react-router-dom';
import { ControllerPanel } from '../components/ControllerPanel';
import { MidiStatus } from '../components/MidiStatus';
import { entries } from '../entries';
import { knobDefaults } from '../entries/types';
import { SketchCanvas } from '../screensaver/SketchCanvas';

const formatDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function Home() {
  const featured = entries[0];

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-stage">
          {featured ? (
            <SketchCanvas
              factory={featured.factory}
              knobDefaults={knobDefaults(featured)}
              running
            />
          ) : null}
          <div className="hero-copy">
            <h1>Screensavers you play.</h1>
            <p>
              Every post here is a screensaver running in your browser, with eight pads and eight
              knobs wired to it. Use an Akai LPD8 mk2 or the controls on screen. Each post says what
              its own knobs and pads do.
            </p>
            <div className="hero-actions">
              {featured ? (
                <Link className="button" to={`/posts/${featured.slug}`}>
                  Open the newest post
                </Link>
              ) : null}
              <Link className="button is-quiet" to="/about">
                How this works
              </Link>
            </div>
          </div>
        </div>
        {featured ? (
          <div className="hero-controller">
            <p className="hero-controller-note">
              Running above: <strong>{featured.title}</strong>. These controls drive it.
            </p>
            <ControllerPanel knobs={featured.knobs} pads={featured.pads} compact />
          </div>
        ) : null}
      </section>

      <MidiStatus />

      <section className="post-list">
        <h2>Posts</h2>
        <ol>
          {entries.map((entry) => (
            <li key={entry.slug}>
              <article className="post-card">
                <p className="post-date">
                  <time dateTime={entry.date}>{formatDate(entry.date)}</time>
                </p>
                <h3>
                  <Link to={`/posts/${entry.slug}`}>{entry.title}</Link>
                </h3>
                <p className="post-dek">{entry.dek}</p>
                <ul className="tags">
                  {entry.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

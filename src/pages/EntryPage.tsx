import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ControllerPanel } from '../components/ControllerPanel';
import { MidiStatus } from '../components/MidiStatus';
import { entries, entryBySlug } from '../entries';
import { knobDefaults } from '../entries/types';
import { midi } from '../midi/engine';
import { SketchCanvas } from '../screensaver/SketchCanvas';
import { NotFound } from './NotFound';

const formatDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function EntryPage() {
  const { slug } = useParams();
  const entry = entryBySlug(slug);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(true);
  const [showHud, setShowHud] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => setIsFullscreen(false));
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    // Deliberately not on the pad keys (1-8, qwer/asdf) so playing never
    // trips a shortcut.
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'h') setShowHud((v) => !v);
      else if (e.key === 'v') toggleFullscreen();
      else if (e.key === ' ') {
        e.preventDefault();
        setRunning((v) => !v);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  // A fresh post gets its own knob positions rather than inheriting the last one's.
  useEffect(() => {
    midi.resetAllKnobs();
  }, [slug]);

  if (!entry) return <NotFound />;

  const index = entries.findIndex((e) => e.slug === entry.slug);
  const newer = index > 0 ? entries[index - 1] : undefined;
  const older = index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined;

  return (
    <article className="page entry">
      <header className="entry-header">
        <p className="post-date">
          <time dateTime={entry.date}>{formatDate(entry.date)}</time>
        </p>
        <h1>{entry.title}</h1>
        <p className="entry-dek">{entry.dek}</p>
      </header>

      <div
        ref={stageRef}
        className={`stage${isFullscreen ? ' is-fullscreen' : ''}${showHud ? '' : ' is-bare'}`}
      >
        <SketchCanvas factory={entry.factory} knobDefaults={knobDefaults(entry)} running={running} />

        <div className="stage-bar">
          <button type="button" className="ghost-button" onClick={() => setRunning((v) => !v)}>
            {running ? 'pause' : 'play'}
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowHud((v) => !v)}>
            {showHud ? 'hide controls' : 'show controls'}
          </button>
          <button type="button" className="ghost-button" onClick={toggleFullscreen}>
            {isFullscreen ? 'exit full screen' : 'full screen'}
          </button>
          <span className="stage-keys">
            <kbd>space</kbd> pause · <kbd>h</kbd> controls · <kbd>v</kbd> full screen
          </span>
        </div>

        {showHud ? (
          <div className="stage-hud">
            <ControllerPanel knobs={entry.knobs} pads={entry.pads} compact />
          </div>
        ) : null}
      </div>

      <MidiStatus />

      <div className="entry-body">
        <div className="prose">{entry.body}</div>

        <aside className="legend">
          <h2>What the controls do</h2>
          <h3>Knobs</h3>
          <ol className="legend-list">
            {entry.knobs.map((knob, i) => (
              <li key={knob.label}>
                <span className="legend-index">K{i + 1}</span>
                <span>{knob.label}</span>
                <span className="legend-default">{Math.round(knob.default * 100)}</span>
              </li>
            ))}
          </ol>
          <h3>Pads</h3>
          <ol className="legend-list">
            {entry.pads.map((pad, i) => (
              <li key={pad.label}>
                <span className="legend-index">P{i + 1}</span>
                <span>{pad.label}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <nav className="entry-nav">
        {older ? (
          <Link to={`/posts/${older.slug}`} className="entry-nav-link">
            <span>older</span>
            <strong>{older.title}</strong>
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link to={`/posts/${newer.slug}`} className="entry-nav-link is-right">
            <span>newer</span>
            <strong>{newer.title}</strong>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="shell">
      <header className="site-header">
        <NavLink to="/" className="wordmark">
          <span className="wordmark-dots" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ '--i': i } as React.CSSProperties} />
            ))}
          </span>
          eight pads
        </NavLink>
        <nav>
          <NavLink to="/" end>
            posts
          </NavLink>
          <NavLink to="/about">about</NavLink>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>
          Screensavers you play with an Akai LPD8 mk2. Without one, use the pads on screen or the keys{' '}
          <kbd>1</kbd>–<kbd>8</kbd>.
        </p>
      </footer>
    </div>
  );
}

import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page not-found">
      <h1>Not found</h1>
      <p className="prose">That post does not exist, or it has been renamed. The index lists them all.</p>
      <Link className="button" to="/">
        Back to the posts
      </Link>
    </div>
  );
}

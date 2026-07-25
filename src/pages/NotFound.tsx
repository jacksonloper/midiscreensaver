import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page not-found">
      <h1>Nothing on this pad</h1>
      <p className="prose">
        That post does not exist — or it did and got renamed. The index has all of them.
      </p>
      <Link className="button" to="/">
        Back to the posts
      </Link>
    </div>
  );
}

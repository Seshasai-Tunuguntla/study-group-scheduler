import { Link } from 'react-router-dom';

export default function NotFound({ title = 'Page not found', children }) {
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>{title}</h1>
        <p className="page-sub">{children || "There's nothing at this address."}</p>
      </header>
      <Link to="/dashboard" className="btn">
        Back to your groups
      </Link>
    </div>
  );
}

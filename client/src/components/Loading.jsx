import { useEffect, useState } from 'react';

// The hosted API sleeps when idle and can take a while to wake up. Saying so only after a few
// seconds keeps fast loads quiet while explaining slow ones.
const SLOW_AFTER_MS = 3000;

export default function Loading({ label = 'Loading…' }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
      {slow && <p className="muted">The free server can take up to a minute to wake up.</p>}
    </div>
  );
}

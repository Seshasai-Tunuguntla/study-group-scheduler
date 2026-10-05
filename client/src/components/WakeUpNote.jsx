import { useEffect, useState } from 'react';

// A server instance that has been idle can take a few seconds to start (and to rebuild the demo, if
// it's due). Saying so only after a few seconds keeps fast loads quiet while explaining slow ones.
// Render it while something is waiting.
const SLOW_AFTER_MS = 3000;

export default function WakeUpNote({ className = 'muted' }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return slow ? <p className={className}>Starting the server can take a few seconds.</p> : null;
}

import { useState } from 'react';

// The organizer's invite code, large and easy to read out, with Copy.
export default function JoinCode({ code }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the code is selectable as a fallback (user-select: all).
    }
  }

  return (
    <div className="join-code">
      <span className="join-code-label">Join code</span>
      <code>{code}</code>
      <button type="button" className="btn-quiet" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

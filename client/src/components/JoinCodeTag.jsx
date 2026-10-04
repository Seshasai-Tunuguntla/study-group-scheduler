import { useState } from 'react';

// The organizer's invite code, styled like a key tag (as in the Landlord project), with Copy.
export default function JoinCodeTag({ code }) {
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
    <div className="key-tag">
      <span className="key-tag-hole" aria-hidden="true" />
      <span className="key-tag-label">Join code</span>
      <code className="key-tag-code">{code}</code>
      <button type="button" className="key-tag-copy" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

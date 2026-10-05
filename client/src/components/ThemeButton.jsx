import { useEffect, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { applyTheme, readPinnedTheme, toggleTheme, writePinnedTheme } from '../theme/theme';

// Switches between the light and dark theme. Named for what it does next ("Switch to light theme"),
// with a sun or moon for the theme it switches to.
export default function ThemeButton() {
  const system = useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  const [pinned, setPinned] = useState(readPinnedTheme);
  const current = pinned ?? system;
  const { theme: next, pinned: nextPinned } = toggleTheme(current, system);

  useEffect(() => {
    applyTheme(pinned);
  }, [pinned]);

  function handleClick() {
    writePinnedTheme(nextPinned);
    setPinned(nextPinned);
  }

  const label = `Switch to ${next} theme`;
  return (
    <button type="button" className="btn-icon" aria-label={label} title={label} onClick={handleClick}>
      {next === 'light' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

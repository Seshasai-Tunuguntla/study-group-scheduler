// Light or dark. The page follows the system setting unless the viewer pins the other theme with
// the theme button; the pin is remembered in this browser (localStorage) and applied as
// data-theme on <html>, which sets color-scheme for the light-dark() tokens in index.css.
// index.html applies a saved pin before the first paint, so the page never flashes the wrong theme.

export const THEME_KEY = 'study-scheduler:theme';
const THEMES = ['light', 'dark'];

// The pinned theme, or null to follow the system. Blocked or odd storage just means "not pinned".
export function readPinnedTheme(storage = globalThis.localStorage) {
  try {
    const theme = storage?.getItem(THEME_KEY);
    return THEMES.includes(theme) ? theme : null;
  } catch {
    return null;
  }
}

export function writePinnedTheme(theme, storage = globalThis.localStorage) {
  try {
    if (theme) storage?.setItem(THEME_KEY, theme);
    else storage?.removeItem(THEME_KEY);
  } catch {
    // Not remembered; the theme still applies until the page is reloaded.
  }
}

// What the theme button does: switch to the other theme. Switching to the system's own theme
// removes the pin, so the page goes back to following the system.
export function toggleTheme(current, system) {
  const theme = current === 'dark' ? 'light' : 'dark';
  return { theme, pinned: theme === system ? null : theme };
}

// Sets data-theme on <html>, and points the browser's theme-color (the phone's address bar) at
// the matching page colour: each <meta name="theme-color" data-theme-color="light|dark"> applies
// to its own system setting, or to everything while that theme is pinned.
export function applyTheme(pinned, doc = globalThis.document) {
  if (pinned) doc.documentElement.dataset.theme = pinned;
  else delete doc.documentElement.dataset.theme;
  for (const meta of doc.querySelectorAll('meta[data-theme-color]')) {
    const theme = meta.dataset.themeColor;
    meta.media = pinned ? (pinned === theme ? 'all' : 'not all') : `(prefers-color-scheme: ${theme})`;
  }
}

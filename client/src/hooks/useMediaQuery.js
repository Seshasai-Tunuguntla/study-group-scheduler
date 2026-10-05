import { useSyncExternalStore } from 'react';

// True while the CSS media query matches, updating when it changes (e.g. rotating a tablet).
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches
  );
}

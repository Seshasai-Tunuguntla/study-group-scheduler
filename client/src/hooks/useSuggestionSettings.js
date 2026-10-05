import { useCallback, useEffect, useState } from 'react';
import { normalizeSettings, readSettings, storageKey, writeSettings } from '../suggestions/settings';

// Session length and preferred hours for one group, remembered in this browser (see settings.js).
export function useSuggestionSettings(userId, groupId) {
  const key = storageKey(userId, groupId);
  const [settings, setSettings] = useState(() => readSettings(key));

  useEffect(() => {
    writeSettings(key, settings);
  }, [key, settings]);

  const update = useCallback((next) => setSettings(normalizeSettings(next)), []);
  return [settings, update];
}

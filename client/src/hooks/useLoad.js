import { useCallback, useEffect, useRef, useState } from 'react';

const NOT_LOADED = Symbol('not loaded');

// Loads data for a screen and tracks the three states every screen has to handle:
// loading, error and loaded. It loads again whenever `key` changes (e.g. the group id or the
// chosen duration), and `reload()` loads again on demand (after a change, or a Retry click).
//
// `loading` is derived rather than stored: the result remembers which key it was loaded for, so
// "the key changed and the result hasn't caught up" is loading. While a new key loads, the previous
// data stays available (screens can dim it instead of flashing a spinner). A response that arrives
// after a newer request started is ignored, so a slow old request can't overwrite fresh data.
export function useLoad(load, key) {
  const [result, setResult] = useState({ key: NOT_LOADED, data: undefined, error: null });
  const [reloading, setReloading] = useState(false);
  const latestRequest = useRef(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const fetchFor = useCallback(async (forKey) => {
    const requestId = ++latestRequest.current;
    const isLatest = () => requestId === latestRequest.current;
    try {
      const data = await loadRef.current();
      if (isLatest()) setResult({ key: forKey, data, error: null });
    } catch (error) {
      if (isLatest()) setResult((current) => ({ key: forKey, data: current.data, error }));
    } finally {
      if (isLatest()) setReloading(false);
    }
  }, []);

  useEffect(() => {
    fetchFor(key);
  }, [fetchFor, key]);

  const reload = useCallback(() => {
    setReloading(true);
    return fetchFor(key);
  }, [fetchFor, key]);

  const current = result.key === key;
  return {
    data: result.data,
    error: current ? result.error : null,
    loading: reloading || !current,
    reload,
  };
}

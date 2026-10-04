import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../api/client';
import { browserTimeZone } from '../time/week';
import { AuthContext } from './authContext';

// Checks the saved token with the server: resolves to { user } or { error }.
// Only a 401 means the token is bad, so only a 401 clears it. If the server is down or waking up,
// the token is kept and the app offers a retry instead of logging the user out.
async function checkSavedToken() {
  try {
    const data = await api.me();
    return { user: data.user };
  } catch (error) {
    if (error.status === 401) {
      tokenStore.clear();
      return { user: null };
    }
    return { error };
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only a saved token needs checking with the server; without one we know straight away.
  const [loading, setLoading] = useState(() => tokenStore.get() !== null);
  // Set when the saved token couldn't be checked because the server didn't answer.
  const [startupError, setStartupError] = useState(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const applyStartup = useCallback(({ user: savedUser = null, error = null }) => {
    setUser(savedUser);
    setStartupError(error);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Any signed-in request that comes back 401 (e.g. the 7-day token expired) logs out,
    // and the private routes then send the user to /login.
    setUnauthorizedHandler(logout);
    if (tokenStore.get()) checkSavedToken().then(applyStartup);
  }, [logout, applyStartup]);

  const retryStartup = useCallback(() => {
    setLoading(true);
    checkSavedToken().then(applyStartup);
  }, [applyStartup]);

  const login = useCallback(async (email, password) => {
    const data = await api.login({ email, password });
    tokenStore.set(data.token);
    setUser(data.user);
  }, []);

  // The account's time zone comes from the browser at signup. All times are shown in it.
  const register = useCallback(async (name, email, password) => {
    const data = await api.register({ name, email, password, timeZone: browserTimeZone() });
    tokenStore.set(data.token);
    setUser(data.user);
  }, []);

  // Bumped when the server moves the user's saved availability (a "keep my local hours" switch),
  // so screens showing availability, suggestions or attendance load it again.
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  // Every time on screen re-renders in the new zone as soon as `user` updates.
  // Resolves to how far the saved availability moved (0 unless keepLocalTimes).
  const updateTimeZone = useCallback(async (timeZone, { keepLocalTimes = false } = {}) => {
    const data = await api.updateTimeZone(timeZone, keepLocalTimes);
    setUser(data.user);
    if (data.shiftedByMinutes !== 0) setAvailabilityVersion((version) => version + 1);
    return data.shiftedByMinutes;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      startupError,
      retryStartup,
      login,
      register,
      logout,
      updateTimeZone,
      availabilityVersion,
    }),
    [user, loading, startupError, retryStartup, login, register, logout, updateTimeZone, availabilityVersion]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

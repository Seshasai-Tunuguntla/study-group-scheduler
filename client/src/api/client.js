const BASE = '/api';
const TOKEN_KEY = 'token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// Carries the HTTP status so pages can tell "not found" (404) from other failures.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Called when a signed-in request comes back 401 (expired or invalid token).
// AuthContext sets this to log the user out.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(path, { method = 'GET', body } = {}) {
  const token = tokenStore.get();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    // Our API always sends { error }. Without one, a proxy or host answered: the API is down or asleep.
    const fallback =
      res.status >= 500
        ? "The server isn't responding right now. Please try again in a moment."
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, data.error || fallback);
  }
  return data;
}

const query = (params) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),
  updateTimeZone: (timeZone, keepLocalTimes = false) =>
    request('/auth/me', { method: 'PATCH', body: { timeZone, keepLocalTimes } }),

  listGroups: () => request('/groups'),
  createGroup: (name) => request('/groups', { method: 'POST', body: { name } }),
  joinGroup: (joinCode) => request('/groups/join', { method: 'POST', body: { joinCode } }),
  getGroup: (groupId) => request(`/groups/${groupId}`),
  setRequired: (groupId, userId, required) =>
    request(`/groups/${groupId}/members/${userId}`, { method: 'PATCH', body: { required } }),
  removeMember: (groupId, userId) => request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  getAvailability: (groupId) => request(`/groups/${groupId}/availability`),
  saveAvailability: (groupId, ranges) =>
    request(`/groups/${groupId}/availability`, { method: 'PUT', body: { ranges } }),

  getSuggestions: (groupId, params) => request(`/groups/${groupId}/suggestions${query(params)}`),

  getSession: (groupId) => request(`/groups/${groupId}/session`),
  confirmSession: (groupId, startMinute, durationMinutes) =>
    request(`/groups/${groupId}/session`, { method: 'POST', body: { startMinute, durationMinutes } }),
  clearSession: (groupId) => request(`/groups/${groupId}/session`, { method: 'DELETE' }),
};

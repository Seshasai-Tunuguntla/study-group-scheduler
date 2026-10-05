// The viewer's settings for exploring best times: session length and preferred hours.
// Shared by the Suggestions and Heatmap tabs, and remembered per user and group in this browser
// (localStorage). They're a personal view setting, never seen by other members, so they don't
// belong in the database; the trade-off is that they don't follow you to another device.

export const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240];
export const DEFAULT_SETTINGS = { duration: 60, preferredStart: null, preferredEnd: null };
export const DEFAULT_PREFERRED = { preferredStart: '18:00', preferredEnd: '21:00' };

const TIME = /^([01]\d|2[0-3]):(00|30)$/;

// "00:00", "00:30", ... "23:30": the half hours the server accepts for preferred hours.
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, '0');
  return `${hours}:${i % 2 ? '30' : '00'}`;
});

export const storageKey = (userId, groupId) => `study-scheduler:suggestions:${userId}:${groupId}`;

// '16:30' -> 990
export const minuteOfDay = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Anything not valid falls back to the default, so a corrupted or outdated stored value can never
// produce a bad request. Preferred hours need both ends, on the half hour, and not equal.
export function normalizeSettings(value) {
  const duration = DURATIONS.includes(value?.duration) ? value.duration : DEFAULT_SETTINGS.duration;
  const start = value?.preferredStart;
  const end = value?.preferredEnd;
  const validPreferred = TIME.test(start ?? '') && TIME.test(end ?? '') && start !== end;
  return {
    duration,
    preferredStart: validPreferred ? start : null,
    preferredEnd: validPreferred ? end : null,
  };
}

export function readSettings(key, storage = globalThis.localStorage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(key)));
  } catch {
    return { ...DEFAULT_SETTINGS }; // storage blocked (private mode) or unreadable
  }
}

export function writeSettings(key, settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, JSON.stringify(settings));
  } catch {
    // Storage blocked or full: the settings just won't be remembered.
  }
}

// Changing one end of the preferred hours so it would equal the other moves the other end an hour
// on, rather than producing an empty (invalid) window.
export function withPreferred(settings, end, time) {
  const next = { ...settings, [end]: time };
  if (next.preferredStart === next.preferredEnd) {
    const other = end === 'preferredStart' ? 'preferredEnd' : 'preferredStart';
    const shift = end === 'preferredStart' ? 60 : -60;
    next[other] = TIME_OPTIONS[((minuteOfDay(time) + shift + 1440) % 1440) / 30];
  }
  return normalizeSettings(next);
}

export const hasPreferred = (settings) => settings.preferredStart !== null;

// An end at or before the start runs past midnight: 21:00-01:00.
export const crossesMidnight = (settings) =>
  hasPreferred(settings) && minuteOfDay(settings.preferredEnd) <= minuteOfDay(settings.preferredStart);

// Query parameters for GET /suggestions (preferred hours only when set).
export function suggestionParams(settings) {
  return hasPreferred(settings)
    ? { duration: settings.duration, preferredStart: settings.preferredStart, preferredEnd: settings.preferredEnd }
    : { duration: settings.duration };
}

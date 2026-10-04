// The client side of the time model (docs/PLAN.md): the server stores every time as UTC minutes
// since Monday 00:00 on a circular 7-day week. The UI shows those times in the user's own zone,
// the one saved on their account at signup (the same zone the server uses for preferred windows).

export const SLOT_MINUTES = 30;
export const MINUTES_PER_DAY = 24 * 60;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const mod = (n, m) => ((n % m) + m) % m;

// An IANA zone's UTC offset in minutes at a given moment, e.g. Asia/Kolkata -> 330,
// America/New_York -> -300 in winter and -240 in summer. Mirrors the server's helper.
export function utcOffsetMinutes(timeZone, at = new Date()) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName').value; // "GMT+05:30", "GMT-04:00" or "GMT"
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(label);
  if (!match?.[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '+' ? minutes : -minutes;
}

// A UTC minute-of-week -> the same moment as a minute-of-week in `timeZone`, using the zone's
// current offset. Like stored availability, this is a fixed weekly pattern: in DST zones the
// local time moves by an hour when the clocks change (the documented DST trade-off).
export function toLocalMinute(utcMinute, timeZone, at = new Date()) {
  return mod(utcMinute + utcOffsetMinutes(timeZone, at), MINUTES_PER_WEEK);
}

// The current moment as a UTC minute-of-week (Monday 00:00 UTC = 0).
export function utcMinuteOfWeek(date = new Date()) {
  const day = (date.getUTCDay() + 6) % 7; // getUTCDay: Sunday = 0; our week starts Monday
  return day * MINUTES_PER_DAY + date.getUTCHours() * 60 + date.getUTCMinutes();
}

// Minutes from `now` until the weekly time `utcMinute` next comes round (0 if it's right now).
export function minutesUntilNext(utcMinute, now = new Date()) {
  return mod(utcMinute - utcMinuteOfWeek(now), MINUTES_PER_WEEK);
}

// Formatting follows the browser's locale, so 12/24-hour clocks and day names match the user's
// settings. Monday 1 Jan 2024 stands in for "Monday" so a minute-of-week maps to a real date.
const WEEK_START = Date.UTC(2024, 0, 1);
const asDate = (localMinute) => new Date(WEEK_START + localMinute * 60_000);

export function formatDay(localMinute, { locale, style = 'short' } = {}) {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(asDate(localMinute));
}

export function formatTime(localMinute, { locale } = {}) {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(asDate(localMinute));
}

const dayOf = (localMinute) => Math.floor(localMinute / MINUTES_PER_DAY);

// "Wed 18:00 – 19:00" in the user's zone, or "Sun 23:00 – Mon 01:00" when it runs past midnight.
// A window ending exactly at midnight reads as the same evening: "Sun 23:00 – 00:00".
export function formatWindow(startUtcMinute, durationMinutes, timeZone, { at, locale, dayStyle } = {}) {
  const start = toLocalMinute(startUtcMinute, timeZone, at);
  const end = mod(start + durationMinutes, MINUTES_PER_WEEK);
  const endsAtMidnight = end % MINUTES_PER_DAY === 0;
  const sameDay = dayOf(start) === dayOf(end) || endsAtMidnight;

  const startText = `${formatDay(start, { locale, style: dayStyle })} ${formatTime(start, { locale })}`;
  const endText = sameDay
    ? formatTime(end, { locale })
    : `${formatDay(end, { locale, style: dayStyle })} ${formatTime(end, { locale })}`;
  return `${startText} – ${endText}`;
}

// 30 -> "30 min", 60 -> "1 hour", 90 -> "1 h 30 min", 120 -> "2 hours"
export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest > 0) return `${hours} h ${rest} min`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// "in 3 hours", "in 2 days", "now"
export function formatCountdown(minutes) {
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < MINUTES_PER_DAY) {
    const hours = Math.round(minutes / 60);
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(minutes / MINUTES_PER_DAY);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// "GMT+05:30"
export function formatOffset(timeZone, at = new Date()) {
  const offset = utcOffsetMinutes(timeZone, at);
  if (offset === 0) return 'GMT';
  const sign = offset > 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

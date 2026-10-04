const { MINUTES_PER_WEEK, SLOT_MINUTES, SLOTS_PER_WEEK, DAYS_PER_WEEK } = require('./week');

const MINUTES_PER_DAY = 24 * 60;

// '16:30' -> 990 (minutes since local midnight).
function parseTimeOfDay(text) {
  const [hours, minutes] = text.split(':').map(Number);
  return hours * 60 + minutes;
}

// An IANA zone's UTC offset in minutes at a given moment: Asia/Kolkata -> 330,
// America/New_York -> -300 in winter and -240 in summer.
function utcOffsetMinutes(timeZone, at) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName').value; // "GMT+05:30", "GMT-04:00", or "GMT"
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(label);
  if (!match) throw new Error(`Unexpected offset label "${label}" for ${timeZone}`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '+' ? minutes : -minutes;
}

/**
 * The UTC slots covered by a local-time window that repeats every day, such as
 * "16:00-21:00 in Asia/Kolkata". The same hours apply to all seven days. An end at or before the
 * start crosses midnight: 21:00-01:00 runs into the next morning (and Sunday's into Monday's).
 *
 * Uses the zone's UTC offset at `at`. Like stored availability, the result is a fixed UTC pattern,
 * so in DST zones it is an hour off for part of the year (the documented DST trade-off).
 *
 * A slot counts only if the window covers all 30 minutes of it. That only matters in zones whose
 * offset isn't a multiple of 30 minutes (Asia/Kathmandu, +05:45), where the edge slots are
 * half covered.
 */
function preferredWindowSlots({ startMinuteOfDay, endMinuteOfDay, timeZone, at = new Date() }) {
  if (startMinuteOfDay === endMinuteOfDay) {
    throw new RangeError('the preferred window must not be empty');
  }
  const offset = utcOffsetMinutes(timeZone, at);
  const length = (endMinuteOfDay - startMinuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  const covered = new Uint8Array(MINUTES_PER_WEEK);
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const localStart = day * MINUTES_PER_DAY + startMinuteOfDay;
    const utcStart = (((localStart - offset) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    for (let minute = 0; minute < length; minute++) {
      covered[(utcStart + minute) % MINUTES_PER_WEEK] = 1;
    }
  }

  const slots = [];
  for (let slot = 0; slot < SLOTS_PER_WEEK; slot++) {
    const slotMinutes = covered.subarray(slot * SLOT_MINUTES, (slot + 1) * SLOT_MINUTES);
    if (slotMinutes.every((minute) => minute === 1)) slots.push(slot);
  }
  return slots;
}

module.exports = { preferredWindowSlots, utcOffsetMinutes, parseTimeOfDay };

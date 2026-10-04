// Lets the scheduling tests say 'Mon 09:00' instead of slot 18. All times are UTC.
const { SLOT_MINUTES, SLOTS_PER_WEEK } = require('../../../src/scheduling/week');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MINUTES_PER_DAY = 24 * 60;
const ALL_WEEK = Array.from({ length: SLOTS_PER_WEEK }, (_, slot) => slot);

// 'Tue 09:30' -> minutes since Monday 00:00
function minuteOf(label) {
  const match = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):(00|30)$/.exec(label);
  if (!match) throw new Error(`Bad time label: ${label}`);
  const [, day, hours, minutes] = match;
  return DAYS.indexOf(day) * MINUTES_PER_DAY + Number(hours) * 60 + Number(minutes);
}

// 570 -> 'Mon 09:30'
function labelOf(minuteOfWeek) {
  const day = DAYS[Math.floor(minuteOfWeek / MINUTES_PER_DAY)];
  const minuteOfDay = minuteOfWeek % MINUTES_PER_DAY;
  const pad = (n) => String(n).padStart(2, '0');
  return `${day} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

const slotOf = (label) => minuteOf(label) / SLOT_MINUTES;

// A stored-style availability range: range('Mon 09:00', 'Mon 10:00') -> { startMinute: 540, endMinute: 600 }.
// 'END' means Sunday 24:00 (minute 10080), the exclusive end of the week.
const range = (from, to) => ({
  startMinute: minuteOf(from),
  endMinute: to === 'END' ? SLOTS_PER_WEEK * SLOT_MINUTES : minuteOf(to),
});

// Slots from `from` up to (not including) `to`, wrapping past Sunday midnight when needed:
// slotsBetween('Sun 23:00', 'Mon 01:00') -> [334, 335, 0, 1]
function slotsBetween(from, to) {
  const slots = [];
  for (let slot = slotOf(from); slot !== slotOf(to); slot = (slot + 1) % SLOTS_PER_WEEK) {
    slots.push(slot);
  }
  return slots;
}

// The same clock window on every day of the week, e.g. dailySlots('16:00', '21:00').
function dailySlots(from, to) {
  return DAYS.flatMap((day, i) => {
    const endDay = to <= from ? DAYS[(i + 1) % DAYS.length] : day;
    return slotsBetween(`${day} ${from}`, `${endDay} ${to}`);
  });
}

// member('ana', ['Mon 09:00', 'Mon 11:00'], ['Wed 17:00', 'Wed 18:00']) - optional unless wrapped in required().
function member(id, ...ranges) {
  const freeSlots = new Set(ranges.flatMap(([from, to]) => slotsBetween(from, to)));
  return { id, name: id, required: false, freeSlots };
}

const freeAllWeek = (id) => ({ id, name: id, required: false, freeSlots: new Set(ALL_WEEK) });

const required = (m) => ({ ...m, required: true });

// Suggestions as readable [start, end] pairs for assertions.
const times = (suggestions) =>
  suggestions.map((s) => [labelOf(s.startMinuteOfWeek), labelOf(s.endMinuteOfWeek)]);

module.exports = {
  ALL_WEEK,
  minuteOf,
  labelOf,
  slotOf,
  range,
  slotsBetween,
  dailySlots,
  member,
  freeAllWeek,
  required,
  times,
};

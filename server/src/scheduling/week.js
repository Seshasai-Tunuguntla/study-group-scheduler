// The scheduling week: a circular week of half-hour slots starting Monday 00:00 UTC.
// Slot 0 = Monday 00:00-00:30 UTC, slot 335 = Sunday 23:30-24:00 UTC, then back to slot 0.

const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = 48;
const DAYS_PER_WEEK = 7;
const SLOTS_PER_WEEK = SLOTS_PER_DAY * DAYS_PER_WEEK; // 336
const MINUTES_PER_WEEK = SLOTS_PER_WEEK * SLOT_MINUTES; // 10080

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;

module.exports = {
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  DAYS_PER_WEEK,
  SLOTS_PER_WEEK,
  MINUTES_PER_WEEK,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
};

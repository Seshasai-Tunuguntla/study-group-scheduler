const { SLOT_MINUTES, SLOTS_PER_WEEK } = require('./week');

// Who is free for the whole of one fixed window (e.g. the confirmed session) and who isn't.
// Same member shape as suggestWindows. It checks a single window, so a direct slot-by-slot
// check is simplest; the prefix sums in suggestWindows pay off only when scanning all 336 starts.
function whoCanAttend({ members, startMinute, durationMinutes }) {
  const firstSlot = startMinute / SLOT_MINUTES;
  const windowSlots = Array.from(
    { length: durationMinutes / SLOT_MINUTES },
    (_, i) => (firstSlot + i) % SLOTS_PER_WEEK
  );

  const attendees = [];
  const missing = [];
  for (const member of members) {
    const free = new Set(member.freeSlots);
    (windowSlots.every((slot) => free.has(slot)) ? attendees : missing).push(member.id);
  }
  return { attendees, missing };
}

module.exports = { whoCanAttend };

const {
  SLOT_MINUTES,
  SLOTS_PER_WEEK,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
} = require('./week');

const DEFAULT_LIMIT = 3;
// A window only one person can make isn't a meeting. Callers can pass minAttendees: 1 explicitly.
const DEFAULT_MIN_ATTENDEES = 2;

/*
 * How "can this member attend the window starting at slot s?" is answered in O(1):
 *
 * Each member's week becomes a running total (prefix sum) of free slots:
 * prefix[i] = how many of the first i slots are free. The number of free slots
 * in s..s+k-1 is then prefix[s+k] - prefix[s], and the member can attend
 * exactly when that equals k. The week is laid out twice before summing, so a
 * window that runs past Sunday 23:30 just reads on into the second copy and
 * wraps into Monday without any special case.
 *
 * Cost: building the sums is O(slots) per member, then each of the 336 windows
 * costs O(1) per member, so O(slots x members) overall. Checking every slot of
 * every window would be O(slots x members x k). With k <= 8 that is at most 8x
 * slower, but prefix sums also keep the cost independent of meeting length,
 * handle the wrap for free, and the same trick scores overlap with the
 * preferred window. (A 336-bit BigInt mask per member would also work, but is
 * harder to read and BigInt operations are slow in JS.)
 */

/**
 * Finds the best weekly meeting windows for a group.
 *
 * @param {object} input
 * @param {{ id: *, required: boolean, freeSlots: Iterable<number> }[]} input.members
 *   freeSlots are UTC slot indexes (see week.js), as a Set or an array.
 * @param {number} input.durationMinutes multiple of 30, from 30 to 240
 * @param {number} [input.limit=3] maximum number of suggestions
 * @param {number} [input.minAttendees=2] windows with fewer attendees are dropped
 * @param {Iterable<number>} [input.preferredSlots] UTC slot indexes the organizer prefers
 * @returns {{ startMinuteOfWeek: number, endMinuteOfWeek: number, attendees: Array,
 *   missing: Array, preferredMinutes: number }[]}
 *   Best first and never overlapping each other. attendees/missing keep the input member order.
 *   endMinuteOfWeek wraps like the week does, so a window running into Monday has end <= start.
 */
function suggestWindows({
  members,
  durationMinutes,
  limit = DEFAULT_LIMIT,
  minAttendees = DEFAULT_MIN_ATTENDEES,
  preferredSlots = [],
}) {
  validateOptions({ members, durationMinutes, limit, minAttendees });

  const k = durationMinutes / SLOT_MINUTES;
  const freePrefix = members.map((member) =>
    doubledPrefixSums(toSlotMask(member.freeSlots, `member ${member.id} freeSlots`))
  );
  const preferredPrefix = doubledPrefixSums(toSlotMask(preferredSlots, 'preferredSlots'));
  const countInWindow = (prefix, start) => prefix[start + k] - prefix[start];

  const candidates = [];
  for (let start = 0; start < SLOTS_PER_WEEK; start++) {
    const attendees = [];
    const missing = [];
    let requiredMemberMissing = false;

    members.forEach((member, i) => {
      if (countInWindow(freePrefix[i], start) === k) {
        attendees.push(member.id);
      } else {
        missing.push(member.id);
        if (member.required) requiredMemberMissing = true;
      }
    });

    if (requiredMemberMissing || attendees.length < minAttendees) continue;
    candidates.push({
      start,
      attendees,
      missing,
      preferredSlotCount: countInWindow(preferredPrefix, start),
    });
  }

  // Start slots are unique, so this is a total order: the same input always gives the same output.
  candidates.sort(
    (a, b) =>
      b.attendees.length - a.attendees.length ||
      b.preferredSlotCount - a.preferredSlotCount ||
      a.start - b.start
  );

  // Greedy: take the best remaining window that doesn't overlap one already taken, so the
  // suggestions are genuinely different options, not the same window shifted by 30 minutes.
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length === limit) break;
    if (picked.every((p) => !windowsOverlap(p.start, candidate.start, k))) picked.push(candidate);
  }

  return picked.map((c) => ({
    startMinuteOfWeek: c.start * SLOT_MINUTES,
    endMinuteOfWeek: ((c.start + k) % SLOTS_PER_WEEK) * SLOT_MINUTES,
    attendees: c.attendees,
    missing: c.missing,
    preferredMinutes: c.preferredSlotCount * SLOT_MINUTES,
  }));
}

// Two windows of the same length k overlap when one starts less than k slots after the other,
// measured forwards around the circular week. Comparing raw start indexes would miss the wrap:
// starts 334 and 0 are only 2 slots apart.
function windowsOverlap(startA, startB, k) {
  const forward = (startB - startA + SLOTS_PER_WEEK) % SLOTS_PER_WEEK;
  return forward < k || SLOTS_PER_WEEK - forward < k;
}

// prefix[i] = number of free slots among the first i slots of the week laid out twice in a row.
function doubledPrefixSums(mask) {
  const prefix = new Uint16Array(2 * SLOTS_PER_WEEK + 1);
  for (let i = 0; i < 2 * SLOTS_PER_WEEK; i++) {
    prefix[i + 1] = prefix[i] + mask[i % SLOTS_PER_WEEK];
  }
  return prefix;
}

function toSlotMask(slots, label) {
  const mask = new Uint8Array(SLOTS_PER_WEEK);
  for (const slot of slots) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_WEEK) {
      throw new RangeError(
        `${label} has an invalid slot index: ${show(slot)} (expected 0-${SLOTS_PER_WEEK - 1})`
      );
    }
    mask[slot] = 1;
  }
  return mask;
}

function validateOptions({ members, durationMinutes, limit, minAttendees }) {
  if (!Array.isArray(members)) {
    throw new TypeError('members must be an array');
  }
  if (!Number.isInteger(durationMinutes)) {
    throw new TypeError(`durationMinutes must be a whole number of minutes, got ${show(durationMinutes)}`);
  }
  if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    throw new RangeError(
      `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}, got ${durationMinutes}`
    );
  }
  if (durationMinutes % SLOT_MINUTES !== 0) {
    throw new RangeError(`durationMinutes must be a multiple of ${SLOT_MINUTES}, got ${durationMinutes}`);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive whole number, got ${show(limit)}`);
  }
  if (!Number.isInteger(minAttendees) || minAttendees < 1) {
    throw new RangeError(`minAttendees must be a positive whole number, got ${show(minAttendees)}`);
  }
}

const show = (value) => (typeof value === 'string' ? `"${value}"` : String(value));

module.exports = { suggestWindows, DEFAULT_LIMIT, DEFAULT_MIN_ATTENDEES };

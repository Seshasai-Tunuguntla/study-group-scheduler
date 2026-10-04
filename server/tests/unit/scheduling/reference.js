// Test-only oracles for the scheduling algorithm.
const { SLOT_MINUTES, SLOTS_PER_WEEK } = require('../../../src/scheduling/week');

// Deliberately naive version of suggestWindows: checks every slot of every window and detects
// overlap by comparing slot sets instead of start distances. Slow, but obviously correct, so the
// fast prefix-sum version can be checked against it on many random inputs.
function referenceSuggest({ members, durationMinutes, limit = 3, minAttendees = 2, preferredSlots = [] }) {
  const k = durationMinutes / SLOT_MINUTES;
  const preferred = new Set(preferredSlots);

  const candidates = [];
  for (let start = 0; start < SLOTS_PER_WEEK; start++) {
    const slots = windowSlots(start * SLOT_MINUTES, durationMinutes);
    const canAttend = members.filter((m) => slots.every((slot) => m.freeSlots.has(slot)));
    const cannot = members.filter((m) => !canAttend.includes(m));
    if (cannot.some((m) => m.required) || canAttend.length < minAttendees) continue;

    candidates.push({
      start,
      slots,
      attendees: canAttend.map((m) => m.id),
      missing: cannot.map((m) => m.id),
      preferred: slots.filter((slot) => preferred.has(slot)).length,
    });
  }

  candidates.sort(
    (a, b) =>
      b.attendees.length - a.attendees.length || b.preferred - a.preferred || a.start - b.start
  );

  const usedSlots = new Set();
  const picked = [];
  for (const c of candidates) {
    if (picked.length === limit) break;
    if (c.slots.some((slot) => usedSlots.has(slot))) continue;
    c.slots.forEach((slot) => usedSlots.add(slot));
    picked.push(c);
  }

  return picked.map((c) => ({
    startMinuteOfWeek: c.start * SLOT_MINUTES,
    endMinuteOfWeek: ((c.start + k) % SLOTS_PER_WEEK) * SLOT_MINUTES,
    attendees: c.attendees,
    missing: c.missing,
    preferredMinutes: c.preferred * SLOT_MINUTES,
  }));
}

// The slot indexes a window covers, wrapping past the end of the week.
function windowSlots(startMinuteOfWeek, durationMinutes) {
  const first = startMinuteOfWeek / SLOT_MINUTES;
  return Array.from({ length: durationMinutes / SLOT_MINUTES }, (_, j) => (first + j) % SLOTS_PER_WEEK);
}

// Small seeded PRNG (mulberry32) so "random" tests are reproducible: a failing seed always fails.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2-6 members, each free in several random blocks (some wrapping past Sunday midnight).
function randomGroup(rand, { requiredChance = 0 } = {}) {
  const size = 2 + Math.floor(rand() * 5);
  return Array.from({ length: size }, (_, i) => {
    const freeSlots = new Set();
    const blocks = 4 + Math.floor(rand() * 9);
    for (let b = 0; b < blocks; b++) {
      const start = Math.floor(rand() * SLOTS_PER_WEEK);
      const length = 2 + Math.floor(rand() * 23);
      for (let j = 0; j < length; j++) freeSlots.add((start + j) % SLOTS_PER_WEEK);
    }
    return { id: `m${i}`, name: `m${i}`, required: rand() < requiredChance, freeSlots };
  });
}

module.exports = { referenceSuggest, windowSlots, seededRandom, randomGroup };

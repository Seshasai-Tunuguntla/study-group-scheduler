const { MINUTES_PER_WEEK, SLOT_MINUTES } = require('./week');

// Availability is stored as ranges of UTC minutes-of-week, end exclusive, that never wrap.
// Clients may send a range that runs past Sunday midnight (end <= start); it is split here.

class RangeOverlapError extends Error {
  constructor(a, b) {
    super(`ranges overlap: [${a.startMinute}, ${a.endMinute}) and [${b.startMinute}, ${b.endMinute})`);
    this.name = 'RangeOverlapError';
  }
}

// [10020, 60) (Sunday 23:00 - Monday 01:00) -> [10020, 10080) + [0, 60).
// An end of 0 means "until Monday 00:00", so nothing is added on the Monday side.
function splitAtWeekEnd({ startMinute, endMinute }) {
  if (endMinute > startMinute) return [{ startMinute, endMinute }];

  const pieces = [{ startMinute, endMinute: MINUTES_PER_WEEK }];
  if (endMinute > 0) pieces.push({ startMinute: 0, endMinute });
  return pieces;
}

// Turns a client's ranges into the stored form: wrap-arounds split, sorted by start, touching
// ranges merged ([540, 600) + [600, 660) -> [540, 660)). Throws RangeOverlapError if any two
// overlap, since that means the client's data is inconsistent. Ranges are not merged across the
// week boundary: [..., 10080) and [0, ...) stay two rows. Does not modify its input.
function normalizeRanges(ranges) {
  const pieces = ranges.flatMap(splitAtWeekEnd).sort((a, b) => a.startMinute - b.startMinute);

  const merged = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && piece.startMinute < last.endMinute) throw new RangeOverlapError(last, piece);
    if (last && piece.startMinute === last.endMinute) {
      last.endMinute = piece.endMinute;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}

// Stored (non-wrapping) ranges -> the UTC slot indexes they cover, for the heatmap and scheduler.
function rangesToSlots(ranges) {
  const slots = [];
  for (const { startMinute, endMinute } of ranges) {
    for (let minute = startMinute; minute < endMinute; minute += SLOT_MINUTES) {
      slots.push(minute / SLOT_MINUTES);
    }
  }
  return slots;
}

module.exports = { normalizeRanges, splitAtWeekEnd, rangesToSlots, RangeOverlapError };

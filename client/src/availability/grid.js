// Pure logic behind the availability grid: no React, no DOM, so it's all unit tested.
//
// A selection is a Set of UTC slot indexes (0 = Monday 00:00-00:30 UTC, 335 = Sunday 23:30 UTC),
// the same slots the server schedules with. The grid only decides where each slot is *drawn*:
// in which local day column and local time row, for the user's time zone.

import { MINUTES_PER_DAY, MINUTES_PER_WEEK, SLOT_MINUTES, utcOffsetMinutes } from '../time/week';

export const DAYS_PER_WEEK = 7;
export const ROWS_PER_DAY = MINUTES_PER_DAY / SLOT_MINUTES; // 48
export const SLOTS_PER_WEEK = MINUTES_PER_WEEK / SLOT_MINUTES; // 336

const mod = (n, m) => ((n % m) + m) % m;

/**
 * Lays the 336 UTC slots out as a local week: 7 columns (local Monday to Sunday) x 48 rows.
 * Every cell is exactly one UTC slot, so nothing is lost or doubled in any zone:
 * - Local Monday needn't start at UTC Monday: in Asia/Kolkata the first cell (Mon 00:00 local)
 *   is UTC slot 325 (Sunday 18:30 UTC).
 * - In zones whose offset isn't a multiple of 30 minutes (Asia/Kathmandu, +05:45), the UTC
 *   half hours fall at :15 and :45 local time, so the rows are labelled 00:15, 00:45, ...
 * Uses the zone's offset at `at` (the documented DST trade-off, as everywhere else).
 */
export function buildWeekGrid(timeZone, at = new Date()) {
  const offset = utcOffsetMinutes(timeZone, at);
  // How far past :00/:30 each row starts in local time: 0 in most zones, 15 for +05:45.
  const rowShift = mod(offset, SLOT_MINUTES);

  return {
    timeZone,
    offset,
    rowShift,
    // The UTC slot drawn at local (day, row).
    slotAt(day, row) {
      const localStart = day * MINUTES_PER_DAY + row * SLOT_MINUTES + rowShift;
      return mod(localStart - offset, MINUTES_PER_WEEK) / SLOT_MINUTES;
    },
    // Where a UTC slot is drawn: the local day and row its start falls in.
    cellOf(slot) {
      const localStart = mod(slot * SLOT_MINUTES + offset, MINUTES_PER_WEEK);
      return {
        day: Math.floor(localStart / MINUTES_PER_DAY),
        row: Math.floor((localStart % MINUTES_PER_DAY) / SLOT_MINUTES),
      };
    },
    // Local start of a row, in minutes since midnight (for its label).
    rowStartMinute(row) {
      return row * SLOT_MINUTES + rowShift;
    },
  };
}

// Stored ranges ([{ startMinute, endMinute }], UTC, end exclusive) -> Set of UTC slots.
export function slotsFromRanges(ranges) {
  const slots = new Set();
  for (const { startMinute, endMinute } of ranges) {
    for (let minute = startMinute; minute < endMinute; minute += SLOT_MINUTES) {
      slots.add(minute / SLOT_MINUTES);
    }
  }
  return slots;
}

// Set of UTC slots -> the fewest ranges covering them, sorted, never wrapping past the end of the
// week (the server's stored form): slots {334, 335, 0, 1} -> [0, 60) and [10020, 10080).
export function rangesFromSlots(slots) {
  const sorted = [...slots].sort((a, b) => a - b);
  const ranges = [];
  for (const slot of sorted) {
    const last = ranges.at(-1);
    if (last && last.endMinute === slot * SLOT_MINUTES) {
      last.endMinute += SLOT_MINUTES;
    } else {
      ranges.push({ startMinute: slot * SLOT_MINUTES, endMinute: (slot + 1) * SLOT_MINUTES });
    }
  }
  return ranges;
}

export function sameSlots(a, b) {
  if (a.size !== b.size) return false;
  for (const slot of a) if (!b.has(slot)) return false;
  return true;
}

// The first cell pressed decides what a drag does: starting on a free cell clears, starting on
// an empty one marks free. So one drag never flips cells in both directions.
export function dragMode(selection, slot) {
  return selection.has(slot) ? 'remove' : 'add';
}

// The UTC slots in the rectangle between two cells (inclusive), whichever way the drag went.
export function slotsInRectangle(grid, from, to) {
  const slots = [];
  for (let day = Math.min(from.day, to.day); day <= Math.max(from.day, to.day); day++) {
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
      slots.push(grid.slotAt(day, row));
    }
  }
  return slots;
}

// A new selection with `slots` added or removed. Never modifies `selection`.
export function applyToSlots(selection, slots, mode) {
  const next = new Set(selection);
  for (const slot of slots) {
    if (mode === 'add') next.add(slot);
    else next.delete(slot);
  }
  return next;
}

export function toggleSlot(selection, slot) {
  return applyToSlots(selection, [slot], dragMode(selection, slot));
}

// Copies one local day's pattern onto other local days, replacing what they had.
// Defaults: Monday onto Tuesday-Friday.
export function copyDay(selection, grid, fromDay = 0, toDays = [1, 2, 3, 4]) {
  const next = new Set(selection);
  for (let row = 0; row < ROWS_PER_DAY; row++) {
    const free = selection.has(grid.slotAt(fromDay, row));
    for (const day of toDays) {
      const slot = grid.slotAt(day, row);
      if (free) next.add(slot);
      else next.delete(slot);
    }
  }
  return next;
}

// Arrow-key movement around the grid, stopping at the edges.
export function moveCell({ day, row }, key) {
  const clamp = (n, max) => Math.min(Math.max(n, 0), max);
  switch (key) {
    case 'ArrowUp':
      return { day, row: clamp(row - 1, ROWS_PER_DAY - 1) };
    case 'ArrowDown':
      return { day, row: clamp(row + 1, ROWS_PER_DAY - 1) };
    case 'ArrowLeft':
      return { day: clamp(day - 1, DAYS_PER_WEEK - 1), row };
    case 'ArrowRight':
      return { day: clamp(day + 1, DAYS_PER_WEEK - 1), row };
    default:
      return { day, row };
  }
}

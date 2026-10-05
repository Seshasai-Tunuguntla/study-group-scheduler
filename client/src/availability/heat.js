// Pure helpers for the group heatmap: no React, no DOM.
import { SLOT_MINUTES } from '../time/week';
import { SLOTS_PER_WEEK } from './grid';

// Brightness step for a free count, out of the members who have replied (never-saved members
// aren't counted, so they never make a slot look busier). 0 = nobody, 4 = everyone who replied,
// 1-3 in between. The steps get monotonically brighter, so they read without relying on hue.
export function heatLevel(count, responded) {
  if (count <= 0 || responded <= 0) return 0;
  if (count >= responded) return 4;
  return Math.max(1, Math.min(3, Math.ceil((count / responded) * 3)));
}

// The legend: which counts each brightness step stands for, out of `responded` members.
// Small groups get one swatch per count; bigger ones group counts by step ("2-4").
export function legendSteps(responded) {
  const counts = Array.from({ length: responded + 1 }, (_, count) => count);
  if (responded <= 6) return counts.map((count) => ({ level: heatLevel(count, responded), label: String(count) }));

  const byLevel = new Map();
  for (const count of counts) {
    const level = heatLevel(count, responded);
    byLevel.set(level, [...(byLevel.get(level) ?? []), count]);
  }
  return [...byLevel].map(([level, group]) => ({
    level,
    label: group.length === 1 ? String(group[0]) : `${group[0]}–${group.at(-1)}`,
  }));
}

// The UTC slots a window covers, wrapping past the end of the week.
export function slotsOfWindow(startMinute, durationMinutes) {
  const first = startMinute / SLOT_MINUTES;
  return Array.from({ length: durationMinutes / SLOT_MINUTES }, (_, i) => (first + i) % SLOTS_PER_WEEK);
}

// Where to draw each suggestion on the heatmap: the rank (1, 2, 3) on its first slot, and the
// set of all slots each one covers.
export function pickMarks(suggestions) {
  const rankAt = new Map();
  const covered = new Map();
  suggestions.forEach((suggestion, index) => {
    const slots = slotsOfWindow(suggestion.startMinute, suggestion.durationMinutes);
    rankAt.set(slots[0], index + 1);
    for (const slot of slots) if (!covered.has(slot)) covered.set(slot, index + 1);
  });
  return { rankAt, covered };
}

// Who is free in one slot, among the members who have replied, in the members' order.
export function slotPeople(freeIds, respondedMembers) {
  const free = new Set(freeIds);
  return {
    free: respondedMembers.filter((member) => free.has(member.userId)),
    notFree: respondedMembers.filter((member) => !free.has(member.userId)),
  };
}

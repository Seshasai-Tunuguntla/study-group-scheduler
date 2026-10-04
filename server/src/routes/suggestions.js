const express = require('express');
const prisma = require('../prismaClient');
const { suggestionsQuerySchema } = require('../validation/schemas');
const { suggestWindows } = require('../scheduling/suggestWindows');
const { preferredWindowSlots, parseTimeOfDay } = require('../scheduling/preferredWindow');
const {
  loadMembersWithAvailability,
  splitByResponse,
  toSchedulingMember,
} = require('../services/memberAvailability');
const { toPerson } = require('../serializers');

// Mounted at /api/groups/:id/suggestions behind requireAuth and requireMembership.
const router = express.Router();

// Why `suggestions` is empty, so the client can show the right next step:
//   not_enough_members    -> the group has fewer members than minAttendees: invite people
//   waiting_for_responses -> enough members, but too few have saved availability yet
//   no_common_time        -> everyone needed has responded and no window works
const REASONS = {
  NOT_ENOUGH_MEMBERS: 'not_enough_members',
  WAITING_FOR_RESPONSES: 'waiting_for_responses',
  NO_COMMON_TIME: 'no_common_time',
};

async function loadPreferredWindow(userId, { preferredStart, preferredEnd }) {
  if (preferredStart === undefined) return { preferredWindow: null, preferredSlots: [] };

  // The requesting user's own zone: "16:00" means 16:00 where the person asking lives.
  const { timeZone } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  return {
    preferredWindow: { start: preferredStart, end: preferredEnd, timeZone },
    preferredSlots: preferredWindowSlots({
      startMinuteOfDay: parseTimeOfDay(preferredStart),
      endMinuteOfDay: parseTimeOfDay(preferredEnd),
      timeZone,
    }),
  };
}

router.get('/', async (req, res) => {
  const query = suggestionsQuerySchema.parse(req.query);
  const memberships = await loadMembersWithAvailability(req.membership.groupId);
  const { responded, waitingOn } = splitByResponse(memberships);
  const { preferredWindow, preferredSlots } = await loadPreferredWindow(req.user.id, query);

  const respond = (suggestions, reason) =>
    res.json({
      suggestions,
      reason,
      waitingOn: waitingOn.map(toPerson),
      // Suggestions may change once the members in waitingOn save their availability.
      mayChange: waitingOn.length > 0,
      durationMinutes: query.duration,
      preferredWindow,
    });

  if (memberships.length < query.minAttendees) return respond([], REASONS.NOT_ENOUGH_MEMBERS);
  if (responded.length < query.minAttendees) return respond([], REASONS.WAITING_FOR_RESPONSES);

  const windows = suggestWindows({
    members: responded.map(toSchedulingMember),
    durationMinutes: query.duration,
    limit: query.limit,
    minAttendees: query.minAttendees,
    preferredSlots,
  });

  const people = new Map(memberships.map((m) => [m.user.id, toPerson(m)]));
  const suggestions = windows.map((window) => ({
    startMinute: window.startMinuteOfWeek,
    endMinute: window.endMinuteOfWeek,
    durationMinutes: query.duration,
    attendees: window.attendees.map((id) => people.get(id)),
    missing: window.missing.map((id) => people.get(id)),
    preferredMinutes: window.preferredMinutes,
  }));

  respond(suggestions, suggestions.length > 0 ? null : REASONS.NO_COMMON_TIME);
});

module.exports = router;

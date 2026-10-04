const express = require('express');
const prisma = require('../prismaClient');
const { requireOrganizer } = require('../middleware/membership');
const { confirmSessionSchema } = require('../validation/schemas');
const { whoCanAttend } = require('../scheduling/attendance');
const { MINUTES_PER_WEEK } = require('../scheduling/week');
const {
  loadMembersWithAvailability,
  splitByResponse,
  toSchedulingMember,
} = require('../services/memberAvailability');
const { toPerson } = require('../serializers');
const { HttpError } = require('../utils/httpError');

// Mounted at /api/groups/:id/session behind requireAuth and requireMembership.
// Any member can read the session; only the organizer can confirm or clear it.
const router = express.Router();

async function loadSession(groupId) {
  const session = await prisma.session.findUnique({
    where: { groupId },
    include: { confirmedBy: { select: { id: true, name: true } } },
  });
  if (!session) return null;

  // Recalculated on every request from current availability, so it reflects changes members
  // made after the session was confirmed.
  const memberships = await loadMembersWithAvailability(groupId);
  const { responded, waitingOn } = splitByResponse(memberships);
  const { attendees, missing } = whoCanAttend({
    members: responded.map(toSchedulingMember),
    startMinute: session.startMinute,
    durationMinutes: session.durationMinutes,
  });
  const people = new Map(memberships.map((m) => [m.user.id, toPerson(m)]));

  return {
    startMinute: session.startMinute,
    // Wraps like the week: a session running into Monday has endMinute <= startMinute.
    endMinute: (session.startMinute + session.durationMinutes) % MINUTES_PER_WEEK,
    durationMinutes: session.durationMinutes,
    confirmedAt: session.confirmedAt,
    confirmedBy: { userId: session.confirmedBy.id, name: session.confirmedBy.name },
    attendance: {
      attendees: attendees.map((id) => people.get(id)),
      missing: missing.map((id) => people.get(id)),
      waitingOn: waitingOn.map(toPerson),
    },
  };
}

router.get('/', async (req, res) => {
  res.json({ session: await loadSession(req.membership.groupId) });
});

router.post('/', requireOrganizer, async (req, res) => {
  const { startMinute, durationMinutes } = confirmSessionSchema.parse(req.body);
  const { groupId } = req.membership;
  const fields = { startMinute, durationMinutes, confirmedById: req.user.id, confirmedAt: new Date() };

  // groupId is unique, so confirming again replaces the group's session rather than adding one.
  await prisma.session.upsert({
    where: { groupId },
    create: { groupId, ...fields },
    update: fields,
  });

  res.json({ session: await loadSession(groupId) });
});

router.delete('/', requireOrganizer, async (req, res) => {
  const { count } = await prisma.session.deleteMany({ where: { groupId: req.membership.groupId } });
  if (count === 0) throw new HttpError(404, 'This group has no confirmed session');

  res.status(204).end();
});

module.exports = router;

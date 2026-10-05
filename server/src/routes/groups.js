const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { requireMembership, requireOrganizer } = require('../middleware/membership');
const { joinLimiter } = require('../middleware/rateLimit');
const {
  createGroupSchema,
  joinGroupSchema,
  memberParamsSchema,
  updateMemberSchema,
} = require('../validation/schemas');
const joinCodes = require('../utils/joinCode');
const { isUniqueViolation } = require('../utils/prismaErrors');
const { HttpError } = require('../utils/httpError');
const { memberInclude, memberOrder, toMember, toSession } = require('../serializers');
const { isDemoEmail } = require('../demo/demo');
const availabilityRoutes = require('./availability');
const suggestionRoutes = require('./suggestions');
const sessionRoutes = require('./session');

const router = express.Router();
router.use(requireAuth);

const MAX_JOIN_CODE_ATTEMPTS = 5;

// The join code is only shown to the organizer, who decides who gets invited.
const visibleJoinCode = (group, viewerRole) => (viewerRole === 'ORGANIZER' ? group.joinCode : null);

async function loadGroupDetails(groupId, viewer) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      session: true,
      memberships: { include: memberInclude, orderBy: memberOrder },
    },
  });

  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    joinCode: visibleJoinCode(group, viewer.role),
    myRole: viewer.role,
    members: group.memberships.map(toMember),
    session: toSession(group.session),
  };
}

// A clash among ~852 billion codes is astronomically unlikely, but the unique index is the real
// guarantee: if it rejects a code, draw another and try again.
async function createWithUniqueJoinCode(create) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create(joinCodes.generateJoinCode());
    } catch (err) {
      if (!isUniqueViolation(err, 'joinCode') || attempt === MAX_JOIN_CODE_ATTEMPTS) throw err;
    }
  }
}

router.post('/', async (req, res) => {
  const { name } = createGroupSchema.parse(req.body);

  // One nested create = one transaction: the group never exists without its organizer.
  const group = await createWithUniqueJoinCode((joinCode) =>
    prisma.group.create({
      data: {
        name,
        joinCode,
        createdById: req.user.id,
        memberships: { create: { userId: req.user.id, role: 'ORGANIZER' } },
      },
      include: { memberships: true },
    })
  );

  res.status(201).json({ group: await loadGroupDetails(group.id, group.memberships[0]) });
});

router.get('/', async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id },
    include: { group: { include: { session: true, _count: { select: { memberships: true } } } } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });

  res.json({
    groups: memberships.map(({ group, role, required, availabilityUpdatedAt }) => ({
      id: group.id,
      name: group.name,
      myRole: role,
      required,
      // Mine, so the dashboard can nudge me to fill in availability.
      availabilityUpdatedAt,
      memberCount: group._count.memberships,
      joinCode: visibleJoinCode(group, role),
      session: toSession(group.session),
    })),
  });
});

// The demo is a closed world: its accounts stay in demo groups and nobody else gets in, so a demo
// reset (which deletes and rebuilds demo groups) can never touch a real user's data.
router.post('/join', joinLimiter, async (req, res) => {
  const { joinCode } = joinGroupSchema.parse(req.body);

  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
  if (!me) throw new HttpError(401, 'User no longer exists');
  if (isDemoEmail(me.email)) {
    throw new HttpError(403, "Demo accounts can't join other groups. Create your own account to try joining one.");
  }

  const group = await prisma.group.findUnique({
    where: { joinCode },
    include: { createdBy: { select: { email: true } } },
  });
  if (!group) throw new HttpError(404, 'No group has that join code');
  if (isDemoEmail(group.createdBy.email)) {
    throw new HttpError(403, 'That join code belongs to the demo, which nobody can join. Create your own group to try inviting people.');
  }

  let membership;
  try {
    membership = await prisma.membership.create({ data: { userId: req.user.id, groupId: group.id } });
  } catch (err) {
    if (isUniqueViolation(err, 'userId')) throw new HttpError(409, "You're already a member of this group");
    throw err;
  }

  res.status(201).json({ group: await loadGroupDetails(group.id, membership) });
});

router.get('/:id', requireMembership, async (req, res) => {
  res.json({ group: await loadGroupDetails(req.membership.groupId, req.membership) });
});

router.patch('/:id/members/:userId', requireMembership, requireOrganizer, async (req, res) => {
  const { userId } = memberParamsSchema.parse(req.params);
  // Only `required` is read from the body, so a request can't also change role or group.
  const { required } = updateMemberSchema.parse(req.body);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId, groupId: req.membership.groupId } },
  });
  if (!target) throw new HttpError(404, "That user isn't a member of this group");

  const updated = await prisma.membership.update({
    where: { id: target.id },
    data: { required },
    include: memberInclude,
  });
  res.json({ member: toMember(updated) });
});

// The organizer removes someone, or a member leaves (removes themselves).
router.delete('/:id/members/:userId', requireMembership, async (req, res) => {
  const { userId } = memberParamsSchema.parse(req.params);
  const removingSelf = userId === req.user.id;

  if (req.membership.role === 'ORGANIZER') {
    // There's no way to hand the group over yet, so leaving would orphan it.
    if (removingSelf) throw new HttpError(409, "Organizers can't leave their own group");
  } else if (!removingSelf) {
    throw new HttpError(403, 'Only the organizer can remove other members');
  }

  // Their availability ranges go with the membership (onDelete: Cascade).
  const { count } = await prisma.membership.deleteMany({
    where: { userId, groupId: req.membership.groupId },
  });
  if (count === 0) throw new HttpError(404, "That user isn't a member of this group");

  res.status(204).end();
});

router.use('/:id/availability', requireMembership, availabilityRoutes);
router.use('/:id/suggestions', requireMembership, suggestionRoutes);
router.use('/:id/session', requireMembership, sessionRoutes);

module.exports = router;

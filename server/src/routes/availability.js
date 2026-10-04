const express = require('express');
const prisma = require('../prismaClient');
const { replaceAvailabilitySchema } = require('../validation/schemas');
const { rangesToSlots } = require('../scheduling/ranges');
const { SLOTS_PER_WEEK } = require('../scheduling/week');
const { memberInclude, memberOrder, toMember } = require('../serializers');

// Mounted at /api/groups/:id/availability behind requireAuth and requireMembership, so
// req.membership is always the caller's own membership in this group: nobody can write
// anyone else's availability.
const router = express.Router();

const rangeFields = { startMinute: true, endMinute: true };

// Replaces the caller's availability for this group.
router.put('/', async (req, res) => {
  const { ranges } = replaceAvailabilitySchema.parse(req.body);
  const membershipId = req.membership.id;

  // One transaction, so a failed insert can't leave the member with their old ranges deleted.
  // The membership update runs first on purpose: it row-locks the membership, so a second save
  // by the same member waits for this one to commit instead of interleaving with it. The stored
  // ranges are then always exactly one request's, never a mix of two.
  // Saving an empty list still sets availabilityUpdatedAt: "saved, never free" is not "never saved".
  const [membership] = await prisma.$transaction([
    prisma.membership.update({
      where: { id: membershipId },
      data: { availabilityUpdatedAt: new Date() },
    }),
    prisma.availabilityRange.deleteMany({ where: { membershipId } }),
    prisma.availabilityRange.createMany({
      data: ranges.map((range) => ({ ...range, membershipId })),
    }),
  ]);

  res.json({ ranges, availabilityUpdatedAt: membership.availabilityUpdatedAt });
});

// The group heatmap: who is free in each UTC slot, plus the caller's own ranges so the
// availability grid can be pre-filled from the same request.
router.get('/', async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { groupId: req.membership.groupId },
    include: {
      ...memberInclude,
      availability: { select: rangeFields, orderBy: { startMinute: 'asc' } },
    },
    orderBy: memberOrder,
  });

  // slots[i] = user ids of the members free in UTC slot i (slot 0 = Monday 00:00-00:30 UTC).
  // The free count for a slot is slots[i].length; names come from `members`.
  const slots = Array.from({ length: SLOTS_PER_WEEK }, () => []);
  for (const membership of memberships) {
    for (const slot of rangesToSlots(membership.availability)) {
      slots[slot].push(membership.user.id);
    }
  }

  const mine = memberships.find((membership) => membership.id === req.membership.id);

  res.json({
    members: memberships.map(toMember),
    slots,
    myRanges: mine.availability,
  });
});

module.exports = router;

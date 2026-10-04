// Loads a group's members with their availability, in the shapes the heatmap, suggestions and
// session routes need.
const prisma = require('../prismaClient');
const { rangesToSlots } = require('../scheduling/ranges');
const { memberInclude, memberOrder } = require('../serializers');

function loadMembersWithAvailability(groupId) {
  return prisma.membership.findMany({
    where: { groupId },
    include: {
      ...memberInclude,
      availability: { select: { startMinute: true, endMinute: true }, orderBy: { startMinute: 'asc' } },
    },
    orderBy: memberOrder,
  });
}

// "Never saved" (availabilityUpdatedAt is null) means hasn't responded yet: those members are left
// out of scheduling entirely, including the required check, and reported as waitingOn instead.
// A member who saved an empty schedule has responded and follows the normal rules.
function splitByResponse(memberships) {
  return {
    responded: memberships.filter((m) => m.availabilityUpdatedAt !== null),
    waitingOn: memberships.filter((m) => m.availabilityUpdatedAt === null),
  };
}

// The member shape suggestWindows and whoCanAttend take.
const toSchedulingMember = (membership) => ({
  id: membership.user.id,
  required: membership.required,
  freeSlots: rangesToSlots(membership.availability),
});

module.exports = { loadMembersWithAvailability, splitByResponse, toSchedulingMember };

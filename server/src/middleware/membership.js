const prisma = require('../prismaClient');
const { HttpError } = require('../utils/httpError');
const { groupParamsSchema } = require('../validation/schemas');

// Loads the caller's membership in group :id into req.membership, or stops the request:
// 404 if the group doesn't exist, 403 if it does but the caller isn't in it.
// Every /api/groups/:id route runs this, so no handler can forget the check.
async function requireMembership(req, res, next) {
  const { id: groupId } = groupParamsSchema.parse(req.params);

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: req.user.id, groupId } },
  });
  if (!membership) {
    const groupExists = (await prisma.group.count({ where: { id: groupId } })) > 0;
    throw groupExists
      ? new HttpError(403, 'You are not a member of this group')
      : new HttpError(404, 'Group not found');
  }

  req.membership = membership;
  next();
}

// Must run after requireMembership. The role comes from the database on every request,
// never from the token.
function requireOrganizer(req, res, next) {
  if (req.membership.role !== 'ORGANIZER') {
    throw new HttpError(403, 'Only the organizer can do that');
  }
  next();
}

module.exports = { requireMembership, requireOrganizer };

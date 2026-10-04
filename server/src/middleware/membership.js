const prisma = require('../prismaClient');
const { HttpError } = require('../utils/httpError');
const { groupParamsSchema } = require('../validation/schemas');

// Loads the caller's membership in group :id into req.membership, or stops the request with 404.
// Non-members get the same 404 as a group that doesn't exist: group ids are sequential, so a
// 403 would let anyone probe which groups exist. Every /api/groups/:id route runs this, so no
// handler can forget the check.
async function requireMembership(req, res, next) {
  const { id: groupId } = groupParamsSchema.parse(req.params);

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: req.user.id, groupId } },
  });
  if (!membership) throw new HttpError(404, 'Group not found');

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

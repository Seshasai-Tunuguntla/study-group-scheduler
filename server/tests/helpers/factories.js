// Builds test data directly in the database, so each API test sets up exactly the state it
// needs without depending on other endpoints working.
const bcrypt = require('bcryptjs');
const prisma = require('../../src/prismaClient');
const { signToken } = require('../../src/utils/tokens');
const { generateJoinCode } = require('../../src/utils/joinCode');

// Low cost factor and hashed once: these users are never used to test real logins.
const PASSWORD_HASH = bcrypt.hashSync('password123', 4);
let userCount = 0;

// Returns the user plus `auth`, a ready-to-use Authorization header value.
async function createUser(name = `User ${userCount + 1}`) {
  userCount += 1;
  const user = await prisma.user.create({
    data: { name, email: `user${userCount}@example.com`, password: PASSWORD_HASH, timeZone: 'UTC' },
  });
  return { ...user, auth: `Bearer ${signToken(user.id)}` };
}

// A group with `organizer` as ORGANIZER and each of `members` as a MEMBER.
async function createGroup(organizer, members = [], { name = 'Algorithms study group' } = {}) {
  return prisma.group.create({
    data: {
      name,
      joinCode: generateJoinCode(),
      createdById: organizer.id,
      memberships: {
        create: [
          { userId: organizer.id, role: 'ORGANIZER' },
          ...members.map((member) => ({ userId: member.id, role: 'MEMBER' })),
        ],
      },
    },
  });
}

const findMembership = (user, group) =>
  prisma.membership.findUnique({ where: { userId_groupId: { userId: user.id, groupId: group.id } } });

module.exports = { createUser, createGroup, findMembership };

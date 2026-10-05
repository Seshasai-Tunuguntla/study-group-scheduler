const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { registerSchema, loginSchema, updateMeSchema } = require('../validation/schemas');
const { signToken } = require('../utils/tokens');
const { HttpError } = require('../utils/httpError');
const { localHoursShiftMinutes } = require('../scheduling/preferredWindow');
const { shiftRanges } = require('../scheduling/ranges');
const { isDemoEmail, resetDemoDataIfStale } = require('../demo/demo');

const router = express.Router();

const BCRYPT_ROUNDS = 10;

// Compared against when the email is unknown, so a wrong email and a wrong password take the
// same time and response timing doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password, timeZone } = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // No "is this email taken?" lookup first: the unique index rejects duplicates atomically,
  // even for two signups racing each other, and the error handler turns that into a 409.
  const user = await prisma.user.create({
    data: { name, email, password: passwordHash, timeZone },
  });

  res.status(201).json({ token: signToken(user.id), user });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email }, omit: { password: false } });
  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !passwordMatches) {
    throw new HttpError(401, 'Invalid email or password');
  }

  if (isDemoEmail(email)) {
    // The previous visitor may have changed things. The user's id survives a reset, but their
    // time zone may not, so the response reads the account again.
    await resetDemoDataIfStale(prisma);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return res.json({ token: signToken(fresh.id), user: fresh });
  }

  const { password: _hash, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  // A well-signed token for a user who no longer exists is still a bad token.
  if (!user) throw new HttpError(401, 'User no longer exists');

  res.json({ user });
});

// Changes the account's time zone (e.g. after moving, or when the device's zone was wrong at signup).
// By default stored availability (UTC) doesn't move: the same moments are just shown in the new
// zone, so nothing changes for the rest of the group. With keepLocalTimes, every saved schedule is
// shifted so it shows at the same local clock times in the new zone (18:00 stays 18:00).
router.patch('/me', requireAuth, async (req, res) => {
  const { timeZone, keepLocalTimes } = updateMeSchema.parse(req.body);
  const userId = req.user.id;

  const { user, shiftedByMinutes } = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current) throw new HttpError(401, 'User no longer exists');

    const shift = keepLocalTimes ? localHoursShiftMinutes(current.timeZone, timeZone) : 0;
    if (shift !== 0) await shiftSavedAvailability(tx, userId, shift);

    const updated = await tx.user.update({ where: { id: userId }, data: { timeZone } });
    return { user: updated, shiftedByMinutes: shift };
  });

  res.json({ user, shiftedByMinutes });
});

// Moves the user's saved availability in every group by `minutes`, inside the caller's transaction.
// The memberships are updated first, which row-locks them, so a concurrent save of availability
// waits for this to commit instead of interleaving (the same rule as PUT /availability).
async function shiftSavedAvailability(tx, userId, minutes) {
  const saved = { userId, availabilityUpdatedAt: { not: null } };
  await tx.membership.updateMany({ where: saved, data: { availabilityUpdatedAt: new Date() } });

  const memberships = await tx.membership.findMany({
    where: saved,
    include: { availability: { select: { startMinute: true, endMinute: true } } },
  });
  for (const membership of memberships) {
    if (membership.availability.length === 0) continue;
    await tx.availabilityRange.deleteMany({ where: { membershipId: membership.id } });
    await tx.availabilityRange.createMany({
      data: shiftRanges(membership.availability, minutes).map((range) => ({ ...range, membershipId: membership.id })),
    });
  }
}

module.exports = router;

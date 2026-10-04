const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { registerSchema, loginSchema } = require('../validation/schemas');
const { signToken } = require('../utils/tokens');
const { HttpError } = require('../utils/httpError');

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

  const { password: _hash, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  // A well-signed token for a user who no longer exists is still a bad token.
  if (!user) throw new HttpError(401, 'User no longer exists');

  res.json({ user });
});

module.exports = router;

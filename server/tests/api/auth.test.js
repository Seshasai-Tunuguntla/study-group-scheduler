const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { resetDb, prisma } = require('../helpers/db');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const ana = {
  name: 'Ana Lima',
  email: 'ana@example.com',
  password: 'correct horse battery',
  timeZone: 'Asia/Kolkata',
};

const register = (body) => request(app).post('/api/auth/register').send(body);
const login = (body) => request(app).post('/api/auth/login').send(body);
const me = (authHeader) => {
  const req = request(app).get('/api/auth/me');
  return authHeader ? req.set('Authorization', authHeader) : req;
};

describe('POST /api/auth/register', () => {
  test('creates the user and returns a token plus the public user', async () => {
    const res = await register(ana);

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      name: 'Ana Lima',
      email: 'ana@example.com',
      // Stored as sent: Node's ICU would rename it to the old alias "Asia/Calcutta" if we normalized.
      timeZone: 'Asia/Kolkata',
      createdAt: expect.any(String),
    });
  });

  test('stores a bcrypt hash, never the plain password', async () => {
    await register(ana);

    const stored = await prisma.user.findUnique({ where: { email: ana.email }, omit: { password: false } });
    expect(stored.password).not.toBe(ana.password);
    expect(await bcrypt.compare(ana.password, stored.password)).toBe(true);
  });

  test('normalizes email case and surrounding whitespace', async () => {
    const res = await register({ ...ana, email: '  Ana@Example.COM ' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('ana@example.com');
  });

  test('a duplicate email, in any case, -> 409', async () => {
    await register(ana);

    const res = await register({ ...ana, email: 'ANA@example.com' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'email already in use' });
  });

  test.each(['UTC', 'America/New_York', 'Europe/London', 'Etc/GMT+5'])('accepts time zone %s', async (timeZone) => {
    const res = await register({ ...ana, timeZone });

    expect(res.status).toBe(201);
    expect(res.body.user.timeZone).toBe(timeZone);
  });

  test.each([
    ['a missing name', { name: undefined }, 'name is required'],
    ['a blank name', { name: '   ' }, 'name is required'],
    ['an invalid email', { email: 'not-an-email' }, 'a valid email is required'],
    ['a short password', { password: 'short' }, 'password must be at least 8 characters'],
    // 20 emoji are only 40 characters but 80 bytes; bcrypt would silently ignore everything past byte 72.
    ['a password over 72 bytes', { password: '😀'.repeat(20) }, 'password is too long (max 72 bytes)'],
    ['a missing time zone', { timeZone: undefined }, 'timeZone is required'],
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }, 'timeZone must be an IANA time zone such as "Asia/Kolkata"'],
    ['a UTC offset instead of a zone', { timeZone: '+05:30' }, 'timeZone must be an IANA time zone such as "Asia/Kolkata"'],
  ])('rejects %s -> 400', async (_label, override, message) => {
    const res = await register({ ...ana, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => register(ana));

  test('returns a working token and the public user for correct credentials', async () => {
    const res = await login({ email: ana.email, password: ana.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: ana.name, email: ana.email, timeZone: ana.timeZone });
    expect(res.body.user).not.toHaveProperty('password');
    expect((await me(`Bearer ${res.body.token}`)).status).toBe(200);
  });

  test('matches the email case-insensitively', async () => {
    const res = await login({ email: 'ANA@Example.com', password: ana.password });

    expect(res.status).toBe(200);
  });

  test('a wrong password and an unknown email get the same 401', async () => {
    const wrongPassword = await login({ email: ana.email, password: 'wrong password' });
    const unknownEmail = await login({ email: 'nobody@example.com', password: ana.password });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: 'Invalid email or password' });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  test('a missing password -> 400', async () => {
    const res = await login({ email: ana.email });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('password is required');
  });
});

describe('GET /api/auth/me', () => {
  let user;
  let token;

  beforeEach(async () => {
    ({ user, token } = (await register(ana)).body);
  });

  test('returns the current user without the password', async () => {
    const res = await me(`Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user });
  });

  test('a missing Authorization header -> 401', async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  test('a header that is not a Bearer token -> 401', async () => {
    const res = await me(`Token ${token}`);

    expect(res.status).toBe(401);
  });

  test('a token signed with a different secret -> 401', async () => {
    const forged = jwt.sign({}, 'not-the-server-secret', { subject: String(user.id) });

    const res = await me(`Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('an expired token -> 401', async () => {
    const expired = jwt.sign(
      { sub: String(user.id), exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET
    );

    const res = await me(`Bearer ${expired}`);

    expect(res.status).toBe(401);
  });

  test('an unsigned token claiming "alg": "none" -> 401', async () => {
    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: String(user.id) })}.`;

    const res = await me(`Bearer ${unsigned}`);

    expect(res.status).toBe(401);
  });

  test('a valid token for a user who no longer exists -> 401', async () => {
    await prisma.user.delete({ where: { id: user.id } });

    const res = await me(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'User no longer exists' });
  });
});

describe('PATCH /api/auth/me', () => {
  let user;
  let token;

  beforeEach(async () => {
    ({ user, token } = (await register(ana)).body);
  });

  const updateMe = (body, authHeader = `Bearer ${token}`) =>
    request(app).patch('/api/auth/me').set('Authorization', authHeader).send(body);

  test('changes the time zone and returns the updated public user', async () => {
    const res = await updateMe({ timeZone: 'Europe/London' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { ...user, timeZone: 'Europe/London' }, shiftedByMinutes: 0 });
    expect((await me(`Bearer ${token}`)).body.user.timeZone).toBe('Europe/London');
  });

  test('stores the zone exactly as sent, aliases included', async () => {
    const res = await updateMe({ timeZone: 'Asia/Calcutta' });

    expect(res.body.user.timeZone).toBe('Asia/Calcutta');
  });

  test('changes nothing but the time zone, even if other fields are sent', async () => {
    await updateMe({ timeZone: 'UTC', email: 'mallory@example.com', name: 'Mallory', password: 'hijacked!!' });

    const stored = await prisma.user.findUnique({ where: { id: user.id }, omit: { password: false } });
    expect(stored).toMatchObject({ email: ana.email, name: ana.name, timeZone: 'UTC' });
    expect(await bcrypt.compare(ana.password, stored.password)).toBe(true);
  });

  // A group where `owner` is organizer and has saved `ranges` (or never saved, with ranges: null).
  async function groupWithAvailability(owner, ranges, joinCode) {
    const group = await prisma.group.create({
      data: {
        name: 'Group',
        joinCode,
        createdById: owner.id,
        memberships: {
          create: { userId: owner.id, role: 'ORGANIZER', availabilityUpdatedAt: ranges ? new Date('2026-01-01') : null },
        },
      },
      include: { memberships: true },
    });
    const membershipId = group.memberships[0].id;
    if (ranges) await prisma.availabilityRange.createMany({ data: ranges.map((r) => ({ ...r, membershipId })) });
    return membershipId;
  }

  const storedRanges = (membershipId) =>
    prisma.availabilityRange.findMany({
      where: { membershipId },
      select: { startMinute: true, endMinute: true },
      orderBy: { startMinute: 'asc' },
    });

  describe('by default, saved availability stays at the same moments', () => {
    test("ranges don't move (they're stored in UTC) and nothing is reported as shifted", async () => {
      const membershipId = await groupWithAvailability(user, [{ startMinute: 750, endMinute: 990 }], 'AAAA2222');

      const res = await updateMe({ timeZone: 'Asia/Tokyo' });

      expect(res.body.shiftedByMinutes).toBe(0);
      expect(await storedRanges(membershipId)).toEqual([{ startMinute: 750, endMinute: 990 }]);
    });
  });

  describe('with keepLocalTimes, saved availability keeps its local clock times', () => {
    test('shifts every group so 18:00-22:00 in India becomes 18:00-22:00 in Japan', async () => {
      // 18:00-22:00 IST on Monday = 12:30-16:30 UTC.
      const first = await groupWithAvailability(user, [{ startMinute: 750, endMinute: 990 }], 'AAAA2222');
      // Monday 00:00-05:00 UTC: moving it 3.5 hours earlier wraps it back into Sunday.
      const second = await groupWithAvailability(user, [{ startMinute: 0, endMinute: 300 }], 'BBBB3333');

      const res = await updateMe({ timeZone: 'Asia/Tokyo', keepLocalTimes: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ user: { timeZone: 'Asia/Tokyo' }, shiftedByMinutes: -210 });
      // 18:00-22:00 JST = 09:00-13:00 UTC.
      expect(await storedRanges(first)).toEqual([{ startMinute: 540, endMinute: 780 }]);
      expect(await storedRanges(second)).toEqual([
        { startMinute: 0, endMinute: 90 },
        { startMinute: 9870, endMinute: 10080 },
      ]);
    });

    test('marks the shifted schedules as saved now, and leaves never-saved ones alone', async () => {
      const saved = await groupWithAvailability(user, [{ startMinute: 750, endMinute: 990 }], 'AAAA2222');
      const neverSaved = await groupWithAvailability(user, null, 'BBBB3333');

      await updateMe({ timeZone: 'Asia/Tokyo', keepLocalTimes: true });

      const savedMembership = await prisma.membership.findUnique({ where: { id: saved } });
      expect(savedMembership.availabilityUpdatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
      expect(await prisma.membership.findUnique({ where: { id: neverSaved } })).toMatchObject({
        availabilityUpdatedAt: null,
      });
    });

    test("never touches other people's availability", async () => {
      const ben = (await register({ ...ana, email: 'ben@example.com' })).body.user;
      const bens = await groupWithAvailability(ben, [{ startMinute: 750, endMinute: 990 }], 'CCCC4444');

      await updateMe({ timeZone: 'Asia/Tokyo', keepLocalTimes: true });

      expect(await storedRanges(bens)).toEqual([{ startMinute: 750, endMinute: 990 }]);
    });

    test('exact ties round toward zero: UTC -> Nepal is exactly -345 minutes and moves -330', async () => {
      await updateMe({ timeZone: 'UTC' });
      const membershipId = await groupWithAvailability(user, [{ startMinute: 1080, endMinute: 1140 }], 'AAAA2222');

      const res = await updateMe({ timeZone: 'Asia/Kathmandu', keepLocalTimes: true });

      expect(res.body.shiftedByMinutes).toBe(-330);
      expect(await storedRanges(membershipId)).toEqual([{ startMinute: 750, endMinute: 810 }]);
    });

    test('India <-> Nepal (exactly 15 minutes apart) is a tie in both directions and moves nothing', async () => {
      const membershipId = await groupWithAvailability(user, [{ startMinute: 750, endMinute: 990 }], 'AAAA2222');

      const there = await updateMe({ timeZone: 'Asia/Kathmandu', keepLocalTimes: true });
      const back = await updateMe({ timeZone: 'Asia/Kolkata', keepLocalTimes: true });

      expect([there.body.shiftedByMinutes, back.body.shiftedByMinutes]).toEqual([0, 0]);
      expect(await storedRanges(membershipId)).toEqual([{ startMinute: 750, endMinute: 990 }]);
    });

    test('switching to another zone and back puts availability exactly where it started', async () => {
      await updateMe({ timeZone: 'UTC' });
      const membershipId = await groupWithAvailability(user, [{ startMinute: 1080, endMinute: 1140 }], 'AAAA2222');

      await updateMe({ timeZone: 'Asia/Kathmandu', keepLocalTimes: true }); // -330
      await updateMe({ timeZone: 'UTC', keepLocalTimes: true }); // +330

      expect(await storedRanges(membershipId)).toEqual([{ startMinute: 1080, endMinute: 1140 }]);
    });

    test('switching to a zone with the same offset moves nothing', async () => {
      const membershipId = await groupWithAvailability(user, [{ startMinute: 750, endMinute: 990 }], 'AAAA2222');

      const res = await updateMe({ timeZone: 'Asia/Calcutta', keepLocalTimes: true });

      expect(res.body.shiftedByMinutes).toBe(0);
      expect(await storedRanges(membershipId)).toEqual([{ startMinute: 750, endMinute: 990 }]);
    });
  });

  test('keepLocalTimes must be a boolean', async () => {
    const res = await updateMe({ timeZone: 'UTC', keepLocalTimes: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('keepLocalTimes must be true or false');
  });

  test.each([
    ['a missing time zone', {}, 'timeZone is required'],
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }, 'timeZone must be an IANA time zone such as "Asia/Kolkata"'],
    ['a UTC offset instead of a zone', { timeZone: '+05:30' }, 'timeZone must be an IANA time zone such as "Asia/Kolkata"'],
  ])('rejects %s -> 400 and keeps the old zone', async (_label, body, message) => {
    const res = await updateMe(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).timeZone).toBe('Asia/Kolkata');
  });

  test('requires a valid token', async () => {
    expect((await request(app).patch('/api/auth/me').send({ timeZone: 'UTC' })).status).toBe(401);
    expect((await updateMe({ timeZone: 'UTC' }, 'Bearer not-a-token')).status).toBe(401);
  });

  test('a valid token for a user who no longer exists -> 401', async () => {
    await prisma.user.delete({ where: { id: user.id } });

    const res = await updateMe({ timeZone: 'UTC' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'User no longer exists' });
  });
});

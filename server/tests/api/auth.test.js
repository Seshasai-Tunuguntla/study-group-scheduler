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

const express = require('express');
const request = require('supertest');
const { resetDb, prisma } = require('../helpers/db');
const { PostgresStore } = require('../../src/middleware/rateLimitStore');
const { createRateLimiter } = require('../../src/middleware/rateLimit');
const { TRUST_PROXY_HOPS } = require('../../src/middleware/clientIp');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const WINDOW_MS = 15 * 60 * 1000;
const store = (prefix = 'test:') => {
  const s = new PostgresStore({ prisma, prefix });
  s.init({ windowMs: WINDOW_MS });
  return s;
};
const at = (ms) => jest.spyOn(Date, 'now').mockReturnValue(ms);
const rows = () => prisma.rateLimit.findMany({ orderBy: { key: 'asc' } });

describe('PostgresStore', () => {
  test('counts hits per client in one window, stored under the limiter prefix', async () => {
    const now = Date.now();
    at(now);
    const s = store('auth:');

    const first = await s.increment('203.0.113.7');
    const second = await s.increment('203.0.113.7');
    await s.increment('198.51.100.4');

    expect(first).toEqual({ totalHits: 1, resetTime: new Date(now + WINDOW_MS) });
    expect(second).toEqual({ totalHits: 2, resetTime: new Date(now + WINDOW_MS) });
    expect((await rows()).map((row) => [row.key, row.hits])).toEqual([
      ['auth:198.51.100.4', 1],
      ['auth:203.0.113.7', 2],
    ]);
  });

  test('keeps different limiters apart', async () => {
    await store('auth:').increment('203.0.113.7');
    const join = await store('join:').increment('203.0.113.7');

    expect(join.totalHits).toBe(1);
  });

  test('starts a new window once the old one has ended, even before cleanup removes the old row', async () => {
    const start = Date.now();
    at(start);
    await store().increment('203.0.113.7');
    await store().increment('203.0.113.7');

    // Another instance cleaned up just before the window ended, so it won't clean up again yet:
    // the expired row is still there when the next hit arrives, and the hit itself must restart it.
    const otherInstance = store();
    at(start + WINDOW_MS - 1);
    await otherInstance.increment('192.0.2.1');
    at(start + WINDOW_MS);
    const next = await otherInstance.increment('203.0.113.7');

    expect(next).toEqual({ totalHits: 1, resetTime: new Date(start + 2 * WINDOW_MS) });
  });

  test('get, decrement and resetKey', async () => {
    const s = store();
    expect(await s.get('203.0.113.7')).toBeUndefined();

    await s.increment('203.0.113.7');
    await s.increment('203.0.113.7');
    await s.decrement('203.0.113.7');
    expect((await s.get('203.0.113.7')).totalHits).toBe(1);

    await s.decrement('203.0.113.7');
    await s.decrement('203.0.113.7'); // never below zero
    expect((await s.get('203.0.113.7')).totalHits).toBe(0);

    await s.resetKey('203.0.113.7');
    expect(await s.get('203.0.113.7')).toBeUndefined();
  });

  test('a client whose window has ended reads as having no hits', async () => {
    const start = Date.now();
    at(start);
    const s = store();
    await s.increment('203.0.113.7');

    at(start + WINDOW_MS);
    expect(await s.get('203.0.113.7')).toBeUndefined();
  });

  test('deletes rows whose window has ended as new requests come in, keeping live ones', async () => {
    const start = Date.now();
    at(start);
    await store('auth:').increment('203.0.113.7');
    at(start + WINDOW_MS / 2);
    await store('join:').increment('198.51.100.4');

    // A new instance's first hit, after the first row's window ended but not the second's.
    at(start + WINDOW_MS);
    await store('auth:').increment('192.0.2.1');

    expect((await rows()).map((row) => row.key)).toEqual(['auth:192.0.2.1', 'join:198.51.100.4']);
  });

  test('cleans up at most once per window per instance', async () => {
    const s = store();
    const executeRaw = jest.spyOn(prisma, '$executeRaw');

    await s.increment('203.0.113.7');
    await s.increment('203.0.113.7');
    await s.increment('198.51.100.4');

    const deletes = executeRaw.mock.calls.filter(([sql]) => sql.join('').includes('DELETE FROM "RateLimit"'));
    expect(deletes).toHaveLength(1);
  });

  test('concurrent hits from many requests are all counted', async () => {
    const s = store();

    await Promise.all(Array.from({ length: 25 }, () => s.increment('203.0.113.7')));

    expect((await s.get('203.0.113.7')).totalHits).toBe(25);
  });
});

// An app behind one proxy (like src/app.js on Vercel) with one limited route.
function limitedApp(limiter, handler = (req, res) => res.json({ ok: true })) {
  const app = express();
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.post('/attempt', limiter, handler);
  return app;
}
const attempt = (app, ip, query = '') => request(app).post(`/attempt${query}`).set('X-Forwarded-For', ip);

describe('the rate limiters', () => {
  test('allow `limit` attempts per window, then answer 429 with a JSON error', async () => {
    const app = limitedApp(createRateLimiter({ name: 'test', limit: 2 }));

    expect((await attempt(app, '203.0.113.7')).status).toBe(200);
    expect((await attempt(app, '203.0.113.7')).status).toBe(200);

    const blocked = await attempt(app, '203.0.113.7');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many attempts, please try again later' });
    expect(blocked.headers).toHaveProperty('retry-after');
  });

  test('count each visitor separately', async () => {
    const app = limitedApp(createRateLimiter({ name: 'test', limit: 1 }));

    expect((await attempt(app, '203.0.113.7')).status).toBe(200);
    expect((await attempt(app, '203.0.113.7')).status).toBe(429);
    expect((await attempt(app, '198.51.100.4')).status).toBe(200);
  });

  test('share counts between server instances', async () => {
    // Two serverless instances: separate limiter objects, one table.
    const instanceA = limitedApp(createRateLimiter({ name: 'test', limit: 2 }));
    const instanceB = limitedApp(createRateLimiter({ name: 'test', limit: 2 }));

    expect((await attempt(instanceA, '203.0.113.7')).status).toBe(200);
    expect((await attempt(instanceB, '203.0.113.7')).status).toBe(200);
    expect((await attempt(instanceA, '203.0.113.7')).status).toBe(429);
  });

  test('with skipSuccessfulRequests, only failed attempts count toward the limit', async () => {
    const app = limitedApp(createRateLimiter({ name: 'test', limit: 2, skipSuccessfulRequests: true }), (req, res) =>
      req.query.code === 'good' ? res.status(201).json({}) : res.status(404).json({})
    );

    // Successful joins never use up the allowance...
    for (let i = 0; i < 5; i++) {
      expect((await attempt(app, '203.0.113.7', '?code=good')).status).toBe(201);
    }
    // ...but two wrong guesses do.
    expect((await attempt(app, '203.0.113.7', '?code=bad')).status).toBe(404);
    expect((await attempt(app, '203.0.113.7', '?code=bad')).status).toBe(404);
    expect((await attempt(app, '203.0.113.7', '?code=good')).status).toBe(429);
  });
});

describe('the real app with its limiters on (as in production)', () => {
  // The limiters are off under test, so load a separate copy of the app as production does.
  let app;
  let appPrisma;
  beforeAll(() => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.isolateModules(() => {
      app = require('../../src/app');
      appPrisma = require('../../src/prismaClient');
    });
    process.env.NODE_ENV = nodeEnv;
  });
  afterAll(() => appPrisma.$disconnect());

  const login = (ip) =>
    request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

  test('the login limiter blocks one visitor after 20 attempts, and only that visitor', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login('203.0.113.7')).status).toBe(401);
    }

    expect((await login('203.0.113.7')).status).toBe(429);
    expect((await login('198.51.100.4')).status).toBe(401);
    expect(await prisma.rateLimit.findUnique({ where: { key: 'auth:203.0.113.7' } })).toMatchObject({ hits: 21 });
  });
});

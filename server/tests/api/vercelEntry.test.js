const request = require('supertest');
const { resetDb, prisma } = require('../helpers/db');

// The Vercel Function at the repository root (api/index.js).
const ENTRY = '../../../api/index.js';

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

// A fresh copy of the entry module is a fresh function instance (a cold start).
function coldStart() {
  let handler;
  let entryPrisma;
  jest.isolateModules(() => {
    handler = require(ENTRY);
    entryPrisma = require('../../src/prismaClient');
  });
  return { handler, entryPrisma };
}

test('serves the API, and checks the demo once per instance before the first request', async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const { handler, entryPrisma } = coldStart();
  try {
    const first = await request(handler).get('/api/health');
    expect(first.status).toBe(200);
    // The new instance found no demo (empty database) and built it before answering.
    expect(await prisma.demoState.count()).toBe(1);
    expect(console.log).toHaveBeenCalledWith('Demo data reset');

    console.log.mockClear();
    expect((await request(handler).post('/api/auth/login').send({})).status).toBe(400);
    expect(console.log).not.toHaveBeenCalled(); // not checked again on this instance
  } finally {
    await entryPrisma.$disconnect();
  }
});

test('refuses to start without a required setting, naming it', () => {
  const secret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    expect(() => coldStart()).toThrow('Missing required environment variable(s): JWT_SECRET');
  } finally {
    process.env.JWT_SECRET = secret;
  }
});

describe('in a Vercel preview deployment', () => {
  const withEnv = (vars, fn) => async () => {
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  test(
    'without its own database, the API answers 503 and never touches the database',
    withEnv({ VERCEL_ENV: 'preview' }, async () => {
      const { handler, entryPrisma } = coldStart();
      try {
        const res = await request(handler).post('/api/auth/login').send({ email: 'demo-organizer@example.com', password: 'password123' });

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: 'The API is off in preview deployments, which have no database of their own' });
        // No demo reset ran: the (test) database is still empty.
        expect(await prisma.demoState.count()).toBe(0);
        expect(await prisma.user.count()).toBe(0);
      } finally {
        await entryPrisma.$disconnect();
      }
    })
  );

  test(
    'with PREVIEW_HAS_OWN_DATABASE=true (a Neon preview branch), it serves the API',
    withEnv({ VERCEL_ENV: 'preview', PREVIEW_HAS_OWN_DATABASE: 'true' }, async () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const { handler, entryPrisma } = coldStart();
      try {
        expect((await request(handler).get('/api/health')).status).toBe(200);
        expect(await prisma.demoState.count()).toBe(1);
      } finally {
        await entryPrisma.$disconnect();
      }
    })
  );
});

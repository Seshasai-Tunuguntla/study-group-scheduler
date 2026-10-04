const express = require('express');
const request = require('supertest');
const { createAuthLimiter } = require('../../src/middleware/rateLimit');

test('allows `limit` attempts per window, then answers 429 with a JSON error', async () => {
  const app = express();
  app.post('/login', createAuthLimiter({ limit: 2 }), (req, res) => res.json({ ok: true }));

  expect((await request(app).post('/login')).status).toBe(200);
  expect((await request(app).post('/login')).status).toBe(200);

  const blocked = await request(app).post('/login');
  expect(blocked.status).toBe(429);
  expect(blocked.body).toEqual({ error: 'Too many attempts, please try again later' });
  expect(blocked.headers).toHaveProperty('retry-after');
});

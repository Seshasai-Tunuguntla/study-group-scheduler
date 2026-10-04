const express = require('express');
const request = require('supertest');
const { createRateLimiter } = require('../../src/middleware/rateLimit');

test('allows `limit` attempts per window, then answers 429 with a JSON error', async () => {
  const app = express();
  app.post('/login', createRateLimiter({ limit: 2 }), (req, res) => res.json({ ok: true }));

  expect((await request(app).post('/login')).status).toBe(200);
  expect((await request(app).post('/login')).status).toBe(200);

  const blocked = await request(app).post('/login');
  expect(blocked.status).toBe(429);
  expect(blocked.body).toEqual({ error: 'Too many attempts, please try again later' });
  expect(blocked.headers).toHaveProperty('retry-after');
});

test('with skipSuccessfulRequests, only failed attempts count toward the limit', async () => {
  const app = express();
  app.post('/join', createRateLimiter({ limit: 2, skipSuccessfulRequests: true }), (req, res) =>
    req.query.code === 'good' ? res.status(201).json({}) : res.status(404).json({})
  );

  // Successful joins never use up the allowance...
  for (let i = 0; i < 5; i++) {
    expect((await request(app).post('/join?code=good')).status).toBe(201);
  }
  // ...but two wrong guesses do.
  expect((await request(app).post('/join?code=bad')).status).toBe(404);
  expect((await request(app).post('/join?code=bad')).status).toBe(404);
  expect((await request(app).post('/join?code=good')).status).toBe(429);
});

const rateLimit = require('express-rate-limit');
const prisma = require('../prismaClient');
const { clientKey } = require('./clientIp');
const { PostgresStore } = require('./rateLimitStore');

const WINDOW_MS = 15 * 60 * 1000;

// `name` keeps each limiter's counts apart in the shared RateLimit table.
function createRateLimiter({ name, limit, windowMs = WINDOW_MS, skipSuccessfulRequests = false, db = prisma }) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    keyGenerator: clientKey,
    store: new PostgresStore({ prisma: db, prefix: `${name}:` }),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
  });
}

// Off under test: the suites register, log in and join far more often than these limits allow,
// which isn't the abuse pattern they exist to slow down. The limiters themselves are covered by
// tests/api/rateLimit.test.js.
const enabled = process.env.NODE_ENV !== 'test';
const passThrough = (req, res, next) => next();

// Login and register share one bucket: 20 attempts per client per 15 minutes slows password
// guessing and mass signups.
const authLimiter = enabled ? createRateLimiter({ name: 'auth', limit: 20 }) : passThrough;

// Joining by code: only failed attempts count, so guessing codes is throttled but someone
// joining several real groups never is.
const joinLimiter = enabled ? createRateLimiter({ name: 'join', limit: 20, skipSuccessfulRequests: true }) : passThrough;

module.exports = { createRateLimiter, authLimiter, joinLimiter };

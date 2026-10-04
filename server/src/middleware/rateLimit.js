const rateLimit = require('express-rate-limit');

function createRateLimiter({ limit, windowMs = 15 * 60 * 1000, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
  });
}

// Off under test: the suites register, log in and join far more often than these limits allow,
// which isn't the abuse pattern they exist to slow down. The limiter itself is covered by
// tests/unit/rateLimit.test.js.
const enabled = process.env.NODE_ENV !== 'test';
const passThrough = (req, res, next) => next();

// Login and register share one bucket: 20 attempts per IP per 15 minutes slows password
// guessing and mass signups.
const authLimiter = enabled ? createRateLimiter({ limit: 20 }) : passThrough;

// Joining by code: only failed attempts count, so guessing codes is throttled but someone
// joining several real groups never is.
const joinLimiter = enabled ? createRateLimiter({ limit: 20, skipSuccessfulRequests: true }) : passThrough;

module.exports = { createRateLimiter, authLimiter, joinLimiter };

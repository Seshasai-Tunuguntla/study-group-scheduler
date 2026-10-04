const rateLimit = require('express-rate-limit');

// Slows down password guessing and mass signups: by default 20 login/register attempts
// per IP per 15 minutes, shared across both routes.
function createAuthLimiter({ limit = 20, windowMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
  });
}

// Off under test: the suites register and log in far more than 20 times in a few seconds,
// which isn't the brute-force pattern this exists to slow down. The limiter itself is
// covered by tests/unit/rateLimit.test.js.
const authLimiter = process.env.NODE_ENV === 'test' ? (req, res, next) => next() : createAuthLimiter();

module.exports = { createAuthLimiter, authLimiter };

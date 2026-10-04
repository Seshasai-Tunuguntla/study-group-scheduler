const jwt = require('jsonwebtoken');

const TOKEN_LIFETIME = '7d';

// The token carries only the user id. Roles are per group and read from the database on every
// request, so a token can never carry stale permissions.
function signToken(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    subject: String(userId),
    expiresIn: TOKEN_LIFETIME,
    algorithm: 'HS256',
  });
}

// Returns the user id. Throws if the token is invalid, expired, or not signed with HS256.
// jsonwebtoken already refuses unsigned "alg": "none" tokens; pinning the algorithm also means a
// token can never pick its own verification algorithm (algorithm-confusion attacks).
function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw new Error('Token has no user id');
  return userId;
}

module.exports = { signToken, verifyToken };

const { verifyToken } = require('../utils/tokens');
const { HttpError } = require('../utils/httpError');

// Sets req.user = { id } from a valid Bearer token. Group roles are checked separately,
// per request, against Membership.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }

  try {
    req.user = { id: verifyToken(header.slice('Bearer '.length)) };
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  next();
}

module.exports = { requireAuth };

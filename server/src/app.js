const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { HttpError } = require('./utils/httpError');
const { TRUST_PROXY_HOPS, logClientIpOnce } = require('./middleware/clientIp');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');

const app = express();

// In production the API runs as a Vercel Function behind Vercel's edge, one proxy hop, so req.ip
// (and the rate limiters' key) is the visitor's address. See src/middleware/clientIp.js.
app.set('trust proxy', TRUST_PROXY_HOPS);
if (process.env.LOG_CLIENT_IP === 'true') app.use(logClientIpOnce());

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Allowed: requests with no Origin (curl, Supertest), the origins listed in CLIENT_ORIGIN, and the
// site's own origin. On Vercel the client and the API share one domain (every preview URL too), and
// browsers still send Origin on same-origin POSTs. A browser sets Origin itself, so another site
// can't make its request look same-origin.
function isAllowedOrigin(origin, host) {
  if (!origin || allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

app.use(helmet());
app.use(
  cors((req, callback) => {
    if (isAllowedOrigin(req.headers.origin, req.headers.host)) return callback(null, { origin: true });
    callback(new HttpError(403, 'Origin not allowed'));
  })
);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

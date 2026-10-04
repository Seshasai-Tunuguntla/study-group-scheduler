const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { HttpError } = require('./utils/httpError');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');

const app = express();

// Hosted behind a reverse proxy in production; needed so req.ip and the rate limiters see the real client.
// TODO(deploy): production traffic goes browser -> Vercel rewrite -> Render, two hops. With 1, req.ip
// may be Vercel's edge IP for everyone, putting all users in one bucket for BOTH the auth limiter
// (login/register) and the join-code limiter. Log req.ip in production, then set this (or the
// limiters' key function, with a test) so both limiters key on the real client IP.
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (curl, Supertest) which send no Origin header.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, 'Origin not allowed'));
    },
  })
);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

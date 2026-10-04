const { ZodError } = require('zod');
const { Prisma } = require('@prisma/client');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Express 5 forwards rejected promises from async handlers here automatically,
// so handlers can let Zod/Prisma throw (or throw an HttpError) without try/catch.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues[0].message, details: err.issues });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // meta.target is usually an array of field names, but can be a constraint name string.
      const fields = [].concat(err.meta?.target ?? []).join(', ');
      return res.status(409).json({ error: `${fields || 'Value'} already in use` });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found' });
    }
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  // Errors that carry their own 4xx status and a client-safe message:
  // HttpError, the CORS rejection, and body-parser errors such as payload too large.
  if (err.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };

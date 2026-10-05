// The API as a Vercel Function. vercel.json sends every /api/* request here, and Express still sees
// the original path, so the routes are the same as in development (server/src/app.js).
const { isPreviewWithoutOwnDatabase, missingEnv } = require('../server/src/env');

// A preview deployment without its own database answers every API request with 503, without loading
// the app, so it never connects to (or migrates, or resets the demo in) the production database.
function previewWithoutDatabase(req, res) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'The API is off in preview deployments, which have no database of their own' }));
}

function apiHandler() {
  const missing = missingEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const app = require('../server/src/app');
  const prisma = require('../server/src/prismaClient');
  const { prepare } = require('../server/src/startup');

  // Each new instance (a cold start) first rebuilds the demo if it's due, as a long-running server
  // does at start. Only the first request on a new instance waits for it; prepare never rejects.
  let ready;
  return async (req, res) => {
    ready ??= prepare({ prisma });
    await ready;
    return app(req, res);
  };
}

module.exports = isPreviewWithoutOwnDatabase() ? previewWithoutDatabase : apiHandler();

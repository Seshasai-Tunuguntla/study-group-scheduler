// Settings the API can't run without. Checked when a server or function instance starts, so a
// missing one fails loudly at once instead of on the first request that needs it.
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

function missingEnv(env = process.env) {
  return REQUIRED.filter((name) => !env[name]);
}

// Vercel preview deployments must never touch the production database. The database settings are
// scoped to Production only in Vercel; this is the safety net in case they ever aren't: a preview
// runs no migrations and serves no API (so never resets the demo) unless PREVIEW_HAS_OWN_DATABASE
// is true, which should only be set together with a separate preview database (a Neon branch).
function isPreviewWithoutOwnDatabase(env = process.env) {
  return env.VERCEL_ENV === 'preview' && env.PREVIEW_HAS_OWN_DATABASE !== 'true';
}

module.exports = { missingEnv, isPreviewWithoutOwnDatabase };

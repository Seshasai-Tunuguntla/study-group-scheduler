// Runs during the Vercel build (`npm run vercel-build`): applies any new migrations before the new
// version goes live. Prisma's migration lock is a session-level Postgres lock, which a pooled
// connection (PgBouncer in transaction mode) can't hold, so this uses Neon's direct connection,
// DATABASE_URL_UNPOOLED, when there is one. The app itself uses the pooled DATABASE_URL.
const path = require('path');
const { execSync } = require('child_process');
const { isPreviewWithoutOwnDatabase } = require('../src/env');

// What this build should do: { run: true, url }, or { run: false, reason } (fine, skip), or
// { run: false, error } (fail the build).
function migrationPlan(env = process.env) {
  if (isPreviewWithoutOwnDatabase(env)) {
    return { run: false, reason: 'Preview deployment: migrations skipped (previews never migrate the production database)' };
  }
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) return { run: false, error: 'Set DATABASE_URL (and DATABASE_URL_UNPOOLED for Neon) to run migrations' };
  return { run: true, url };
}

if (require.main === module) {
  const plan = migrationPlan();
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (!plan.run) {
    console.log(plan.reason);
  } else {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: plan.url },
    });
  }
}

module.exports = { migrationPlan };

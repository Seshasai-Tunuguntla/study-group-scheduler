const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');
const { defineConfig } = require('@playwright/test');

// Its own ports and database, so it can run while the dev servers (4100 and 5180) are up.
const API_PORT = 4200;
const WEB_PORT = 5280;
const SERVER_DIR = path.join(__dirname, '..', 'server');

// The API's demo reset on start seeds this database, so there is no separate seed step.
// CI passes E2E_DATABASE_URL. Locally it's the dev database's server with the name swapped to
// study_scheduler_e2e (`prisma migrate deploy` creates it on the first run).
function databaseUrl() {
  let url = process.env.E2E_DATABASE_URL;
  if (!url) {
    const { DATABASE_URL } = parseEnv(fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8'));
    const local = new URL(DATABASE_URL);
    local.pathname = '/study_scheduler_e2e';
    url = local.toString();
  }
  if (!new URL(url).pathname.endsWith('_e2e')) {
    throw new Error('The end-to-end tests need a database whose name ends in _e2e');
  }
  return url;
}

module.exports = defineConfig({
  testDir: './tests',
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // The Google Chrome already installed (GitHub's Ubuntu runners have it too), so no browser
    // download is needed.
    channel: 'chrome',
    // The demo organizer's zone (India has no daylight saving time, so the times asserted never
    // move), and a locale with 24-hour times.
    timezoneId: 'Asia/Kolkata',
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'API',
      command: 'npx prisma migrate deploy && node src/server.js',
      cwd: SERVER_DIR,
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl(),
        JWT_SECRET: 'e2e-only-secret',
        CLIENT_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      timeout: 60_000,
    },
    {
      // The production build, served by `vite preview`, which proxies /api like the dev server.
      name: 'Web',
      command: `npm run build && npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: path.join(__dirname, '..', 'client'),
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://localhost:${API_PORT}` },
      timeout: 60_000,
    },
  ],
});

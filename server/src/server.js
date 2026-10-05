// The long-running server: local development, or any host that runs `npm start`.
// On Vercel the API runs as a function instead (api/index.js at the repository root).
require('dotenv').config({ quiet: true });
const { missingEnv } = require('./env');

const missing = missingEnv();
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const app = require('./app');
const prisma = require('./prismaClient');
const { start } = require('./startup');

start({ app, prisma, port: process.env.PORT || 4100 });

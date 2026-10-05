require('dotenv').config({ quiet: true });

// Fail at startup, not on the first request that needs one of these.
for (const name of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const app = require('./app');
const prisma = require('./prismaClient');
const { start } = require('./startup');

start({ app, prisma, port: process.env.PORT || 4100 });

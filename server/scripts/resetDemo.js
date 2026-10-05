// Rebuilds the demo accounts and groups now: `npm run demo:reset`.
// The server also does this on start and when the demo is opened 30+ minutes after the last reset.
require('dotenv').config({ quiet: true });
const prisma = require('../src/prismaClient');
const { resetDemoData } = require('../src/demo/demo');

resetDemoData(prisma)
  .then(() => console.log('Demo data reset'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

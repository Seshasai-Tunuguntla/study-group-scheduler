const prisma = require('../../src/prismaClient');

// Empties every table between tests. Refuses to run unless DATABASE_URL points at a *_test
// database, so a misconfigured environment can never wipe development data.
async function resetDb() {
  const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": tests must use a database whose name ends in _test`);
  }
  await prisma.$executeRaw`TRUNCATE "AvailabilityRange", "Session", "Membership", "Group", "User", "DemoState", "RateLimit" CASCADE`;
}

module.exports = { resetDb, prisma };

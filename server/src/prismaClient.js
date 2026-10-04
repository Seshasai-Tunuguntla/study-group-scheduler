const { PrismaClient } = require('@prisma/client');

// One shared client per process: each PrismaClient owns a connection pool.
const prisma = new PrismaClient({
  // Password hashes never leave the database by accident: every query omits them unless it
  // explicitly opts back in with `omit: { password: false }` (only login does).
  omit: { user: { password: true } },
});

module.exports = prisma;

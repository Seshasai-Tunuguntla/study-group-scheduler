const { PrismaClient } = require('@prisma/client');

// One shared client per process: each PrismaClient owns a connection pool.
const prisma = new PrismaClient();

module.exports = prisma;

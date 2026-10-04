const { Prisma } = require('@prisma/client');

// True when `err` is a unique-constraint violation (P2002) involving `field`.
function isUniqueViolation(err, field) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    [].concat(err.meta?.target ?? []).includes(field)
  );
}

module.exports = { isUniqueViolation };

// An express-rate-limit store that keeps hit counts in Postgres (the RateLimit table), so every
// server instance shares them. An in-memory store would give each serverless instance its own
// counts, and they would vanish whenever an instance stops.
//
// Each hit is one atomic statement, so concurrent requests on different instances never lose a
// count. Rows whose window has ended are deleted as requests come in (at most once per window per
// instance): serverless instances have no reliable background timer to do it.
class PostgresStore {
  // prefix keeps each limiter's counts apart in the shared table ("auth:", "join:").
  constructor({ prisma, prefix }) {
    this.prisma = prisma;
    this.prefix = prefix;
    // Counts are shared between instances (express-rate-limit uses this for its double-count check).
    this.localKeys = false;
    this.lastCleanupMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  rowKey(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    const row = await this.prisma.rateLimit.findUnique({ where: { key: this.rowKey(key) } });
    if (!row || Number(row.resetAtMs) <= Date.now()) return undefined;
    return { totalHits: row.hits, resetTime: new Date(Number(row.resetAtMs)) };
  }

  // Counts a hit. A client's first hit, or the first after their window ended, starts a new window.
  async increment(key) {
    const now = Date.now();
    await this.cleanUp(now);
    const nowMs = BigInt(now);
    const [row] = await this.prisma.$queryRaw`
      INSERT INTO "RateLimit" ("key", "hits", "resetAtMs")
      VALUES (${this.rowKey(key)}, 1, ${nowMs + BigInt(this.windowMs)})
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimit"."resetAtMs" <= ${nowMs} THEN 1 ELSE "RateLimit"."hits" + 1 END,
        "resetAtMs" = CASE WHEN "RateLimit"."resetAtMs" <= ${nowMs}
          THEN EXCLUDED."resetAtMs" ELSE "RateLimit"."resetAtMs" END
      RETURNING "hits", "resetAtMs"`;
    return { totalHits: row.hits, resetTime: new Date(Number(row.resetAtMs)) };
  }

  // Takes a hit back (skipSuccessfulRequests: the join limiter only counts failed attempts).
  async decrement(key) {
    await this.prisma.$executeRaw`
      UPDATE "RateLimit" SET "hits" = "hits" - 1
      WHERE "key" = ${this.rowKey(key)} AND "hits" > 0 AND "resetAtMs" > ${BigInt(Date.now())}`;
  }

  async resetKey(key) {
    await this.prisma.rateLimit.deleteMany({ where: { key: this.rowKey(key) } });
  }

  // Deletes every client's row whose window has ended (for all limiters), so the table only holds
  // clients seen within the last window.
  async cleanUp(now) {
    if (now - this.lastCleanupMs < this.windowMs) return;
    this.lastCleanupMs = now;
    await this.prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAtMs" <= ${BigInt(now)}`;
  }
}

module.exports = { PostgresStore };

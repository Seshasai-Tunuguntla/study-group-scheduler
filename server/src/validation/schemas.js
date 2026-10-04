const { z } = require('zod');
const { isIanaTimeZone } = require('../utils/timeZone');
const { MINUTES_PER_WEEK, SLOT_MINUTES, SLOTS_PER_WEEK } = require('../scheduling/week');
// Called through the module object (not destructured) so tests can stub normalizeRanges.
const ranges = require('../scheduling/ranges');

// Trim and lowercase *before* the format check: z.email().trim() would validate first and
// reject "  Ana@Example.com ".
const emailSchema = z
  .string({ message: 'email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'email must be at most 254 characters')
  .pipe(z.email('a valid email is required'));

const registerSchema = z.object({
  name: z
    .string({ message: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(100, 'name must be at most 100 characters'),
  email: emailSchema,
  password: z
    .string({ message: 'password is required' })
    .min(8, 'password must be at least 8 characters')
    // bcrypt only reads the first 72 bytes and silently ignores the rest. Counting bytes, not
    // characters, matters for non-ASCII passwords: one emoji is 2 characters but 4 bytes.
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'password is too long (max 72 bytes)'),
  timeZone: z
    .string({ message: 'timeZone is required' })
    .trim()
    .refine(isIanaTimeZone, 'timeZone must be an IANA time zone such as "Asia/Kolkata"'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ message: 'password is required' }).min(1, 'password is required'),
});

// Route params arrive as strings. The upper bound keeps ids inside Postgres INTEGER, so a huge
// id is a 400 instead of a database overflow error (500).
const MAX_INT = 2_147_483_647;
const idParam = (name) => {
  const message = `${name} must be a positive whole number`;
  return z.coerce.number({ message }).int(message).positive(message).max(MAX_INT, message);
};

const groupParamsSchema = z.object({ id: idParam('group id') });

const memberParamsSchema = z.object({ id: idParam('group id'), userId: idParam('userId') });

const createGroupSchema = z.object({
  name: z
    .string({ message: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(100, 'name must be at most 100 characters'),
});

// Forgiving about how people type a code they were sent: "abcd-efgh" and "ABCD EFGH" both work.
const joinGroupSchema = z.object({
  joinCode: z
    .string({ message: 'joinCode is required' })
    .transform((code) => code.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().length(8, 'joinCode must be 8 characters')),
});

const updateMemberSchema = z.object({
  required: z.boolean({ message: 'required must be true or false' }),
});

const minuteOfWeek = (name, max) => {
  const outOfRange = `${name} must be between 0 and ${max}`;
  return z
    .number({ message: `${name} must be a number` })
    .int(`${name} must be a whole number`)
    .min(0, outOfRange)
    .max(max, outOfRange)
    .multipleOf(SLOT_MINUTES, `${name} must be a multiple of ${SLOT_MINUTES}`);
};

// UTC minutes since Monday 00:00, end exclusive. An end at or before the start means the range
// runs past Sunday midnight: { startMinute: 10020, endMinute: 60 } is Sun 23:00 - Mon 01:00 UTC.
const availabilityRangeSchema = z
  .object({
    startMinute: minuteOfWeek('startMinute', MINUTES_PER_WEEK - SLOT_MINUTES),
    endMinute: minuteOfWeek('endMinute', MINUTES_PER_WEEK),
  })
  .refine((range) => range.startMinute !== range.endMinute, 'a range must not be empty');

// Even one-slot ranges can't need more than one per slot of the week.
const MAX_RANGES_PER_REQUEST = SLOTS_PER_WEEK;

// Validates, then normalizes to the stored form (split at the week boundary, sorted, merged).
// Overlapping ranges are reported as a normal validation error, so they become a 400.
const replaceAvailabilitySchema = z
  .object({
    ranges: z
      .array(availabilityRangeSchema, { message: 'ranges must be an array' })
      .max(MAX_RANGES_PER_REQUEST, `at most ${MAX_RANGES_PER_REQUEST} ranges per request`),
  })
  .transform(({ ranges: input }, ctx) => {
    try {
      return { ranges: ranges.normalizeRanges(input) };
    } catch (err) {
      if (!(err instanceof ranges.RangeOverlapError)) throw err;
      ctx.issues.push({ code: 'custom', message: err.message, input, path: ['ranges'] });
      return z.NEVER;
    }
  });

module.exports = {
  registerSchema,
  loginSchema,
  groupParamsSchema,
  memberParamsSchema,
  createGroupSchema,
  joinGroupSchema,
  updateMemberSchema,
  replaceAvailabilitySchema,
  MAX_RANGES_PER_REQUEST,
};

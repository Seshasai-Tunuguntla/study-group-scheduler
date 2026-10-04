const { z } = require('zod');
const { isIanaTimeZone } = require('../utils/timeZone');

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

module.exports = { registerSchema, loginSchema };

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateJoinCode } = require('../utils/joinCode');

// The public demo behind the "Try as organizer / Try as member" buttons. Visitors can change
// anything their account can, so all demo data is rebuilt from the fixture below on server start
// and when someone opens the demo more than 30 minutes after the last reset.
//
// The fixture is designed to show the app's strengths in one click:
// - members in India, London and New York, so the two demo logins see the same session at
//   different local times;
// - Cal never saves availability, so "Waiting on Cal" / "Not counted yet" appear;
// - Ben is required and isn't free on Thursday, when 4 people are: the best times are 3-person
//   slots that include him, and making him optional (Members tab) brings Thursday to the top;
// - the top suggestion is already the confirmed weekly session, so the dashboard isn't empty;
// - a second group where only the organizer has replied (the "waiting for responses" state).

const DEMO_PASSWORD = 'password123'; // public on purpose: it's on the login page's demo buttons

// Accounts visitors can log in as.
const DEMO_ORGANIZER = { key: 'priya', email: 'demo-organizer@example.com', name: 'Priya', timeZone: 'Asia/Kolkata' };
const DEMO_MEMBER = { key: 'sam', email: 'demo-member@example.com', name: 'Sam', timeZone: 'Europe/London' };

// The other group members. Nobody can log in as them (their password is random and never kept).
const FIXTURE_MEMBERS = [
  { key: 'ben', email: 'demo-ben@example.com', name: 'Ben', timeZone: 'America/New_York' },
  { key: 'emma', email: 'demo-emma@example.com', name: 'Emma', timeZone: 'Europe/London' },
  { key: 'rohan', email: 'demo-rohan@example.com', name: 'Rohan', timeZone: 'Asia/Kolkata' },
  { key: 'cal', email: 'demo-cal@example.com', name: 'Cal', timeZone: 'America/New_York' },
];

const DEMO_USERS = [DEMO_ORGANIZER, DEMO_MEMBER, ...FIXTURE_MEMBERS];
const DEMO_EMAILS = new Set(DEMO_USERS.map((user) => user.email));

// A visitor who opens the demo within this window keeps the previous visitor's changes,
// so two people exploring at the same time don't wipe each other's work.
const RESET_IF_OLDER_THAN_MS = 30 * 60 * 1000;

// UTC minute-of-week helpers for the fixture: utc('tue', '13:30') -> 1 * 1440 + 810.
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const utc = (day, time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return DAYS.indexOf(day) * 1440 + hours * 60 + minutes;
};
const free = (days, from, to) => days.map((day) => ({ startMinute: utc(day, from), endMinute: utc(day, to) }));

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours) => new Date(Date.now() - hours * HOUR_MS);

// Times are UTC. Priya's 13:00-17:00 is 18:30-22:30 in India. London and New York change clocks,
// so the same moments are 14:30 / 09:30 there in summer and an hour earlier in winter.
// `key` is stored as Group.demoKey, so each reset finds the same group row again.
const GROUPS = [
  {
    key: 'algorithms',
    name: 'Algorithms study group',
    organizer: 'priya',
    members: [
      { key: 'priya', required: true, free: [...free(['mon', 'tue', 'wed', 'thu', 'fri'], '13:00', '17:00'), ...free(['sat'], '04:30', '07:30')] },
      { key: 'sam', required: false, free: free(['mon', 'tue', 'wed', 'thu'], '13:30', '17:00') },
      { key: 'ben', required: true, free: [...free(['tue', 'wed'], '13:00', '15:00'), ...free(['fri'], '14:00', '16:00')] },
      { key: 'emma', required: false, free: [...free(['tue'], '15:00', '17:00'), ...free(['thu'], '14:00', '17:00'), ...free(['sat'], '05:00', '07:00')] },
      { key: 'rohan', required: false, free: [...free(['mon'], '14:00', '16:00'), ...free(['thu'], '14:00', '16:30')] },
      { key: 'cal', required: true, free: null }, // never saved
    ],
    // The top suggestion: Tuesday 13:30-14:30 UTC, 19:00 in India.
    session: { startMinute: utc('tue', '13:30'), durationMinutes: 60, confirmedBy: 'priya' },
  },
  {
    key: 'physics',
    name: 'Physics lab group',
    organizer: 'priya',
    members: [
      { key: 'priya', required: true, free: [...free(['wed'], '15:00', '17:00'), ...free(['sat'], '05:00', '07:00')] },
      { key: 'sam', required: true, free: null },
      { key: 'ben', required: true, free: null },
    ],
    session: null,
  },
];

// Any fixed number: resets in different processes (the server, `npm run demo:reset`) take this
// Postgres lock, so they run one after another instead of both rebuilding at once. Updating the
// demo users first would also make a second reset wait, but only while that stays the first step;
// the lock doesn't depend on statement order.
const RESET_LOCK_KEY = 461_007;

let lastResetAt = 0;
let resetInFlight = null;

function isDemoEmail(email) {
  return DEMO_EMAILS.has(email);
}

// Rebuilds everything the demo owns: the demo users (name and time zone restored), the groups
// visitors created (deleted), and the fixture groups' contents (memberships, availability, required
// flags and session). Users and fixture groups keep their rows and ids, so a visitor who is logged
// in, or looking at a demo group, just sees fresh data after a reset. Real users' data is never
// touched: demo accounts can't join other groups and nobody else can join the demo groups.
async function rebuildDemoData(prisma) {
  const [visitorPassword, fixturePassword] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORD, 10),
    bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
  ]);

  await prisma.$transaction(
    async (tx) => {
      // Released automatically when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESET_LOCK_KEY})`;

      const ids = {};
      for (const user of DEMO_USERS) {
        const visitor = user === DEMO_ORGANIZER || user === DEMO_MEMBER;
        const data = { name: user.name, timeZone: user.timeZone, password: visitor ? visitorPassword : fixturePassword };
        const saved = await tx.user.upsert({ where: { email: user.email }, update: data, create: { email: user.email, ...data } });
        ids[user.key] = saved.id;
      }

      // Groups visitors created. Cascades remove their memberships, availability and sessions.
      await tx.group.deleteMany({ where: { createdById: { in: Object.values(ids) }, demoKey: null } });

      for (const group of GROUPS) {
        const details = { name: group.name, createdById: ids[group.organizer], createdAt: hoursAgo(24 * 9) };
        // The join code is kept: nobody can join a demo group, so it never needs to change.
        const { id: groupId } = await tx.group.upsert({
          where: { demoKey: group.key },
          update: details,
          create: { ...details, demoKey: group.key, joinCode: generateJoinCode() },
        });
        // Members' availability goes with their memberships (onDelete: Cascade).
        await tx.membership.deleteMany({ where: { groupId } });
        await tx.session.deleteMany({ where: { groupId } });

        for (const [index, member] of group.members.entries()) {
          await tx.membership.create({
            data: {
              userId: ids[member.key],
              groupId,
              role: member.key === group.organizer ? 'ORGANIZER' : 'MEMBER',
              required: member.required,
              joinedAt: hoursAgo(24 * 9 - index),
              availabilityUpdatedAt: member.free ? hoursAgo(30 - index * 3) : null,
              availability: member.free ? { create: member.free } : undefined,
            },
          });
        }
        if (group.session) {
          await tx.session.create({
            data: {
              groupId,
              startMinute: group.session.startMinute,
              durationMinutes: group.session.durationMinutes,
              confirmedById: ids[group.session.confirmedBy],
              confirmedAt: hoursAgo(20),
            },
          });
        }
      }
    },
    { timeout: 20000 }
  );
}

// Callers that overlap (server start, two visitors logging in at once) share one rebuild.
function resetDemoData(prisma) {
  resetInFlight ??= rebuildDemoData(prisma)
    .then(() => {
      lastResetAt = Date.now();
    })
    .finally(() => {
      resetInFlight = null;
    });
  return resetInFlight;
}

// Called when someone logs in to a demo account. A reset already under way is waited for, so the
// visitor never loads groups that are about to be replaced.
async function resetDemoDataIfStale(prisma) {
  if (!resetInFlight && Date.now() - lastResetAt < RESET_IF_OLDER_THAN_MS) return;
  await resetDemoData(prisma);
}

module.exports = {
  DEMO_ORGANIZER,
  DEMO_MEMBER,
  DEMO_PASSWORD,
  DEMO_USERS,
  RESET_IF_OLDER_THAN_MS,
  isDemoEmail,
  resetDemoData,
  resetDemoDataIfStale,
};

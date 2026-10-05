const request = require('supertest');
const app = require('../../src/app');
const { start } = require('../../src/startup');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, setAvailability } = require('../helpers/factories');
const { range, minuteOf } = require('../unit/scheduling/weekHelpers');
const {
  DEMO_ORGANIZER,
  DEMO_MEMBER,
  DEMO_PASSWORD,
  DEMO_USERS,
  RESET_IF_OLDER_THAN_MS,
  resetDemoData,
} = require('../../src/demo/demo');

const DEMO_EMAILS = DEMO_USERS.map((user) => user.email);
const fixtureUser = (name) => DEMO_USERS.find((user) => user.name === name);

// Every test starts from a freshly reset demo, as after a server start.
beforeEach(async () => {
  await resetDb();
  await resetDemoData(prisma);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const login = (email, password = DEMO_PASSWORD) => request(app).post('/api/auth/login').send({ email, password });

async function logInAs(account) {
  const res = await login(account.email);
  expect(res.status).toBe(200);
  return { ...res.body.user, auth: `Bearer ${res.body.token}` };
}

const as = (user) => ({
  get: (path) => request(app).get(`/api${path}`).set('Authorization', user.auth),
  post: (path, body) => request(app).post(`/api${path}`).set('Authorization', user.auth).send(body),
  put: (path, body) => request(app).put(`/api${path}`).set('Authorization', user.auth).send(body),
  patch: (path, body) => request(app).patch(`/api${path}`).set('Authorization', user.auth).send(body),
  delete: (path) => request(app).delete(`/api${path}`).set('Authorization', user.auth),
});

const demoGroup = (demoKey) => prisma.group.findUniqueOrThrow({ where: { demoKey } });
const userId = (account) => prisma.user.findUniqueOrThrow({ where: { email: account.email } }).then((u) => u.id);

// Moves the clock past (or not quite to) the end of the reset window.
function minutesLater(minutes) {
  const later = Date.now() + minutes * 60 * 1000;
  jest.spyOn(Date, 'now').mockReturnValue(later);
}
const RESET_WINDOW_MINUTES = RESET_IF_OLDER_THAN_MS / 60_000;

// Everything a visitor can change, without ids or timestamps: a reset recreates the memberships and
// gives fresh "replied 30 hours ago" times, so only whether someone has replied is compared.
// (Group ids are checked separately: they must survive a reset.)
async function demoState() {
  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { email: true, name: true, timeZone: true },
    orderBy: { email: 'asc' },
  });
  const groups = await prisma.group.findMany({
    where: { createdBy: { email: { in: DEMO_EMAILS } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      name: true,
      demoKey: true,
      createdBy: { select: { email: true } },
      session: { select: { startMinute: true, durationMinutes: true, confirmedBy: { select: { email: true } } } },
      memberships: {
        orderBy: { user: { email: 'asc' } },
        select: {
          role: true,
          required: true,
          availabilityUpdatedAt: true,
          user: { select: { email: true } },
          availability: { select: { startMinute: true, endMinute: true }, orderBy: { startMinute: 'asc' } },
        },
      },
    },
  });
  return {
    users,
    groups: groups.map(({ memberships, ...group }) => ({
      ...group,
      memberships: memberships.map(({ availabilityUpdatedAt, ...membership }) => ({
        ...membership,
        replied: availabilityUpdatedAt !== null,
      })),
    })),
  };
}

// A visitor using both demo accounts changes everything they can.
async function changeEverything() {
  const priya = await logInAs(DEMO_ORGANIZER);
  const sam = await logInAs(DEMO_MEMBER);
  const algorithms = await demoGroup('algorithms');
  const physics = await demoGroup('physics');
  const [benId, emmaId] = await Promise.all([userId(fixtureUser('Ben')), userId(fixtureUser('Emma'))]);

  const changes = [
    as(priya).put(`/groups/${algorithms.id}/availability`, { ranges: [range('Sat 10:00', 'Sat 12:00')] }),
    as(priya).patch(`/groups/${algorithms.id}/members/${benId}`, { required: false }),
    as(priya).delete(`/groups/${algorithms.id}/members/${emmaId}`),
    as(priya).delete(`/groups/${algorithms.id}/session`),
    as(priya).post(`/groups/${physics.id}/session`, { startMinute: minuteOf('Wed 15:00'), durationMinutes: 90 }),
    as(priya).post('/groups', { name: "A visitor's own group" }),
    // Same name as a demo group: a reset must still tell the two apart.
    as(sam).post('/groups', { name: 'Algorithms study group' }),
    as(sam).put(`/groups/${physics.id}/availability`, { ranges: [range('Wed 15:00', 'Wed 17:00')] }),
    as(sam).delete(`/groups/${algorithms.id}/members/${sam.id}`),
  ];
  for (const change of changes) expect((await change).status).toBeLessThan(300);

  // Time zones last, with "keep my local hours", which also moves saved availability.
  for (const [user, timeZone] of [
    [priya, 'America/New_York'],
    [sam, 'Asia/Tokyo'],
  ]) {
    const res = await as(user).patch('/auth/me', { timeZone, keepLocalTimes: true });
    expect(res.status).toBe(200);
  }
}

describe('demo data', () => {
  test('puts members in India, London and New York', async () => {
    const algorithms = await demoGroup('algorithms');
    const members = await prisma.membership.findMany({
      where: { groupId: algorithms.id },
      include: { user: { select: { email: true, timeZone: true } } },
    });
    const zoneOf = (account) => members.find((m) => m.user.email === account.email).user.timeZone;

    expect(zoneOf(DEMO_ORGANIZER)).toBe('Asia/Kolkata');
    expect(zoneOf(DEMO_MEMBER)).toBe('Europe/London');
    expect(new Set(members.map((m) => m.user.timeZone))).toEqual(
      new Set(['Asia/Kolkata', 'Europe/London', 'America/New_York'])
    );
  });

  test('gives the organizer a confirmed session that is also the top suggestion, with one member yet to reply', async () => {
    const priya = await logInAs(DEMO_ORGANIZER);

    const { body } = await as(priya).get('/groups');
    expect(body.groups.map((g) => [g.name, g.myRole])).toEqual([
      ['Algorithms study group', 'ORGANIZER'],
      ['Physics lab group', 'ORGANIZER'],
    ]);
    const [algorithms, physics] = body.groups;
    expect(algorithms.session).toMatchObject({ startMinute: minuteOf('Tue 13:30'), durationMinutes: 60 });

    const suggestions = (await as(priya).get(`/groups/${algorithms.id}/suggestions?duration=60`)).body;
    expect(suggestions.waitingOn.map((p) => p.name)).toEqual(['Cal']);
    expect(suggestions.mayChange).toBe(true);
    expect(suggestions.suggestions[0]).toMatchObject({ startMinute: minuteOf('Tue 13:30'), durationMinutes: 60 });

    // The second group shows the "waiting for responses" state.
    const waiting = (await as(priya).get(`/groups/${physics.id}/suggestions?duration=60`)).body;
    expect(waiting.reason).toBe('waiting_for_responses');
  });

  test('has a required member who blocks the time most people can make', async () => {
    const priya = await logInAs(DEMO_ORGANIZER);
    const algorithms = await demoGroup('algorithms');
    const suggest = async () =>
      (await as(priya).get(`/groups/${algorithms.id}/suggestions?duration=60`)).body.suggestions;

    // Thursday 14:00 has the most people free...
    const { slots } = (await as(priya).get(`/groups/${algorithms.id}/availability`)).body;
    const busiest = Math.max(...slots.map((free) => free.length));
    expect(busiest).toBe(4);
    expect(slots[minuteOf('Thu 14:00') / 30]).toHaveLength(busiest);

    // ...but Ben is required and busy then, so the best times are smaller ones that include him.
    const withBen = await suggest();
    expect(withBen.map((s) => s.attendees.length)).toEqual([3, 3, 2]);
    expect(withBen.every((s) => s.attendees.some((p) => p.name === 'Ben'))).toBe(true);

    // Making Ben optional brings Thursday to the top.
    const benId = await userId(fixtureUser('Ben'));
    await as(priya).patch(`/groups/${algorithms.id}/members/${benId}`, { required: false });
    const [best] = await suggest();
    expect(best).toMatchObject({ startMinute: minuteOf('Thu 14:00') });
    expect(best.attendees).toHaveLength(4);
  });

  test('gives the member the same groups without the join codes', async () => {
    const sam = await logInAs(DEMO_MEMBER);

    const { body } = await as(sam).get('/groups');

    expect(body.groups.map((g) => [g.name, g.myRole, g.joinCode])).toEqual([
      ['Algorithms study group', 'MEMBER', null],
      ['Physics lab group', 'MEMBER', null],
    ]);
    expect(body.groups[0].session).toMatchObject({ startMinute: minuteOf('Tue 13:30') });
  });

  test("only the two visitor accounts can log in; the other members' passwords are random", async () => {
    for (const user of DEMO_USERS) {
      const visitor = user === DEMO_ORGANIZER || user === DEMO_MEMBER;
      expect((await login(user.email)).status).toBe(visitor ? 200 : 401);
    }
  });
});

describe('demo reset', () => {
  test('runs when the server starts', async () => {
    await resetDb();
    const log = { log: jest.fn(), error: jest.fn() };

    const server = await start({ app, prisma, port: 0, log });
    try {
      expect(await prisma.user.count({ where: { email: { in: DEMO_EMAILS } } })).toBe(DEMO_USERS.length);
      expect((await login(DEMO_ORGANIZER.email)).status).toBe(200);
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('a failed reset at start is logged, and the API still serves requests', async () => {
    const brokenDb = { $transaction: () => Promise.reject(new Error('database is down')) };
    const log = { log: jest.fn(), error: jest.fn() };

    const server = await start({ app, prisma: brokenDb, port: 0, log });
    try {
      expect(log.error).toHaveBeenCalledWith('Demo data reset failed:', expect.any(Error));
      const res = await request(server).get('/api/health');
      expect(res.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test(`a demo login ${RESET_WINDOW_MINUTES}+ minutes after the last reset restores everything a visitor changed`, async () => {
    const fresh = await demoState();
    await changeEverything();
    expect(await demoState()).not.toEqual(fresh);

    minutesLater(RESET_WINDOW_MINUTES + 1);
    const res = await login(DEMO_MEMBER.email);

    expect(res.status).toBe(200);
    // The response has the restored time zone, not the one the previous visitor picked.
    expect(res.body.user.timeZone).toBe(DEMO_MEMBER.timeZone);
    expect(await demoState()).toEqual(fresh);
  });

  test('restores each kind of change on its own', async () => {
    // The big test above could pass if one change hid another; these check them one at a time.
    const fresh = await demoState();
    const priya = await logInAs(DEMO_ORGANIZER);
    const benId = await userId(fixtureUser('Ben'));
    const changes = {
      availability: (groupId) => as(priya).put(`/groups/${groupId}/availability`, { ranges: [] }),
      'time zone': () => as(priya).patch('/auth/me', { timeZone: 'Europe/Paris' }),
      'required flag': (groupId) => as(priya).patch(`/groups/${groupId}/members/${benId}`, { required: false }),
      'removed member': (groupId) => as(priya).delete(`/groups/${groupId}/members/${benId}`),
      'confirmed session': (groupId) =>
        as(priya).post(`/groups/${groupId}/session`, { startMinute: minuteOf('Sat 05:00'), durationMinutes: 60 }),
    };

    const algorithms = await demoGroup('algorithms');
    for (const [kind, change] of Object.entries(changes)) {
      const res = await change(algorithms.id);
      expect({ kind, changed: res.status < 300 }).toEqual({ kind, changed: true });
      expect(await demoState()).not.toEqual(fresh);

      await resetDemoData(prisma);
      expect({ kind, state: await demoState() }).toEqual({ kind, state: fresh });
    }
  });

  test(`a demo login within ${RESET_WINDOW_MINUTES} minutes keeps the previous visitor's changes`, async () => {
    const priya = await logInAs(DEMO_ORGANIZER);
    await as(priya).patch('/auth/me', { timeZone: 'Europe/Paris' });

    minutesLater(RESET_WINDOW_MINUTES - 1);
    const res = await login(DEMO_ORGANIZER.email);

    expect(res.body.user.timeZone).toBe('Europe/Paris');
  });

  test("a wrong password or a real user's login never resets the demo", async () => {
    await changeEverything();
    const changed = await demoState();
    const realUser = await createUser('Real Person');

    minutesLater(RESET_WINDOW_MINUTES + 1);
    expect((await login(DEMO_ORGANIZER.email, 'wrong-password')).status).toBe(401);
    expect((await login(realUser.email, 'password123')).status).toBe(200);

    expect(await demoState()).toEqual(changed);
  });

  test('two visitors opening the demo at once share one reset', async () => {
    await changeEverything();
    const transaction = jest.spyOn(prisma, '$transaction');

    minutesLater(RESET_WINDOW_MINUTES + 1);
    const responses = await Promise.all([login(DEMO_ORGANIZER.email), login(DEMO_MEMBER.email)]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await prisma.group.count()).toBe(2);
  });

  test('resets from two processes at once still leave exactly one demo', async () => {
    // A second copy of the module has its own in-memory state, like `npm run demo:reset` running
    // while the server resets. Only the database lock keeps the two from both rebuilding.
    let otherProcess;
    jest.isolateModules(() => {
      otherProcess = require('../../src/demo/demo');
    });

    await Promise.all([resetDemoData(prisma), otherProcess.resetDemoData(prisma)]);

    expect(await prisma.user.count()).toBe(DEMO_USERS.length);
    expect((await prisma.group.findMany({ orderBy: { name: 'asc' } })).map((g) => g.name)).toEqual([
      'Algorithms study group',
      'Physics lab group',
    ]);
  });

  test("leaves real users' groups, availability and sessions alone", async () => {
    const olivia = await createUser('Olivia');
    const ana = await createUser('Ana');
    const group = await createGroup(olivia, [ana]);
    await setAvailability(olivia, group, [range('Mon 09:00', 'Mon 11:00')]);
    await setAvailability(ana, group, [range('Mon 10:00', 'Mon 12:00')]);
    await as(olivia).post(`/groups/${group.id}/session`, { startMinute: minuteOf('Mon 10:00'), durationMinutes: 60 });
    const realData = () =>
      prisma.group.findUnique({
        where: { id: group.id },
        include: { session: true, memberships: { include: { availability: true }, orderBy: { id: 'asc' } } },
      });
    const before = await realData();

    await resetDemoData(prisma);

    expect(await realData()).toEqual(before);
    expect(await prisma.user.count({ where: { email: { notIn: DEMO_EMAILS } } })).toBe(2);
  });

  test('keeps the demo accounts\' ids, so a visitor who is already logged in stays logged in', async () => {
    const priya = await logInAs(DEMO_ORGANIZER);

    await resetDemoData(prisma);

    const res = await as(priya).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(DEMO_ORGANIZER.email);
  });

  test('keeps the demo groups\' ids, so a visitor on a group page sees fresh data, not "Group not found"', async () => {
    const before = await prisma.group.findMany({ where: { demoKey: { not: null } }, orderBy: { id: 'asc' } });
    const priya = await logInAs(DEMO_ORGANIZER);
    const algorithms = await demoGroup('algorithms');
    await as(priya).delete(`/groups/${algorithms.id}/session`);

    // Another visitor opens the demo while Priya's page is still open.
    minutesLater(RESET_WINDOW_MINUTES + 1);
    await logInAs(DEMO_MEMBER);

    const after = await prisma.group.findMany({ where: { demoKey: { not: null } }, orderBy: { id: 'asc' } });
    expect(after.map((g) => [g.id, g.demoKey, g.joinCode])).toEqual(before.map((g) => [g.id, g.demoKey, g.joinCode]));
    const page = await as(priya).get(`/groups/${algorithms.id}`);
    expect(page.status).toBe(200);
    expect(page.body.group.session).toMatchObject({ startMinute: minuteOf('Tue 13:30') });
  });

  test('restores the demo password if the stored one was changed', async () => {
    await prisma.user.update({ where: { email: DEMO_MEMBER.email }, data: { password: 'not-a-bcrypt-hash' } });

    await resetDemoData(prisma);

    expect((await login(DEMO_MEMBER.email)).status).toBe(200);
  });
});

describe('joining and the demo', () => {
  test.each([
    ['organizer', DEMO_ORGANIZER],
    ['member', DEMO_MEMBER],
  ])("the demo %s can't join a real group", async (_role, account) => {
    const olivia = await createUser('Olivia');
    const group = await createGroup(olivia);
    const visitor = await logInAs(account);

    const res = await as(visitor).post('/groups/join', { joinCode: group.joinCode });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Demo accounts can't join other groups. Create your own account to try joining one.");
    expect(await prisma.membership.count({ where: { groupId: group.id } })).toBe(1);
  });

  test("a demo member who left can't rejoin with the organizer's code either", async () => {
    const sam = await logInAs(DEMO_MEMBER);
    const algorithms = await demoGroup('algorithms');
    await as(sam).delete(`/groups/${algorithms.id}/members/${sam.id}`);

    const res = await as(sam).post('/groups/join', { joinCode: algorithms.joinCode });

    expect(res.status).toBe(403);
  });

  test("a real user can't join a demo group, or a group a demo visitor created", async () => {
    const realUser = await createUser('Real Person');
    const priya = await logInAs(DEMO_ORGANIZER);
    const visitorsGroup = (await as(priya).post('/groups', { name: "A visitor's own group" })).body.group;
    const algorithms = await demoGroup('algorithms');

    for (const joinCode of [algorithms.joinCode, visitorsGroup.joinCode]) {
      const res = await as(realUser).post('/groups/join', { joinCode });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        'That join code belongs to the demo, which nobody can join. Create your own group to try inviting people.'
      );
    }
    expect(await prisma.membership.count({ where: { userId: realUser.id } })).toBe(0);
  });

  test('real users can still join real groups', async () => {
    const olivia = await createUser('Olivia');
    const ana = await createUser('Ana');
    const group = await createGroup(olivia);

    const res = await as(ana).post('/groups/join', { joinCode: group.joinCode });

    expect(res.status).toBe(201);
  });
});

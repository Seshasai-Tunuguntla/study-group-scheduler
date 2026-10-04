const request = require('supertest');
const app = require('../../src/app');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, setAvailability } = require('../helpers/factories');
const { range, minuteOf } = require('../unit/scheduling/weekHelpers');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const confirm = (user, groupId, body) =>
  request(app).post(`/api/groups/${groupId}/session`).set('Authorization', user.auth).send(body);
const getSession = (user, groupId) =>
  request(app).get(`/api/groups/${groupId}/session`).set('Authorization', user.auth);
const clearSession = (user, groupId) =>
  request(app).delete(`/api/groups/${groupId}/session`).set('Authorization', user.auth);

const person = (user, required = true) => ({ userId: user.id, name: user.name, required });
const at = (label, durationMinutes) => ({ startMinute: minuteOf(label), durationMinutes });

async function setup() {
  const organizer = await createUser('Olivia Organizer');
  const ana = await createUser('Ana Member');
  const ben = await createUser('Ben Member');
  const group = await createGroup(organizer, [ana, ben]);
  return { organizer, ana, ben, group };
}

describe('POST /api/groups/:id/session', () => {
  test('the organizer can confirm any valid time, even one that was never suggested', async () => {
    const { organizer, ana, ben, group } = await setup();
    await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
    await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00')]);

    // Tuesday 07:00 suits nobody, but the organizer may know something the data doesn't.
    const res = await confirm(organizer, group.id, at('Tue 07:00', 90));

    expect(res.status).toBe(200);
    expect(res.body.session).toEqual({
      startMinute: minuteOf('Tue 07:00'),
      endMinute: minuteOf('Tue 08:30'),
      durationMinutes: 90,
      confirmedAt: expect.any(String),
      confirmedBy: { userId: organizer.id, name: organizer.name },
      attendance: {
        attendees: [],
        missing: [person(organizer), person(ana)],
        waitingOn: [person(ben)],
      },
    });
  });

  test('confirming again replaces the session (one per group)', async () => {
    const { organizer, group } = await setup();
    await confirm(organizer, group.id, at('Mon 09:00', 60));

    const res = await confirm(organizer, group.id, at('Thu 18:00', 120));

    expect(res.status).toBe(200);
    expect(await prisma.session.findMany({ where: { groupId: group.id } })).toEqual([
      expect.objectContaining({ startMinute: minuteOf('Thu 18:00'), durationMinutes: 120 }),
    ]);
  });

  test('a session can run from Sunday night into Monday', async () => {
    const { organizer, ana, group } = await setup();
    await setAvailability(ana, group, [range('Mon 00:00', 'Mon 02:00'), range('Sun 22:00', 'END')]);
    await setAvailability(organizer, group, [range('Sun 22:00', 'END')]); // free until midnight only

    const res = await confirm(organizer, group.id, at('Sun 23:00', 120));

    expect(res.body.session).toMatchObject({ startMinute: minuteOf('Sun 23:00'), endMinute: minuteOf('Mon 01:00') });
    expect(res.body.session.attendance).toMatchObject({ attendees: [person(ana)], missing: [person(organizer)] });
  });

  test('the confirmed session shows up in the group list and details', async () => {
    const { organizer, ana, group } = await setup();
    await confirm(organizer, group.id, at('Wed 17:00', 60));
    const summary = { startMinute: minuteOf('Wed 17:00'), durationMinutes: 60, confirmedAt: expect.any(String) };

    const list = await request(app).get('/api/groups').set('Authorization', ana.auth);
    const details = await request(app).get(`/api/groups/${group.id}`).set('Authorization', ana.auth);

    expect(list.body.groups[0].session).toEqual(summary);
    expect(details.body.group.session).toEqual(summary);
  });

  test.each([
    ['a start off the 30-minute grid', { startMinute: 545, durationMinutes: 60 }, 'startMinute must be a multiple of 30'],
    ['a start at the end of the week', { startMinute: 10080, durationMinutes: 60 }, 'startMinute must be between 0 and 10050'],
    ['a negative start', { startMinute: -30, durationMinutes: 60 }, 'startMinute must be between 0 and 10050'],
    ['a start sent as a string', { startMinute: '540', durationMinutes: 60 }, 'startMinute must be a number'],
    ['a missing duration', { startMinute: 540 }, 'durationMinutes must be a number'],
    ['a duration off the 30-minute grid', { startMinute: 540, durationMinutes: 45 }, 'durationMinutes must be a multiple of 30'],
    ['a duration over 4 hours', { startMinute: 540, durationMinutes: 270 }, 'durationMinutes must be between 30 and 240 minutes'],
    ['a zero duration', { startMinute: 540, durationMinutes: 0 }, 'durationMinutes must be between 30 and 240 minutes'],
  ])('rejects %s -> 400 and stores nothing', async (_label, body, message) => {
    const { organizer, group } = await setup();

    const res = await confirm(organizer, group.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.session.count()).toBe(0);
  });

  test('a plain member cannot confirm or clear the session', async () => {
    const { organizer, ana, group } = await setup();
    await confirm(organizer, group.id, at('Mon 09:00', 60));

    expect((await confirm(ana, group.id, at('Fri 09:00', 60))).status).toBe(403);
    expect((await clearSession(ana, group.id)).status).toBe(403);
    expect(await prisma.session.findUnique({ where: { groupId: group.id } })).toMatchObject({
      startMinute: minuteOf('Mon 09:00'),
    });
  });
});

describe('GET /api/groups/:id/session', () => {
  test('any member can read it', async () => {
    const { organizer, ben, group } = await setup();
    await confirm(organizer, group.id, at('Mon 09:00', 60));

    const res = await getSession(ben, group.id);

    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({ startMinute: minuteOf('Mon 09:00'), durationMinutes: 60 });
  });

  test('recalculates attendance from current availability on every request', async () => {
    const { organizer, ana, ben, group } = await setup();
    await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
    await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00')]);
    await confirm(organizer, group.id, at('Mon 09:00', 60));

    // After confirming, Ana's week changes and Ben responds for the first time.
    await setAvailability(ana, group, [range('Tue 09:00', 'Tue 10:00')]);
    await setAvailability(ben, group, [range('Mon 08:00', 'Mon 12:00')]);

    const res = await getSession(organizer, group.id);

    expect(res.body.session.attendance).toEqual({
      attendees: [person(organizer), person(ben)],
      missing: [person(ana)],
      waitingOn: [],
    });
  });

  test('is null when nothing has been confirmed', async () => {
    const { ana, group } = await setup();

    const res = await getSession(ana, group.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ session: null });
  });
});

describe('DELETE /api/groups/:id/session', () => {
  test('the organizer can clear the session; clearing again -> 404', async () => {
    const { organizer, group } = await setup();
    await confirm(organizer, group.id, at('Mon 09:00', 60));

    expect((await clearSession(organizer, group.id)).status).toBe(204);
    expect((await getSession(organizer, group.id)).body).toEqual({ session: null });

    const again = await clearSession(organizer, group.id);
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: 'This group has no confirmed session' });
  });
});

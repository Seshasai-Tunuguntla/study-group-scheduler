const request = require('supertest');
const app = require('../../src/app');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, setAvailability, setRequired } = require('../helpers/factories');
const { range, minuteOf } = require('../unit/scheduling/weekHelpers');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const suggest = (user, groupId, query = 'duration=60') =>
  request(app).get(`/api/groups/${groupId}/suggestions?${query}`).set('Authorization', user.auth);

const person = (user, required = true) => ({ userId: user.id, name: user.name, required });
const startsOf = (res) => res.body.suggestions.map((s) => s.startMinute);

async function setup({ organizerTimeZone = 'UTC' } = {}) {
  const organizer = await createUser('Olivia Organizer', { timeZone: organizerTimeZone });
  const ana = await createUser('Ana Member');
  const ben = await createUser('Ben Member');
  const group = await createGroup(organizer, [ana, ben]);
  return { organizer, ana, ben, group };
}

describe('GET /api/groups/:id/suggestions', () => {
  test('returns ranked windows with who can and cannot attend, by name', async () => {
    const { organizer, ana, ben, group } = await setup();
    await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 11:00'), range('Wed 18:00', 'Wed 19:00')]);
    await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00'), range('Wed 18:00', 'Wed 19:00')]);
    await setAvailability(ben, group, [range('Mon 09:00', 'Mon 10:00')]);
    await setRequired(ben, group, false);

    const res = await suggest(ana, group.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      suggestions: [
        {
          startMinute: minuteOf('Mon 09:00'),
          endMinute: minuteOf('Mon 10:00'),
          durationMinutes: 60,
          attendees: [person(organizer), person(ana), person(ben, false)],
          missing: [],
          preferredMinutes: 0,
        },
        {
          startMinute: minuteOf('Wed 18:00'),
          endMinute: minuteOf('Wed 19:00'),
          durationMinutes: 60,
          attendees: [person(organizer), person(ana)],
          missing: [person(ben, false)],
          preferredMinutes: 0,
        },
      ],
      reason: null,
      waitingOn: [],
      mayChange: false,
      durationMinutes: 60,
      preferredWindow: null,
    });
  });

  describe('members who never saved vs. members who saved an empty schedule', () => {
    test('a required member who never saved is left out of the required check and listed in waitingOn', async () => {
      const { organizer, ana, ben, group } = await setup();
      await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00')]);
      // Ben is required (the default) but has never saved availability.

      const res = await suggest(organizer, group.id);

      expect(startsOf(res)).toEqual([minuteOf('Mon 09:00')]);
      expect(res.body.suggestions[0].attendees).toEqual([person(organizer), person(ana)]);
      expect(res.body.suggestions[0].missing).toEqual([]); // Ben isn't "missing", he hasn't answered
      expect(res.body).toMatchObject({ reason: null, waitingOn: [person(ben)], mayChange: true });
    });

    test('a required member who saved an empty schedule follows the normal rules and blocks every window', async () => {
      const { organizer, ana, ben, group } = await setup();
      await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ben, group, []); // responded: never free

      const res = await suggest(organizer, group.id);

      expect(res.body).toMatchObject({ suggestions: [], reason: 'no_common_time', waitingOn: [], mayChange: false });
    });

    test('once that member is made optional, they are reported as missing instead', async () => {
      const { organizer, ana, ben, group } = await setup();
      await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ana, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ben, group, []);
      await setRequired(ben, group, false);

      const res = await suggest(organizer, group.id);

      expect(startsOf(res)).toEqual([minuteOf('Mon 09:00')]);
      expect(res.body.suggestions[0].missing).toEqual([person(ben, false)]);
    });
  });

  describe('reason when there are no suggestions', () => {
    test('a group with only the organizer -> not_enough_members', async () => {
      const olivia = await createUser('Olivia');
      const group = await createGroup(olivia);
      await setAvailability(olivia, group, [range('Mon 09:00', 'Mon 17:00')]);

      const res = await suggest(olivia, group.id);

      expect(res.body).toMatchObject({ suggestions: [], reason: 'not_enough_members', waitingOn: [] });
    });

    test('minAttendees larger than the group -> not_enough_members', async () => {
      const { organizer, group } = await setup();

      const res = await suggest(organizer, group.id, 'duration=60&minAttendees=4');

      expect(res.body.reason).toBe('not_enough_members');
    });

    test('enough members, but too few have saved availability -> waiting_for_responses', async () => {
      const { organizer, ana, ben, group } = await setup();
      await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 17:00')]);

      const res = await suggest(organizer, group.id);

      expect(res.body).toMatchObject({
        suggestions: [],
        reason: 'waiting_for_responses',
        waitingOn: [person(ana), person(ben)],
        mayChange: true,
      });
    });

    test('everyone has responded but nobody overlaps -> no_common_time', async () => {
      const { organizer, ana, ben, group } = await setup();
      await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00')]);
      await setAvailability(ana, group, [range('Tue 09:00', 'Tue 10:00')]);
      await setAvailability(ben, group, [range('Wed 09:00', 'Wed 10:00')]);

      const res = await suggest(organizer, group.id);

      expect(res.body).toMatchObject({ suggestions: [], reason: 'no_common_time', mayChange: false });
    });
  });

  test('passes duration, limit and minAttendees through to the algorithm', async () => {
    const { organizer, ana, ben, group } = await setup();
    for (const user of [organizer, ana, ben]) await setAvailability(user, group, [range('Mon 09:00', 'Mon 17:00')]);
    await setAvailability(ben, group, [range('Mon 09:00', 'Mon 12:00')]);

    const res = await suggest(organizer, group.id, 'duration=120&limit=5&minAttendees=3');

    // Only Ben's 09:00-12:00 fits all three, and only one 2-hour window fits in it.
    expect(res.body.suggestions.map((s) => [s.startMinute, s.endMinute, s.durationMinutes])).toEqual([
      [minuteOf('Mon 09:00'), minuteOf('Mon 11:00'), 120],
    ]);
  });

  describe('preferred window', () => {
    // Two equally attended windows. Without a preference, the earlier one ranks first.
    const A = range('Mon 10:30', 'Mon 11:30'); // = 16:00-17:00 in Asia/Kolkata
    const B = range('Mon 16:00', 'Mon 17:00'); // = 16:00-17:00 in UTC

    test("is read in the requesting user's own time zone", async () => {
      const { organizer, ana, ben, group } = await setup({ organizerTimeZone: 'Asia/Kolkata' });
      for (const user of [organizer, ana]) await setAvailability(user, group, [A, B]);
      await setAvailability(ben, group, []);
      await setRequired(ben, group, false);
      const query = 'duration=60&preferredStart=16:00&preferredEnd=17:00';

      expect(startsOf(await suggest(ana, group.id, 'duration=60'))).toEqual([A.startMinute, B.startMinute]);

      // Ana (UTC) means 16:00 UTC, so B moves to the top.
      const anas = await suggest(ana, group.id, query);
      expect(startsOf(anas)).toEqual([B.startMinute, A.startMinute]);
      expect(anas.body.preferredWindow).toEqual({ start: '16:00', end: '17:00', timeZone: 'UTC' });

      // The organizer (India) means 16:00 IST = 10:30 UTC, so A stays on top, now as preferred.
      const organizers = await suggest(organizer, group.id, query);
      expect(startsOf(organizers)).toEqual([A.startMinute, B.startMinute]);
      expect(organizers.body.suggestions.map((s) => s.preferredMinutes)).toEqual([60, 0]);
      expect(organizers.body.preferredWindow).toEqual({ start: '16:00', end: '17:00', timeZone: 'Asia/Kolkata' });
    });

    test('applies to the same hours every day', async () => {
      const { organizer, ana, group } = await setup();
      const windows = [range('Mon 18:00', 'Mon 19:00'), range('Fri 09:00', 'Fri 10:00'), range('Fri 18:00', 'Fri 19:00')];
      for (const user of [organizer, ana]) await setAvailability(user, group, windows);

      const res = await suggest(organizer, group.id, 'duration=60&preferredStart=17:00&preferredEnd=20:00');

      // Both evenings are preferred, so Friday evening outranks the earlier Friday morning.
      expect(startsOf(res)).toEqual([minuteOf('Mon 18:00'), minuteOf('Fri 18:00'), minuteOf('Fri 09:00')]);
      expect(res.body.suggestions.map((s) => s.preferredMinutes)).toEqual([60, 60, 0]);
    });

    test('can cross midnight (22:00-01:00)', async () => {
      const { organizer, ana, group } = await setup();
      const windows = [range('Mon 09:00', 'Mon 10:00'), range('Tue 00:00', 'Tue 01:00')];
      for (const user of [organizer, ana]) await setAvailability(user, group, windows);

      const res = await suggest(organizer, group.id, 'duration=60&preferredStart=22:00&preferredEnd=01:00');

      // Tuesday 00:00-01:00 is inside Monday night's 22:00-01:00 window.
      expect(startsOf(res)).toEqual([minuteOf('Tue 00:00'), minuteOf('Mon 09:00')]);
    });
  });

  test.each([
    ['a missing duration', '', 'duration must be a number of minutes'],
    ['a duration that is not a number', 'duration=abc', 'duration must be a number of minutes'],
    ['a duration off the 30-minute grid', 'duration=45', 'duration must be a multiple of 30'],
    ['a duration over 4 hours', 'duration=270', 'duration must be between 30 and 240 minutes'],
    ['limit 0', 'duration=60&limit=0', 'limit must be a whole number from 1 to 10'],
    ['limit 11', 'duration=60&limit=11', 'limit must be a whole number from 1 to 10'],
    ['minAttendees 0', 'duration=60&minAttendees=0', 'minAttendees must be a whole number from 1 to 1000'],
    ['only preferredStart', 'duration=60&preferredStart=16:00', 'preferredStart and preferredEnd must be given together'],
    ['a time off the half hour', 'duration=60&preferredStart=16:15&preferredEnd=21:00', 'preferredStart must be a time on the half hour, like 16:00 or 16:30'],
    ['a time past 23:30', 'duration=60&preferredStart=16:00&preferredEnd=24:00', 'preferredEnd must be a time on the half hour, like 16:00 or 16:30'],
    ['an empty preferred window', 'duration=60&preferredStart=16:00&preferredEnd=16:00', 'the preferred window must not be empty (preferredStart equals preferredEnd)'],
  ])('rejects %s -> 400', async (_label, query, message) => {
    const { organizer, group } = await setup();

    const res = await suggest(organizer, group.id, query);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });
});

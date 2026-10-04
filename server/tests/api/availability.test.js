const request = require('supertest');
const app = require('../../src/app');
const ranges = require('../../src/scheduling/ranges');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, findMembership } = require('../helpers/factories');
const { minuteOf } = require('../unit/scheduling/weekHelpers');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const save = (user, groupId, body) =>
  request(app).put(`/api/groups/${groupId}/availability`).set('Authorization', user.auth).send(body);
const heatmap = (user, groupId) =>
  request(app).get(`/api/groups/${groupId}/availability`).set('Authorization', user.auth);

// range('Mon 09:00', 'Mon 10:00') -> { startMinute: 540, endMinute: 600 }. 'END' is Sunday 24:00.
const range = (from, to) => ({ startMinute: minuteOf(from), endMinute: to === 'END' ? 10080 : minuteOf(to) });

const storedRanges = async (user, group) => {
  const membership = await findMembership(user, group);
  return prisma.availabilityRange.findMany({
    where: { membershipId: membership.id },
    select: { startMinute: true, endMinute: true },
    orderBy: { startMinute: 'asc' },
  });
};

async function setup() {
  const organizer = await createUser('Olivia Organizer');
  const ana = await createUser('Ana Member');
  const ben = await createUser('Ben Member');
  const group = await createGroup(organizer, [ana, ben]);
  return { organizer, ana, ben, group };
}

describe('PUT /api/groups/:id/availability', () => {
  test('saves my ranges in stored form: wrap-arounds split, touching ranges merged, sorted', async () => {
    const { ana, group } = await setup();

    const res = await save(ana, group.id, {
      ranges: [
        range('Tue 10:00', 'Tue 11:00'),
        range('Sun 23:00', 'Mon 01:00'), // wraps past Sunday midnight
        range('Tue 09:00', 'Tue 10:00'), // touches the Tuesday range above
      ],
    });

    const expected = [range('Mon 00:00', 'Mon 01:00'), range('Tue 09:00', 'Tue 11:00'), range('Sun 23:00', 'END')];
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ranges: expected, availabilityUpdatedAt: expect.any(String) });
    expect(await storedRanges(ana, group)).toEqual(expected);
  });

  test('replaces my previous ranges rather than adding to them', async () => {
    const { ana, group } = await setup();
    await save(ana, group.id, { ranges: [range('Mon 09:00', 'Mon 12:00'), range('Wed 09:00', 'Wed 10:00')] });

    await save(ana, group.id, { ranges: [range('Fri 18:00', 'Fri 20:00')] });

    expect(await storedRanges(ana, group)).toEqual([range('Fri 18:00', 'Fri 20:00')]);
  });

  test('saving an empty schedule clears my ranges but still marks me as having responded', async () => {
    const { ana, ben, group } = await setup();
    await save(ana, group.id, { ranges: [range('Mon 09:00', 'Mon 12:00')] });

    const res = await save(ana, group.id, { ranges: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ranges: [], availabilityUpdatedAt: expect.any(String) });
    expect(await storedRanges(ana, group)).toEqual([]);
    // "saved, never free" (Ana) is recorded differently from "never saved" (Ben).
    expect((await findMembership(ana, group)).availabilityUpdatedAt).toBeInstanceOf(Date);
    expect((await findMembership(ben, group)).availabilityUpdatedAt).toBeNull();
  });

  test('each save moves availabilityUpdatedAt forward', async () => {
    const { ana, group } = await setup();

    const first = await save(ana, group.id, { ranges: [] });
    const second = await save(ana, group.id, { ranges: [] });

    expect(new Date(second.body.availabilityUpdatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.availabilityUpdatedAt).getTime()
    );
  });

  test("only changes my availability in this group, never another member's or another group's", async () => {
    const { organizer, ana, ben, group } = await setup();
    const otherGroup = await createGroup(organizer, [ana]);
    await save(ben, group.id, { ranges: [range('Mon 09:00', 'Mon 10:00')] });
    await save(ana, otherGroup.id, { ranges: [range('Tue 09:00', 'Tue 10:00')] });

    await save(ana, group.id, { ranges: [range('Wed 09:00', 'Wed 10:00')] });

    expect(await storedRanges(ben, group)).toEqual([range('Mon 09:00', 'Mon 10:00')]);
    expect(await storedRanges(ana, otherGroup)).toEqual([range('Tue 09:00', 'Tue 10:00')]);
  });

  test('is atomic: if inserting the new ranges fails, the old ranges and timestamp are kept', async () => {
    const { ana, group } = await setup();
    await save(ana, group.id, { ranges: [range('Mon 09:00', 'Mon 12:00')] });
    const before = await findMembership(ana, group);
    // Let a range that breaks the database's CHECK constraint slip past validation, so the
    // insert fails after the delete and timestamp update have already run in the transaction.
    jest.spyOn(ranges, 'normalizeRanges').mockReturnValue([{ startMinute: 545, endMinute: 600 }]);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await save(ana, group.id, { ranges: [range('Tue 09:00', 'Tue 10:00')] });

    expect(res.status).toBe(500);
    expect(await storedRanges(ana, group)).toEqual([range('Mon 09:00', 'Mon 12:00')]);
    expect(await findMembership(ana, group)).toEqual(before);
  });

  test('two saves at the same moment never mix: the result is exactly one of them', async () => {
    const { ana, group } = await setup();
    const mondays = [range('Mon 09:00', 'Mon 10:00'), range('Mon 14:00', 'Mon 15:00')];
    const fridays = [range('Fri 09:00', 'Fri 10:00'), range('Fri 14:00', 'Fri 15:00')];

    for (let round = 0; round < 10; round++) {
      await Promise.all([save(ana, group.id, { ranges: mondays }), save(ana, group.id, { ranges: fridays })]);

      expect([mondays, fridays]).toContainEqual(await storedRanges(ana, group));
    }
  });

  test(`accepts up to 336 ranges per request`, async () => {
    const { ana, group } = await setup();
    // Every slot of the week sent as its own one-slot range; they all merge into one.
    const everySlot = Array.from({ length: 336 }, (_, i) => ({ startMinute: i * 30, endMinute: i * 30 + 30 }));

    const res = await save(ana, group.id, { ranges: everySlot });

    expect(res.status).toBe(200);
    expect(res.body.ranges).toEqual([{ startMinute: 0, endMinute: 10080 }]);
  });

  test.each([
    ['no ranges field', {}, 'ranges must be an array'],
    ['ranges that is not an array', { ranges: 'Mon 9-10' }, 'ranges must be an array'],
    ['more than 336 ranges', { ranges: Array.from({ length: 337 }, () => range('Mon 09:00', 'Mon 09:30')) }, 'at most 336 ranges per request'],
    ['a start off the 30-minute grid', { ranges: [{ startMinute: 545, endMinute: 600 }] }, 'startMinute must be a multiple of 30'],
    ['an end off the 30-minute grid', { ranges: [{ startMinute: 540, endMinute: 610 }] }, 'endMinute must be a multiple of 30'],
    ['a negative start', { ranges: [{ startMinute: -30, endMinute: 60 }] }, 'startMinute must be between 0 and 10050'],
    ['a start at the end of the week', { ranges: [{ startMinute: 10080, endMinute: 60 }] }, 'startMinute must be between 0 and 10050'],
    ['an end past the end of the week', { ranges: [{ startMinute: 540, endMinute: 10110 }] }, 'endMinute must be between 0 and 10080'],
    ['a fractional minute', { ranges: [{ startMinute: 540.5, endMinute: 600 }] }, 'startMinute must be a whole number'],
    ['a minute sent as a string', { ranges: [{ startMinute: '540', endMinute: 600 }] }, 'startMinute must be a number'],
    ['a missing end', { ranges: [{ startMinute: 540 }] }, 'endMinute must be a number'],
    ['an empty range', { ranges: [{ startMinute: 540, endMinute: 540 }] }, 'a range must not be empty'],
    ['overlapping ranges', { ranges: [range('Mon 09:00', 'Mon 10:00'), range('Mon 09:30', 'Mon 11:00')] }, 'ranges overlap: [540, 600) and [570, 660)'],
  ])('rejects %s -> 400 and keeps the old ranges', async (_label, body, message) => {
    const { ana, group } = await setup();
    await save(ana, group.id, { ranges: [range('Mon 09:00', 'Mon 10:00')] });
    const before = await findMembership(ana, group);

    const res = await save(ana, group.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await storedRanges(ana, group)).toEqual([range('Mon 09:00', 'Mon 10:00')]);
    expect(await findMembership(ana, group)).toEqual(before);
  });
});

describe('GET /api/groups/:id/availability (heatmap)', () => {
  test('lists, for each UTC slot, which members are free', async () => {
    const { organizer, ana, ben, group } = await setup();
    await save(organizer, group.id, { ranges: [range('Mon 09:00', 'Mon 10:00')] });
    await save(ana, group.id, { ranges: [range('Mon 09:30', 'Mon 11:00')] });

    const res = await heatmap(ben, group.id);

    expect(res.status).toBe(200);
    const { slots } = res.body;
    expect(slots).toHaveLength(336);
    expect(slots[17]).toEqual([]); // Mon 08:30
    expect(slots[18]).toEqual([organizer.id]); // Mon 09:00
    expect(slots[19]).toEqual([organizer.id, ana.id]); // Mon 09:30: two free
    expect(slots[20]).toEqual([ana.id]); // Mon 10:00
    expect(slots[21]).toEqual([ana.id]); // Mon 10:30
    expect(slots[22]).toEqual([]); // Mon 11:00
    expect(slots.flat()).toHaveLength(5); // the five entries above: nobody is free anywhere else
  });

  test('a Sunday-into-Monday block shows up at both ends of the week', async () => {
    const { ana, group } = await setup();
    await save(ana, group.id, { ranges: [range('Sun 23:00', 'Mon 01:00')] });

    const { slots } = (await heatmap(ana, group.id)).body;

    expect([334, 335, 0, 1].map((slot) => slots[slot])).toEqual([[ana.id], [ana.id], [ana.id], [ana.id]]);
    expect(slots[2]).toEqual([]);
    expect(slots[333]).toEqual([]);
  });

  test('lists every member by name only, with who has responded, organizer first', async () => {
    const { organizer, ana, ben, group } = await setup();
    await save(ana, group.id, { ranges: [] });

    const { members } = (await heatmap(ben, group.id)).body;

    expect(members.map((m) => [m.name, m.role, m.availabilityUpdatedAt === null])).toEqual([
      [organizer.name, 'ORGANIZER', true], // never saved
      [ana.name, 'MEMBER', false], // saved an empty schedule
      [ben.name, 'MEMBER', true],
    ]);
    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual(
        ['availabilityUpdatedAt', 'joinedAt', 'name', 'required', 'role', 'userId'].sort()
      );
    }
    expect(JSON.stringify(members)).not.toContain('@example.com');
  });

  test('includes my own stored ranges so the grid can be pre-filled', async () => {
    const { ana, ben, group } = await setup();
    await save(ana, group.id, { ranges: [range('Sun 23:00', 'Mon 01:00')] });
    await save(ben, group.id, { ranges: [range('Wed 09:00', 'Wed 10:00')] });

    const res = await heatmap(ana, group.id);

    expect(res.body.myRanges).toEqual([range('Mon 00:00', 'Mon 01:00'), range('Sun 23:00', 'END')]);
  });

  test('a group where nobody has saved yet has an empty heatmap', async () => {
    const { ana, group } = await setup();

    const res = await heatmap(ana, group.id);

    expect(res.body.slots.every((slot) => slot.length === 0)).toBe(true);
    expect(res.body.myRanges).toEqual([]);
  });
});

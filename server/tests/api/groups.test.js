const request = require('supertest');
const app = require('../../src/app');
const joinCodes = require('../../src/utils/joinCode');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, findMembership, setAvailability } = require('../helpers/factories');
const { range, slotOf } = require('../unit/scheduling/weekHelpers');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const api = {
  create: (user, body) => request(app).post('/api/groups').set('Authorization', user.auth).send(body),
  list: (user) => request(app).get('/api/groups').set('Authorization', user.auth),
  get: (user, groupId) => request(app).get(`/api/groups/${groupId}`).set('Authorization', user.auth),
  join: (user, joinCode) => request(app).post('/api/groups/join').set('Authorization', user.auth).send({ joinCode }),
  setRequired: (user, groupId, userId, required) =>
    request(app).patch(`/api/groups/${groupId}/members/${userId}`).set('Authorization', user.auth).send({ required }),
  remove: (user, groupId, userId) =>
    request(app).delete(`/api/groups/${groupId}/members/${userId}`).set('Authorization', user.auth),
};

const JOIN_CODE_PATTERN = new RegExp(`^[${joinCodes.JOIN_CODE_ALPHABET}]{8}$`);

// A group with an organizer, two members, and an outsider who belongs to no group.
async function setup() {
  const organizer = await createUser('Olivia Organizer');
  const ana = await createUser('Ana Member');
  const ben = await createUser('Ben Member');
  const outsider = await createUser('Oscar Outsider');
  const group = await createGroup(organizer, [ana, ben]);
  return { organizer, ana, ben, outsider, group };
}

describe('POST /api/groups', () => {
  test('creates the group with the caller as its required organizer', async () => {
    const olivia = await createUser('Olivia');

    const res = await api.create(olivia, { name: '  Linear Algebra crew  ' });

    expect(res.status).toBe(201);
    expect(res.body.group).toEqual({
      id: expect.any(Number),
      name: 'Linear Algebra crew',
      createdAt: expect.any(String),
      joinCode: expect.stringMatching(JOIN_CODE_PATTERN),
      myRole: 'ORGANIZER',
      members: [
        {
          userId: olivia.id,
          name: 'Olivia',
          role: 'ORGANIZER',
          required: true,
          joinedAt: expect.any(String),
          availabilityUpdatedAt: null,
        },
      ],
      session: null,
    });
    expect(await prisma.group.findUnique({ where: { id: res.body.group.id } })).toMatchObject({
      createdById: olivia.id,
    });
  });

  test('ignores fields the client may not set (join code, creator)', async () => {
    const olivia = await createUser();
    const other = await createUser();

    const res = await api.create(olivia, { name: 'Study group', joinCode: 'AAAAAAAA', createdById: other.id });

    expect(res.status).toBe(201);
    expect(res.body.group.joinCode).not.toBe('AAAAAAAA');
    expect(res.body.group.members.map((m) => m.userId)).toEqual([olivia.id]);
  });

  test.each([
    ['a missing name', {}, 'name is required'],
    ['a blank name', { name: '   ' }, 'name is required'],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, 'name must be at most 100 characters'],
  ])('rejects %s -> 400', async (_label, body, message) => {
    const olivia = await createUser();

    const res = await api.create(olivia, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(await prisma.group.count()).toBe(0);
  });

  test('draws a new join code if the first one is already taken', async () => {
    const { group: existing, organizer } = await setup();
    const spy = jest
      .spyOn(joinCodes, 'generateJoinCode')
      .mockReturnValueOnce(existing.joinCode)
      .mockReturnValueOnce('FRESH234');

    const res = await api.create(organizer, { name: 'Second group' });

    expect(res.status).toBe(201);
    expect(res.body.group.joinCode).toBe('FRESH234');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/groups', () => {
  test("lists only the caller's groups, with their role in each", async () => {
    const { organizer, ana, group } = await setup();
    const anasOwnGroup = await createGroup(ana, [], { name: "Ana's group" });
    await createGroup(organizer, [], { name: 'Not Ana' });

    const res = await api.list(ana);

    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([
      {
        id: group.id,
        name: 'Algorithms study group',
        myRole: 'MEMBER',
        required: true,
        availabilityUpdatedAt: null,
        memberCount: 3,
        joinCode: null,
        session: null,
        heat: { respondedCount: 0, freeCounts: new Array(336).fill(0) },
      },
      expect.objectContaining({
        id: anasOwnGroup.id,
        myRole: 'ORGANIZER',
        memberCount: 1,
        joinCode: anasOwnGroup.joinCode,
      }),
    ]);
  });

  test('includes the confirmed session for the dashboard', async () => {
    const { organizer, ana, group } = await setup();
    await prisma.session.create({
      data: { groupId: group.id, confirmedById: organizer.id, startMinute: 1110, durationMinutes: 90 },
    });

    const res = await api.list(ana);

    expect(res.body.groups[0].session).toEqual({
      startMinute: 1110,
      durationMinutes: 90,
      confirmedAt: expect.any(String),
    });
  });

  test("includes each group's heat summary: how many are free in each UTC slot", async () => {
    const { organizer, ana, ben, group } = await setup();
    // The organizer's Sunday-night block wraps into Monday (stored as two ranges).
    await setAvailability(organizer, group, [range('Mon 09:00', 'Mon 10:00'), range('Sun 23:30', 'END'), range('Mon 00:00', 'Mon 00:30')]);
    await setAvailability(ana, group, [range('Mon 09:30', 'Mon 10:30')]);
    // Ben never saved: he isn't counted, and doesn't lower any count.

    const { heat } = (await api.list(ana)).body.groups[0];

    expect(heat.respondedCount).toBe(2);
    expect(heat.freeCounts).toHaveLength(336);
    const expected = new Array(336).fill(0);
    expected[slotOf('Mon 09:00')] = 1;
    expected[slotOf('Mon 09:30')] = 2;
    expected[slotOf('Mon 10:00')] = 1;
    expected[slotOf('Sun 23:30')] = 1;
    expected[slotOf('Mon 00:00')] = 1;
    expect(heat.freeCounts).toEqual(expected);

    // Saving an empty week counts as replying, without adding any free time.
    await setAvailability(ben, group, []);
    const after = (await api.list(ana)).body.groups[0].heat;
    expect(after.respondedCount).toBe(3);
    expect(after.freeCounts).toEqual(expected);
  });

  test('keeps the heat summaries of different groups apart, and gives counts only', async () => {
    const { organizer, ana, group } = await setup();
    const anasOwnGroup = await createGroup(ana, [organizer], { name: "Ana's group" });
    await setAvailability(ana, group, [range('Tue 18:00', 'Tue 19:00')]);
    await setAvailability(ana, anasOwnGroup, [range('Fri 12:00', 'Fri 12:30')]);
    await setAvailability(organizer, anasOwnGroup, [range('Fri 12:00', 'Fri 12:30')]);

    const [first, second] = (await api.list(ana)).body.groups;

    expect(Object.keys(first.heat)).toEqual(['respondedCount', 'freeCounts']);
    expect(first.heat.respondedCount).toBe(1);
    expect(first.heat.freeCounts[slotOf('Tue 18:00')]).toBe(1);
    expect(first.heat.freeCounts[slotOf('Fri 12:00')]).toBe(0);
    expect(second.heat.respondedCount).toBe(2);
    expect(second.heat.freeCounts[slotOf('Fri 12:00')]).toBe(2);
    expect(second.heat.freeCounts[slotOf('Tue 18:00')]).toBe(0);
  });

  test('is empty for someone in no groups', async () => {
    const { outsider } = await setup();

    const res = await api.list(outsider);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ groups: [] });
  });
});

describe('GET /api/groups/:id', () => {
  test('a member sees the members (organizer first) but not the join code', async () => {
    const { organizer, ana, ben, group } = await setup();

    const res = await api.get(ana, group.id);

    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ id: group.id, myRole: 'MEMBER', joinCode: null, session: null });
    expect(res.body.group.members.map((m) => [m.name, m.role])).toEqual([
      [organizer.name, 'ORGANIZER'],
      [ana.name, 'MEMBER'],
      [ben.name, 'MEMBER'],
    ]);
  });

  test("never exposes other members' emails or time zones", async () => {
    const { ana, group } = await setup();

    const res = await api.get(ana, group.id);

    for (const member of res.body.group.members) {
      expect(Object.keys(member).sort()).toEqual(
        ['availabilityUpdatedAt', 'joinedAt', 'name', 'required', 'role', 'userId'].sort()
      );
    }
  });

  test('the organizer sees the join code', async () => {
    const { organizer, group } = await setup();

    const res = await api.get(organizer, group.id);

    expect(res.body.group).toMatchObject({ myRole: 'ORGANIZER', joinCode: group.joinCode });
  });
});

describe('POST /api/groups/join', () => {
  test('joins as a required MEMBER', async () => {
    const { group, outsider } = await setup();

    const res = await api.join(outsider, group.joinCode);

    expect(res.status).toBe(201);
    expect(res.body.group).toMatchObject({ id: group.id, myRole: 'MEMBER', joinCode: null });
    expect(await findMembership(outsider, group)).toMatchObject({
      role: 'MEMBER',
      required: true,
      availabilityUpdatedAt: null,
    });
  });

  test('accepts the code in lowercase, with spaces or a dash', async () => {
    const { group, outsider } = await setup();
    const typed = `${group.joinCode.slice(0, 4)}-${group.joinCode.slice(4)}`.toLowerCase();

    const res = await api.join(outsider, `  ${typed} `);

    expect(res.status).toBe(201);
  });

  test('an unknown code -> 404', async () => {
    const { outsider } = await setup();

    const res = await api.join(outsider, 'ZZZZZZZZ');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No group has that join code' });
  });

  test.each([
    ['a member', 'ana'],
    ['the organizer', 'organizer'],
  ])('%s joining again -> 409, membership unchanged', async (_label, who) => {
    const people = await setup();
    await prisma.membership.updateMany({ where: { userId: people[who].id }, data: { required: false } });

    const res = await api.join(people[who], people.group.joinCode);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "You're already a member of this group" });
    expect(await findMembership(people[who], people.group)).toMatchObject({ required: false });
  });

  test.each([
    ['missing', undefined, 'joinCode is required'],
    ['too short', 'ABC', 'joinCode must be 8 characters'],
    ['too long', 'ABCDEFGHJ', 'joinCode must be 8 characters'],
  ])('a %s code -> 400', async (_label, joinCode, message) => {
    const { outsider } = await setup();

    const res = await api.join(outsider, joinCode);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });
});

describe('PATCH /api/groups/:id/members/:userId', () => {
  test('the organizer can mark a member optional and back', async () => {
    const { organizer, ana, group } = await setup();

    const res = await api.setRequired(organizer, group.id, ana.id, false);

    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ userId: ana.id, name: ana.name, required: false });
    expect(await findMembership(ana, group)).toMatchObject({ required: false });

    await api.setRequired(organizer, group.id, ana.id, true);
    expect(await findMembership(ana, group)).toMatchObject({ required: true });
  });

  test.each([
    ['another member', 'ben'],
    ['themselves', 'ana'],
  ])('a plain member changing %s -> 403', async (_label, target) => {
    const people = await setup();

    const res = await api.setRequired(people.ana, people.group.id, people[target].id, false);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only the organizer can do that' });
    expect(await findMembership(people[target], people.group)).toMatchObject({ required: true });
  });

  test('cannot change anything but `required`, e.g. promote a member to organizer', async () => {
    const { organizer, ana, group } = await setup();

    await request(app)
      .patch(`/api/groups/${group.id}/members/${ana.id}`)
      .set('Authorization', organizer.auth)
      .send({ required: true, role: 'ORGANIZER', groupId: 999 });

    expect(await findMembership(ana, group)).toMatchObject({ role: 'MEMBER', groupId: group.id });
  });

  test('a user who is not in this group -> 404', async () => {
    const { organizer, outsider, group } = await setup();

    const res = await api.setRequired(organizer, group.id, outsider.id, false);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "That user isn't a member of this group" });
  });

  test.each([
    ['missing', {}],
    ['not a boolean', { required: 'yes' }],
  ])('a %s `required` -> 400', async (_label, body) => {
    const { organizer, ana, group } = await setup();

    const res = await request(app)
      .patch(`/api/groups/${group.id}/members/${ana.id}`)
      .set('Authorization', organizer.auth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('required must be true or false');
  });
});

describe('DELETE /api/groups/:id/members/:userId', () => {
  test('the organizer removes a member, and their availability goes with them', async () => {
    const { organizer, ana, group } = await setup();
    const membership = await findMembership(ana, group);
    await prisma.availabilityRange.create({ data: { membershipId: membership.id, startMinute: 540, endMinute: 600 } });

    const res = await api.remove(organizer, group.id, ana.id);

    expect(res.status).toBe(204);
    expect(await findMembership(ana, group)).toBeNull();
    expect(await prisma.availabilityRange.count()).toBe(0);
  });

  test('a member can leave', async () => {
    const { ana, group } = await setup();

    const res = await api.remove(ana, group.id, ana.id);

    expect(res.status).toBe(204);
    expect(await findMembership(ana, group)).toBeNull();
  });

  test.each([
    ['another member', 'ben'],
    ['the organizer', 'organizer'],
  ])('a plain member removing %s -> 403', async (_label, target) => {
    const people = await setup();

    const res = await api.remove(people.ana, people.group.id, people[target].id);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only the organizer can remove other members' });
    expect(await findMembership(people[target], people.group)).not.toBeNull();
  });

  test("the organizer can't remove themselves -> 409 (no back door around leaving)", async () => {
    const { organizer, group } = await setup();

    const res = await api.remove(organizer, group.id, organizer.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Organizers can't leave their own group" });
    expect(await findMembership(organizer, group)).toMatchObject({ role: 'ORGANIZER' });
  });

  test('a user who is not in this group -> 404', async () => {
    const { organizer, outsider, group } = await setup();

    const res = await api.remove(organizer, group.id, outsider.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "That user isn't a member of this group" });
  });

  test('a removed member loses access immediately', async () => {
    const { organizer, ana, group } = await setup();
    await api.remove(organizer, group.id, ana.id);

    const res = await api.get(ana, group.id);

    expect(res.status).toBe(404);
  });
});

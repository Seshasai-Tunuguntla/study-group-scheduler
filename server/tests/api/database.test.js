// Checks the rules the schema itself enforces (unique keys, cascades, CHECK constraints),
// independently of the API validation that normally runs first.
const { resetDb, prisma } = require('../helpers/db');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function createGroupWithOrganizer() {
  const user = await prisma.user.create({
    data: { name: 'Ana', email: 'ana@example.com', password: 'hash', timeZone: 'UTC' },
  });
  const group = await prisma.group.create({
    data: {
      name: 'Algorithms study group',
      joinCode: 'ABCD1234',
      createdById: user.id,
      memberships: { create: { userId: user.id, role: 'ORGANIZER' } },
    },
    include: { memberships: true },
  });
  return { user, group, membership: group.memberships[0] };
}

describe('database rules', () => {
  test('queries omit the password hash unless they opt in', async () => {
    const { user } = await createGroupWithOrganizer();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toHaveProperty('password');
    expect(
      await prisma.user.findUnique({ where: { id: user.id }, omit: { password: false } })
    ).toHaveProperty('password', 'hash');
  });

  test('new memberships default to MEMBER, required, and "availability never saved"', async () => {
    const { group } = await createGroupWithOrganizer();
    const ben = await prisma.user.create({
      data: { name: 'Ben', email: 'ben@example.com', password: 'hash', timeZone: 'UTC' },
    });

    const membership = await prisma.membership.create({ data: { userId: ben.id, groupId: group.id } });

    expect(membership).toMatchObject({ role: 'MEMBER', required: true, availabilityUpdatedAt: null });
  });

  test('a user can only be in a group once', async () => {
    const { user, group } = await createGroupWithOrganizer();

    await expect(
      prisma.membership.create({ data: { userId: user.id, groupId: group.id } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('deleting a membership deletes its availability ranges', async () => {
    const { membership } = await createGroupWithOrganizer();
    await prisma.availabilityRange.createMany({
      data: [
        { membershipId: membership.id, startMinute: 540, endMinute: 660 }, // Mon 09:00-11:00
        { membershipId: membership.id, startMinute: 1980, endMinute: 2100 }, // Tue 09:00-11:00
      ],
    });

    await prisma.membership.delete({ where: { id: membership.id } });

    expect(await prisma.availabilityRange.count()).toBe(0);
  });

  test('a group can have only one confirmed session', async () => {
    const { user, group } = await createGroupWithOrganizer();
    const session = { groupId: group.id, confirmedById: user.id, startMinute: 540, durationMinutes: 60 };
    await prisma.session.create({ data: session });

    await expect(prisma.session.create({ data: session })).rejects.toMatchObject({ code: 'P2002' });
  });

  test.each([
    ['start not on a 30-minute boundary', 545, 600],
    ['end not on a 30-minute boundary', 540, 610],
    ['negative start', -30, 60],
    ['end past the end of the week', 10050, 10110],
    ['empty range', 600, 600],
    ['end before start', 660, 600],
  ])('rejects an availability range with %s', async (_label, startMinute, endMinute) => {
    const { membership } = await createGroupWithOrganizer();

    await expect(
      prisma.availabilityRange.create({ data: { membershipId: membership.id, startMinute, endMinute } })
    ).rejects.toThrow('AvailabilityRange_minutes_check');
  });

  test('accepts a range that ends exactly at the end of the week', async () => {
    const { membership } = await createGroupWithOrganizer();

    await expect(
      prisma.availabilityRange.create({ data: { membershipId: membership.id, startMinute: 10020, endMinute: 10080 } })
    ).resolves.toMatchObject({ endMinute: 10080 });
  });

  test.each([
    ['duration over 4 hours', 540, 270],
    ['duration not a multiple of 30', 540, 45],
    ['start at the week length', 10080, 60],
    ['start not on a 30-minute boundary', 545, 60],
  ])('rejects a session with %s', async (_label, startMinute, durationMinutes) => {
    const { user, group } = await createGroupWithOrganizer();

    await expect(
      prisma.session.create({ data: { groupId: group.id, confirmedById: user.id, startMinute, durationMinutes } })
    ).rejects.toThrow('Session_time_check');
  });
});

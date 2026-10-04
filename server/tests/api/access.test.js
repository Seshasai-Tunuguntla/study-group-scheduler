// Who may call which group route. Every /api/groups/:id route is listed here once, so each new
// route gets the same checks: a token is required, non-members get 404 (exactly like a missing
// group, so sequential ids reveal nothing), and organizer-only routes refuse plain members.
const request = require('supertest');
const app = require('../../src/app');
const { resetDb, prisma } = require('../helpers/db');
const { createUser, createGroup, findMembership } = require('../helpers/factories');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const as = (user) => ({
  get: (path) => request(app).get(path).set('Authorization', user.auth),
  put: (path, body) => request(app).put(path).set('Authorization', user.auth).send(body),
  patch: (path, body) => request(app).patch(path).set('Authorization', user.auth).send(body),
  delete: (path) => request(app).delete(path).set('Authorization', user.auth),
});

// [label, (client, groupId, target) => request]. `target` is a member the request acts on.
const memberRoutes = [
  ['GET /groups/:id', (c, id) => c.get(`/api/groups/${id}`)],
  ['GET /groups/:id/availability', (c, id) => c.get(`/api/groups/${id}/availability`)],
  ['PUT /groups/:id/availability', (c, id) => c.put(`/api/groups/${id}/availability`, { ranges: [] })],
  ['DELETE /groups/:id/members/:userId', (c, id, target) => c.delete(`/api/groups/${id}/members/${target.id}`)],
];
const organizerRoutes = [
  ['PATCH /groups/:id/members/:userId', (c, id, target) => c.patch(`/api/groups/${id}/members/${target.id}`, { required: false })],
];
const allRoutes = [...memberRoutes, ...organizerRoutes];

async function setup() {
  const organizer = await createUser('Olivia Organizer');
  const ana = await createUser('Ana Member');
  const ben = await createUser('Ben Member');
  const outsider = await createUser('Oscar Outsider');
  const group = await createGroup(organizer, [ana, ben]);
  return { organizer, ana, ben, outsider, group };
}

test.each(allRoutes)('%s without a token -> 401', async (_label, send) => {
  const { group, ana } = await setup();

  const res = await send(as({ auth: '' }), group.id, ana);

  expect(res.status).toBe(401);
});

test.each(allRoutes)('%s by a non-member -> 404, same as a missing group, and nothing changes', async (_label, send) => {
  const { group, ana, outsider } = await setup();
  const before = await findMembership(ana, group);

  const res = await send(as(outsider), group.id, ana);

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Group not found' });
  expect(await findMembership(ana, group)).toEqual(before);
});

test.each(allRoutes)('%s on a group that does not exist -> the same 404', async (_label, send) => {
  const { group, organizer, ana } = await setup();

  const res = await send(as(organizer), group.id + 1000, ana);

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Group not found' });
});

test.each(organizerRoutes)('%s by a plain member -> 403, and nothing changes', async (_label, send) => {
  const { group, ana, ben } = await setup();

  const res = await send(as(ana), group.id, ben);

  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: 'Only the organizer can do that' });
  expect(await findMembership(ben, group)).toMatchObject({ required: true });
});

test.each(['abc', '0', '-1', '1.5', '99999999999'])('group id %p -> 400', async (badId) => {
  const { organizer } = await setup();

  const res = await as(organizer).get(`/api/groups/${badId}`);

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('group id must be a positive whole number');
});

test('POST /groups, GET /groups and POST /groups/join require a token', async () => {
  expect((await request(app).post('/api/groups').send({ name: 'x' })).status).toBe(401);
  expect((await request(app).get('/api/groups')).status).toBe(401);
  expect((await request(app).post('/api/groups/join').send({ joinCode: 'ABCDEFGH' })).status).toBe(401);
});

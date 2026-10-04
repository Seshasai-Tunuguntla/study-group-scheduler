const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { HttpError } = require('../../src/utils/httpError');

function prismaError(code, meta) {
  return new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}

// A tiny app whose only route throws whatever error the test hands it,
// so the handler's mapping is checked without any real routes or database.
function appThrowing(err) {
  const app = express();
  app.get('/boom', async () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  test('ZodError -> 400 with the first issue message', async () => {
    const schema = z.object({ name: z.string({ message: 'name is required' }) });
    const { error } = schema.safeParse({});

    const res = await request(appThrowing(error)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('name is required');
    expect(res.body.details).toHaveLength(1);
  });

  test('Prisma P2002 (unique violation) -> 409 naming the field', async () => {
    const res = await request(appThrowing(prismaError('P2002', { target: ['email'] }))).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email already in use');
  });

  test('Prisma P2002 with a string target still produces a message', async () => {
    const res = await request(appThrowing(prismaError('P2002', { target: 'User_email_key' }))).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('User_email_key already in use');
  });

  test('Prisma P2025 (record not found) -> 404', async () => {
    const res = await request(appThrowing(prismaError('P2025'))).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Record not found');
  });

  test('HttpError -> its own status and message', async () => {
    const res = await request(appThrowing(new HttpError(403, 'Organizer only'))).get('/boom');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Organizer only' });
  });

  test('unknown errors -> 500 without leaking the message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

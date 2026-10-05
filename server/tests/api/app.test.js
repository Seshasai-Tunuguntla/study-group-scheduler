const request = require('supertest');
const app = require('../../src/app');

describe('app shell', () => {
  test('GET /api/health -> 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('unknown route -> JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('sets security headers via helmet', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('CORS allows the configured client origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5180');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5180');
  });

  test("CORS allows the site's own origin, as on Vercel where client and API share a domain", async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'study-scheduler-git-main.vercel.app')
      .set('Origin', 'https://study-scheduler-git-main.vercel.app')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401); // reached the route
    expect(res.headers['access-control-allow-origin']).toBe('https://study-scheduler-git-main.vercel.app');
  });

  test('CORS rejects another site even when it sends our Host', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Host', 'study-scheduler.vercel.app')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
  });

  test('CORS rejects a malformed Origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'not a url');

    expect(res.status).toBe(403);
  });

  test('CORS rejects other origins with 403', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Origin not allowed' });
  });

  test('malformed JSON body -> 400', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
  });
});

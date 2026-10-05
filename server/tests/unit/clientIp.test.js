const express = require('express');
const request = require('supertest');
const { TRUST_PROXY_HOPS, clientKey, logClientIpOnce } = require('../../src/middleware/clientIp');

describe('clientKey', () => {
  test.each([
    ['203.0.113.7', '203.0.113.7'], // IPv4: the address itself
    ['::ffff:203.0.113.7', '203.0.113.7'], // IPv4 seen through an IPv6 socket: the same client
    ['2001:db8:1234:5678::1', '2001:db8:1234:5600::/56'], // IPv6: its /56 subnet...
    ['2001:db8:1234:56ff:abcd::9', '2001:db8:1234:5600::/56'], // ...so a whole subnet shares one bucket
  ])('%s -> %s', (ip, key) => {
    expect(clientKey({ ip })).toBe(key);
  });
});

// The app behind one proxy, set up the way src/app.js sets it up, answering with the key it sees.
function appBehindOneProxy() {
  const app = express();
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.get('/key', (req, res) => res.json({ key: clientKey(req) }));
  return app;
}
const keyFor = async (forwardedFor) => {
  const req = request(appBehindOneProxy()).get('/key');
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
  return (await req).body.key;
};

describe('the key behind Vercel (one trusted proxy)', () => {
  test("is the visitor's address from X-Forwarded-For, which Vercel's edge sets", async () => {
    expect(await keyFor('203.0.113.7')).toBe('203.0.113.7');
  });

  test('different visitors get different keys', async () => {
    expect(await keyFor('203.0.113.7')).not.toBe(await keyFor('198.51.100.4'));
  });

  test('addresses a client adds in front of the proxy\'s entry are ignored', async () => {
    // Only the last entry was written by the trusted proxy, so fake ones can't buy a fresh bucket.
    expect(await keyFor('10.0.0.1, 192.0.2.99, 203.0.113.7')).toBe('203.0.113.7');
  });

  test('without the header (no proxy, e.g. local development) it is the socket address', async () => {
    expect(await keyFor(null)).toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});

describe('logClientIpOnce', () => {
  test('logs how the first request\'s address arrived, then never again', async () => {
    const log = { log: jest.fn() };
    const app = express();
    app.set('trust proxy', TRUST_PROXY_HOPS);
    app.use(logClientIpOnce(log));
    app.get('/', (req, res) => res.end());

    await request(app).get('/').set('X-Forwarded-For', '203.0.113.7').set('X-Real-IP', '203.0.113.7');
    await request(app).get('/').set('X-Forwarded-For', '198.51.100.4');

    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.log).toHaveBeenCalledWith('[client-ip]', expect.any(String));
    expect(JSON.parse(log.log.mock.calls[0][1])).toEqual({
      ip: '203.0.113.7',
      key: '203.0.113.7',
      forwardedFor: '203.0.113.7',
      realIp: '203.0.113.7',
    });
  });
});

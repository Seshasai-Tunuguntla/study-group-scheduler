const { ipKeyGenerator } = require('express-rate-limit');

// How many proxies in front of the app to trust for the client's address (app.set('trust proxy')).
// On Vercel there is exactly one: its edge, which overwrites X-Forwarded-For with the visitor's own
// address, so a visitor can't put a fake address there. With one trusted hop, Express takes the
// last X-Forwarded-For entry, the one that edge wrote, as req.ip.
const TRUST_PROXY_HOPS = 1;

// Who a request counts against in the rate limiters: the client's address. IPv4 addresses are used
// as they are. IPv6 addresses are grouped by /56 subnet, because one person often controls a whole
// subnet and could otherwise get a fresh allowance per address.
function clientKey(req) {
  return ipKeyGenerator(req.ip);
}

// For checking a deployment: logs how the first request's address arrived (once per instance), to
// confirm req.ip is the visitor and not a proxy. Only on when LOG_CLIENT_IP=true, so visitors'
// addresses aren't logged by default.
function logClientIpOnce(log = console) {
  let logged = false;
  return (req, res, next) => {
    if (!logged) {
      logged = true;
      log.log(
        '[client-ip]',
        JSON.stringify({
          ip: req.ip,
          key: clientKey(req),
          forwardedFor: req.headers['x-forwarded-for'] ?? null,
          realIp: req.headers['x-real-ip'] ?? null,
        })
      );
    }
    next();
  };
}

module.exports = { TRUST_PROXY_HOPS, clientKey, logClientIpOnce };

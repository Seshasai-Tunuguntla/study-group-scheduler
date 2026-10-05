const { resetDemoDataIfStale } = require('./demo/demo');

// Work for every new server instance: a long-running server once at start, a serverless function
// on each cold start (api/index.js). The demo is rebuilt only if its last rebuild, recorded in the
// database, is 30+ minutes old, so a cold start never wipes a visitor's recent changes.
// A failure is logged and never stops the API from serving real users.
async function prepare({ prisma, log = console }) {
  try {
    const rebuilt = await resetDemoDataIfStale(prisma);
    log.log(rebuilt ? 'Demo data reset' : 'Demo data is recent, not reset');
  } catch (err) {
    log.error('Demo data reset failed:', err);
  }
}

// The long-running server (`npm start`, `npm run dev`): listen, then prepare.
function start({ app, prisma, port, log = console }) {
  return new Promise((resolve) => {
    const server = app.listen(port, async () => {
      log.log(`Server listening on http://localhost:${server.address().port}`);
      await prepare({ prisma, log });
      resolve(server);
    });
  });
}

module.exports = { prepare, start };

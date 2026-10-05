const { resetDemoData } = require('./demo/demo');

// Starts the HTTP server, then rebuilds the demo data, so every deploy and restart begins with a
// clean demo. A failed demo reset is logged but never stops the API from serving real users.
function start({ app, prisma, port, log = console }) {
  return new Promise((resolve) => {
    const server = app.listen(port, async () => {
      log.log(`Server listening on http://localhost:${server.address().port}`);
      try {
        await resetDemoData(prisma);
        log.log('Demo data reset');
      } catch (err) {
        log.error('Demo data reset failed:', err);
      }
      resolve(server);
    });
  });
}

module.exports = { start };

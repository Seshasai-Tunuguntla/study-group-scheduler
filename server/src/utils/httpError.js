// An error with an HTTP status and a message that is safe to show the client.
// Handlers and helpers throw it (e.g. `throw new HttpError(403, 'Not a member of this group')`)
// and the central error handler turns it into a JSON response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    // Same flag the http-errors package (used by express.json()) sets on client-safe errors.
    this.expose = true;
  }
}

module.exports = { HttpError };

// "Region/City" IANA names ("Asia/Kolkata", "America/New_York") plus names like "UTC" and
// "Etc/GMT+5". The pattern rules out offset strings like "+05:30": Intl accepts those too, but
// they aren't IANA zones and don't follow daylight saving changes.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

// Valid names are stored exactly as the browser sent them. Asking Intl for the canonical name
// instead would rename "Asia/Kolkata" to the old alias "Asia/Calcutta" on Node's ICU data.
function isIanaTimeZone(value) {
  if (!IANA_NAME.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

module.exports = { isIanaTimeZone };

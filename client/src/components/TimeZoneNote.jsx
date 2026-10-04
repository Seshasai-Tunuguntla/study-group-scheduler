import { useAuth } from '../hooks/useAuth';
import { browserTimeZone, formatOffset } from '../time/week';

// Says which zone times are shown in: the one saved on the account, which is also the zone the
// server reads preferred hours in. If this device is set to a different zone (e.g. while
// travelling), says that too, so the times don't look an hour or a day off without explanation.
export default function TimeZoneNote() {
  const { user } = useAuth();
  const deviceZone = browserTimeZone();
  const differs = deviceZone && deviceZone !== user.timeZone && formatOffset(deviceZone) !== formatOffset(user.timeZone);

  return (
    <p className="tz-note">
      Times are in your time zone, <strong>{user.timeZone}</strong> ({formatOffset(user.timeZone)}).
      {differs && (
        <span className="tz-warning">
          {' '}
          This device is set to {deviceZone} ({formatOffset(deviceZone)}), so times may differ from your clock.
        </span>
      )}
    </p>
  );
}

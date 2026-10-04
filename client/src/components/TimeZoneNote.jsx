import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { browserTimeZone, formatOffset } from '../time/week';

// Says which zone times are shown in: the one saved on the account, which is also the zone the
// server reads preferred hours in. If this device is set to a zone with a different offset (e.g.
// while travelling, or a wrong zone at signup), says so and offers to switch the account to it.
// Offsets are compared rather than names, since browsers may report "Asia/Calcutta" for "Asia/Kolkata".
export default function TimeZoneNote() {
  const { user, updateTimeZone } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [switchedFrom, setSwitchedFrom] = useState(null);
  const deviceZone = browserTimeZone();
  const differs = Boolean(deviceZone) && formatOffset(deviceZone) !== formatOffset(user.timeZone);

  async function useDeviceZone() {
    setError('');
    setSaving(true);
    const previous = user.timeZone;
    try {
      await updateTimeZone(deviceZone);
      setSwitchedFrom(previous);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tz-note">
      <p>
        Times are in your time zone, <strong>{user.timeZone}</strong> ({formatOffset(user.timeZone)}).
      </p>
      {differs && (
        <div className="tz-mismatch" role="status">
          <p>
            This device is set to <strong>{deviceZone}</strong> ({formatOffset(deviceZone)}), so times here may not match
            your clock.
          </p>
          <button type="button" className="btn-ghost" onClick={useDeviceZone} disabled={saving}>
            {saving ? 'Switching…' : "Use this device's time zone"}
          </button>
        </div>
      )}
      {switchedFrom && !differs && (
        <p className="tz-switched" role="status">
          Switched from {switchedFrom}. Your saved availability stays at the same moments, so it now shows in your new
          time zone: check it still covers the hours you mean.
        </p>
      )}
      {error && <p className="flash flash-error" role="alert">{error}</p>}
    </div>
  );
}

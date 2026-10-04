import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { hasUnsavedChanges } from '../availability/unsavedChanges';
import { browserTimeZone, formatDuration, formatOffset } from '../time/week';

// Says which zone times are shown in: the one saved on the account, which is also the zone the
// server reads preferred hours in. If this device is set to a zone with a different offset (e.g.
// while travelling, or a wrong zone at signup), says so and offers to switch the account to it.
// Offsets are compared rather than names, since browsers may report "Asia/Calcutta" for "Asia/Kolkata".
//
// Switching asks what should happen to saved availability:
// - Keep the same moments (default): nothing moves for the group; the grid just shows the same
//   moments at new local clock times.
// - Keep my local hours: the server shifts every saved schedule so 18:00 stays 18:00 locally.
export default function TimeZoneNote() {
  const { user, updateTimeZone } = useAuth();
  const [choosing, setChoosing] = useState(false);
  const [keepLocalTimes, setKeepLocalTimes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { from, shiftedByMinutes }
  const deviceZone = browserTimeZone();
  const differs = Boolean(deviceZone) && formatOffset(deviceZone) !== formatOffset(user.timeZone);

  async function switchZone() {
    // Moving saved availability reloads the grid, which would throw away unsaved edits.
    if (keepLocalTimes && hasUnsavedChanges() && !window.confirm('You have unsaved changes to your availability. Switching will discard them. Continue?')) {
      return;
    }
    setError('');
    setSaving(true);
    const from = user.timeZone;
    try {
      const shiftedByMinutes = await updateTimeZone(deviceZone, { keepLocalTimes });
      setResult({ from, shiftedByMinutes });
      setChoosing(false);
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

      {differs && !choosing && (
        <div className="tz-mismatch" role="status">
          <p>
            This device is set to <strong>{deviceZone}</strong> ({formatOffset(deviceZone)}), so times here may not match
            your clock.
          </p>
          <button type="button" className="btn-ghost" onClick={() => setChoosing(true)}>
            Use this device's time zone
          </button>
        </div>
      )}

      {differs && choosing && (
        <fieldset className="tz-choice">
          <legend>
            Switch to {deviceZone} ({formatOffset(deviceZone)}). What should happen to your saved availability?
          </legend>
          <label className="tz-option">
            <input type="radio" name="tz-keep" checked={!keepLocalTimes} onChange={() => setKeepLocalTimes(false)} />
            <span>
              <strong>Keep the same moments</strong>
              <span className="muted">
                Nothing changes for your group. Your free times just show at different clock times in the new zone.
              </span>
            </span>
          </label>
          <label className="tz-option">
            <input type="radio" name="tz-keep" checked={keepLocalTimes} onChange={() => setKeepLocalTimes(true)} />
            <span>
              <strong>Keep my local hours</strong>
              <span className="muted">
                If you were free at 18:00, you stay free at 18:00 on your new clock. Your group will see your times move.
              </span>
            </span>
          </label>
          <div className="tz-choice-actions">
            <button type="button" className="btn" onClick={switchZone} disabled={saving}>
              {saving ? 'Switching…' : 'Switch time zone'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setChoosing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}

      {result && !differs && (
        <p className="tz-switched" role="status">
          Switched from {result.from}.{' '}
          {result.shiftedByMinutes === 0
            ? 'Your saved availability stays at the same moments, so it now shows in your new time zone: check it still covers the hours you mean.'
            : `Your saved availability moved ${formatDuration(Math.abs(result.shiftedByMinutes))} ${
                result.shiftedByMinutes < 0 ? 'earlier' : 'later'
              } in every group, so it stays at the same local hours.`}
        </p>
      )}
      {error && <p className="flash flash-error" role="alert">{error}</p>}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import ErrorState from '../../components/ErrorState';
import { formatDuration, formatWindow } from '../../time/week';
import { names } from './names';

// The group's confirmed weekly session. Attendance comes from the server, recalculated from
// everyone's current availability, so it shows who can still make it after people change their week.
export default function SessionCard({ groupId, sessionLoad, isOrganizer }) {
  const { user } = useAuth();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const { data, error: loadError, reload } = sessionLoad;

  if (data === undefined) {
    if (loadError) return <ErrorState error={loadError} onRetry={reload} title="Couldn't load the weekly session" />;
    return (
      <section className="panel session-card" aria-busy="true">
        <p className="muted">Loading the weekly session…</p>
      </section>
    );
  }

  const { session } = data;
  if (!session) {
    return (
      <section className="panel session-card session-card-empty" aria-labelledby="session-heading">
        <h2 id="session-heading" className="eyebrow">
          Weekly session
        </h2>
        <p>
          No time confirmed yet.{' '}
          {isOrganizer ? (
            <>
              Pick one from <Link to="suggestions">Suggestions</Link>.
            </>
          ) : (
            'The organizer will confirm one from the suggestions.'
          )}
        </p>
      </section>
    );
  }

  async function clear() {
    if (!window.confirm('Clear the weekly session? Members will no longer see a confirmed time.')) return;
    setError('');
    setClearing(true);
    try {
      await api.clearSession(groupId);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  }

  const { attendees, missing, waitingOn } = session.attendance;

  return (
    <section className="panel session-card" aria-labelledby="session-heading">
      <div className="session-main">
        <h2 id="session-heading" className="eyebrow">
          Weekly session
        </h2>
        <p className="session-time">
          {formatWindow(session.startMinute, session.durationMinutes, user.timeZone, { dayStyle: 'long' })}
        </p>
        <p className="muted">
          {formatDuration(session.durationMinutes)} · confirmed by {session.confirmedBy.name}
        </p>
      </div>
      <dl className="attendance">
        <div>
          <dt>Can make it</dt>
          <dd>{attendees.length > 0 ? names(attendees) : 'Nobody, based on current availability'}</dd>
        </div>
        {missing.length > 0 && (
          <div>
            <dt>Can't make it</dt>
            <dd>{names(missing)}</dd>
          </div>
        )}
        {waitingOn.length > 0 && (
          <div>
            <dt>Waiting on</dt>
            <dd>{names(waitingOn, user.id)}</dd>
          </div>
        )}
      </dl>
      {isOrganizer && (
        <button type="button" className="btn-ghost session-clear" onClick={clear} disabled={clearing}>
          {clearing ? 'Clearing…' : 'Clear'}
        </button>
      )}
      {error && <p className="flash flash-error" role="alert">{error}</p>}
    </section>
  );
}

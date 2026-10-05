import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import TimeZoneNote from '../components/TimeZoneNote';
import MiniHeat from '../availability/MiniHeat';
import { formatCountdown, formatDuration, formatWindow, minutesUntilNext } from '../time/week';

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(() => api.listGroups(), 'groups');
  const groups = data?.groups;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your groups</h1>
        <TimeZoneNote />
      </header>

      {loading && !groups ? (
        <Loading label="Loading your groups…" />
      ) : error && !groups ? (
        <ErrorState error={error} onRetry={reload} title="Couldn't load your groups" />
      ) : (
        <>
          <NextSession groups={groups} />
          {groups.length === 0 ? (
            <div className="empty group-rows">
              <p>
                <strong>You're not in any groups yet.</strong>
              </p>
              <p>Start one for your study group, or join one with the code your organizer sent you.</p>
            </div>
          ) : (
            <ul className="group-rows" aria-label="Groups">
              {groups.map((group) => (
                <GroupRow key={group.id} group={group} />
              ))}
            </ul>
          )}
        </>
      )}

      <div className="dash-forms">
        <CreateGroupForm />
        <JoinGroupForm />
      </div>
    </div>
  );
}

// The soonest confirmed weekly session across all groups, in the user's time zone.
// Each group's own session is also shown on its row.
function NextSession({ groups }) {
  const { user } = useAuth();
  const [next] = groups
    .filter((group) => group.session)
    .map((group) => ({ group, minutesAway: minutesUntilNext(group.session.startMinute) }))
    .sort((a, b) => a.minutesAway - b.minutesAway);

  if (!next) return null;
  const { group, minutesAway } = next;

  return (
    <p className="next-session">
      <span className="next-session-label">Next session</span>
      <strong>
        <Link to={`/groups/${group.id}`} className="group-link">
          {group.name}
        </Link>
      </strong>
      <span>{formatWindow(group.session.startMinute, group.session.durationMinutes, user.timeZone, { dayStyle: 'long' })}</span>
      <span className="next-session-when">{formatCountdown(minutesAway)}</span>
    </p>
  );
}

function GroupRow({ group }) {
  const { user } = useAuth();
  const { session } = group;

  return (
    <li className="group-row">
      <div>
        <Link to={`/groups/${group.id}`} className="group-link">
          {group.name}
        </Link>
        <span className="group-row-role">{group.myRole === 'ORGANIZER' ? 'You organize' : 'Member'}</span>
      </div>
      <p className="group-row-session">
        {session ? (
          <>
            Meets {formatWindow(session.startMinute, session.durationMinutes, user.timeZone, { dayStyle: 'long' })}
            <span>{formatDuration(session.durationMinutes)} a week</span>
          </>
        ) : (
          'No weekly time yet'
        )}
      </p>
      <MiniHeat heat={group.heat} timeZone={user.timeZone} />
      {group.availabilityUpdatedAt === null ? (
        <Link to={`/groups/${group.id}/availability`} className="nudge">
          Fill in your week
        </Link>
      ) : (
        <span className="group-row-role">
          {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
        </span>
      )}
    </li>
  );
}

function CreateGroupForm() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { group } = await api.createGroup(name);
      navigate(`/groups/${group.id}/members`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="create-heading">
      <h2 id="create-heading">Create a group</h2>
      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          Group name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Algorithms study group"
            maxLength={100}
            required
          />
        </label>
        {error && <p className="flash flash-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create group'}
        </button>
      </form>
      <p className="hint">You'll be the organizer and get a code to invite people.</p>
    </section>
  );
}

function JoinGroupForm() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { group } = await api.joinGroup(joinCode);
      // First thing a new member should do: say when they're free.
      navigate(`/groups/${group.id}/availability`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="join-heading">
      <h2 id="join-heading">Join a group</h2>
      <form onSubmit={handleSubmit} className="form join-form">
        <label className="field">
          Join code
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="ABCD2345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </label>
        {error && <p className="flash flash-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join group'}
        </button>
      </form>
      <p className="hint">Ask your organizer for the 8-character code.</p>
    </section>
  );
}

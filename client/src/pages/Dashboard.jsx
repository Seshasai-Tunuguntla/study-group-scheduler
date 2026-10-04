import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import Loading from '../components/Loading';
import ErrorState from '../components/ErrorState';
import TimeZoneNote from '../components/TimeZoneNote';
import { formatCountdown, formatDuration, formatWindow, minutesUntilNext } from '../time/week';

const ROLE_LABELS = { ORGANIZER: 'Organizer', MEMBER: 'Member' };

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(() => api.listGroups(), 'groups');
  const groups = data?.groups;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your study groups</h1>
        <TimeZoneNote />
      </header>

      <div className="layout layout-dashboard">
        <div className="main-column">
          {loading && !groups ? (
            <Loading label="Loading your groups…" />
          ) : error && !groups ? (
            <ErrorState error={error} onRetry={reload} title="Couldn't load your groups" />
          ) : (
            <>
              <UpcomingSessions groups={groups} />
              <section aria-labelledby="groups-heading">
                <h2 id="groups-heading">Groups</h2>
                {groups.length === 0 ? (
                  <div className="empty">
                    <p>
                      <strong>You're not in any groups yet.</strong>
                    </p>
                    <p>Create one for your study group, or join one with the code your organizer sent you.</p>
                  </div>
                ) : (
                  <ul className="card-list">
                    {groups.map((group) => (
                      <GroupCard key={group.id} group={group} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="side">
          <CreateGroupForm />
          <JoinGroupForm />
        </aside>
      </div>
    </div>
  );
}

// Each group's confirmed weekly session, soonest first, in the user's time zone.
function UpcomingSessions({ groups }) {
  const { user } = useAuth();
  const sessions = groups
    .filter((group) => group.session)
    .map((group) => ({ group, minutesAway: minutesUntilNext(group.session.startMinute) }))
    .sort((a, b) => a.minutesAway - b.minutesAway);

  if (sessions.length === 0) return null;

  return (
    <section className="panel upcoming" aria-labelledby="upcoming-heading">
      <h2 id="upcoming-heading">Your weekly sessions</h2>
      <ul className="upcoming-list">
        {sessions.map(({ group, minutesAway }) => (
          <li key={group.id}>
            <Link to={`/groups/${group.id}`} className="upcoming-group">
              {group.name}
            </Link>
            <span className="upcoming-time">
              {formatWindow(group.session.startMinute, group.session.durationMinutes, user.timeZone, { dayStyle: 'long' })}
            </span>
            <span className="upcoming-next">Next {formatCountdown(minutesAway)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupCard({ group }) {
  const { user } = useAuth();
  const { session } = group;

  return (
    <li className="card group-card">
      <div className="card-head">
        <Link to={`/groups/${group.id}`} className="card-title">
          {group.name}
        </Link>
        <span className={`chip chip-role-${group.myRole.toLowerCase()}`}>{ROLE_LABELS[group.myRole]}</span>
      </div>
      <p className="card-meta">
        {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
        {' · '}
        {session ? (
          <>
            Meets {formatWindow(session.startMinute, session.durationMinutes, user.timeZone, { dayStyle: 'long' })} (
            {formatDuration(session.durationMinutes)})
          </>
        ) : (
          'No weekly time confirmed yet'
        )}
      </p>
      {group.availabilityUpdatedAt === null && (
        <Link to={`/groups/${group.id}/availability`} className="nudge">
          Add your availability so this group can find a time →
        </Link>
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

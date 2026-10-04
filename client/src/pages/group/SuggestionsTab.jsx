import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import JoinCodeTag from '../../components/JoinCodeTag';
import { formatDuration, formatWindow } from '../../time/week';
import { names } from './names';

const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240];
const SHORT_LABELS = { 30: '30m', 60: '1h', 90: '1.5h', 120: '2h', 150: '2.5h', 180: '3h', 210: '3.5h', 240: '4h' };

export default function SuggestionsTab() {
  const { group } = useOutletContext();
  const [duration, setDuration] = useState(60);
  const { data, error, loading, reload } = useLoad(
    () => api.getSuggestions(group.id, { duration }),
    duration
  );

  let content;
  if (data === undefined) {
    content = error ? (
      <ErrorState error={error} onRetry={reload} title="Couldn't load suggestions" />
    ) : (
      <Loading label="Finding the best times…" />
    );
  } else if (data.reason) {
    content = <NoSuggestions data={data} duration={duration} onDuration={setDuration} />;
  } else {
    content = <SuggestionList data={data} />;
  }

  return (
    <section aria-labelledby="suggestions-heading">
      <h2 id="suggestions-heading" className="visually-hidden">
        Suggestions
      </h2>
      <div className="toolbar">
        <span className="toolbar-label" id="duration-label">
          Session length
        </span>
        <div className="segmented" role="group" aria-labelledby="duration-label">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="segment"
              aria-pressed={duration === minutes}
              aria-label={formatDuration(minutes)}
              onClick={() => setDuration(minutes)}
            >
              {SHORT_LABELS[minutes]}
            </button>
          ))}
        </div>
      </div>
      {error && data !== undefined && (
        <ErrorState error={error} onRetry={reload} title="Couldn't refresh suggestions" />
      )}
      {/* Older results stay visible (dimmed) while a new length loads, instead of flashing a spinner. */}
      <div className={loading && data !== undefined ? 'is-refreshing' : undefined} aria-busy={loading}>
        {content}
      </div>
    </section>
  );
}

function SuggestionList({ data }) {
  const { group, isOrganizer, session, reloadSession } = useOutletContext();
  const { user } = useAuth();
  const [confirmingAt, setConfirmingAt] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function confirm(suggestion) {
    setError('');
    setMessage('');
    setConfirmingAt(suggestion.startMinute);
    try {
      await api.confirmSession(group.id, suggestion.startMinute, suggestion.durationMinutes);
      await reloadSession();
      setMessage(`${formatWindow(suggestion.startMinute, suggestion.durationMinutes, user.timeZone, { dayStyle: 'long' })} is now the weekly session.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirmingAt(null);
    }
  }

  const isConfirmed = (s) =>
    session?.startMinute === s.startMinute && session?.durationMinutes === s.durationMinutes;

  return (
    <>
      {data.mayChange && (
        <p className="flash flash-info" role="status">
          Still waiting on {names(data.waitingOn, user.id)}. These suggestions may change once they add
          their availability.
        </p>
      )}
      {message && <p className="flash flash-success" role="status">{message}</p>}
      {error && <p className="flash flash-error" role="alert">{error}</p>}

      <ol className="card-list suggestion-list">
        {data.suggestions.map((suggestion, index) => {
          const responded = suggestion.attendees.length + suggestion.missing.length;
          return (
            <li key={suggestion.startMinute} className="card suggestion">
              <span className="suggestion-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="suggestion-body">
                <p className="suggestion-time">
                  {formatWindow(suggestion.startMinute, suggestion.durationMinutes, user.timeZone, { dayStyle: 'long' })}
                </p>
                <p className="suggestion-count">
                  {suggestion.missing.length === 0
                    ? `Everyone who has responded can make it (${responded})`
                    : `${suggestion.attendees.length} of ${responded} can make it`}
                </p>
                <p className="people">
                  <span className="people-label">Can attend</span> {names(suggestion.attendees)}
                </p>
                {suggestion.missing.length > 0 && (
                  <p className="people">
                    <span className="people-label">Can't</span> {names(suggestion.missing)}
                  </p>
                )}
              </div>
              <div className="suggestion-action">
                {isConfirmed(suggestion) ? (
                  <span className="chip chip-confirmed">Weekly session</span>
                ) : (
                  isOrganizer && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => confirm(suggestion)}
                      disabled={confirmingAt !== null}
                    >
                      {confirmingAt === suggestion.startMinute ? 'Confirming…' : 'Confirm'}
                    </button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!isOrganizer && <p className="hint">The organizer confirms one of these as the weekly session.</p>}
    </>
  );
}

// One explanation per `reason` the API gives for an empty result, each with a next step.
function NoSuggestions({ data, duration, onDuration }) {
  const { group, isOrganizer } = useOutletContext();
  const { user } = useAuth();

  if (data.reason === 'not_enough_members') {
    const organizer = group.members.find((member) => member.role === 'ORGANIZER');
    return (
      <div className="empty empty-action">
        <h3>Invite members to get suggestions</h3>
        <p>
          Suggestions need at least 2 people, and {group.members.length === 1 ? "it's just you so far" : `this group has ${group.members.length}`}.
        </p>
        {isOrganizer ? (
          <>
            <p>Share this code. Anyone with it can join from their dashboard.</p>
            <JoinCodeTag code={group.joinCode} />
          </>
        ) : (
          <p>Ask {organizer?.name ?? 'the organizer'} to share the group's join code.</p>
        )}
      </div>
    );
  }

  if (data.reason === 'waiting_for_responses') {
    const iHaveResponded = !data.waitingOn.some((person) => person.userId === user.id);
    return (
      <div className="empty empty-action">
        <h3>Waiting on: {names(data.waitingOn, user.id)}</h3>
        <p>Suggestions appear once at least 2 members have added their availability.</p>
        {!iHaveResponded && (
          <Link to="../availability" className="btn">
            Add your availability
          </Link>
        )}
      </div>
    );
  }

  // no_common_time
  const shorter = duration > 30 ? duration - 30 : null;
  return (
    <div className="empty empty-action">
      <h3>No time works for everyone who's required</h3>
      <p>Every window of {formatDuration(duration)} clashes with someone who has to be there. You could:</p>
      <ul className="tips">
        {shorter && (
          <li>
            <button type="button" className="btn-link" onClick={() => onDuration(shorter)}>
              Try {formatDuration(shorter)} instead
            </button>
          </li>
        )}
        <li>
          {isOrganizer ? (
            <>
              Mark someone optional in <Link to="../members">Members</Link>
            </>
          ) : (
            'Ask the organizer to mark someone optional'
          )}
          . Optional members never block a time.
        </li>
        <li>Ask everyone to add more free time to their availability.</li>
      </ul>
      {data.waitingOn.length > 0 && <p className="muted">Still waiting on {names(data.waitingOn, user.id)}.</p>}
    </div>
  );
}

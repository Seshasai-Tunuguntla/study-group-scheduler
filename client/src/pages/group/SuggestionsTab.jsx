import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import JoinCode from '../../components/JoinCode';
import {
  crossesMidnight,
  DEFAULT_PREFERRED,
  DURATIONS,
  hasPreferred,
  minuteOfDay,
  suggestionParams,
  TIME_OPTIONS,
  withPreferred,
} from '../../suggestions/settings';
import { formatDuration, formatTime, formatWindow } from '../../time/week';
import { names } from './names';

const SHORT_LABELS = { 30: '30m', 60: '1h', 90: '1.5h', 120: '2h', 150: '2.5h', 180: '3h', 210: '3.5h', 240: '4h' };

export default function SuggestionsTab() {
  const { group, suggestionSettings: settings, setSuggestionSettings: setSettings } = useOutletContext();
  const { availabilityVersion } = useAuth();
  const { duration } = settings;
  const setDuration = (minutes) => setSettings({ ...settings, duration: minutes });
  const params = suggestionParams(settings);
  const { data, error, loading, reload } = useLoad(
    () => api.getSuggestions(group.id, params),
    `${JSON.stringify(params)}:${availabilityVersion}`
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
      <PreferredHours settings={settings} onChange={setSettings} />
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

// Preferred hours: the same local hours every day. Best times inside them rank higher, but they
// never beat a time more people can make (attendance is ranked first). Remembered per group in this
// browser, along with the session length.
function PreferredHours({ settings, onChange }) {
  const { user } = useAuth();
  const label = (time) => formatTime(minuteOfDay(time));

  if (!hasPreferred(settings)) {
    return (
      <div className="toolbar">
        <span className="toolbar-label">Preferred hours</span>
        <button type="button" className="btn-quiet" onClick={() => onChange({ ...settings, ...DEFAULT_PREFERRED })}>
          Add preferred hours
        </button>
        <span className="muted">Optional: rank times inside them higher.</span>
      </div>
    );
  }

  return (
    <div className="toolbar preferred">
      <span className="toolbar-label" id="preferred-label">
        Preferred hours
      </span>
      <span className="preferred-range" role="group" aria-labelledby="preferred-label">
        <label>
          <span className="visually-hidden">From</span>
          <select
            value={settings.preferredStart}
            onChange={(e) => onChange(withPreferred(settings, 'preferredStart', e.target.value))}
          >
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {label(time)}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden="true">to</span>
        <label>
          <span className="visually-hidden">Until</span>
          <select
            value={settings.preferredEnd}
            onChange={(e) => onChange(withPreferred(settings, 'preferredEnd', e.target.value))}
          >
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {label(time)}
              </option>
            ))}
          </select>
        </label>
        {crossesMidnight(settings) && <span className="chip">past midnight</span>}
      </span>
      <span className="muted">Every day, in {user.timeZone}.</span>
      <button
        type="button"
        className="btn-link"
        onClick={() => onChange({ ...settings, preferredStart: null, preferredEnd: null })}
      >
        Remove
      </button>
    </div>
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

      <ol className="pick-grid">
        {data.suggestions.map((suggestion, index) => {
          const responded = suggestion.attendees.length + suggestion.missing.length;
          const confirmed = isConfirmed(suggestion);
          return (
            <li key={suggestion.startMinute} className={confirmed ? 'pick-card pick-card-confirmed' : 'pick-card'}>
              <span className="pick-rank">{index + 1}</span>
              <p className="pick-time">
                {formatWindow(suggestion.startMinute, suggestion.durationMinutes, user.timeZone, { dayStyle: 'long' })}
              </p>
              <p className="pick-count">
                {suggestion.missing.length === 0
                  ? `Everyone who replied can come (${responded})`
                  : `${suggestion.attendees.length} of ${responded} can come`}
              </p>
              {data.preferredWindow && suggestion.preferredMinutes > 0 && (
                <p className="pick-preferred">
                  {suggestion.preferredMinutes >= suggestion.durationMinutes
                    ? 'Inside your preferred hours'
                    : `${formatDuration(suggestion.preferredMinutes)} inside your preferred hours`}
                </p>
              )}
              <p className="people">
                <span className="people-label">Can come:</span> {names(suggestion.attendees)}
              </p>
              {suggestion.missing.length > 0 && (
                <p className="people">
                  <span className="people-label">Can't:</span> {names(suggestion.missing)}
                </p>
              )}
              <div className="pick-action">
                {confirmed ? (
                  <span className="chip chip-accent">Weekly session</span>
                ) : (
                  isOrganizer && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => confirm(suggestion)}
                      disabled={confirmingAt !== null}
                    >
                      {confirmingAt === suggestion.startMinute ? 'Saving…' : 'Make it the session'}
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
            <JoinCode code={group.joinCode} />
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

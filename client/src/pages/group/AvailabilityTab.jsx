import { useEffect, useMemo, useState } from 'react';
import { useBlocker, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import AvailabilityGrid from '../../availability/AvailabilityGrid';
import { buildWeekGrid, copyDay, rangesFromSlots, sameSlots, slotsFromRanges } from '../../availability/grid';
import { LEAVE_WARNING, setUnsavedChanges } from '../../availability/unsavedChanges';
import { formatDuration, SLOT_MINUTES } from '../../time/week';

export default function AvailabilityTab() {
  const { group } = useOutletContext();
  const { user, availabilityVersion } = useAuth();
  // availabilityVersion changes when a "keep my local hours" switch moved the saved ranges on the
  // server: load them again and start the editor fresh.
  const key = `${group.id}:${availabilityVersion}`;
  const { data, error, loading, reload } = useLoad(() => api.getAvailability(group.id), key);

  if (data === undefined || loading) {
    if (error) return <ErrorState error={error} onRetry={reload} title="Couldn't load your availability" />;
    return <Loading label="Loading your availability…" />;
  }

  const me = data.members.find((member) => member.userId === user.id);
  return (
    <AvailabilityEditor key={key} initialRanges={data.myRanges} initialSavedAt={me.availabilityUpdatedAt} />
  );
}

function AvailabilityEditor({ initialRanges, initialSavedAt }) {
  const { group, reloadGroup, reloadSession } = useOutletContext();
  const { user } = useAuth();
  const [saved, setSaved] = useState(() => slotsFromRanges(initialRanges));
  const [draft, setDraft] = useState(saved);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [touchPaint, setTouchPaint] = useState(false);
  const isTouchScreen = useMemo(() => window.matchMedia?.('(pointer: coarse)').matches ?? false, []);

  // Re-labels in place if the user switches time zone: the selection is UTC, so it doesn't move.
  const grid = useMemo(() => buildWeekGrid(user.timeZone), [user.timeZone]);

  const neverSaved = savedAt === null;
  const dirty = !sameSlots(draft, saved);

  // Lets actions outside this screen (a time zone switch that reloads the grid) ask before
  // throwing the edits away.
  useEffect(() => {
    setUnsavedChanges(dirty);
    return () => setUnsavedChanges(false);
  }, [dirty]);

  // Leaving with unsaved changes: in-app navigation (tabs, links, logging out) asks first...
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(LEAVE_WARNING)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // ...and so does closing or reloading the browser tab.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function edit(next) {
    setDraft(next);
    setJustSaved(false);
    setError('');
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await api.saveAvailability(group.id, rangesFromSlots(draft));
      const stored = slotsFromRanges(result.ranges);
      setSaved(stored);
      setDraft(stored);
      setSavedAt(result.availabilityUpdatedAt);
      setJustSaved(true);
      // Member counts and the session's attendance depend on this, so refresh them too.
      reloadGroup();
      reloadSession();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const savedAtText =
    savedAt &&
    new Date(savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: user.timeZone });

  return (
    <section className="availability" aria-labelledby="availability-heading">
      <div className="availability-intro">
        <h2 id="availability-heading">My availability</h2>
        <p className="muted">
          {isTouchScreen
            ? 'Tap the half hours you are free each week.'
            : 'Click or drag across the half hours you are free each week. Starting a drag on a free cell clears instead.'}{' '}
          This is your usual week; it repeats.
        </p>
      </div>

      {neverSaved ? (
        <p className="flash flash-info">
          You haven't saved your availability for this group yet, so suggestions leave you out until you do. Saving
          with nothing marked tells the group you're never free.
        </p>
      ) : (
        saved.size === 0 &&
        !dirty && <p className="flash flash-info">You saved an empty week, so you're marked as never free.</p>
      )}

      <div className="availability-tools">
        <button type="button" className="btn-quiet" onClick={() => edit(copyDay(draft, grid))}>
          Copy Monday to weekdays
        </button>
        <button type="button" className="btn-quiet" onClick={() => edit(new Set())} disabled={draft.size === 0}>
          Clear
        </button>
        {isTouchScreen && (
          <label className="switch">
            <input type="checkbox" checked={touchPaint} onChange={(e) => setTouchPaint(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>Drag to select</span>
          </label>
        )}
      </div>
      {isTouchScreen && touchPaint && (
        <p className="hint">Drag across cells to mark them. The page won't scroll over the grid while this is on.</p>
      )}

      <div className="week-grid-wrap">
        <AvailabilityGrid grid={grid} selection={draft} onChange={edit} touchPaint={touchPaint} />
      </div>

      <div className={`save-bar${dirty ? ' save-bar-dirty' : ''}`} role="region" aria-label="Save availability">
        <div className="save-status" role="status">
          {dirty ? (
            <span className="pill pill-unsaved">Not saved yet</span>
          ) : justSaved ? (
            <span className="pill pill-saved">Saved</span>
          ) : savedAt ? (
            <span className="muted">Last saved {savedAtText}</span>
          ) : null}
          <span className="save-total">
            {draft.size === 0 ? 'Nothing marked' : `${formatDuration(draft.size * SLOT_MINUTES)} a week`}
          </span>
        </div>
        <div className="save-actions">
          {dirty && (
            <button type="button" className="btn-quiet" onClick={() => edit(saved)} disabled={saving}>
              Discard changes
            </button>
          )}
          <button type="button" className="btn" onClick={save} disabled={saving || (!dirty && !neverSaved)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && <p className="flash flash-error save-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

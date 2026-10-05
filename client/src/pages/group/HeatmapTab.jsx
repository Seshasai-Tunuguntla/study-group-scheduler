import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import HeatGrid from '../../availability/HeatGrid';
import { buildWeekGrid } from '../../availability/grid';
import { legendSteps, pickMarks, slotPeople, slotsOfWindow } from '../../availability/heat';
import { suggestionParams } from '../../suggestions/settings';
import { formatDuration, formatWindow, SLOT_MINUTES } from '../../time/week';
import { names } from './names';

export default function HeatmapTab() {
  const { group, session, suggestionSettings } = useOutletContext();
  const { user, availabilityVersion } = useAuth();
  const sideways = useMediaQuery('(min-width: 900px)');
  const heat = useLoad(() => api.getAvailability(group.id), `${group.id}:${availabilityVersion}`);
  // The same best times as the Suggestions tab: same length, same preferred hours.
  const params = suggestionParams(suggestionSettings);
  const picks = useLoad(() => api.getSuggestions(group.id, params), `${JSON.stringify(params)}:${availabilityVersion}`);
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const grid = useMemo(() => buildWeekGrid(user.timeZone), [user.timeZone]);

  if (heat.data === undefined) {
    if (heat.error) return <ErrorState error={heat.error} onRetry={heat.reload} title="Couldn't load the heatmap" />;
    return <Loading label="Loading who's free…" />;
  }

  const { members, slots } = heat.data;
  // Only members who have saved their week are counted. Never-saved members aren't "busy",
  // they just haven't answered, so they're listed separately and never lower a count.
  const responded = members.filter((member) => member.availabilityUpdatedAt !== null);
  const waiting = members.filter((member) => member.availabilityUpdatedAt === null);
  const respondedIds = new Set(responded.map((member) => member.userId));

  const sessionSlots = new Set(session ? slotsOfWindow(session.startMinute, session.durationMinutes) : []);
  const suggestions = picks.data?.suggestions ?? [];
  const { rankAt, covered } = pickMarks(suggestions);

  const when = (slot) => formatWindow(slot * SLOT_MINUTES, SLOT_MINUTES, user.timeZone, { dayStyle: 'long' });
  const describe = (slot, count) =>
    `${when(slot)}: ${count} of ${responded.length} free${sessionSlots.has(slot) ? ', weekly session' : ''}${
      covered.has(slot) ? `, best time ${covered.get(slot)}` : ''
    }`;

  if (responded.length === 0) {
    return (
      <section aria-labelledby="heat-heading">
        <h2 id="heat-heading">Who's free</h2>
        <div className="empty empty-action">
          <h3>Nobody has filled in their week yet</h3>
          <p>The heatmap fills in as members mark when they're free.</p>
          <Link to="../availability" className="btn">
            Fill in your week
          </Link>
        </div>
      </section>
    );
  }

  const inspected = hovered ?? pinned;
  return (
    <section aria-labelledby="heat-heading">
      <div className="heat-head">
        <div>
          <h2 id="heat-heading">Who's free</h2>
          <p className="muted">
            Counts are out of the {responded.length} {responded.length === 1 ? 'member who has' : 'members who have'}{' '}
            filled in their week.
            {waiting.length > 0 && ` Not counted yet: ${names(waiting, user.id)}.`}
          </p>
        </div>
        <Legend respondedCount={responded.length} hasSession={sessionSlots.size > 0} hasPicks={suggestions.length > 0} />
      </div>

      <div className="heat-wrap">
        <HeatGrid
          grid={grid}
          slots={slots}
          respondedCount={responded.length}
          respondedIds={respondedIds}
          sessionSlots={sessionSlots}
          pickRankAt={rankAt}
          pickCovered={covered}
          pinned={pinned}
          onInspect={setHovered}
          // The latest interaction wins: a tap, click or keyboard move replaces what the mouse is over.
          onPin={(slot) => {
            setPinned(slot);
            setHovered(null);
          }}
          sideways={sideways}
          describe={describe}
        />
      </div>

      <Inspector slot={inspected} slots={slots} responded={responded} waiting={waiting} when={when} sessionSlots={sessionSlots} pickAt={covered} />

      <p className="hint">
        {picks.error
          ? "Couldn't load the best times to mark them."
          : suggestions.length > 0
            ? `Numbers 1 to ${suggestions.length} mark the best times for ${formatDuration(suggestionSettings.duration)}, as on the Suggestions tab.`
            : picks.data
              ? 'No best times to mark for the current session length.'
              : 'Loading the best times…'}
      </p>
    </section>
  );
}

function Legend({ respondedCount, hasSession, hasPicks }) {
  return (
    <div className="heat-legend">
      <span className="heat-legend-scale">
        <span>Free, of {respondedCount}:</span>
        {legendSteps(respondedCount).map((step) => (
          <span key={step.label} className={`heat-swatch heat-${step.level}`}>
            {step.label}
          </span>
        ))}
      </span>
      {hasSession && (
        <span>
          <span className="heat-swatch heat-swatch-session" aria-hidden="true" /> Weekly session
        </span>
      )}
      {hasPicks && (
        <span>
          <span className="heat-rank heat-rank-legend" aria-hidden="true">
            1
          </span>{' '}
          Best times
        </span>
      )}
    </div>
  );
}

// Who is free in the half hour under the pointer, or the last one tapped or focused.
function Inspector({ slot, slots, responded, waiting, when, sessionSlots, pickAt }) {
  if (slot === null) {
    return (
      <p className="heat-inspector muted" aria-live="polite">
        Hover over or tap a half hour to see who's free.
      </p>
    );
  }
  const { free, notFree, blockedBy } = slotPeople(slots[slot], responded);
  return (
    <p className="heat-inspector" aria-live="polite">
      <strong>{when(slot)}</strong>
      <span className="heat-inspector-count">
        {free.length} of {responded.length} free
      </span>
      {free.length > 0 && <span>Free: {names(free)}</span>}
      {notFree.length > 0 && <span className="muted">Not free: {names(notFree)}</span>}
      {/* Explains a bright half hour with no best-time number: someone who has to be there can't. */}
      {free.length > 0 && blockedBy.length > 0 && (
        <span className="muted">
          Not suggested: {names(blockedBy)} {blockedBy.length === 1 ? 'is' : 'are'} required.
        </span>
      )}
      {waiting.length > 0 && <span className="muted">Hasn't replied: {names(waiting)}</span>}
      {sessionSlots.has(slot) && <span className="chip chip-accent">Weekly session</span>}
      {pickAt.has(slot) && <span className="chip">Best time {pickAt.get(slot)}</span>}
    </p>
  );
}

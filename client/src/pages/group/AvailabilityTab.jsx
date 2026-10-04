import { useOutletContext } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import { formatWindow } from '../../time/week';

// Phase 7 placeholder: lists the saved availability in local time. The drag-to-select weekly
// grid replaces this in phase 8.
export default function AvailabilityTab() {
  const { group } = useOutletContext();
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api.getAvailability(group.id), group.id);

  if (data === undefined) {
    if (error) return <ErrorState error={error} onRetry={reload} title="Couldn't load your availability" />;
    return <Loading label="Loading your availability…" />;
  }

  const me = data.members.find((member) => member.userId === user.id);

  return (
    <section aria-labelledby="availability-heading">
      <h2 id="availability-heading">My availability</h2>
      <p className="flash flash-info">The drag-to-select weekly grid arrives in the next phase.</p>
      {me.availabilityUpdatedAt === null ? (
        <div className="empty">
          <p>You haven't added your availability for this group yet.</p>
        </div>
      ) : data.myRanges.length === 0 ? (
        <div className="empty">
          <p>You saved an empty week: you're marked as never free.</p>
        </div>
      ) : (
        <ul className="range-list">
          {data.myRanges.map((range) => (
            <li key={range.startMinute}>
              {formatWindow(range.startMinute, range.endMinute - range.startMinute, user.timeZone, { dayStyle: 'long' })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

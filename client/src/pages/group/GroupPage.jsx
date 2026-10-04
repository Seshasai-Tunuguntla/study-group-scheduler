import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import TimeZoneNote from '../../components/TimeZoneNote';
import NotFound from '../NotFound';
import SessionCard from './SessionCard';

// Short labels so all four fit side by side on a phone.
const TABS = [
  { path: 'availability', label: 'Availability' },
  { path: 'heatmap', label: 'Heatmap' },
  { path: 'suggestions', label: 'Suggestions' },
  { path: 'members', label: 'Members' },
];

// Keyed by group id, so moving to another group starts fresh instead of briefly showing the
// previous group's data.
export function GroupRoute() {
  const { groupId } = useParams();
  return <GroupPage key={groupId} groupId={groupId} />;
}

function GroupPage({ groupId }) {
  // Attendance depends on everyone's availability, which a "keep my local hours" switch can move.
  const { availabilityVersion } = useAuth();
  const groupLoad = useLoad(() => api.getGroup(groupId), groupId);
  const sessionLoad = useLoad(() => api.getSession(groupId), `${groupId}:${availabilityVersion}`);
  const group = groupLoad.data?.group;

  if (!group) {
    if (groupLoad.error?.status === 404) {
      return (
        <NotFound title="Group not found">
          This group doesn't exist, or you're not a member of it. Ask the organizer for the join code.
        </NotFound>
      );
    }
    if (groupLoad.error) {
      return <ErrorState error={groupLoad.error} onRetry={groupLoad.reload} title="Couldn't load this group" />;
    }
    return <Loading label="Loading group…" />;
  }

  const isOrganizer = group.myRole === 'ORGANIZER';
  const responded = group.members.filter((member) => member.availabilityUpdatedAt !== null).length;

  return (
    <div className="page">
      <header className="page-head">
        <Link to="/dashboard" className="back-link">
          ← All groups
        </Link>
        <div className="title-row">
          <h1>{group.name}</h1>
          <span className={`chip chip-role-${group.myRole.toLowerCase()}`}>{isOrganizer ? 'Organizer' : 'Member'}</span>
        </div>
        <p className="page-sub">
          {group.members.length} {group.members.length === 1 ? 'member' : 'members'} · {responded} added availability
        </p>
        <TimeZoneNote />
      </header>

      <SessionCard groupId={group.id} sessionLoad={sessionLoad} isOrganizer={isOrganizer} />

      <nav className="tabs" aria-label="Group sections">
        {TABS.map((tab) => (
          <NavLink key={tab.path} to={tab.path} className="tab">
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="tab-panel">
        <Outlet
          context={{
            group,
            isOrganizer,
            reloadGroup: groupLoad.reload,
            session: sessionLoad.data?.session ?? null,
            reloadSession: sessionLoad.reload,
          }}
        />
      </div>
    </div>
  );
}

import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Loading from './components/Loading';
import ErrorState from './components/ErrorState';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import { GroupRoute } from './pages/group/GroupPage';
import AvailabilityTab from './pages/group/AvailabilityTab';
import HeatmapTab from './pages/group/HeatmapTab';
import SuggestionsTab from './pages/group/SuggestionsTab';
import MembersTab from './pages/group/MembersTab';

// Signed-out visitors go to /login, which sends them back here after logging in.
function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function SignedOutOnly({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/dashboard" replace /> : children;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="brand-icon">
      <rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="11" y="13" width="4" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const { user, logout, loading, startupError, retryStartup } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <Link to={user ? '/dashboard' : '/login'} className="brand">
          <CalendarIcon />
          <span>Study Scheduler</span>
        </Link>
        {user && (
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <button type="button" className="btn-ghost" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>

      <main className="content">
        {loading ? (
          <Loading />
        ) : startupError ? (
          <div className="page page-narrow">
            <ErrorState error={startupError} onRetry={retryStartup} title="Can't reach the server" />
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
            <Route path="/login" element={<SignedOutOnly><Login /></SignedOutOnly>} />
            <Route path="/register" element={<SignedOutOnly><Register /></SignedOutOnly>} />
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/groups/:groupId" element={<GroupRoute />}>
                <Route index element={<Navigate to="availability" replace />} />
                <Route path="availability" element={<AvailabilityTab />} />
                <Route path="heatmap" element={<HeatmapTab />} />
                <Route path="suggestions" element={<SuggestionsTab />} />
                <Route path="members" element={<MembersTab />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout, { HomeRedirect, Logout, RequireAuth, SignedOutOnly } from './App';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import { GroupRoute } from './pages/group/GroupPage';
import AvailabilityTab from './pages/group/AvailabilityTab';
import HeatmapTab from './pages/group/HeatmapTab';
import SuggestionsTab from './pages/group/SuggestionsTab';
import MembersTab from './pages/group/MembersTab';

// A data router (rather than <BrowserRouter>) so pages can use useBlocker, e.g. to warn before
// leaving the availability grid with unsaved changes.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <SignedOutOnly><Login /></SignedOutOnly> },
      { path: '/register', element: <SignedOutOnly><Register /></SignedOutOnly> },
      { path: '/logout', element: <Logout /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/dashboard', element: <Dashboard /> },
          {
            path: '/groups/:groupId',
            element: <GroupRoute />,
            children: [
              { index: true, element: <Navigate to="availability" replace /> },
              { path: 'availability', element: <AvailabilityTab /> },
              { path: 'heatmap', element: <HeatmapTab /> },
              { path: 'suggestions', element: <SuggestionsTab /> },
              { path: 'members', element: <MembersTab /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

import { createContext } from 'react';

// { user, loading, startupError, retryStartup, login, register, logout, updateTimeZone,
//   availabilityVersion }, provided by <AuthProvider>, read with useAuth().
export const AuthContext = createContext(null);

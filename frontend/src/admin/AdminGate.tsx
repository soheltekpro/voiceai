import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getToken } from '../api/auth';

/** Redirect to login if no token; otherwise render nested admin routes via Outlet. */
export function AdminGate() {
  const location = useLocation();
  const token = getToken();
  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}

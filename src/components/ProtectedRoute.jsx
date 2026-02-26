import { Navigate } from 'react-router-dom';
import { useBranch } from '../context/BranchContext';

/** Requires any logged-in session. */
export default function ProtectedRoute({ children }) {
  const { branch } = useBranch();
  if (!branch) return <Navigate to="/" replace />;
  return children;
}

/** Requires an admin session. Branch accounts are redirected to /timeinout. */
export function AdminRoute({ children }) {
  const { branch } = useBranch();
  if (!branch) return <Navigate to="/" replace />;
  if (!branch.isAdmin) return <Navigate to="/timeinout" replace />;
  return children;
}

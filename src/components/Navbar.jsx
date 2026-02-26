import { Link, useNavigate } from 'react-router-dom';
import { useBranch } from '../context/BranchContext';

export default function Navbar() {
  const { branch, setBranch } = useBranch();
  const navigate = useNavigate();

  function handleLogout() {
    setBranch(null);
    navigate('/');
  }

  return (
    <nav className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3">
        <span className="font-bold text-lg tracking-wide">TimeIn</span>
        {branch && (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              branch.isAdmin
                ? 'bg-amber-400 text-amber-900'
                : 'bg-blue-500 text-white'
            }`}
          >
            {branch.isAdmin ? 'ADMIN' : branch.code}
          </span>
        )}
      </div>

      {branch && (
        <div className="flex items-center gap-4 text-sm">
          {branch.isAdmin ? (
            <>
              <Link to="/dashboard" className="hover:text-blue-200 transition-colors">
                Dashboard
              </Link>
              <Link to="/timeinout" className="hover:text-blue-200 transition-colors">
                Time In/Out
              </Link>
              <Link to="/register" className="hover:text-blue-200 transition-colors">
                Register
              </Link>
              <Link to="/admin" className="hover:text-blue-200 transition-colors">
                Admin
              </Link>
            </>
          ) : (
            <Link to="/timeinout" className="hover:text-blue-200 transition-colors">
              Time In/Out
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="bg-white text-blue-700 px-3 py-1 rounded font-semibold hover:bg-blue-50 transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}

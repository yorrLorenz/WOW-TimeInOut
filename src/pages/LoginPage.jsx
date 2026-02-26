import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranch } from '../context/BranchContext';
import { getBranch, saveBranch } from '../lib/db';

const DEFAULT_BRANCHES = [
  { code: 'MAIN-001', name: 'Main Branch' },
  { code: 'NORTH-002', name: 'North Branch' },
  { code: 'SOUTH-003', name: 'South Branch' },
];

export default function LoginPage() {
  const { setBranch } = useBranch();
  const navigate = useNavigate();

  const [accountCode, setAccountCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const code = accountCode.trim().toUpperCase();
      if (!code) {
        setError('Please enter your branch code or admin code.');
        return;
      }

      let account = await getBranch(code);

      // Auto-create known default branches on first run
      if (!account) {
        const defaultBranch = DEFAULT_BRANCHES.find((b) => b.code === code);
        if (defaultBranch) {
          await saveBranch({ ...defaultBranch, pin: '1234' });
          account = { ...defaultBranch, pin: '1234' };
        }
      }

      if (!account) {
        setError('Account not found. Check your branch code or contact your administrator.');
        return;
      }

      if (account.pin && account.pin !== pin) {
        setError('Incorrect PIN.');
        return;
      }

      const isAdmin = account.isAdmin ?? false;
      // Store minimal context — never the PIN
      setBranch({ code: account.code, name: account.name, isAdmin });
      navigate(isAdmin ? '/dashboard' : '/timeinout');
    } catch (err) {
      setError('Login failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">TimeIn</h1>
          <p className="text-gray-500 text-sm mt-1">Employee Attendance System</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account Code
            </label>
            <input
              type="text"
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="e.g. MAIN-001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              PIN
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
          <p className="font-medium mb-1">Branch codes (default PIN: 1234):</p>
          {DEFAULT_BRANCHES.map((b) => (
            <button
              key={b.code}
              type="button"
              onClick={() => setAccountCode(b.code)}
              className="block hover:text-blue-600 transition-colors"
            >
              {b.code} — {b.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
